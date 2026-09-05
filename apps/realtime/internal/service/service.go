package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"sort"
	"time"

	"github.com/cooketfun/cooket/apps/realtime/internal/market"
	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
)

type EventPublisher interface{ Publish(market.Event) }

const (
	initialReconnectDelay    = time.Second
	maximumReconnectDelay    = 30 * time.Second
	dedupCapacity            = 10_000
	maximumBackfillBlocks    = 512
	blockHeaderLookupTimeout = 5 * time.Second
)

type MarketLoader interface {
	Markets(context.Context, int64) ([]market.Market, error)
}

type LogClient interface {
	SubscribeFilterLogs(context.Context, ethereum.FilterQuery, chan<- types.Log) (ethereum.Subscription, error)
	FilterLogs(context.Context, ethereum.FilterQuery) ([]types.Log, error)
	BlockNumber(context.Context) (uint64, error)
	HeaderByHash(context.Context, common.Hash) (*types.Header, error)
}

type Service struct {
	wssURL            string
	reconcileInterval time.Duration
	loader            MarketLoader
	registry          *market.Registry
	decoder           *market.Decoder
	deduper           *market.Deduper
	output            *json.Encoder
	publisher         EventPublisher
	logger            *slog.Logger
	registryLoaded    bool
	pendingBackfills  map[common.Address]market.Registration
	blockTimestamps   *blockTimestampCache
}

func New(wssURL string, reconcileInterval time.Duration, canonicalUSDC common.Address, loader MarketLoader, output io.Writer, publisher EventPublisher, logger *slog.Logger) (*Service, error) {
	if wssURL == "" || reconcileInterval <= 0 || loader == nil || output == nil || logger == nil {
		return nil, fmt.Errorf("WSS URL, positive reconciliation interval, loader, output, and logger are required")
	}
	registry := market.NewRegistry()
	decoder, err := market.NewDecoder(registry, canonicalUSDC)
	if err != nil {
		return nil, err
	}
	return &Service{
		wssURL: wssURL, reconcileInterval: reconcileInterval, loader: loader, registry: registry,
		decoder: decoder, deduper: market.NewDeduper(dedupCapacity), output: json.NewEncoder(output), publisher: publisher, logger: logger,
		pendingBackfills: make(map[common.Address]market.Registration),
		blockTimestamps:  newBlockTimestampCache(blockTimestampCacheCapacity),
	}, nil
}

func (s *Service) Run(ctx context.Context) error {
	delay := initialReconnectDelay
	for {
		started := time.Now()
		err := s.runConnection(ctx)
		if ctx.Err() != nil {
			return nil
		}
		s.logger.Error("realtime connection ended", "error", err, "reconnect_in", delay)
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
		if time.Since(started) >= s.reconcileInterval*2 {
			delay = initialReconnectDelay
		} else if delay < maximumReconnectDelay {
			delay *= 2
			if delay > maximumReconnectDelay {
				delay = maximumReconnectDelay
			}
		}
	}
}

func (s *Service) runConnection(ctx context.Context) error {
	s.logger.Info("connecting to Arc WebSocket RPC", "url", s.wssURL)
	client, err := ethclient.DialContext(ctx, s.wssURL)
	if err != nil {
		return fmt.Errorf("connect to Arc WebSocket RPC: %w", err)
	}
	defer client.Close()
	s.logger.Info("Arc WebSocket RPC connected")

	changed, err := s.reconcile(ctx)
	if err != nil {
		return err
	}
	_ = changed

	var current *liveSubscription
	current, err = s.replaceSubscription(ctx, client, current)
	if err != nil {
		return err
	}
	if err := s.backfillPending(ctx, client); err != nil {
		return err
	}
	defer closeSubscription(current)

	ticker := time.NewTicker(s.reconcileInterval)
	defer ticker.Stop()
	for {
		var logs <-chan types.Log
		var subscriptionErrors <-chan error
		if current != nil {
			logs, subscriptionErrors = current.logs, current.subscription.Err()
		}
		select {
		case <-ctx.Done():
			return nil
		case entry, ok := <-logs:
			if !ok {
				return errors.New("realtime log delivery channel closed")
			}
			if err := s.handleLog(ctx, client, entry); err != nil {
				s.logger.Warn("discarding invalid registered-market log", "address", entry.Address.Hex(), "tx", entry.TxHash.Hex(), "log_index", entry.Index, "error", err)
			}
		case err, ok := <-subscriptionErrors:
			if !ok || err == nil {
				return errors.New("realtime log subscription closed")
			}
			return fmt.Errorf("realtime log subscription: %w", err)
		case <-ticker.C:
			changed, err := s.reconcile(ctx)
			if err != nil {
				return err
			}
			if changed {
				current, err = s.replaceSubscription(ctx, client, current)
				if err != nil {
					return err
				}
			}
			if err := s.backfillPending(ctx, client); err != nil {
				return err
			}
		}
	}
}

func (s *Service) reconcile(ctx context.Context) (bool, error) {
	previous := s.registry.Registrations()
	markets, err := s.loader.Markets(ctx, market.ChainID)
	if err != nil {
		return false, fmt.Errorf("reconcile canonical market registry: %w", err)
	}
	changed, err := s.registry.Replace(markets)
	if err != nil {
		return false, fmt.Errorf("apply canonical market registry: %w", err)
	}
	if changed {
		s.logger.Info("canonical market registry changed", "markets", s.registry.Len(), "sources", len(s.registry.SubscriptionAddresses()))
	}
	current := s.registry.Registrations()
	if !s.registryLoaded {
		s.registryLoaded = true
		return changed, nil
	}
	for address, registration := range current {
		if prior, ok := previous[address]; !ok || prior != registration {
			s.pendingBackfills[address] = registration
		}
	}
	for address := range s.pendingBackfills {
		if _, ok := current[address]; !ok {
			delete(s.pendingBackfills, address)
		}
	}
	return changed, nil
}

