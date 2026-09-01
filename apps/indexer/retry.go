package indexer

import (
	"context"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

type RetryConfig struct {
	MaxAttempts            int
	InitialDelay, MaxDelay time.Duration
}

func (c *RetryConfig) defaults() {
	if c.MaxAttempts < 1 {
		c.MaxAttempts = 3
	}
	if c.InitialDelay <= 0 {
		c.InitialDelay = 100 * time.Millisecond
	}
	if c.MaxDelay <= 0 {
		c.MaxDelay = 2 * time.Second
	}
}

type RetryingRPC struct {
	inner RPC
	cfg   RetryConfig
}

func NewRetryingRPC(inner RPC, cfg RetryConfig) *RetryingRPC {
	cfg.defaults()
	return &RetryingRPC{inner: inner, cfg: cfg}
}
func permanentRPCError(err error) bool {
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "invalid argument") || strings.Contains(s, "method not found") || strings.Contains(s, "unsupported") || strings.Contains(s, "unauthorized")
}
func (r *RetryingRPC) wait(ctx context.Context, attempt int) error {
	d := r.cfg.InitialDelay << (attempt - 1)
	if d > r.cfg.MaxDelay {
		d = r.cfg.MaxDelay
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}
func (r *RetryingRPC) HeaderByNumber(ctx context.Context, n *big.Int) (*types.Header, error) {
	var out *types.Header
	err := r.call(ctx, func() error { var e error; out, e = r.inner.HeaderByNumber(ctx, n); return e })
	return out, err
}
func (r *RetryingRPC) FilterLogs(ctx context.Context, q ethereum.FilterQuery) ([]types.Log, error) {
	var out []types.Log
	err := r.call(ctx, func() error { var e error; out, e = r.inner.FilterLogs(ctx, q); return e })
	return out, err
}
func (r *RetryingRPC) CallContract(ctx context.Context, msg ethereum.CallMsg, block *big.Int) ([]byte, error) {
	var out []byte
	err := r.call(ctx, func() error { var e error; out, e = r.inner.CallContract(ctx, msg, block); return e })
	return out, err
}
func (r *RetryingRPC) TransactionByHash(ctx context.Context, hash common.Hash) (*types.Transaction, bool, error) {
	provider, ok := r.inner.(transactionSenderRPC)
	if !ok {
		return nil, false, fmt.Errorf("transaction sender RPC is unavailable")
	}
	var out *types.Transaction
	var pending bool
	err := r.call(ctx, func() error { var e error; out, pending, e = provider.TransactionByHash(ctx, hash); return e })
	return out, pending, err
}
func (r *RetryingRPC) call(ctx context.Context, fn func() error) error {
	var last error
	for attempt := 1; attempt <= r.cfg.MaxAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := fn(); err == nil {
			return nil
		} else {
			last = err
			if permanentRPCError(err) || attempt == r.cfg.MaxAttempts {
				return err
			}
			if err = r.wait(ctx, attempt); err != nil {
				return err
			}
		}
	}
	return fmt.Errorf("rpc retry exhausted: %w", last)
}
