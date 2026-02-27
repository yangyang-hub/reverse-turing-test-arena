package auth

import (
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/google/uuid"
	"github.com/rtta/chat-server/internal/db"
	"gorm.io/gorm"
)

type Service struct {
	db         *gorm.DB
	sessionTTL time.Duration
}

func NewService(database *gorm.DB, ttlHours int) *Service {
	return &Service{
		db:         database,
		sessionTTL: time.Duration(ttlHours) * time.Hour,
	}
}

// RecoverAddress recovers an Ethereum address from a signed message.
func RecoverAddress(message, signature string) (common.Address, error) {
	prefixed := fmt.Sprintf("\x19Ethereum Signed Message:\n%d%s", len(message), message)
	hash := crypto.Keccak256Hash([]byte(prefixed))

	sigBytes := common.FromHex(signature)
	if len(sigBytes) != 65 {
		return common.Address{}, fmt.Errorf("invalid signature length: %d", len(sigBytes))
	}
	// Recovery ID normalization (EIP-155)
	if sigBytes[64] >= 27 {
		sigBytes[64] -= 27
	}

	pubKey, err := crypto.SigToPub(hash.Bytes(), sigBytes)
	if err != nil {
		return common.Address{}, fmt.Errorf("failed to recover public key: %w", err)
	}
	return crypto.PubkeyToAddress(*pubKey), nil
}

// Authenticate verifies the signature and creates a session.
func (s *Service) Authenticate(message, signature string) (token string, address string, err error) {
	addr, err := RecoverAddress(message, signature)
	if err != nil {
		return "", "", fmt.Errorf("signature verification failed: %w", err)
	}

	if err := validateChallenge(message); err != nil {
		return "", "", err
	}

	token = uuid.New().String()
	session := &db.Session{
		ID:        uuid.New().String(),
		Address:   strings.ToLower(addr.Hex()),
		Token:     token,
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().Add(s.sessionTTL),
	}
	if err := s.db.Create(session).Error; err != nil {
		return "", "", fmt.Errorf("failed to create session: %w", err)
	}

	return token, session.Address, nil
}

// ValidateToken checks a bearer token and returns the associated address.
func (s *Service) ValidateToken(token string) (string, error) {
	var session db.Session
	if err := s.db.Where("token = ? AND expires_at > ?", token, time.Now()).First(&session).Error; err != nil {
		return "", fmt.Errorf("invalid or expired token")
	}
	return session.Address, nil
}

// validateChallenge checks the message format and timestamp freshness (5 min window).
func validateChallenge(message string) error {
	// Expected: "Chat login for RTTA at <timestamp_ms>"
	parts := strings.Split(message, " at ")
	if len(parts) != 2 {
		return fmt.Errorf("invalid challenge format")
	}
	if !strings.HasPrefix(parts[0], "Chat login for RTTA") {
		return fmt.Errorf("invalid challenge prefix")
	}

	ts, err := strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 64)
	if err != nil {
		return fmt.Errorf("invalid challenge timestamp")
	}

	diff := time.Since(time.UnixMilli(ts))
	if diff < 0 {
		diff = -diff
	}
	if diff > 5*time.Minute {
		return fmt.Errorf("challenge expired (age: %v)", diff)
	}

	return nil
}

// CleanExpired removes expired sessions from the database.
func (s *Service) CleanExpired() {
	if err := s.db.Where("expires_at < ?", time.Now()).Delete(&db.Session{}).Error; err != nil {
		log.Printf("[Auth] Failed to clean expired sessions: %v", err)
	}
}
