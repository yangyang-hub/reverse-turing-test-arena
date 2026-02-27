package ws

import (
	"encoding/json"
	"log"
	"sync"
)

// BroadcastMsg is a message to broadcast to all clients in a room.
type BroadcastMsg struct {
	RoomID int
	Data   []byte
}

// Hub maintains a set of active WebSocket clients grouped by room.
type Hub struct {
	mu         sync.RWMutex
	rooms      map[int]map[*Client]bool
	register   chan *Client
	unregister chan *Client
	broadcast  chan *BroadcastMsg
}

func NewHub() *Hub {
	return &Hub{
		rooms:      make(map[int]map[*Client]bool),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan *BroadcastMsg, 256),
	}
}

// Run starts the hub's event loop — must run in its own goroutine.
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			if h.rooms[client.RoomID] == nil {
				h.rooms[client.RoomID] = make(map[*Client]bool)
			}
			h.rooms[client.RoomID][client] = true
			h.mu.Unlock()
			log.Printf("[Hub] Client %s joined room %d (total: %d)", client.Address, client.RoomID, len(h.rooms[client.RoomID]))

		case client := <-h.unregister:
			h.mu.Lock()
			if clients, ok := h.rooms[client.RoomID]; ok {
				delete(clients, client)
				if len(clients) == 0 {
					delete(h.rooms, client.RoomID)
				}
			}
			close(client.send)
			h.mu.Unlock()
			log.Printf("[Hub] Client %s left room %d", client.Address, client.RoomID)

		case msg := <-h.broadcast:
			h.mu.RLock()
			clients := h.rooms[msg.RoomID]
			for client := range clients {
				select {
				case client.send <- msg.Data:
				default:
					// Client send buffer full — skip
				}
			}
			h.mu.RUnlock()
		}
	}
}

// Broadcast sends a message to all clients in a room.
func (h *Hub) Broadcast(roomID int, payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[Hub] Failed to marshal broadcast: %v", err)
		return
	}
	h.broadcast <- &BroadcastMsg{RoomID: roomID, Data: data}
}

// Register adds a client to the hub.
func (h *Hub) Register(client *Client) {
	h.register <- client
}

// Unregister removes a client from the hub.
func (h *Hub) Unregister(client *Client) {
	h.unregister <- client
}
