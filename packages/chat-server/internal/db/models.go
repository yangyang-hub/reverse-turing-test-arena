package db

import "time"

type Message struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	RoomID    int       `gorm:"index:idx_room_round;not null" json:"roomId"`
	Round     int       `gorm:"index:idx_room_round;not null" json:"round"`
	Sender    string    `gorm:"size:42;not null" json:"sender"` // 0x address lowercase
	Content   string    `gorm:"size:280;not null" json:"content"`
	CreatedAt time.Time `gorm:"index:idx_room_created" json:"createdAt"`
}

type Session struct {
	ID        string    `gorm:"primaryKey;size:36" json:"id"` // UUID
	Address   string    `gorm:"size:42;index;not null" json:"address"`
	Token     string    `gorm:"size:36;uniqueIndex;not null" json:"-"`
	CreatedAt time.Time `json:"createdAt"`
	ExpiresAt time.Time `gorm:"index" json:"expiresAt"`
}

type IdentityRecord struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	RoomID     int       `gorm:"index:idx_identity_room;not null" json:"roomId"`
	Address    string    `gorm:"size:42;index:idx_identity_room;not null" json:"address"` // 0x address lowercase
	IsAI       bool      `gorm:"not null" json:"isAI"`
	Salt       string    `gorm:"size:66;not null" json:"-"` // hex bytes32
	Commitment string    `gorm:"size:66;not null" json:"-"` // hex bytes32
	CreatedAt  time.Time `json:"createdAt"`
}
