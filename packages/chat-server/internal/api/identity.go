package api

import (
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"

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

// UpdateRoomIdRequest is the JSON body for POST /api/room-join-auth/update-room-id.
type UpdateRoomIdRequest struct {
	NewRoomId int `json:"newRoomId" binding:"required"`
}

// HandleUpdateIdentityRoomId godoc
// POST /api/room-join-auth/update-room-id — update creator's identity record from room_id=0 to actual room ID.
// Called by frontend/MCP after createRoom tx confirms on-chain.
func HandleUpdateIdentityRoomId(opService *operator.Service) gin.HandlerFunc {
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

		var req UpdateRoomIdRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: newRoomId required"})
			return
		}

		if req.NewRoomId <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "newRoomId must be positive"})
			return
		}

		if err := opService.UpdateIdentityRoomId(addr.(string), req.NewRoomId); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}

// LeaveRoomRequest is the JSON body for POST /api/room-join-auth/leave.
type LeaveRoomRequest struct {
	RoomID int `json:"roomId" binding:"required"`
}

// HandleLeaveRoom godoc
// POST /api/room-join-auth/leave — delete identity record when a player leaves a room.
func HandleLeaveRoom(opService *operator.Service) gin.HandlerFunc {
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

		var req LeaveRoomRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: roomId required"})
			return
		}

		if req.RoomID <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "roomId must be positive"})
			return
		}

		if err := opService.DeletePlayerIdentity(req.RoomID, addr.(string)); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete identity"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"ok": true})
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

// HandleGetPlayerRooms godoc
// GET /api/players/:address/rooms — public endpoint, returns room IDs the player participated in.
func HandleGetPlayerRooms(opService *operator.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		if opService == nil {
			c.JSON(http.StatusOK, gin.H{"roomIds": []int{}})
			return
		}

		addr := strings.ToLower(c.Param("address"))
		if len(addr) < 42 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid address"})
			return
		}

		roomIds, err := opService.GetPlayerRooms(addr)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query rooms"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"roomIds": roomIds})
	}
}
