package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rtta/chat-server/internal/ws"
)

var startTime = time.Now()

// HandleHealth godoc
// GET /api/health — server health check
func HandleHealth(hub *ws.Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status": "ok",
			"uptime": time.Since(startTime).String(),
		})
	}
}
