package ws

import (
	"encoding/json"
	"log"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = (pongWait * 9) / 10
	maxMsgSize = 4096
)

// Client represents a single WebSocket connection.
type Client struct {
	hub     *Hub
	conn    *websocket.Conn
	send    chan []byte
	Address string // Ethereum address (set after auth)
	RoomID  int    // Room joined (set after join_room)
	handler *Handler
}

func NewClient(hub *Hub, conn *websocket.Conn, handler *Handler) *Client {
	return &Client{
		hub:     hub,
		conn:    conn,
		send:    make(chan []byte, 256),
		handler: handler,
	}
}

// ReadPump pumps messages from the WebSocket connection to the handler.
func (c *Client) ReadPump() {
	defer func() {
		if c.RoomID != 0 {
			c.hub.Unregister(c)
			c.handler.OnDisconnect(c)
		}
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMsgSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("[WS] Read error from %s: %v", c.Address, err)
			}
			break
		}

		var msg IncomingMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			c.SendJSON(OutgoingMessage{Type: "error", Code: "parse_error", Message: "Invalid JSON"})
			continue
		}

		c.handler.HandleMessage(c, &msg)
	}
}

// WritePump pumps messages from the send channel to the WebSocket connection.
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// SendJSON marshals and sends a JSON message to the client.
func (c *Client) SendJSON(v any) {
	data, err := json.Marshal(v)
	if err != nil {
		log.Printf("[WS] Failed to marshal message: %v", err)
		return
	}
	select {
	case c.send <- data:
	default:
		log.Printf("[WS] Send buffer full for %s, dropping message", c.Address)
	}
}
