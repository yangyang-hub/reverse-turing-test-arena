package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/rtta/chat-server/internal/auth"
)

// AuthRequest is the JSON body for POST /api/auth.
type AuthRequest struct {
	Message   string `json:"message" binding:"required"`
	Signature string `json:"signature" binding:"required"`
}

// AuthResponse is the JSON response for POST /api/auth.
type AuthResponse struct {
	Token   string `json:"token"`
	Address string `json:"address"`
}

// HandleAuth godoc
// POST /api/auth — authenticate with SIWE signature
func HandleAuth(authSvc *auth.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req AuthRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Missing message or signature"})
			return
		}

		token, address, err := authSvc.Authenticate(req.Message, req.Signature)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, AuthResponse{Token: token, Address: address})
	}
}
