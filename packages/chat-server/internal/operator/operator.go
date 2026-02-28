package operator

import (
	"crypto/ecdsa"
	"crypto/rand"
	"fmt"
	"log"
	"strings"
	"sync"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/rtta/chat-server/internal/chain"
	"github.com/rtta/chat-server/internal/db"
	"gorm.io/gorm"
)

// Service manages operator signing and identity records.
type Service struct {
	mu         sync.Mutex
	privateKey *ecdsa.PrivateKey
	address    common.Address
	database   *gorm.DB
	cache      *chain.RoomStateCache
}

// NewService creates an operator service from a hex private key.
func NewService(hexKey string, database *gorm.DB, cache *chain.RoomStateCache) (*Service, error) {
	hexKey = strings.TrimPrefix(hexKey, "0x")
	pk, err := crypto.HexToECDSA(hexKey)
	if err != nil {
		return nil, fmt.Errorf("invalid operator private key: %w", err)
	}

	addr := crypto.PubkeyToAddress(pk.PublicKey)
	log.Printf("[Operator] Initialized, address: %s", addr.Hex())

	return &Service{
		privateKey: pk,
		address:    addr,
		database:   database,
		cache:      cache,
	}, nil
}

// Address returns the operator's Ethereum address.
func (s *Service) Address() common.Address {
	return s.address
}

// SigningKey returns the operator's private key for transaction signing.
func (s *Service) SigningKey() *ecdsa.PrivateKey {
	return s.privateKey
}

// JoinAuthResult is returned by AuthorizeJoin.
type JoinAuthResult struct {
	Commitment  [32]byte
	Salt        [32]byte
	OperatorSig []byte
}

// AuthorizeJoin generates a commitment and operator signature for a player to join a room.
// action is "create" or "join".
// Idempotent: if a record already exists for this room+player, returns the existing
// commitment/salt to prevent on-chain commitment mismatch from duplicate calls.
func (s *Service) AuthorizeJoin(roomId int, playerAddr string, isAI bool, maxPlayers int, action string) (*JoinAuthResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	addr := strings.ToLower(playerAddr)

	// Idempotent: if a record already exists, check if the player actually joined on-chain.
	// If they did, return the existing commitment/salt. If not (phantom record from a failed tx),
	// delete the stale record and proceed with fresh auth including ratio check.
	var existing db.IdentityRecord
	if err := s.database.Where("room_id = ? AND address = ?", roomId, addr).First(&existing).Error; err == nil {
		// For join action (roomId > 0), verify against on-chain state via cache.
		// For create action (roomId = 0), the room doesn't exist yet so we can't verify.
		isOnChain := action == "create" || roomId == 0
		if !isOnChain && s.cache != nil {
			inRoom, roomCached := s.cache.IsPlayerInRoom(roomId, addr)
			if roomCached {
				isOnChain = inRoom
			} else {
				// Room not in cache — can't verify, treat as valid (idempotent)
				isOnChain = true
			}
		}
		if isOnChain {
			log.Printf("[Operator] Returning existing identity for %s in room %d (idempotent, on-chain confirmed)", addr, roomId)

			var commitment [32]byte
			copy(commitment[:], common.FromHex(existing.Commitment))

			var salt [32]byte
			copy(salt[:], common.FromHex(existing.Salt))

			sig, err := s.signAuth(addr, commitment, roomId, action)
			if err != nil {
				return nil, err
			}

			return &JoinAuthResult{
				Commitment:  commitment,
				Salt:        salt,
				OperatorSig: sig,
			}, nil
		}

		// Phantom record: player got auth but never joined on-chain. Delete and re-auth.
		log.Printf("[Operator] Deleting phantom identity for %s in room %d (not on-chain)", addr, roomId)
		s.database.Where("room_id = ? AND address = ?", roomId, addr).Delete(&db.IdentityRecord{})
	}

	// Check 7:3 ratio (only for join, not create — create is the first player)
	if action == "join" {
		if err := s.checkRatio(roomId, isAI, maxPlayers); err != nil {
			return nil, err
		}
	}
	// For create, the creator is the first player — ratio will be checked on subsequent joins

	// Generate random salt
	var salt [32]byte
	if _, err := rand.Read(salt[:]); err != nil {
		return nil, fmt.Errorf("failed to generate salt: %w", err)
	}

	// Compute commitment = keccak256(isAI, salt)
	commitment := computeCommitment(isAI, salt)

	sig, err := s.signAuth(addr, commitment, roomId, action)
	if err != nil {
		return nil, err
	}

	// Store identity record in DB
	record := &db.IdentityRecord{
		RoomID:     roomId,
		Address:    addr,
		IsAI:       isAI,
		Salt:       fmt.Sprintf("0x%x", salt),
		Commitment: fmt.Sprintf("0x%x", commitment),
	}
	if err := s.database.Create(record).Error; err != nil {
		return nil, fmt.Errorf("failed to store identity record: %w", err)
	}

	return &JoinAuthResult{
		Commitment:  commitment,
		Salt:        salt,
		OperatorSig: sig,
	}, nil
}

// signAuth signs the authorization hash for a create or join action.
func (s *Service) signAuth(addr string, commitment [32]byte, roomId int, action string) ([]byte, error) {
	var authHash [32]byte
	if action == "create" {
		authHash = crypto.Keccak256Hash(
			common.HexToAddress(addr).Bytes(),
			commitment[:],
			[]byte("create"),
		)
	} else {
		authHash = crypto.Keccak256Hash(
			common.HexToAddress(addr).Bytes(),
			commitment[:],
			[]byte("join"),
			common.LeftPadBytes([]byte{byte(roomId >> 24), byte(roomId >> 16), byte(roomId >> 8), byte(roomId)}, 32),
		)
	}

	sig, err := s.signEthMessage(authHash)
	if err != nil {
		return nil, fmt.Errorf("failed to sign: %w", err)
	}
	return sig, nil
}

