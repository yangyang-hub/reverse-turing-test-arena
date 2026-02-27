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
	// Track rooms that have been revealed (to skip them)
	mu            sync.Mutex
	revealedRooms map[int]bool
}

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
		// Skip rooms already revealed
		if w.revealedRooms[roomId] {
			continue
		}

		pending, err := w.isPendingReveal(ctx, roomId)
		if err != nil {
			log.Printf("[Watcher] Failed to check pendingReveal for room %d: %v", roomId, err)
			continue
		}
		if pending {
			log.Printf("[Watcher] Room %d is pending reveal, triggering revealAndEnd", roomId)
			if err := w.triggerReveal(ctx, roomId); err != nil {
				log.Printf("[Watcher] Failed to reveal room %d: %v", roomId, err)
			} else {
				w.revealedRooms[roomId] = true
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

// triggerReveal builds the reveal parameters from DB and sends the transaction.
func (w *Watcher) triggerReveal(ctx context.Context, roomId int) error {
	records, err := w.service.GetRoomIdentities(roomId)
	if err != nil {
		return err
	}
	if len(records) == 0 {
		return fmt.Errorf("no identity records found for room %d", roomId)
	}

	players := make([]common.Address, len(records))
	isAIs := make([]bool, len(records))
	salts := make([][32]byte, len(records))

	for i, rec := range records {
		players[i] = common.HexToAddress(rec.Address)
		isAIs[i] = rec.IsAI
		saltBytes := common.FromHex(rec.Salt)
		copy(salts[i][:], saltBytes)
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
