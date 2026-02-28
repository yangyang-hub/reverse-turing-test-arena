package ws

import (
	"log"
	"strings"
	"time"

	"github.com/rtta/chat-server/internal/auth"
	"github.com/rtta/chat-server/internal/chain"
	"github.com/rtta/chat-server/internal/db"
	"github.com/rtta/chat-server/internal/operator"
	"gorm.io/gorm"
)

// IncomingMessage represents a message from the client.
type IncomingMessage struct {
	Type      string `json:"type"`
	Message   string `json:"message,omitempty"`   // for auth (SIWE)
	Signature string `json:"signature,omitempty"` // for auth (SIWE)
	Token     string `json:"token,omitempty"`     // for auth (token-based, no re-signing)
	RoomID    int    `json:"roomId,omitempty"`    // for join_room / send_message
	Content   string `json:"content,omitempty"`   // for send_message
}

// OutgoingMessage represents a message to the client.
type OutgoingMessage struct {
	Type      string       `json:"type"`
	Address   string       `json:"address,omitempty"`
	Token     string       `json:"token,omitempty"` // returned in auth_ok for client caching
	RoomID    int          `json:"roomId,omitempty"`
	Round     int          `json:"round"`
	Sender    string       `json:"sender,omitempty"`
	Content   string       `json:"content,omitempty"`
	CreatedAt *time.Time   `json:"createdAt,omitempty"`
	Messages  []db.Message `json:"messages,omitempty"`
	Code      string       `json:"code,omitempty"`
	Message   string       `json:"message,omitempty"`
	IsAI      *bool        `json:"isAI,omitempty"` // sent in room_joined response
}

// Handler processes WebSocket messages.
type Handler struct {
	hub       *Hub
	database  *gorm.DB
	authSvc   *auth.Service
	cache     *chain.RoomStateCache
	opService *operator.Service
}

func NewHandler(hub *Hub, database *gorm.DB, authSvc *auth.Service, cache *chain.RoomStateCache, opService *operator.Service) *Handler {
	return &Handler{
		hub:       hub,
		database:  database,
		authSvc:   authSvc,
		cache:     cache,
		opService: opService,
	}
}

// HandleMessage dispatches an incoming message to the appropriate handler.
func (h *Handler) HandleMessage(client *Client, msg *IncomingMessage) {
	switch msg.Type {
	case "auth":
		h.handleAuth(client, msg)
	case "join_room":
		h.handleJoinRoom(client, msg)
	case "send_message":
		h.handleSendMessage(client, msg)
	default:
		client.SendJSON(OutgoingMessage{Type: "error", Code: "unknown_type", Message: "Unknown message type"})
	}
}

func (h *Handler) handleAuth(client *Client, msg *IncomingMessage) {
	// Token-based auth: reuse existing session (no re-signing needed)
	if msg.Token != "" {
		address, err := h.authSvc.ValidateToken(msg.Token)
		if err != nil {
			client.SendJSON(OutgoingMessage{Type: "error", Code: "auth_failed", Message: "Invalid or expired token"})
			return
		}
		client.Address = address
		client.SendJSON(OutgoingMessage{Type: "auth_ok", Address: address, Token: msg.Token})
		log.Printf("[WS] Token auth: %s", address)
		return
	}

	// Signature-based auth: SIWE (first time)
	if msg.Message == "" || msg.Signature == "" {
		client.SendJSON(OutgoingMessage{Type: "error", Code: "auth_failed", Message: "Missing message or signature"})
		return
	}

	token, address, err := h.authSvc.Authenticate(msg.Message, msg.Signature)
	if err != nil {
		log.Printf("[WS] Auth failed: %v", err)
		client.SendJSON(OutgoingMessage{Type: "error", Code: "auth_failed", Message: "Authentication failed: " + err.Error()})
		return
	}

	client.Address = address
	client.SendJSON(OutgoingMessage{Type: "auth_ok", Address: address, Token: token})
	log.Printf("[WS] Authenticated: %s", address)
}

