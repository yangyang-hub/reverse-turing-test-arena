package operator

import (
	"context"
	"fmt"
	"log"
	"math/big"
	"strings"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
)

// Watcher monitors pendingReveal state and triggers revealAndEnd when needed.
type Watcher struct {
	service  *Service
	client   *ethclient.Client
	contract common.Address
	abi      abi.ABI
	pollMs   int
	// Track rooms that have been revealed or permanently failed (to skip them)
	mu            sync.Mutex
	revealedRooms map[int]bool
	failCount     map[int]int // room → consecutive failure count
}

const maxRevealRetries = 3 // stop retrying after this many consecutive failures

// NewWatcher creates a reveal watcher.
func NewWatcher(service *Service, rpcURL, contractAddr string, abiJSON string, pollMs int) (*Watcher, error) {
	client, err := ethclient.Dial(rpcURL)
	if err != nil {
		return nil, err
	}

	parsed, err := abi.JSON(strings.NewReader(abiJSON))
	if err != nil {
		return nil, err
	}

	return &Watcher{
		service:       service,
		client:        client,
		contract:      common.HexToAddress(contractAddr),
		abi:           parsed,
		pollMs:        pollMs,
		revealedRooms: make(map[int]bool),
		failCount:     make(map[int]int),
	}, nil
}

// StartWatching runs a background loop polling active rooms for pendingReveal.
// Instead of relying on AddPendingRoom (which was never called), it queries the
// DB for all rooms with identity records and checks pendingReveal on-chain.
func (w *Watcher) StartWatching(ctx context.Context) {
	ticker := time.NewTicker(time.Duration(w.pollMs) * time.Millisecond)
	defer ticker.Stop()

	log.Printf("[Watcher] Started polling for pendingReveal (interval: %dms)", w.pollMs)

	for {
		select {
		case <-ticker.C:
			w.checkActiveRooms(ctx)
		case <-ctx.Done():
			log.Println("[Watcher] Stopped")
			return
		}
	}
}

func (w *Watcher) checkActiveRooms(ctx context.Context) {
	// Query distinct room IDs from identity records
	roomIds, err := w.getActiveRoomIds()
	if err != nil {
		log.Printf("[Watcher] Failed to get active room IDs: %v", err)
		return
	}

	w.mu.Lock()
	defer w.mu.Unlock()

	for _, roomId := range roomIds {
		// Skip rooms already revealed or permanently failed
		if w.revealedRooms[roomId] {
			continue
		}
		if w.failCount[roomId] >= maxRevealRetries {
			continue
		}

		pending, err := w.isPendingReveal(ctx, roomId)
		if err != nil {
			log.Printf("[Watcher] Failed to check pendingReveal for room %d: %v", roomId, err)
			continue
		}

		// Also check aliveCount <= 2 as a fallback (in case pendingReveal wasn't set)
		shouldReveal := pending
		if !shouldReveal {
			aliveCount, isActive, err := w.getRoomAliveStatus(ctx, roomId)
			if err != nil {
				log.Printf("[Watcher] Failed to check room status for room %d: %v", roomId, err)
				continue
			}
			if isActive && aliveCount <= 2 {
				log.Printf("[Watcher] Room %d: pendingReveal=false but aliveCount=%d, forcing reveal", roomId, aliveCount)
				shouldReveal = true
			}
		}

		if shouldReveal {
			log.Printf("[Watcher] Room %d is pending reveal, triggering revealAndEnd (attempt %d/%d)", roomId, w.failCount[roomId]+1, maxRevealRetries)
			if err := w.triggerReveal(ctx, roomId); err != nil {
				w.failCount[roomId]++
				if w.failCount[roomId] >= maxRevealRetries {
					log.Printf("[Watcher] Room %d: giving up after %d failed attempts: %v (emergencyEnd available as fallback)", roomId, maxRevealRetries, err)
				} else {
					log.Printf("[Watcher] Failed to reveal room %d: %v", roomId, err)
				}
			} else {
				w.revealedRooms[roomId] = true
				delete(w.failCount, roomId)
			}
		}
	}
}

// getActiveRoomIds queries the DB for distinct room IDs that have identity records.
func (w *Watcher) getActiveRoomIds() ([]int, error) {
	var roomIds []int
	err := w.service.database.Raw("SELECT DISTINCT room_id FROM identity_records").Scan(&roomIds).Error
	return roomIds, err
}

