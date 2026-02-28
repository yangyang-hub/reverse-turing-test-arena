package api

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/rtta/chat-server/internal/chain"
)

// HandleGetRoomState godoc
// GET /api/rooms/:roomId/state — public endpoint returning cached room state.
// Used by MCP agents to avoid independent RPC calls.
// Returns 404 if the room is not currently cached (MCP falls back to direct RPC).
func HandleGetRoomState(cache *chain.RoomStateCache) gin.HandlerFunc {
	return func(c *gin.Context) {
		roomId, err := strconv.Atoi(c.Param("roomId"))
		if err != nil || roomId <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid room ID"})
			return
		}

		state := cache.GetRoomState(roomId)
		if state == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Room not in cache"})
			return
		}

		c.JSON(http.StatusOK, state)
	}
}