func (h *Handler) handleJoinRoom(client *Client, msg *IncomingMessage) {
	if client.Address == "" {
		client.SendJSON(OutgoingMessage{Type: "error", Code: "not_authenticated", Message: "Authenticate first"})
		return
	}

	if msg.RoomID <= 0 {
		client.SendJSON(OutgoingMessage{Type: "error", Code: "invalid_room", Message: "Invalid room ID"})
		return
	}

	// Leave previous room if any
	if client.RoomID != 0 {
		h.hub.Unregister(client)
		h.cache.Unwatch(client.RoomID)
	}

	client.RoomID = msg.RoomID
	h.hub.Register(client)
	h.cache.Watch(msg.RoomID)

	// Send recent messages from DB
	var messages []db.Message
	if err := h.database.Where("room_id = ?", msg.RoomID).Order("created_at ASC").Limit(100).Find(&messages).Error; err != nil {
		log.Printf("[WS] Failed to fetch messages for room %d: %v", msg.RoomID, err)
	}

	// Look up the player's identity from operator service (commit-reveal)
	response := OutgoingMessage{
		Type:     "room_joined",
		RoomID:   msg.RoomID,
		Messages: messages,
	}
	if h.opService != nil {
		isAI, err := h.opService.IsPlayerAI(msg.RoomID, client.Address)
		if err == nil {
			response.IsAI = &isAI
		}
	}

	client.SendJSON(response)
}

func (h *Handler) handleSendMessage(client *Client, msg *IncomingMessage) {
	if client.Address == "" {
		client.SendJSON(OutgoingMessage{Type: "error", Code: "not_authenticated", Message: "Authenticate first"})
		return
	}

	roomId := msg.RoomID
	if roomId <= 0 {
		roomId = client.RoomID
	}
	if roomId <= 0 {
		client.SendJSON(OutgoingMessage{Type: "error", Code: "no_room", Message: "Join a room first"})
		return
	}

	addr := strings.ToLower(client.Address)
	content := strings.TrimSpace(msg.Content)

	// Validate content length
	if len(content) == 0 || len(content) > 280 {
		client.SendJSON(OutgoingMessage{Type: "error", Code: "invalid_message", Message: "Message must be 1-280 characters"})
		return
	}

	// Validate: room is active
	if !h.cache.IsRoomActive(roomId) {
		client.SendJSON(OutgoingMessage{Type: "error", Code: "room_not_active", Message: "Room is not active"})
		return
	}

	// Validate: player is alive
	if !h.cache.IsPlayerAlive(roomId, addr) {
		client.SendJSON(OutgoingMessage{Type: "error", Code: "player_eliminated", Message: "You are eliminated"})
		return
	}

	// Channel exclusivity: AI players must use MCP, not WebSocket chat
	if h.opService != nil {
		isAI, err := h.opService.IsPlayerAI(roomId, addr)
		if err == nil && isAI {
			client.SendJSON(OutgoingMessage{Type: "error", Code: "channel_exclusive", Message: "AI agents must use MCP for chat"})
			return
		}
	}

	// Validate: 3 messages per round
	round := h.cache.GetCurrentRound(roomId)
	var count int64
	h.database.Model(&db.Message{}).Where("room_id = ? AND round = ? AND sender = ?", roomId, int(round), addr).Count(&count)
	if count >= 6 {
		client.SendJSON(OutgoingMessage{Type: "error", Code: "message_limit", Message: "Message limit reached (6/round)"})
		return
	}

	// Store in DB
	now := time.Now()
	message := &db.Message{
		RoomID:    roomId,
		Round:     int(round),
		Sender:    addr,
		Content:   content,
		CreatedAt: now,
	}
	if err := h.database.Create(message).Error; err != nil {
		log.Printf("[WS] Failed to save message: %v", err)
		client.SendJSON(OutgoingMessage{Type: "error", Code: "db_error", Message: "Failed to save message"})
		return
	}

	// Broadcast to all clients in the room
	h.hub.Broadcast(roomId, OutgoingMessage{
		Type:      "new_message",
		RoomID:    roomId,
		Round:     int(round),
		Sender:    addr,
		Content:   content,
		CreatedAt: &now,
	})
}

// OnDisconnect is called when a client disconnects.
func (h *Handler) OnDisconnect(client *Client) {
	if client.RoomID != 0 {
		h.cache.Unwatch(client.RoomID)
	}
}
