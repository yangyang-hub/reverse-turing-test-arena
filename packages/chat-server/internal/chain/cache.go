package chain

import (
	"context"
	"log"
	"math/big"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/common"
)

// CachedPlayer holds per-player cached state.
type CachedPlayer struct {
	IsAlive       bool `json:"isAlive"`
	HumanityScore int  `json:"humanityScore"`
}

// CachedRoom holds a snapshot of room state from the contract.
type CachedRoom struct {
	Phase         uint8
	CurrentRound  uint64
	AliveCount    int
	PlayerCount   int
	PendingReveal bool
	Players       map[string]*CachedPlayer // lowercase address → player state
	PlayerNames   map[string]string        // lowercase address → name
	UpdatedAt     time.Time
}

// RoomStateCache polls the contract for room state on a schedule.
// Only rooms with active WebSocket connections are polled.
type RoomStateCache struct {
	mu          sync.RWMutex
	rooms       map[int]*CachedRoom // roomId → cached state
	watchers    map[int]int         // roomId → active connection count
	refreshing  map[int]bool        // roomId → refresh in progress (prevents concurrent RPC bursts)
	noMulticall bool                // true if Multicall3 is unavailable (auto-detected on first failure)
	reader      *ChainReader
	pollMs      int
}

func NewRoomStateCache(reader *ChainReader, pollMs int) *RoomStateCache {
	return &RoomStateCache{
		rooms:      make(map[int]*CachedRoom),
		watchers:   make(map[int]int),
		refreshing: make(map[int]bool),
		reader:     reader,
		pollMs:     pollMs,
	}
}

// Watch increments the watcher count for a room — call when a WS client joins.
func (c *RoomStateCache) Watch(roomId int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.watchers[roomId]++

	// Immediately populate cache if first watcher
	if c.watchers[roomId] == 1 {
		go c.refreshRoom(roomId)
	}
}

// Unwatch decrements the watcher count — call when a WS client leaves.
func (c *RoomStateCache) Unwatch(roomId int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.watchers[roomId] <= 0 {
		return // no watchers to decrement
	}
	c.watchers[roomId]--
	if c.watchers[roomId] <= 0 {
		delete(c.watchers, roomId)
		delete(c.rooms, roomId)
	}
}

// StartPolling runs a background goroutine refreshing all watched rooms.
func (c *RoomStateCache) StartPolling(ctx context.Context) {
	ticker := time.NewTicker(time.Duration(c.pollMs) * time.Millisecond)
	defer ticker.Stop()

	log.Printf("[Cache] Polling started (interval: %dms)", c.pollMs)

	for {
		select {
		case <-ticker.C:
			c.refreshAll()
		case <-ctx.Done():
			log.Println("[Cache] Polling stopped")
			return
		}
	}
}

func (c *RoomStateCache) refreshAll() {
	c.mu.RLock()
	ids := make([]int, 0, len(c.watchers))
	for id := range c.watchers {
		ids = append(ids, id)
	}
	c.mu.RUnlock()

	for _, id := range ids {
		c.refreshRoom(id)
	}
}

