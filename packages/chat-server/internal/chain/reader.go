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

// ABI tuple types for decoding contract return values (shared by individual calls and multicall).

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

// RoomSummary holds the fields needed for room listing (lobby display).
type RoomSummary struct {
	RoomID      int    `json:"roomId"`
	Creator     string `json:"creator"`
	Tier        uint8  `json:"tier"`
	Phase       uint8  `json:"phase"`
	EntryFee    string `json:"entryFee"`    // wei string
	PrizePool   string `json:"prizePool"`   // wei string
	MaxPlayers  int    `json:"maxPlayers"`
	PlayerCount int    `json:"playerCount"`
	AliveCount  int    `json:"aliveCount"`
}

// --- Individual RPC calls ---

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

	return r.UnpackRoomInfo(result)
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

	return r.UnpackCurrentRound(result)
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

	return r.UnpackAllPlayers(result)
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

	return r.UnpackPlayerInfo(result)
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

	return r.UnpackPlayerNames(result)
}

// --- Individual RPC call for pendingReveal ---

// GetRoomCount fetches the total number of rooms from the contract.
func (r *ChainReader) GetRoomCount(ctx context.Context) (int, error) {
	data, err := r.abi.Pack("getRoomCount")
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

	return r.UnpackRoomCount(result)
}

// GetPendingReveal checks if a room is in pendingReveal state.
func (r *ChainReader) GetPendingReveal(ctx context.Context, roomId int) (bool, error) {
	data, err := r.abi.Pack("pendingReveal", big.NewInt(int64(roomId)))
	if err != nil {
		return false, err
	}

	result, err := r.client.CallContract(ctx, ethereum.CallMsg{
		To:   &r.contract,
		Data: data,
	}, nil)
	if err != nil {
		return false, err
	}

	return r.UnpackPendingReveal(result)
}

// --- Unpack helpers (used by both individual calls and multicall batch) ---

// UnpackRoomInfo decodes ABI-encoded getRoomInfo return data.
func (r *ChainReader) UnpackRoomInfo(data []byte) (*RoomInfo, error) {
	repacked, err := r.abi.Methods["getRoomInfo"].Outputs.Unpack(data)
	if err != nil {
		return nil, err
	}
	if len(repacked) == 0 {
		return nil, fmt.Errorf("empty output from getRoomInfo")
	}

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

// UnpackCurrentRound decodes ABI-encoded currentRound return data.
func (r *ChainReader) UnpackCurrentRound(data []byte) (uint64, error) {
	outputs, err := r.abi.Unpack("currentRound", data)
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

// UnpackAllPlayers decodes ABI-encoded getAllPlayers return data.
func (r *ChainReader) UnpackAllPlayers(data []byte) ([]string, error) {
	outputs, err := r.abi.Unpack("getAllPlayers", data)
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
	result := make([]string, len(addrs))
	for i, a := range addrs {
		result[i] = strings.ToLower(a.Hex())
	}
	return result, nil
}

// UnpackPlayerNames decodes ABI-encoded getRoomPlayerNames return data.
func (r *ChainReader) UnpackPlayerNames(data []byte) ([]string, error) {
	outputs, err := r.abi.Unpack("getRoomPlayerNames", data)
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

// UnpackPendingReveal decodes ABI-encoded pendingReveal return data.
func (r *ChainReader) UnpackPendingReveal(data []byte) (bool, error) {
	outputs, err := r.abi.Unpack("pendingReveal", data)
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

// UnpackPlayerInfo decodes ABI-encoded getPlayerInfo return data.
func (r *ChainReader) UnpackPlayerInfo(data []byte) (*PlayerInfo, error) {
	repacked, err := r.abi.Methods["getPlayerInfo"].Outputs.Unpack(data)
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

// UnpackRoomCount decodes ABI-encoded getRoomCount return data.
func (r *ChainReader) UnpackRoomCount(data []byte) (int, error) {
	outputs, err := r.abi.Unpack("getRoomCount", data)
	if err != nil {
		return 0, err
	}
	if len(outputs) == 0 {
		return 0, nil
	}

	val, ok := outputs[0].(*big.Int)
	if !ok {
		return 0, fmt.Errorf("unexpected type for getRoomCount output")
	}
	return int(val.Int64()), nil
}

// UnpackRoomSummary decodes ABI-encoded getRoomInfo return data into a RoomSummary.
func (r *ChainReader) UnpackRoomSummary(data []byte, roomId int) (*RoomSummary, error) {
	repacked, err := r.abi.Methods["getRoomInfo"].Outputs.Unpack(data)
	if err != nil {
		return nil, err
	}
	if len(repacked) == 0 {
		return nil, fmt.Errorf("empty output from getRoomInfo")
	}

	var room roomTuple
	converted := abi.ConvertType(repacked[0], room)
	room = converted.(roomTuple)

	return &RoomSummary{
		RoomID:      roomId,
		Creator:     strings.ToLower(room.Creator.Hex()),
		Tier:        room.Tier,
		Phase:       room.Phase,
		EntryFee:    room.EntryFee.String(),
		PrizePool:   room.PrizePool.String(),
		MaxPlayers:  int(room.MaxPlayers.Int64()),
		PlayerCount: int(room.PlayerCount.Int64()),
		AliveCount:  int(room.AliveCount.Int64()),
	}, nil
}