// isPendingReveal calls the contract's pendingReveal(roomId) view function.
func (w *Watcher) isPendingReveal(ctx context.Context, roomId int) (bool, error) {
	data, err := w.abi.Pack("pendingReveal", big.NewInt(int64(roomId)))
	if err != nil {
		return false, err
	}

	result, err := w.client.CallContract(ctx, ethereum.CallMsg{
		To:   &w.contract,
		Data: data,
	}, nil)
	if err != nil {
		return false, err
	}

	outputs, err := w.abi.Unpack("pendingReveal", result)
	if err != nil {
		return false, err
	}
	if len(outputs) == 0 {
		return false, nil
	}

	val, ok := outputs[0].(bool)
	if !ok {
		return false, fmt.Errorf("unexpected type for pendingReveal output: %T", outputs[0])
	}
	return val, nil
}

// getRoomAliveStatus calls getRoomInfo to check aliveCount and isActive.
func (w *Watcher) getRoomAliveStatus(ctx context.Context, roomId int) (uint64, bool, error) {
	data, err := w.abi.Pack("getRoomInfo", big.NewInt(int64(roomId)))
	if err != nil {
		return 0, false, err
	}

	result, err := w.client.CallContract(ctx, ethereum.CallMsg{
		To:   &w.contract,
		Data: data,
	}, nil)
	if err != nil {
		return 0, false, err
	}

	if len(result) == 0 {
		return 0, false, fmt.Errorf("empty result from getRoomInfo")
	}

	type roomTuple struct {
		Id              *big.Int
		Creator         common.Address
		Tier            uint8
		Phase           uint8
		EntryFee        *big.Int
		PrizePool       *big.Int
		StartBlock      *big.Int
		BaseInterval    *big.Int
		CurrentInterval *big.Int
		MaxPlayers      *big.Int
		PlayerCount     *big.Int
		AliveCount      *big.Int
		EliminatedCount *big.Int
		LastSettleBlock  *big.Int
		IsActive        bool
		IsEnded         bool
	}

	repacked, err := w.abi.Methods["getRoomInfo"].Outputs.Unpack(result)
	if err != nil {
		return 0, false, err
	}
	if len(repacked) == 0 {
		return 0, false, fmt.Errorf("empty output from getRoomInfo")
	}

	var room roomTuple
	converted := abi.ConvertType(repacked[0], room)
	room = converted.(roomTuple)

	return room.AliveCount.Uint64(), room.IsActive, nil
}

// getAllPlayers calls the contract's getAllPlayers(roomId) view function.
func (w *Watcher) getAllPlayers(ctx context.Context, roomId int) ([]common.Address, error) {
	data, err := w.abi.Pack("getAllPlayers", big.NewInt(int64(roomId)))
	if err != nil {
		return nil, err
	}

	result, err := w.client.CallContract(ctx, ethereum.CallMsg{
		To:   &w.contract,
		Data: data,
	}, nil)
	if err != nil {
		return nil, err
	}

	outputs, err := w.abi.Methods["getAllPlayers"].Outputs.Unpack(result)
	if err != nil {
		return nil, err
	}
	if len(outputs) == 0 {
		return nil, nil
	}

	addrs, ok := outputs[0].([]common.Address)
	if !ok {
		return nil, fmt.Errorf("unexpected type for getAllPlayers output: %T", outputs[0])
	}
	return addrs, nil
}