func (c *RoomStateCache) refreshRoom(roomId int) {
	// Prevent concurrent refreshes for the same room.
	// If Watch() triggers a goroutine while the ticker is already refreshing,
	// skip to avoid duplicate RPC bursts.
	c.mu.Lock()
	if c.refreshing[roomId] {
		c.mu.Unlock()
		return
	}
	c.refreshing[roomId] = true
	tryBatch := !c.noMulticall
	c.mu.Unlock()

	defer func() {
		c.mu.Lock()
		delete(c.refreshing, roomId)
		c.mu.Unlock()
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Try Multicall3 batch (2 HTTP requests instead of 4+N)
	if tryBatch && c.batchRefreshRoom(ctx, roomId) {
		return
	}

	// Fallback: individual parallel calls
	c.individualRefreshRoom(ctx, roomId)
}

// batchRefreshRoom fetches all room data via Multicall3 in 1-2 HTTP requests.
// Returns true on success, false to trigger fallback.
func (c *RoomStateCache) batchRefreshRoom(ctx context.Context, roomId int) bool {
	rid := big.NewInt(int64(roomId))

	// Batch 1: 5 metadata calls → 1 HTTP request
	call0, err := c.reader.MakeCall(false, "getRoomInfo", rid)
	if err != nil {
		return false
	}
	call1, err := c.reader.MakeCall(false, "currentRound", rid)
	if err != nil {
		return false
	}
	call2, err := c.reader.MakeCall(false, "getAllPlayers", rid)
	if err != nil {
		return false
	}
	call3, err := c.reader.MakeCall(true, "getRoomPlayerNames", rid)
	if err != nil {
		return false
	}
	call4, err := c.reader.MakeCall(true, "pendingReveal", rid)
	if err != nil {
		return false
	}

	results, err := c.reader.BatchCall(ctx, []Multicall3Call{call0, call1, call2, call3, call4})
	if err != nil {
		c.mu.Lock()
		if !c.noMulticall {
			c.noMulticall = true
			log.Printf("[Cache] Multicall3 unavailable: %v — using individual calls", err)
		}
		c.mu.Unlock()
		return false
	}

	// Unpack getRoomInfo
	if !results[0].Success {
		return false
	}
	roomInfo, err := c.reader.UnpackRoomInfo(results[0].ReturnData)
	if err != nil {
		log.Printf("[Cache] Batch unpack getRoomInfo room %d: %v", roomId, err)
		return false
	}

	// Unpack currentRound
	if !results[1].Success {
		return false
	}
	round, err := c.reader.UnpackCurrentRound(results[1].ReturnData)
	if err != nil {
		log.Printf("[Cache] Batch unpack currentRound room %d: %v", roomId, err)
		return false
	}

	// Unpack getAllPlayers
	if !results[2].Success {
		return false
	}
	players, err := c.reader.UnpackAllPlayers(results[2].ReturnData)
	if err != nil {
		log.Printf("[Cache] Batch unpack getAllPlayers room %d: %v", roomId, err)
		return false
	}

	// Unpack names (optional — allowFailure=true)
	var names []string
	if results[3].Success {
		names, _ = c.reader.UnpackPlayerNames(results[3].ReturnData)
	}

	// Unpack pendingReveal (optional — allowFailure=true)
	var pendingReveal bool
	if results[4].Success {
		pendingReveal, _ = c.reader.UnpackPendingReveal(results[4].ReturnData)
	}

	// Build player maps — initialize defaults for ALL players first
	playersMap := make(map[string]*CachedPlayer, len(players))
	playerNames := make(map[string]string, len(players))

	for i, addr := range players {
		// Default: alive with full HP (accurate for waiting rooms, overwritten for active)
		playersMap[addr] = &CachedPlayer{IsAlive: true, HumanityScore: 100}
		if i < len(names) && names[i] != "" {
			playerNames[addr] = names[i]
		}
	}

	// Phase-aware: only fetch playerInfo for active rooms (phase 1)
	if roomInfo.Phase == 1 && len(players) > 0 {
		// Batch 2: N getPlayerInfo calls → 1 HTTP request
		playerCalls := make([]Multicall3Call, len(players))
		for i, addr := range players {
			pc, err := c.reader.MakeCall(true, "getPlayerInfo", rid, common.HexToAddress(addr))
			if err != nil {
				log.Printf("[Cache] Batch pack getPlayerInfo %s: %v", addr, err)
				return false
			}
			playerCalls[i] = pc
		}

		playerResults, err := c.reader.BatchCall(ctx, playerCalls)
		if err != nil {
			log.Printf("[Cache] Batch playerInfo room %d: %v", roomId, err)
			// Partial success — use metadata without playerInfo
		} else {
			for i, r := range playerResults {
				if r.Success {
					pInfo, err := c.reader.UnpackPlayerInfo(r.ReturnData)
					if err == nil {
						playersMap[players[i]] = &CachedPlayer{
							IsAlive:       pInfo.IsAlive,
							HumanityScore: pInfo.HumanityScore,
						}
					}
				}
			}
		}
	}

	c.mu.Lock()
	c.rooms[roomId] = &CachedRoom{
		Phase:         roomInfo.Phase,
		CurrentRound:  round,
		AliveCount:    roomInfo.AliveCount,
		PlayerCount:   roomInfo.PlayerCount,
		PendingReveal: pendingReveal,
		Players:       playersMap,
		PlayerNames:   playerNames,
		UpdatedAt:     time.Now(),
	}
	c.mu.Unlock()

	return true
}

// individualRefreshRoom fetches room data using parallel individual RPC calls.
// Used as fallback when Multicall3 is unavailable (e.g., local Anvil).
func (c *RoomStateCache) individualRefreshRoom(ctx context.Context, roomId int) {
	// Parallel fetch room metadata (5 independent calls → 1 RTT instead of 5)
	type metaResult struct {
		roomInfo      *RoomInfo
		round         uint64
		players       []string
		names         []string
		pendingReveal bool
		err           [5]error // one per call
	}
	meta := metaResult{}
	var wg sync.WaitGroup
	wg.Add(5)

	go func() {
		defer wg.Done()
		info, err := c.reader.GetRoomInfo(ctx, roomId)
		meta.roomInfo = info
		meta.err[0] = err
	}()
	go func() {
		defer wg.Done()
		r, err := c.reader.GetCurrentRound(ctx, roomId)
		meta.round = r
		meta.err[1] = err
	}()
	go func() {
		defer wg.Done()
		p, err := c.reader.GetAllPlayers(ctx, roomId)
		meta.players = p
		meta.err[2] = err
	}()
	go func() {
		defer wg.Done()
		n, err := c.reader.GetRoomPlayerNames(ctx, roomId)
		meta.names = n
		meta.err[3] = err
	}()
	go func() {
		defer wg.Done()
		pr, err := c.reader.GetPendingReveal(ctx, roomId)
		meta.pendingReveal = pr
		meta.err[4] = err
	}()
	wg.Wait()

	if meta.err[0] != nil {
		log.Printf("[Cache] Failed to refresh room %d: %v", roomId, meta.err[0])
		return
	}
	if meta.err[1] != nil {
		log.Printf("[Cache] Failed to get round for room %d: %v", roomId, meta.err[1])
		return
	}
	if meta.err[2] != nil {
		log.Printf("[Cache] Failed to get players for room %d: %v", roomId, meta.err[2])
		return
	}
	if meta.err[3] != nil {
		log.Printf("[Cache] Failed to get player names for room %d: %v", roomId, meta.err[3])
	}
	if meta.err[4] != nil {
		log.Printf("[Cache] Failed to get pendingReveal for room %d: %v", roomId, meta.err[4])
	}

	players := meta.players
	names := meta.names

	// Parallel fetch player info using goroutines
	type playerResult struct {
		idx           int
		alive         bool
		humanityScore int
		err           error
	}

	ch := make(chan playerResult, len(players))
	for i, addr := range players {
		go func(idx int, a string) {
			pInfo, err := c.reader.GetPlayerInfo(ctx, roomId, a)
			if err != nil {
				ch <- playerResult{idx: idx, err: err}
			} else {
				ch <- playerResult{idx: idx, alive: pInfo.IsAlive, humanityScore: pInfo.HumanityScore}
			}
		}(i, addr)
	}

	playersMap := make(map[string]*CachedPlayer, len(players))
	playerNames := make(map[string]string, len(players))

	// Initialize defaults for ALL players (ensures IsPlayerInRoom works even if getPlayerInfo fails)
	for i, addr := range players {
		playersMap[addr] = &CachedPlayer{IsAlive: true, HumanityScore: 100}
		if i < len(names) && names[i] != "" {
			playerNames[addr] = names[i]
		}
	}

	for i := 0; i < len(players); i++ {
		r := <-ch
		if r.err == nil {
			playersMap[players[r.idx]] = &CachedPlayer{
				IsAlive:       r.alive,
				HumanityScore: r.humanityScore,
			}
		}
	}

	c.mu.Lock()
	c.rooms[roomId] = &CachedRoom{
		Phase:         meta.roomInfo.Phase,
		CurrentRound:  meta.round,
		AliveCount:    meta.roomInfo.AliveCount,
		PlayerCount:   meta.roomInfo.PlayerCount,
		PendingReveal: meta.pendingReveal,
		Players:       playersMap,
		PlayerNames:   playerNames,
		UpdatedAt:     time.Now(),
	}
	c.mu.Unlock()
}

// --- Cache query methods ---

// IsPlayerAlive checks if a player is alive in a room (from cache).
func (c *RoomStateCache) IsPlayerAlive(roomId int, addr string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	room, ok := c.rooms[roomId]
	if !ok {
		return false
	}
	p, exists := room.Players[addr]
	return exists && p.IsAlive
}

// IsRoomActive checks if a room is in the active phase.
func (c *RoomStateCache) IsRoomActive(roomId int) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	room, ok := c.rooms[roomId]
	if !ok {
		return false
	}
	return room.Phase == 1 // Active phase
}