type liveSubscription struct {
	subscription ethereum.Subscription
	logs         chan types.Log
}

func (s *Service) replaceSubscription(ctx context.Context, client LogClient, prior *liveSubscription) (*liveSubscription, error) {
	addresses := s.registry.SubscriptionAddresses()
	if len(addresses) == 0 {
		closeSubscription(prior)
		s.logger.Warn("no canonical Cooket markets are currently available")
		return nil, nil
	}
	logs := make(chan types.Log, 256)
	subscription, err := client.SubscribeFilterLogs(ctx, ethereum.FilterQuery{
		Addresses: addresses,
		Topics:    [][]common.Hash{market.SubscriptionTopics()},
	}, logs)
	if err != nil {
		return prior, fmt.Errorf("subscribe to canonical Cooket markets: %w", err)
	}
	replacement := &liveSubscription{subscription: subscription, logs: logs}
	closeSubscription(prior)
	s.logger.Info("subscribed to canonical Cooket market sources", "addresses", len(addresses))
	return replacement, nil
}

// backfillPending closes the deterministic source-registration gap. The registry
// supplies each source's canonical launch or graduation block; queries are
// restricted to that exact address and its reviewed event topics. A source that
// falls outside the small runtime catch-up window fails closed rather than
// silently producing incomplete realtime output.
func (s *Service) backfillPending(ctx context.Context, client LogClient) error {
	if len(s.pendingBackfills) == 0 {
		return nil
	}
	head, err := client.BlockNumber(ctx)
	if err != nil {
		return fmt.Errorf("read Arc head for realtime catch-up: %w", err)
	}
	addresses := make([]common.Address, 0, len(s.pendingBackfills))
	for address := range s.pendingBackfills {
		addresses = append(addresses, address)
	}
	sort.Slice(addresses, func(i, j int) bool { return addresses[i].Hex() < addresses[j].Hex() })
	for _, address := range addresses {
		registration := s.pendingBackfills[address]
		start := registration.Market.SourceStartBlock
		if start > head {
			return fmt.Errorf("realtime catch-up source %s starts at future block %d (head %d)", address.Hex(), start, head)
		}
		if head-start > maximumBackfillBlocks {
			return fmt.Errorf("realtime catch-up source %s spans %d blocks; maximum is %d", address.Hex(), head-start, maximumBackfillBlocks)
		}
		topics := market.SubscriptionTopicsFor(registration.Source)
		if len(topics) == 0 {
			return fmt.Errorf("realtime catch-up source %s has unsupported type %q", address.Hex(), registration.Source)
		}
		logs, err := client.FilterLogs(ctx, ethereum.FilterQuery{
			FromBlock: new(big.Int).SetUint64(start),
			ToBlock:   new(big.Int).SetUint64(head),
			Addresses: []common.Address{address},
			Topics:    [][]common.Hash{topics},
		})
		if err != nil {
			return fmt.Errorf("realtime catch-up source %s: %w", address.Hex(), err)
		}
		sort.Slice(logs, func(i, j int) bool {
			if logs[i].BlockNumber != logs[j].BlockNumber {
				return logs[i].BlockNumber < logs[j].BlockNumber
			}
			if logs[i].TxIndex != logs[j].TxIndex {
				return logs[i].TxIndex < logs[j].TxIndex
			}
			if logs[i].Index != logs[j].Index {
				return logs[i].Index < logs[j].Index
			}
			return logs[i].TxHash.Hex() < logs[j].TxHash.Hex()
		})
		for _, entry := range logs {
			if entry.Address != address || entry.BlockNumber < start || entry.BlockNumber > head {
				return fmt.Errorf("realtime catch-up source %s returned an out-of-bound log", address.Hex())
			}
			if err := s.handleLog(ctx, client, entry); err != nil {
				return fmt.Errorf("decode realtime catch-up source %s: %w", address.Hex(), err)
			}
		}
		delete(s.pendingBackfills, address)
	}
	return nil
}

func closeSubscription(subscription *liveSubscription) {
	if subscription != nil {
		subscription.subscription.Unsubscribe()
	}
}

func (s *Service) handleLog(ctx context.Context, client LogClient, entry types.Log) error {
	event, err := s.decoder.Decode(entry, time.Now())
	if err != nil {
		return err
	}
	if entry.Removed {
		if timestamp, ok := s.blockTimestamps.cached(entry.BlockHash); ok {
			event.BlockTimestamp = &timestamp
		}
	} else {
		lookupCtx, cancel := context.WithTimeout(ctx, blockHeaderLookupTimeout)
		timestamp, err := s.blockTimestamps.get(lookupCtx, entry.BlockHash, client.HeaderByHash)
		cancel()
		if err != nil {
			return err
		}
		event.BlockTimestamp = &timestamp
	}
	id := market.EventID{ChainID: event.ChainID, TransactionHash: entry.TxHash, LogIndex: entry.Index}
	if !s.deduper.Accept(id, entry.Removed) {
		s.logger.Debug("duplicate realtime event suppressed", "identity", id.String(), "removed", entry.Removed)
		return nil
	}
	if err := s.output.Encode(event); err != nil {
		return fmt.Errorf("publish normalized realtime event: %w", err)
	}
	if s.publisher != nil {
		s.publisher.Publish(event)
	}
	return nil
}
