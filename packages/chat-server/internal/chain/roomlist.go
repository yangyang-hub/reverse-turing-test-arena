package chain

import (
	"context"
	"log"
	"math/big"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum"
)

const batchChunkSize = 200 // max getRoomInfo calls per Multicall3 batch

// RoomListCache provides a shared, TTL-based cache of all room summaries.
// All API clients share the same snapshot — only one RPC refresh per TTL window.
type RoomListCache struct {
	mu        sync.RWMutex
	rooms     []RoomSummary
	updatedAt time.Time
	ttl       time.Duration
	reader    *ChainReader
}

func NewRoomListCache(reader *ChainReader, ttl time.Duration) *RoomListCache {
	return &RoomListCache{
		reader: reader,
		ttl:    ttl,
	}
}

// GetAll returns all room summaries. Uses cached data if fresh, otherwise refreshes.
func (c *RoomListCache) GetAll(ctx context.Context) ([]RoomSummary, error) {
	c.mu.RLock()
	if time.Since(c.updatedAt) < c.ttl && c.rooms != nil {
		rooms := c.rooms
		c.mu.RUnlock()
		return rooms, nil
	}
	c.mu.RUnlock()

	return c.refresh(ctx)
}

func (c *RoomListCache) refresh(ctx context.Context) ([]RoomSummary, error) {
	c.mu.Lock()
	// Double-check after acquiring write lock (another goroutine may have refreshed)
	if time.Since(c.updatedAt) < c.ttl && c.rooms != nil {
		rooms := c.rooms
		c.mu.Unlock()
		return rooms, nil
	}
	c.mu.Unlock()

	count, err := c.reader.GetRoomCount(ctx)
	if err != nil {
		return nil, err
	}
	if count == 0 {
		c.mu.Lock()
		c.rooms = []RoomSummary{}
		c.updatedAt = time.Now()
		c.mu.Unlock()
		return []RoomSummary{}, nil
	}

	rooms, err := c.fetchAllRooms(ctx, count)
	if err != nil {
		return nil, err
	}

	c.mu.Lock()
	c.rooms = rooms
	c.updatedAt = time.Now()
	c.mu.Unlock()

	return rooms, nil
}

func (c *RoomListCache) fetchAllRooms(ctx context.Context, count int) ([]RoomSummary, error) {
	// Build all getRoomInfo calls (roomId 1..count)
	calls := make([]Multicall3Call, count)
	for i := 0; i < count; i++ {
		call, err := c.reader.MakeCall(true, "getRoomInfo", big.NewInt(int64(i+1)))
		if err != nil {
			return nil, err
		}
		calls[i] = call
	}

	// Execute in chunks to avoid oversized RPC payloads
	allResults := make([]Multicall3Result, 0, count)
	for start := 0; start < len(calls); start += batchChunkSize {
		end := start + batchChunkSize
		if end > len(calls) {
			end = len(calls)
		}
		chunk := calls[start:end]

		results, err := c.reader.BatchCall(ctx, chunk)
		if err != nil {
			log.Printf("[RoomList] Multicall3 failed at chunk %d-%d: %v — falling back to individual calls", start, end, err)
			return c.fetchAllRoomsIndividual(ctx, count)
		}
		allResults = append(allResults, results...)
	}

	// Decode results
	rooms := make([]RoomSummary, 0, count)
	for i, r := range allResults {
		roomId := i + 1
		if !r.Success || len(r.ReturnData) == 0 {
			continue
		}
		summary, err := c.reader.UnpackRoomSummary(r.ReturnData, roomId)
		if err != nil {
			log.Printf("[RoomList] Unpack room %d failed: %v", roomId, err)
			continue
		}
		rooms = append(rooms, *summary)
	}

	return rooms, nil
}

// fetchAllRoomsIndividual is the fallback when Multicall3 is unavailable.
func (c *RoomListCache) fetchAllRoomsIndividual(ctx context.Context, count int) ([]RoomSummary, error) {
	type result struct {
		idx     int
		summary *RoomSummary
		err     error
	}

	ch := make(chan result, count)
	for i := 1; i <= count; i++ {
		go func(roomId int) {
			data, err := c.reader.abi.Pack("getRoomInfo", big.NewInt(int64(roomId)))
			if err != nil {
				ch <- result{idx: roomId, err: err}
				return
			}
			rawResult, err := c.reader.client.CallContract(ctx, ethereum.CallMsg{
				To:   &c.reader.contract,
				Data: data,
			}, nil)
			if err != nil {
				ch <- result{idx: roomId, err: err}
				return
			}
			summary, err := c.reader.UnpackRoomSummary(rawResult, roomId)
			if err != nil {
				ch <- result{idx: roomId, err: err}
				return
			}
			ch <- result{idx: roomId, summary: summary}
		}(i)
	}

	rooms := make([]RoomSummary, 0, count)
	for i := 0; i < count; i++ {
		r := <-ch
		if r.err != nil {
			log.Printf("[RoomList] Individual fetch room %d: %v", r.idx, r.err)
			continue
		}
		rooms = append(rooms, *r.summary)
	}

	return rooms, nil
}