// triggerReveal builds the reveal parameters from DB and sends the transaction.
// It self-heals missing identity records caused by updateRoomId race conditions
// (e.g., creator's record stuck at room_id=0).
func (w *Watcher) triggerReveal(ctx context.Context, roomId int) error {
	// Get on-chain player list (authoritative source)
	onChainPlayers, err := w.getAllPlayers(ctx, roomId)
	if err != nil {
		return fmt.Errorf("failed to get on-chain players: %w", err)
	}
	if len(onChainPlayers) == 0 {
		return fmt.Errorf("no players found on-chain for room %d", roomId)
	}

	players := make([]common.Address, len(onChainPlayers))
	isAIs := make([]bool, len(onChainPlayers))
	salts := make([][32]byte, len(onChainPlayers))

	for i, addr := range onChainPlayers {
		players[i] = addr
		addrLower := strings.ToLower(addr.Hex())

		// Look up identity record — try actual roomId first, then room_id=0 (creator race condition)
		record, err := w.service.FindIdentityRecord(roomId, addrLower)
		if err != nil {
			record, err = w.service.FindIdentityRecord(0, addrLower)
			if err != nil {
				return fmt.Errorf("no identity record for player %s in room %d: %w", addrLower, roomId, err)
			}
			// Auto-fix: update the stale room_id=0 record
			log.Printf("[Watcher] Auto-fixing identity room_id for %s: 0 → %d", addrLower, roomId)
			_ = w.service.UpdateIdentityRoomId(addrLower, roomId)
		}

		isAIs[i] = record.IsAI
		saltBytes := common.FromHex(record.Salt)
		copy(salts[i][:], saltBytes)

		// Diagnostic: verify commitment matches on-chain before sending tx
		computed := computeCommitment(record.IsAI, salts[i])
		onChainCommitment, err := w.getOnChainCommitment(ctx, roomId, addr)
		if err != nil {
			log.Printf("[Watcher] Warning: could not read on-chain commitment for %s: %v", addrLower, err)
		} else if computed != onChainCommitment {
			return fmt.Errorf("commitment mismatch for %s: DB salt produces %x but on-chain is %x (identity record may be stale)",
				addrLower, computed, onChainCommitment)
		}
	}

	// Encode the revealAndEnd call
	data, err := w.abi.Pack("revealAndEnd", big.NewInt(int64(roomId)), players, isAIs, salts)
	if err != nil {
		return fmt.Errorf("failed to pack revealAndEnd: %w", err)
	}

	// Send the transaction
	txHash, err := w.sendTx(ctx, data)
	if err != nil {
		return fmt.Errorf("failed to send revealAndEnd tx: %w", err)
	}

	log.Printf("[Watcher] revealAndEnd tx sent for room %d: %s", roomId, txHash.Hex())

	// Wait for receipt (with timeout)
	receiptCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	for {
		receipt, err := w.client.TransactionReceipt(receiptCtx, txHash)
		if err == nil {
			if receipt.Status == 0 {
				return fmt.Errorf("revealAndEnd transaction reverted for room %d", roomId)
			}
			log.Printf("[Watcher] revealAndEnd confirmed for room %d, block: %d", roomId, receipt.BlockNumber.Uint64())
			return nil
		}
		select {
		case <-receiptCtx.Done():
			return fmt.Errorf("timeout waiting for receipt")
		case <-time.After(2 * time.Second):
			// retry
		}
	}
}

// sendTx builds, signs, and sends a transaction to the contract.
func (w *Watcher) sendTx(ctx context.Context, data []byte) (common.Hash, error) {
	from := w.service.Address()

	nonce, err := w.client.PendingNonceAt(ctx, from)
	if err != nil {
		return common.Hash{}, err
	}

	gasPrice, err := w.client.SuggestGasPrice(ctx)
	if err != nil {
		return common.Hash{}, err
	}

	gas, err := w.client.EstimateGas(ctx, ethereum.CallMsg{
		From: from,
		To:   &w.contract,
		Data: data,
	})
	if err != nil {
		return common.Hash{}, fmt.Errorf("gas estimation failed: %w", err)
	}

	chainID, err := w.client.ChainID(ctx)
	if err != nil {
		return common.Hash{}, err
	}

	tx := types.NewTransaction(nonce, w.contract, big.NewInt(0), gas, gasPrice, data)
	signedTx, err := types.SignTx(tx, types.NewEIP155Signer(chainID), w.service.SigningKey())
	if err != nil {
		return common.Hash{}, err
	}

	if err := w.client.SendTransaction(ctx, signedTx); err != nil {
		return common.Hash{}, err
	}

	return signedTx.Hash(), nil
}

// getOnChainCommitment reads identityCommitments(roomId, player) from the contract.
func (w *Watcher) getOnChainCommitment(ctx context.Context, roomId int, player common.Address) ([32]byte, error) {
	data, err := w.abi.Pack("identityCommitments", big.NewInt(int64(roomId)), player)
	if err != nil {
		return [32]byte{}, err
	}

	result, err := w.client.CallContract(ctx, ethereum.CallMsg{
		To:   &w.contract,
		Data: data,
	}, nil)
	if err != nil {
		return [32]byte{}, err
	}

	outputs, err := w.abi.Methods["identityCommitments"].Outputs.Unpack(result)
	if err != nil {
		return [32]byte{}, err
	}
	if len(outputs) == 0 {
		return [32]byte{}, fmt.Errorf("no output")
	}

	val, ok := outputs[0].([32]byte)
	if !ok {
		return [32]byte{}, fmt.Errorf("unexpected type: %T", outputs[0])
	}
	return val, nil
}
