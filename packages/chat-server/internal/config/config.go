package config

import (
	"os"
	"strconv"
)

type Config struct {
	DatabaseURL          string
	RpcURL               string
	ArenaContractAddress string
	Port                 string
	CorsOrigin           string
	SessionTTLHours      int
	RoomStatePollMs      int
	WatcherPollMs        int
	OperatorPrivateKey   string
}

func Load() *Config {
	return &Config{
		DatabaseURL:          getEnv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/rtta_chat?sslmode=disable"),
		RpcURL:               getEnv("RPC_URL", "http://127.0.0.1:8545"),
		ArenaContractAddress: getEnv("ARENA_CONTRACT_ADDRESS", ""),
		Port:                 getEnv("PORT", "43001"),
		CorsOrigin:           getEnv("CORS_ORIGIN", "http://localhost:3000"),
		SessionTTLHours:      getEnvInt("SESSION_TTL_HOURS", 24),
		RoomStatePollMs:      getEnvInt("ROOM_STATE_POLL_MS", 4000),
		WatcherPollMs:        getEnvInt("WATCHER_POLL_MS", 15000),
		OperatorPrivateKey:   getEnv("OPERATOR_PRIVATE_KEY", ""),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}