// IsPlayerAI checks the identity record in DB for a player in a room.
func (s *Service) IsPlayerAI(roomId int, addr string) (bool, error) {
	var record db.IdentityRecord
	err := s.database.Where("room_id = ? AND address = ?", roomId, strings.ToLower(addr)).First(&record).Error
	if err != nil {
		return false, fmt.Errorf("identity record not found: %w", err)
	}
	return record.IsAI, nil
}

// FindIdentityRecord finds a single identity record for a player in a room.
func (s *Service) FindIdentityRecord(roomId int, addr string) (*db.IdentityRecord, error) {
	var record db.IdentityRecord
	err := s.database.Where("room_id = ? AND address = ?", roomId, strings.ToLower(addr)).First(&record).Error
	if err != nil {
		return nil, err
	}
	return &record, nil
}

// GetRoomIdentities returns all identity records for a room.
func (s *Service) GetRoomIdentities(roomId int) ([]db.IdentityRecord, error) {
	var records []db.IdentityRecord
	err := s.database.Where("room_id = ?", roomId).Find(&records).Error
	return records, err
}

// UpdateIdentityRoomId updates the room_id of a creator's identity record from 0 to the actual room ID.
// This is needed because createRoom is called with roomId=0 (the real ID isn't known until the tx confirms).
func (s *Service) UpdateIdentityRoomId(address string, newRoomId int) error {
	result := s.database.Model(&db.IdentityRecord{}).
		Where("address = ? AND room_id = 0", strings.ToLower(address)).
		Update("room_id", newRoomId)
	if result.Error != nil {
		return fmt.Errorf("failed to update identity room_id: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("no pending identity record found for address %s", address)
	}
	log.Printf("[Operator] Updated identity room_id for %s: 0 → %d", address, newRoomId)
	return nil
}

// GetPlayerRooms returns all room IDs where the player has identity records (excluding room_id=0 placeholder).
func (s *Service) GetPlayerRooms(address string) ([]int, error) {
	var roomIds []int
	err := s.database.Model(&db.IdentityRecord{}).
		Where("address = ? AND room_id > 0", strings.ToLower(address)).
		Distinct().Pluck("room_id", &roomIds).Error
	return roomIds, err
}

// DeleteRoomIdentities removes identity records when a player leaves or room is cancelled.
func (s *Service) DeletePlayerIdentity(roomId int, addr string) error {
	return s.database.Where("room_id = ? AND address = ?", roomId, strings.ToLower(addr)).Delete(&db.IdentityRecord{}).Error
}

// checkRatio verifies the 7:3 human:AI ratio before allowing a join.
// Cross-references DB records with on-chain state to exclude phantom records
// (auth requested but on-chain join never completed).
func (s *Service) checkRatio(roomId int, isAI bool, maxPlayers int) error {
	var records []db.IdentityRecord
	if err := s.database.Where("room_id = ?", roomId).Find(&records).Error; err != nil {
		return fmt.Errorf("failed to query identity records: %w", err)
	}

	var aiCount, humanCount int
	var phantomAddrs []string
	for _, rec := range records {
		// If cache is available and has this room, verify the player is actually on-chain
		if s.cache != nil {
			inRoom, roomCached := s.cache.IsPlayerInRoom(roomId, rec.Address)
			if roomCached && !inRoom {
				phantomAddrs = append(phantomAddrs, rec.Address)
				continue // skip phantom records
			}
		}
		if rec.IsAI {
			aiCount++
		} else {
			humanCount++
		}
	}

	// Clean up phantom records in background
	if len(phantomAddrs) > 0 {
		log.Printf("[Operator] Cleaning %d phantom records in room %d: %v", len(phantomAddrs), roomId, phantomAddrs)
		s.database.Where("room_id = ? AND address IN ?", roomId, phantomAddrs).Delete(&db.IdentityRecord{})
	}

	// aiSlots = ceil(maxPlayers*30/100), at least 1; humanSlots = maxPlayers - aiSlots
	aiSlots := (maxPlayers*30 + 99) / 100
	if aiSlots < 1 {
		aiSlots = 1
	}
	humanSlots := maxPlayers - aiSlots

	if isAI {
		if aiCount >= aiSlots {
			return fmt.Errorf("AI slots full (%d/%d)", aiCount, aiSlots)
		}
	} else {
		if humanCount >= humanSlots {
			return fmt.Errorf("Human slots full (%d/%d)", humanCount, humanSlots)
		}
	}
	return nil
}

// computeCommitment mirrors the Solidity: keccak256(abi.encodePacked(isAI, salt))
func computeCommitment(isAI bool, salt [32]byte) [32]byte {
	var isAIByte byte
	if isAI {
		isAIByte = 1
	}
	data := make([]byte, 33) // 1 byte bool + 32 bytes salt
	data[0] = isAIByte
	copy(data[1:], salt[:])
	return crypto.Keccak256Hash(data)
}

// signEthMessage signs a hash with the EIP-191 prefix.
func (s *Service) signEthMessage(hash [32]byte) ([]byte, error) {
	prefixed := crypto.Keccak256Hash(
		[]byte("\x19Ethereum Signed Message:\n32"),
		hash[:],
	)
	sig, err := crypto.Sign(prefixed.Bytes(), s.privateKey)
	if err != nil {
		return nil, err
	}
	// Convert v from 0/1 to 27/28 for Solidity ecrecover
	sig[64] += 27
	return sig, nil
}
