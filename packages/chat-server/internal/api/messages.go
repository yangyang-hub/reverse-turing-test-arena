package api

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rtta/chat-server/internal/chain"
	"github.com/rtta/chat-server/internal/db"
	"github.com/rtta/chat-server/internal/operator"
	"github.com/rtta/chat-server/internal/ws"
	"gorm.io/gorm"
)

// SendMessageRequest is the JSON body for POST /api/rooms/:roomId/messages.
type SendMessageRequest struct {
	Content string `json:"content" binding:"required"`
}

// HandleGetMessages godoc
// GET /api/rooms/:roomId/messages — fetch messages, optionally filtered by round
func HandleGetMessages(database *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		roomId, err := strconv.Atoi(c.Param("roomId"))
		if err != nil || roomId <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid room ID"})
			return
		}

		query := database.Where("room_id = ?", roomId)

		if roundStr := c.Query("round"); roundStr != "" {
			round, err := strconv.Atoi(roundStr)
			if err == nil {
				query = query.Where("round = ?", round)
			}
		}

		var messages []db.Message
		if err := query.Order("created_at ASC").Limit(500).Find(&messages).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch messages"})
			return
		}

		c.JSON(http.StatusOK, messages)
	}
}

// HandlePostMessage godoc
// POST /api/rooms/:roomId/messages — send a message (for MCP adapter / AI players only)
func HandlePostMessage(database *gorm.DB, hub *ws.Hub, cache *chain.RoomStateCache, opService *operator.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		roomId, err := strconv.Atoi(c.Param("roomId"))
		if err != nil || roomId <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid room ID"})
			return
		}

		var req SendMessageRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Missing content"})
			return
		}

		content := strings.TrimSpace(req.Content)
		if len(content) == 0 || len(content) > 280 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Message must be 1-280 characters"})
			return
		}

		// Get authenticated address from middleware
		addr, exists := c.Get("address")
		if !exists {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
			return
		}
		senderAddr := strings.ToLower(addr.(string))

		// Channel exclusivity: REST POST is for AI players only (humans use WebSocket)
		if opService != nil {
			isAI, err := opService.IsPlayerAI(roomId, senderAddr)
			if err == nil && !isAI {
				c.JSON(http.StatusForbidden, gin.H{"error": "Human players must use WebSocket to chat"})
				return
			}
			// If identity not found, allow through (operator may not have record yet)
		}

		// Validate: room is active
		if !cache.IsRoomActive(roomId) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Room is not active"})
			return
		}

		// Validate: player is alive
		if !cache.IsPlayerAlive(roomId, senderAddr) {
			c.JSON(http.StatusForbidden, gin.H{"error": "You are eliminated"})
			return
		}

		// Validate: 3 messages per round
		round := cache.GetCurrentRound(roomId)
		var count int64
		database.Model(&db.Message{}).Where("room_id = ? AND round = ? AND sender = ?", roomId, int(round), senderAddr).Count(&count)
		if count >= 3 {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "Message limit reached (3/round)"})
			return
		}

		// Store in DB
		now := time.Now()
		message := &db.Message{
			RoomID:    roomId,
			Round:     int(round),
			Sender:    senderAddr,
			Content:   content,
			CreatedAt: now,
		}
		if err := database.Create(message).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save message"})
			return
		}

		// Broadcast to WebSocket clients
		hub.Broadcast(roomId, ws.OutgoingMessage{
			Type:      "new_message",
			RoomID:    roomId,
			Round:     int(round),
			Sender:    senderAddr,
			Content:   content,
			CreatedAt: &now,
		})

		c.JSON(http.StatusCreated, message)
	}
}
