package api

import (
	"encoding/hex"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/rtta/chat-server/internal/operator"
)

// JoinAuthRequest is the JSON body for POST /api/room-join-auth.
type JoinAuthRequest struct {
	RoomID     int  `json:"roomId"`
	IsAI       bool `json:"isAI"`
	MaxPlayers int  `json:"maxPlayers" binding:"required"`
}

// JoinAuthResponse is the JSON response for POST /api/room-join-auth.
type JoinAuthResponse struct {
	Commitment  string `json:"commitment"`
	Salt        string `json:"salt"`
	OperatorSig string `json:"operatorSig"`
}

// HandleJoinAuth godoc
// POST /api/room-join-auth — get commitment + operator signature for joining a room.
// Requires Bearer token authentication.
func HandleJoinAuth(opService *operator.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		if opService == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Operator service not configured"})
			return
		}

		addr, exists := c.Get("address")
		if !exists {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
			return
		}
		playerAddr := addr.(string)

		var req JoinAuthRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: maxPlayers required"})
			return
		}

		// Determine action: roomId=0 means "create", otherwise "join"
		action := "join"
		if req.RoomID == 0 {
			action = "create"
		}

		result, err := opService.AuthorizeJoin(req.RoomID, playerAddr, req.IsAI, req.MaxPlayers, action)
		if err != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, JoinAuthResponse{
			Commitment:  "0x" + hex.EncodeToString(result.Commitment[:]),
			Salt:        "0x" + hex.EncodeToString(result.Salt[:]),
			OperatorSig: "0x" + hex.EncodeToString(result.OperatorSig),
		})
	}
}

// HandleGetPlayerIdentity godoc
// GET /api/rooms/:roomId/identity — check if the authenticated player is AI in a specific room.
func HandleGetPlayerIdentity(opService *operator.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		if opService == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Operator service not configured"})
			return
		}

		addr, exists := c.Get("address")
		if !exists {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
			return
		}
		playerAddr := addr.(string)

		roomId, err := strconv.Atoi(c.Param("roomId"))
		if err != nil || roomId <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid room ID"})
			return
		}

		isAI, err := opService.IsPlayerAI(roomId, playerAddr)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Identity not found"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"isAI": isAI})
	}
}
