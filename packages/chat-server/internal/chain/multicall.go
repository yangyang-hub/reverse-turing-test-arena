package chain

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
)

var (
	multicall3Addr    = common.HexToAddress("0xcA11bde05977b3631167028862bE2a173976CA11")
	multicall3Parsed  abi.ABI
	multicall3Once    sync.Once
	multicall3InitErr error
)

const multicall3ABIJson = `[{"inputs":[{"components":[{"name":"target","type":"address"},{"name":"allowFailure","type":"bool"},{"name":"callData","type":"bytes"}],"name":"calls","type":"tuple[]"}],"name":"aggregate3","outputs":[{"components":[{"name":"success","type":"bool"},{"name":"returnData","type":"bytes"}],"name":"returnData","type":"tuple[]"}],"stateMutability":"payable","type":"function"}]`

// Multicall3Call represents a single call in a batch.
type Multicall3Call struct {
	Target       common.Address
	AllowFailure bool
	CallData     []byte
}

// Multicall3Result represents the result of a batched call.
type Multicall3Result struct {
	Success    bool
	ReturnData []byte
}

func initMulticall3ABI() {
	multicall3Parsed, multicall3InitErr = abi.JSON(strings.NewReader(multicall3ABIJson))
}

// MakeCall creates a Multicall3Call targeting this reader's contract.
func (r *ChainReader) MakeCall(allowFailure bool, method string, args ...interface{}) (Multicall3Call, error) {
	data, err := r.abi.Pack(method, args...)
	if err != nil {
		return Multicall3Call{}, fmt.Errorf("pack %s: %w", method, err)
	}
	return Multicall3Call{
		Target:       r.contract,
		AllowFailure: allowFailure,
		CallData:     data,
	}, nil
}

// BatchCall executes multiple eth_call via Multicall3.aggregate3 in a single RPC request.
func (r *ChainReader) BatchCall(ctx context.Context, calls []Multicall3Call) ([]Multicall3Result, error) {
	if len(calls) == 0 {
		return nil, nil
	}

	multicall3Once.Do(initMulticall3ABI)
	if multicall3InitErr != nil {
		return nil, fmt.Errorf("parse multicall3 ABI: %w", multicall3InitErr)
	}

	data, err := multicall3Parsed.Pack("aggregate3", calls)
	if err != nil {
		return nil, fmt.Errorf("pack aggregate3: %w", err)
	}

	raw, err := r.client.CallContract(ctx, ethereum.CallMsg{
		To:   &multicall3Addr,
		Data: data,
	}, nil)
	if err != nil {
		return nil, fmt.Errorf("multicall3 eth_call: %w", err)
	}

	outputs, err := multicall3Parsed.Methods["aggregate3"].Outputs.Unpack(raw)
	if err != nil {
		return nil, fmt.Errorf("unpack aggregate3: %w", err)
	}
	if len(outputs) == 0 {
		return nil, fmt.Errorf("empty aggregate3 output")
	}

	// Convert anonymous struct slice to typed Multicall3Result slice
	var proto []Multicall3Result
	converted := abi.ConvertType(outputs[0], proto)
	results, ok := converted.([]Multicall3Result)
	if !ok {
		return nil, fmt.Errorf("unexpected aggregate3 result type: %T", converted)
	}

	if len(results) != len(calls) {
		return nil, fmt.Errorf("result count mismatch: got %d, want %d", len(results), len(calls))
	}

	return results, nil
}
