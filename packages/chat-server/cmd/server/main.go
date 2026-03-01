package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"github.com/rtta/chat-server/internal/api"
	"github.com/rtta/chat-server/internal/auth"
	"github.com/rtta/chat-server/internal/chain"
	"github.com/rtta/chat-server/internal/config"
	"github.com/rtta/chat-server/internal/db"
	"github.com/rtta/chat-server/internal/operator"
	"github.com/rtta/chat-server/internal/ws"
)

func main() {
	// Load .env file (optional, won't fail if missing)
	_ = godotenv.Load()

	cfg := config.Load()

	// --migrate-only flag: just run migrations and exit
	if len(os.Args) > 1 && os.Args[1] == "--migrate-only" {
		log.Println("Running migrations only...")
		db.Init(cfg.DatabaseURL)
		log.Println("Migrations complete.")
		return
	}

	// Initialize database
	database := db.Init(cfg.DatabaseURL)

	// Initialize chain reader
	reader, err := chain.NewChainReader(cfg.RpcURL, cfg.ArenaContractAddress)
	if err != nil {
		log.Fatalf("Failed to init chain reader: %v", err)
	}

	// Initialize room state cache
	cache := chain.NewRoomStateCache(reader, cfg.RoomStatePollMs)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go cache.StartPolling(ctx)

	// Initialize room list cache (shared across all API clients, 10s TTL)
	roomListCache := chain.NewRoomListCache(reader, 10*time.Second)

	// Initialize WebSocket hub
	hub := ws.NewHub()
	go hub.Run()

	// Initialize auth service
	authSvc := auth.NewService(database, cfg.SessionTTLHours)

	// Periodic session cleanup
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				authSvc.CleanExpired()
				log.Println("[Auth] Expired sessions cleaned")
			case <-ctx.Done():
				return
			}
		}
	}()

	// Initialize operator service (optional — only if private key is configured)
	var opService *operator.Service
	if cfg.OperatorPrivateKey != "" {
		opService, err = operator.NewService(cfg.OperatorPrivateKey, database, cache)
		if err != nil {
			log.Fatalf("Failed to init operator service: %v", err)
		}

		// Start the reveal watcher
		watcher, err := operator.NewWatcher(opService, cfg.RpcURL, cfg.ArenaContractAddress, chain.ArenaABI, cfg.WatcherPollMs, cache)
		if err != nil {
			log.Printf("[Watcher] Failed to init watcher: %v (reveal monitoring disabled)", err)
		} else {
			go watcher.StartWatching(ctx)
		}
	} else {
		log.Println("[Operator] No OPERATOR_PRIVATE_KEY set — operator service disabled")
	}

	// Setup HTTP router
	router := api.SetupRouter(database, hub, authSvc, cache, opService, roomListCache, cfg.CorsOrigin)

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Println("Shutting down...")
		cancel()
		os.Exit(0)
	}()

	addr := ":" + cfg.Port
	log.Printf("Chat server starting on %s", addr)
	if err := router.Run(addr); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
