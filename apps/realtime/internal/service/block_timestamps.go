package service

import (
	"context"
	"fmt"
	"sync"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"golang.org/x/sync/singleflight"
)

const blockTimestampCacheCapacity = 1024

// blockTimestampCache is deliberately hash-keyed: a reorg replacement at the
// same height cannot reuse the old block's timestamp. FIFO eviction bounds it.
type blockTimestampCache struct {
	mu       sync.Mutex
	values   map[common.Hash]uint64
	order    []common.Hash
	capacity int
	lookups  singleflight.Group
}

func newBlockTimestampCache(capacity int) *blockTimestampCache {
	return &blockTimestampCache{values: make(map[common.Hash]uint64), capacity: capacity}
}

func (c *blockTimestampCache) cached(hash common.Hash) (uint64, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	timestamp, ok := c.values[hash]
	return timestamp, ok
}

func (c *blockTimestampCache) get(ctx context.Context, hash common.Hash, fetch func(context.Context, common.Hash) (*types.Header, error)) (uint64, error) {
	if hash == (common.Hash{}) {
		return 0, fmt.Errorf("realtime log has no block hash")
	}
	if timestamp, ok := c.cached(hash); ok {
		return timestamp, nil
	}
	value, err, _ := c.lookups.Do(hash.Hex(), func() (any, error) {
		if timestamp, ok := c.cached(hash); ok {
			return timestamp, nil
		}
		header, err := fetch(ctx, hash)
		if err != nil {
			return nil, err
		}
		if header == nil || header.Hash() != hash {
			return nil, fmt.Errorf("realtime header does not match log block hash %s", hash.Hex())
		}
		c.store(hash, header.Time)
		return header.Time, nil
	})
	if err != nil {
		return 0, fmt.Errorf("read canonical block timestamp: %w", err)
	}
	return value.(uint64), nil
}

func (c *blockTimestampCache) store(hash common.Hash, timestamp uint64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.values[hash]; ok {
		return
	}
	if len(c.order) == c.capacity {
		delete(c.values, c.order[0])
		copy(c.order, c.order[1:])
		c.order = c.order[:len(c.order)-1]
	}
	c.values[hash] = timestamp
	c.order = append(c.order, hash)
}

func (c *blockTimestampCache) len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.values)
}