// GetCurrentRound returns the cached round number.
func (c *RoomStateCache) GetCurrentRound(roomId int) uint64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	room, ok := c.rooms[roomId]
	if !ok {
		return 0
	}
	return room.CurrentRound
}

// GetPhase returns the cached phase for a room. Returns 255 if not in cache.
func (c *RoomStateCache) GetPhase(roomId int) uint8 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	room, ok := c.rooms[roomId]
	if !ok {
		return 255 // not in cache
	}
	return room.Phase
}

// GetAliveCount returns the cached alive count for a room. Returns -1 if not in cache.
func (c *RoomStateCache) GetAliveCount(roomId int) int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	room, ok := c.rooms[roomId]
	if !ok {
		return -1
	}
	return room.AliveCount
}

// IsPlayerInRoom checks if an address is a player in the room.
// Returns (inRoom, roomCached). If roomCached is false, the room is not in cache
// and the result is inconclusive (callers should not treat this as "not in room").
func (c *RoomStateCache) IsPlayerInRoom(roomId int, addr string) (bool, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	room, ok := c.rooms[roomId]
	if !ok {
		return false, false
	}
	_, exists := room.Players[addr]
	return exists, true
}

// RoomStateJSON is the REST-friendly snapshot of a cached room.
type RoomStateJSON struct {
	RoomID        int                        `json:"roomId"`
	Phase         uint8                      `json:"phase"`
	CurrentRound  uint64                     `json:"currentRound"`
	PendingReveal bool                       `json:"pendingReveal"`
	AliveCount    int                        `json:"aliveCount"`
	PlayerCount   int                        `json:"playerCount"`
	Players       map[string]*CachedPlayer   `json:"players"`
	PlayerNames   map[string]string          `json:"playerNames"`
	UpdatedAt     time.Time                  `json:"updatedAt"`
}

// GetRoomState returns a REST-friendly snapshot of the cached room.
// Returns nil if the room is not in cache.
func (c *RoomStateCache) GetRoomState(roomId int) *RoomStateJSON {
	c.mu.RLock()
	defer c.mu.RUnlock()
	room, ok := c.rooms[roomId]
	if !ok {
		return nil
	}
	return &RoomStateJSON{
		RoomID:        roomId,
		Phase:         room.Phase,
		CurrentRound:  room.CurrentRound,
		PendingReveal: room.PendingReveal,
		AliveCount:    room.AliveCount,
		PlayerCount:   room.PlayerCount,
		Players:       room.Players,
		PlayerNames:   room.PlayerNames,
		UpdatedAt:     room.UpdatedAt,
	}
}
