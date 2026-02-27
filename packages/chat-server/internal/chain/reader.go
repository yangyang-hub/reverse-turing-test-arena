package chain

import (
	"context"
	"fmt"
	"log"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
)

// ChainReader provides read-only access to TuringArena contract state.
type ChainReader struct {
	client   *ethclient.Client
	contract common.Address
	abi      abi.ABI
}

func NewChainReader(rpcURL, contractAddr string) (*ChainReader, error) {
	client, err := ethclient.Dial(rpcURL)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to RPC: %w", err)
	}

	parsed, err := abi.JSON(strings.NewReader(ArenaABI))
	if err != nil {
		return nil, fmt.Errorf("failed to parse ABI: %w", err)
	}

	log.Printf("[Chain] Connected to %s, contract: %s", rpcURL, contractAddr)

	return &ChainReader{
		client:   client,
		contract: common.HexToAddress(contractAddr),
		abi:      parsed,
	}, nil
}

// RoomInfo holds parsed room state from the contract.
type RoomInfo struct {
	Phase        uint8
	AliveCount   int
	PlayerCount  int
	IsActive     bool
	IsEnded      bool
	CurrentRound uint64
}

// PlayerInfo holds parsed player state.
type PlayerInfo struct {
	Address       string
	HumanityScore int
	IsAlive       bool
	IsAI          bool
}

// GetRoomInfo fetches room state from the contract.
func (r *ChainReader) GetRoomInfo(ctx context.Context, roomId int) (*RoomInfo, error) {
	data, err := r.abi.Pack("getRoomInfo", big.NewInt(int64(roomId)))
	if err != nil {
		return nil, err
	}

	result, err := r.client.CallContract(ctx, ethereum.CallMsg{
		To:   &r.contract,
		Data: data,
	}, nil)
	if err != nil {
		return nil, err
	}

	if len(result) == 0 {
		return nil, fmt.Errorf("empty result")
	}

	// getRoomInfo returns a single struct as anonymous struct
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

	repacked, err := r.abi.Methods["getRoomInfo"].Outputs.Unpack(result)
	if err != nil {
		return nil, err
	}
	if len(repacked) == 0 {
		return nil, fmt.Errorf("empty output from getRoomInfo")
	}

	// Anonymous struct → convert via abi.ConvertType (not Outputs.Copy which maps per-field)
	var room roomTuple
	converted := abi.ConvertType(repacked[0], room)
	room = converted.(roomTuple)

	return &RoomInfo{
		Phase:       room.Phase,
		AliveCount:  int(room.AliveCount.Int64()),
		PlayerCount: int(room.PlayerCount.Int64()),
		IsActive:    room.IsActive,
		IsEnded:     room.IsEnded,
	}, nil
}

// GetCurrentRound fetches the current round number for a room.
func (r *ChainReader) GetCurrentRound(ctx context.Context, roomId int) (uint64, error) {
	data, err := r.abi.Pack("currentRound", big.NewInt(int64(roomId)))
	if err != nil {
		return 0, err
	}

	result, err := r.client.CallContract(ctx, ethereum.CallMsg{
		To:   &r.contract,
		Data: data,
	}, nil)
	if err != nil {
		return 0, err
	}

	outputs, err := r.abi.Unpack("currentRound", result)
	if err != nil {
		return 0, err
	}
	if len(outputs) == 0 {
		return 0, nil
	}

	val, ok := outputs[0].(*big.Int)
	if !ok {
		return 0, fmt.Errorf("unexpected type for currentRound output")
	}
	return val.Uint64(), nil
}

// GetAllPlayers returns all player addresses in a room.
func (r *ChainReader) GetAllPlayers(ctx context.Context, roomId int) ([]string, error) {
	data, err := r.abi.Pack("getAllPlayers", big.NewInt(int64(roomId)))
	if err != nil {
		return nil, err
	}

	result, err := r.client.CallContract(ctx, ethereum.CallMsg{
		To:   &r.contract,
		Data: data,
	}, nil)
	if err != nil {
		return nil, err
	}

	outputs, err := r.abi.Unpack("getAllPlayers", result)
	if err != nil {
		return nil, err
	}
	if len(outputs) == 0 {
		return nil, nil
	}

	addrs, ok := outputs[0].([]common.Address)
	if !ok {
		return nil, fmt.Errorf("unexpected type for getAllPlayers output")
	}
	result2 := make([]string, len(addrs))
	for i, a := range addrs {
		result2[i] = strings.ToLower(a.Hex())
	}
	return result2, nil
}

// GetPlayerInfo fetches a specific player's info.
func (r *ChainReader) GetPlayerInfo(ctx context.Context, roomId int, addr string) (*PlayerInfo, error) {
	data, err := r.abi.Pack("getPlayerInfo", big.NewInt(int64(roomId)), common.HexToAddress(addr))
	if err != nil {
		return nil, err
	}

	result, err := r.client.CallContract(ctx, ethereum.CallMsg{
		To:   &r.contract,
		Data: data,
	}, nil)
	if err != nil {
		return nil, err
	}

	type playerTuple struct {
		Addr             common.Address
		HumanityScore    *big.Int
		IsAlive          bool
		IsAI             bool
		JoinBlock        *big.Int
		EliminationBlock *big.Int
		EliminationRank  *big.Int
		LastActionBlock  *big.Int
		ActionCount      *big.Int
		SuccessfulVotes  *big.Int
	}

	repacked, err := r.abi.Methods["getPlayerInfo"].Outputs.Unpack(result)
	if err != nil {
		return nil, err
	}
	if len(repacked) == 0 {
		return nil, fmt.Errorf("empty output from getPlayerInfo")
	}

	var player playerTuple
	converted := abi.ConvertType(repacked[0], player)
	player = converted.(playerTuple)

	return &PlayerInfo{
		Address:       strings.ToLower(player.Addr.Hex()),
		HumanityScore: int(player.HumanityScore.Int64()),
		IsAlive:       player.IsAlive,
		IsAI:          player.IsAI,
	}, nil
}

// GetRoomPlayerNames returns the player names for a room.
func (r *ChainReader) GetRoomPlayerNames(ctx context.Context, roomId int) ([]string, error) {
	data, err := r.abi.Pack("getRoomPlayerNames", big.NewInt(int64(roomId)))
	if err != nil {
		return nil, err
	}

	result, err := r.client.CallContract(ctx, ethereum.CallMsg{
		To:   &r.contract,
		Data: data,
	}, nil)
	if err != nil {
		return nil, err
	}

	outputs, err := r.abi.Unpack("getRoomPlayerNames", result)
	if err != nil {
		return nil, err
	}
	if len(outputs) == 0 {
		return nil, nil
	}

	names, ok := outputs[0].([]string)
	if !ok {
		return nil, fmt.Errorf("unexpected type for getRoomPlayerNames output")
	}
	return names, nil
}
