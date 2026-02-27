package chain

import (
	"context"
	"log"
	"sync"
	"time"
)

// CachedRoom holds a snapshot of room state from the contract.
type CachedRoom struct {
	Phase        uint8
	CurrentRound uint64
	AliveCount   int
	AlivePlayers map[string]bool   // lowercase address → alive
	PlayerNames  map[string]string // lowercase address → name
	UpdatedAt    time.Time
}

// RoomStateCache polls the contract for room state on a schedule.
// Only rooms with active WebSocket connections are polled.
type RoomStateCache struct {
	mu       sync.RWMutex
	rooms    map[int]*CachedRoom // roomId → cached state
	watchers map[int]int         // roomId → active connection count
	reader   *ChainReader
	pollMs   int
}

func NewRoomStateCache(reader *ChainReader, pollMs int) *RoomStateCache {
	return &RoomStateCache{
		rooms:    make(map[int]*CachedRoom),
		watchers: make(map[int]int),
		reader:   reader,
		pollMs:   pollMs,
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
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	roomInfo, err := c.reader.GetRoomInfo(ctx, roomId)
	if err != nil {
		log.Printf("[Cache] Failed to refresh room %d: %v", roomId, err)
		return
	}

	round, err := c.reader.GetCurrentRound(ctx, roomId)
	if err != nil {
		log.Printf("[Cache] Failed to get round for room %d: %v", roomId, err)
		return
	}

	// Fetch player list and names
	players, err := c.reader.GetAllPlayers(ctx, roomId)
	if err != nil {
		log.Printf("[Cache] Failed to get players for room %d: %v", roomId, err)
		return
	}

	names, err := c.reader.GetRoomPlayerNames(ctx, roomId)
	if err != nil {
		log.Printf("[Cache] Failed to get player names for room %d: %v", roomId, err)
	}

	// Parallel fetch player info using goroutines
	type playerResult struct {
		idx   int
		alive bool
		err   error
	}

	ch := make(chan playerResult, len(players))
	for i, addr := range players {
		go func(idx int, a string) {
			pInfo, err := c.reader.GetPlayerInfo(ctx, roomId, a)
			if err != nil {
				ch <- playerResult{idx: idx, err: err}
			} else {
				ch <- playerResult{idx: idx, alive: pInfo.IsAlive}
			}
		}(i, addr)
	}

	alivePlayers := make(map[string]bool, len(players))
	playerNames := make(map[string]string, len(players))
	for i := 0; i < len(players); i++ {
		r := <-ch
		if r.err == nil {
			alivePlayers[players[r.idx]] = r.alive
		}
		if r.idx < len(names) && names[r.idx] != "" {
			playerNames[players[r.idx]] = names[r.idx]
		}
	}

	c.mu.Lock()
	c.rooms[roomId] = &CachedRoom{
		Phase:        roomInfo.Phase,
		CurrentRound: round,
		AliveCount:   roomInfo.AliveCount,
		AlivePlayers: alivePlayers,
		PlayerNames:  playerNames,
		UpdatedAt:    time.Now(),
	}
	c.mu.Unlock()
}

// IsPlayerAlive checks if a player is alive in a room (from cache).
func (c *RoomStateCache) IsPlayerAlive(roomId int, addr string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	room, ok := c.rooms[roomId]
	if !ok {
		return false
	}
	return room.AlivePlayers[addr]
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

// IsPlayerInRoom checks if an address is a player in the room.
func (c *RoomStateCache) IsPlayerInRoom(roomId int, addr string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	room, ok := c.rooms[roomId]
	if !ok {
		return false
	}
	_, exists := room.AlivePlayers[addr]
	return exists
}
