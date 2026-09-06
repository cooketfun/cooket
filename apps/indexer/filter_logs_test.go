package indexer

import (
	"context"
	"errors"
	"math/big"
	"reflect"
	"testing"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

type filterLogsRPC struct {
	queries []ethereum.FilterQuery
	filter  func(int, ethereum.FilterQuery) ([]types.Log, error)
}

func (r *filterLogsRPC) HeaderByNumber(context.Context, *big.Int) (*types.Header, error) {
	return nil, errors.New("unexpected HeaderByNumber call")
}

func (r *filterLogsRPC) FilterLogs(_ context.Context, query ethereum.FilterQuery) ([]types.Log, error) {
	query.Addresses = append([]common.Address(nil), query.Addresses...)
	r.queries = append(r.queries, query)
	if r.filter == nil {
		return nil, nil
	}
	return r.filter(len(r.queries)-1, query)
}

func (r *filterLogsRPC) CallContract(context.Context, ethereum.CallMsg, *big.Int) ([]byte, error) {
	return nil, errors.New("unexpected CallContract call")
}

func testAddresses(count int) []common.Address {
	addresses := make([]common.Address, count)
	for i := range addresses {
		addresses[i] = common.BigToAddress(big.NewInt(int64(i + 1)))
	}
	return addresses
}

func canonicalTestLog(block uint64, txIndex, logIndex uint) types.Log {
	return types.Log{
		Address:     common.BigToAddress(big.NewInt(int64(logIndex + 1))),
		BlockNumber: block,
		BlockHash:   common.BigToHash(new(big.Int).SetUint64(block)),
		TxHash:      common.BigToHash(new(big.Int).SetUint64(uint64(txIndex + 100))),
		TxIndex:     txIndex,
		Index:       logIndex,
	}
}

func TestFilterLogsByAddressChunksSplitsMergesDeduplicatesAndOrders(t *testing.T) {
	addresses := testAddresses(maxFilterLogAddresses*2 + 3)
	duplicate := canonicalTestLog(12, 1, 4)
	rpc := &filterLogsRPC{filter: func(call int, _ ethereum.FilterQuery) ([]types.Log, error) {
		switch call {
		case 0:
			return []types.Log{duplicate, canonicalTestLog(11, 2, 3)}, nil
		case 1:
			return []types.Log{canonicalTestLog(11, 1, 8), duplicate}, nil
		case 2:
			return []types.Log{canonicalTestLog(13, 0, 1)}, nil
		default:
			t.Fatalf("unexpected FilterLogs call %d", call)
			return nil, nil
		}
	}}
	query := ethereum.FilterQuery{
		FromBlock: big.NewInt(11),
		ToBlock:   big.NewInt(13),
		Addresses: addresses,
		Topics:    [][]common.Hash{{common.HexToHash("0x1234")}},
	}

	logs, err := New(Config{}, rpc, nil).filterLogsByAddressChunks(context.Background(), query)
	if err != nil {
		t.Fatal(err)
	}
	if len(rpc.queries) != 3 {
		t.Fatalf("FilterLogs calls=%d, want 3", len(rpc.queries))
	}
	var scanned []common.Address
	for i, got := range rpc.queries {
		if len(got.Addresses) > maxFilterLogAddresses {
			t.Fatalf("chunk %d has %d addresses", i, len(got.Addresses))
		}
		if got.FromBlock.Cmp(query.FromBlock) != 0 || got.ToBlock.Cmp(query.ToBlock) != 0 || !reflect.DeepEqual(got.Topics, query.Topics) {
			t.Fatalf("chunk %d did not preserve query: %+v", i, got)
		}
		scanned = append(scanned, got.Addresses...)
	}
	if !reflect.DeepEqual(scanned, addresses) {
		t.Fatalf("scanned addresses=%v, want %v", scanned, addresses)
	}
	if len(logs) != 4 {
		t.Fatalf("merged logs=%d, want 4", len(logs))
	}
	wantOrder := []struct {
		block   uint64
		txIndex uint
		index   uint
	}{{11, 1, 8}, {11, 2, 3}, {12, 1, 4}, {13, 0, 1}}
	for i, want := range wantOrder {
		if logs[i].BlockNumber != want.block || logs[i].TxIndex != want.txIndex || logs[i].Index != want.index {
			t.Fatalf("log %d position=(%d,%d,%d), want=(%d,%d,%d)", i, logs[i].BlockNumber, logs[i].TxIndex, logs[i].Index, want.block, want.txIndex, want.index)
		}
	}
}

func TestFilterLogsByAddressChunksSmallSetUsesOneCall(t *testing.T) {
	addresses := testAddresses(3)
	want := canonicalTestLog(20, 0, 1)
	rpc := &filterLogsRPC{filter: func(_ int, _ ethereum.FilterQuery) ([]types.Log, error) {
		return []types.Log{want}, nil
	}}

	logs, err := New(Config{}, rpc, nil).filterLogsByAddressChunks(context.Background(), ethereum.FilterQuery{
		FromBlock: big.NewInt(20), ToBlock: big.NewInt(20), Addresses: addresses,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(rpc.queries) != 1 || !reflect.DeepEqual(rpc.queries[0].Addresses, addresses) {
		t.Fatalf("queries=%+v", rpc.queries)
	}
	if len(logs) != 1 || !reflect.DeepEqual(logs[0], want) {
		t.Fatalf("logs=%+v, want %+v", logs, want)
	}
}

func TestFilterLogsByAddressChunksErrorReturnsNoPartialLogsAndStops(t *testing.T) {
	wantErr := errors.New("rate limit exceeded")
	rpc := &filterLogsRPC{filter: func(call int, _ ethereum.FilterQuery) ([]types.Log, error) {
		if call == 1 {
			return nil, wantErr
		}
		return []types.Log{canonicalTestLog(uint64(call+1), 0, uint(call+1))}, nil
	}}

	logs, err := New(Config{}, rpc, nil).filterLogsByAddressChunks(context.Background(), ethereum.FilterQuery{
		FromBlock: big.NewInt(1), ToBlock: big.NewInt(3), Addresses: testAddresses(maxFilterLogAddresses * 3),
	})
	if !errors.Is(err, wantErr) {
		t.Fatalf("error=%v, want %v", err, wantErr)
	}
	if logs != nil {
		t.Fatalf("partial logs returned on error: %+v", logs)
	}
	if len(rpc.queries) != 2 {
		t.Fatalf("FilterLogs calls=%d, want stop after failing second chunk", len(rpc.queries))
	}
}
