package api

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/rtta/chat-server/internal/auth"
	"github.com/rtta/chat-server/internal/chain"
	"github.com/rtta/chat-server/internal/operator"
	"github.com/rtta/chat-server/internal/ws"
	"gorm.io/gorm"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // CORS is handled by Gin middleware
	},
}

// SetupRouter creates the Gin router with all routes.
func SetupRouter(
	database *gorm.DB,
	hub *ws.Hub,
	authSvc *auth.Service,
	cache *chain.RoomStateCache,
	opService *operator.Service,
	roomListCache *chain.RoomListCache,
	corsOrigin string,
) *gin.Engine {
	r := gin.Default()

	// CORS
	r.Use(CORSMiddleware(corsOrigin))

	// WebSocket endpoint
	wsHandler := ws.NewHandler(hub, database, authSvc, cache, opService)
	r.GET("/ws", func(c *gin.Context) {
		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			log.Printf("[WS] Upgrade failed: %v", err)
			return
		}
		client := ws.NewClient(hub, conn, wsHandler)
		go client.WritePump()
		go client.ReadPump()
	})

	// Public endpoints
	r.POST("/api/auth", HandleAuth(authSvc))
	r.GET("/api/health", HandleHealth(hub))
	r.GET("/api/rooms", HandleGetRooms(roomListCache))
	r.GET("/api/rooms/:roomId/messages", HandleGetMessages(database))
	r.GET("/api/rooms/:roomId/state", HandleGetRoomState(cache))
	r.GET("/api/players/:address/rooms", HandleGetPlayerRooms(opService))

	// Protected endpoints (require Bearer token)
	rooms := r.Group("/api/rooms", BearerAuth(authSvc))
	{
		rooms.POST("/:roomId/messages", HandlePostMessage(database, hub, cache, opService))
		rooms.GET("/:roomId/identity", HandleGetPlayerIdentity(opService))
	}

	// Operator endpoints (require Bearer token)
	r.POST("/api/room-join-auth", BearerAuth(authSvc), HandleJoinAuth(opService))
	r.POST("/api/room-join-auth/update-room-id", BearerAuth(authSvc), HandleUpdateIdentityRoomId(opService))
	r.POST("/api/room-join-auth/leave", BearerAuth(authSvc), HandleLeaveRoom(opService))

	return r
}
