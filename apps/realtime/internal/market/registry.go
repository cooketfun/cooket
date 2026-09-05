package market

import (
	"fmt"
	"sort"
	"sync"

	"github.com/ethereum/go-ethereum/common"
)

type Registration struct {
	Market Market
	Source Source
}

type Registry struct {
	mu       sync.RWMutex
	byToken  map[common.Address]Market
	bySource map[common.Address]Registration
}

func NewRegistry() *Registry {
	return &Registry{byToken: map[common.Address]Market{}, bySource: map[common.Address]Registration{}}
}

func (r *Registry) Replace(markets []Market) (bool, error) {
	nextTokens := make(map[common.Address]Market, len(markets))
	nextSources := make(map[common.Address]Registration, len(markets))
	for _, entry := range markets {
		if err := entry.Validate(); err != nil {
			return false, err
		}
		if _, exists := nextTokens[entry.Token]; exists {
			return false, fmt.Errorf("duplicate token %s", entry.Token.Hex())
		}
		nextTokens[entry.Token] = entry
		address, source := entry.Curve, SourceCurve
		if entry.Stage == StageGraduated {
			address, source = entry.CanonicalPool, SourceUniswapV3
		}
		if prior, exists := nextSources[address]; exists {
			return false, fmt.Errorf("market source %s belongs to both %s and %s", address.Hex(), prior.Market.Token.Hex(), entry.Token.Hex())
		}
		nextSources[address] = Registration{Market: entry, Source: source}
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	changed := !equalMarkets(r.byToken, nextTokens)
	r.byToken, r.bySource = nextTokens, nextSources
	return changed, nil
}

func (r *Registry) Resolve(address common.Address) (Registration, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	entry, ok := r.bySource[address]
	return entry, ok
}

func (r *Registry) Market(token common.Address) (Market, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	entry, ok := r.byToken[token]
	return entry, ok
}

func (r *Registry) SubscriptionAddresses() []common.Address {
	r.mu.RLock()
	defer r.mu.RUnlock()
	addresses := make([]common.Address, 0, len(r.bySource))
	for address := range r.bySource {
		addresses = append(addresses, address)
	}
	sort.Slice(addresses, func(i, j int) bool { return addresses[i].Hex() < addresses[j].Hex() })
	return addresses
}

func (r *Registry) Registrations() map[common.Address]Registration {
	r.mu.RLock()
	defer r.mu.RUnlock()
	entries := make(map[common.Address]Registration, len(r.bySource))
	for address, registration := range r.bySource {
		entries[address] = registration
	}
	return entries
}

func (r *Registry) Len() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.byToken)
}

func equalMarkets(left, right map[common.Address]Market) bool {
	if len(left) != len(right) {
		return false
	}
	for token, market := range left {
		if other, ok := right[token]; !ok || other != market {
			return false
		}
	}
	return true
}
