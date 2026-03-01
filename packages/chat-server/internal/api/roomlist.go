package api

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/rtta/chat-server/internal/chain"
)

// HandleGetRooms — GET /api/rooms
// Public endpoint returning all room summaries from a shared TTL cache.
// Optional query: ?phase=0 (only return rooms with the given phase).
func HandleGetRooms(roomList *chain.RoomListCache) gin.HandlerFunc {
	return func(c *gin.Context) {
		rooms, err := roomList.GetAll(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch rooms"})
			return
		}

		// Optional phase filter
		if phaseStr := c.Query("phase"); phaseStr != "" {
			phase, err := strconv.Atoi(phaseStr)
			if err == nil {
				filtered := make([]chain.RoomSummary, 0, len(rooms))
				for _, r := range rooms {
					if int(r.Phase) == phase {
						filtered = append(filtered, r)
					}
				}
				rooms = filtered
			}
		}

		c.JSON(http.StatusOK, gin.H{
			"rooms": rooms,
			"total": len(rooms),
		})
	}
}
