package db

import (
	"log"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func Init(dsn string) *gorm.DB {
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	if err := db.AutoMigrate(&Message{}, &Session{}, &IdentityRecord{}); err != nil {
		log.Fatalf("Failed to auto-migrate: %v", err)
	}

	log.Println("[DB] Connected and migrated successfully")
	return db
}
