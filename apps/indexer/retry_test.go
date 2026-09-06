package indexer

import (
	"context"
	"errors"
	"math/big"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/core/types"
)

type retryRPC struct {
	filterCalls int
	filterErrs  []error
}

func (r *retryRPC) HeaderByNumber(context.Context, *big.Int) (*types.Header, error) {
	return nil, errors.New("unexpected HeaderByNumber call")
}

func (r *retryRPC) FilterLogs(context.Context, ethereum.FilterQuery) ([]types.Log, error) {
	err := r.filterErrs[r.filterCalls]
	r.filterCalls++
	return nil, err
}

func (r *retryRPC) CallContract(context.Context, ethereum.CallMsg, *big.Int) ([]byte, error) {
	return nil, errors.New("unexpected CallContract call")
}

func TestRetryingRPCFilterLogsRetriesRateLimit(t *testing.T) {
	inner := &retryRPC{filterErrs: []error{errors.New("rate limit exceeded"), nil}}
	rpc := NewRetryingRPC(inner, RetryConfig{MaxAttempts: 3, InitialDelay: time.Nanosecond, MaxDelay: time.Nanosecond})

	if _, err := rpc.FilterLogs(context.Background(), ethereum.FilterQuery{}); err != nil {
		t.Fatal(err)
	}
	if inner.filterCalls != 2 {
		t.Fatalf("FilterLogs calls=%d, want 2", inner.filterCalls)
	}
}

func TestRetryingRPCFilterLogsDoesNotRetryDeterministicRangeLimit(t *testing.T) {
	wantErr := errors.New("rpc error -32012: requested range too large")
	inner := &retryRPC{filterErrs: []error{wantErr}}
	rpc := NewRetryingRPC(inner, RetryConfig{MaxAttempts: 3, InitialDelay: time.Nanosecond, MaxDelay: time.Nanosecond})

	if _, err := rpc.FilterLogs(context.Background(), ethereum.FilterQuery{}); !errors.Is(err, wantErr) {
		t.Fatalf("error=%v, want %v", err, wantErr)
	}
	if inner.filterCalls != 1 {
		t.Fatalf("FilterLogs calls=%d, want 1", inner.filterCalls)
	}
}
