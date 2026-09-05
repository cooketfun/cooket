package service

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

func TestBlockTimestampCacheCachesAndBoundsCanonicalHeaders(t *testing.T) {
	cache := newBlockTimestampCache(2)
	header := &types.Header{Time: 77}
	hash := header.Hash()
	var calls atomic.Int32
	fetch := func(context.Context, common.Hash) (*types.Header, error) { calls.Add(1); return header, nil }
	for range 2 {
		if got, err := cache.get(context.Background(), hash, fetch); err != nil || got != 77 {
			t.Fatalf("timestamp=%d err=%v", got, err)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("header calls=%d", calls.Load())
	}
	for _, timestamp := range []uint64{78, 79} {
		next := &types.Header{Time: timestamp}
		if _, err := cache.get(context.Background(), next.Hash(), func(context.Context, common.Hash) (*types.Header, error) { return next, nil }); err != nil {
			t.Fatal(err)
		}
	}
	if cache.len() != 2 {
		t.Fatalf("cache len=%d", cache.len())
	}
	if _, ok := cache.cached(hash); ok {
		t.Fatal("oldest timestamp was not evicted")
	}
}

func TestBlockTimestampCacheCoalescesConcurrentLookupsAndRejectsFailures(t *testing.T) {
	cache := newBlockTimestampCache(4)
	header := &types.Header{Time: 88}
	hash := header.Hash()
	var calls atomic.Int32
	var group sync.WaitGroup
	for range 16 {
		group.Add(1)
		go func() {
			defer group.Done()
			got, err := cache.get(context.Background(), hash, func(context.Context, common.Hash) (*types.Header, error) { calls.Add(1); return header, nil })
			if err != nil || got != 88 {
				t.Errorf("timestamp=%d err=%v", got, err)
			}
		}()
	}
	group.Wait()
	if calls.Load() != 1 {
		t.Fatalf("concurrent calls=%d", calls.Load())
	}
	missing := common.HexToHash("0x1234")
	if _, err := cache.get(context.Background(), missing, func(context.Context, common.Hash) (*types.Header, error) { return nil, errors.New("rpc unavailable") }); err == nil {
		t.Fatal("missing header error")
	}
	if _, ok := cache.cached(missing); ok {
		t.Fatal("failed lookup was cached")
	}
}
