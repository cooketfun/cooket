package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"math/big"
	"testing"
	"time"

	"github.com/cooketfun/cooket/apps/realtime/internal/market"
	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

type testLoader struct{ markets []market.Market }

func (l *testLoader) Markets(context.Context, int64) ([]market.Market, error) { return l.markets, nil }

type testClient struct {
	head    uint64
	logs    []types.Log
	queries []ethereum.FilterQuery
	headers map[common.Hash]*types.Header
}

func (c *testClient) SubscribeFilterLogs(context.Context, ethereum.FilterQuery, chan<- types.Log) (ethereum.Subscription, error) {
	return nil, nil
}
func (c *testClient) FilterLogs(_ context.Context, query ethereum.FilterQuery) ([]types.Log, error) {
	c.queries = append(c.queries, query)
	return c.logs, nil
}
func (c *testClient) BlockNumber(context.Context) (uint64, error) { return c.head, nil }
func (c *testClient) HeaderByHash(_ context.Context, hash common.Hash) (*types.Header, error) {
	if header := c.headers[hash]; header != nil {
		return header, nil
	}
	return nil, errors.New("header not found")
}

func newTestService(t *testing.T, loader *testLoader, output *bytes.Buffer) *Service {
	t.Helper()
	svc, err := New("wss://example.invalid", time.Second, common.HexToAddress("0x3600000000000000000000000000000000000000"), loader, output, nil, testLogger())
	if err != nil {
		t.Fatal(err)
	}
	return svc
}

func testLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func curveBuyLog(curve, token common.Address, block uint64) types.Log {
	data := make([]byte, 0, 320)
	for _, value := range []int64{110, 100, 90, 1000, 10, 2, 3, 4, 1, 10} {
		data = append(data, common.LeftPadBytes(big.NewInt(value).Bytes(), 32)...)
	}
	return types.Log{Address: curve, Topics: []common.Hash{market.TokensBoughtTopic, common.BytesToHash(token.Bytes()), common.HexToHash("0xbeef")}, Data: data, BlockNumber: block, TxHash: common.HexToHash("0x1234"), Index: 3}
}

func canonicalHeader(entry *types.Log, timestamp uint64) *types.Header {
	header := &types.Header{Number: new(big.Int).SetUint64(entry.BlockNumber), Time: timestamp}
	entry.BlockHash = header.Hash()
	return header
}

func TestStartupDiscoveryRegistersCanonicalCurveWithoutHistoricalScan(t *testing.T) {
	token := common.HexToAddress("0x1000000000000000000000000000000000000009")
	curve := common.HexToAddress("0x2000000000000000000000000000000000000009")
	loader := &testLoader{markets: []market.Market{{Token: token, Curve: curve, Stage: market.StageCurve, SourceStartBlock: 7}}}
	svc := newTestService(t, loader, &bytes.Buffer{})
	if changed, err := svc.reconcile(context.Background()); err != nil || !changed {
		t.Fatalf("changed=%t err=%v", changed, err)
	}
	registration, ok := svc.registry.Resolve(curve)
	if !ok || registration.Source != market.SourceCurve || registration.Market.SourceStartBlock != 7 {
		t.Fatalf("startup registration=%+v ok=%t", registration, ok)
	}
	if len(svc.pendingBackfills) != 0 {
		t.Fatal("startup attempted an unbounded historical backfill")
	}
}

func TestReconnectReplaysLastBlockWithoutReplayingSourceLifetime(t *testing.T) {
	token := common.HexToAddress("0x1000000000000000000000000000000000000001")
	curve := common.HexToAddress("0x2000000000000000000000000000000000000001")
	svc := newTestService(t, &testLoader{markets: []market.Market{{Token: token, Curve: curve, Stage: market.StageCurve, SourceStartBlock: 1}}}, &bytes.Buffer{})
	if _, err := svc.reconcile(context.Background()); err != nil {
		t.Fatal(err)
	}
	svc.queueReconnectBackfill(1000)
	client := &testClient{head: 1010}
	if err := svc.backfillPending(context.Background(), client); err != nil {
		t.Fatal(err)
	}
	if len(client.queries) != 1 || client.queries[0].FromBlock.Uint64() != 1000 || client.queries[0].ToBlock.Uint64() != 1010 {
		t.Fatalf("unexpected query: %+v", client.queries)
	}
	svc.queueReconnectBackfill(1000)
	client.head = 1513
	if err := svc.backfillPending(context.Background(), client); err == nil {
		t.Fatal("unbounded reconnect replay accepted")
	}
}

func TestNewSourceBackfillUsesExactAddressAndTopicsAndDeduplicatesWSS(t *testing.T) {
	token := common.HexToAddress("0x1000000000000000000000000000000000000001")
	curve := common.HexToAddress("0x2000000000000000000000000000000000000001")
	loader, output := &testLoader{}, &bytes.Buffer{}
	svc := newTestService(t, loader, output)
	if _, err := svc.reconcile(context.Background()); err != nil {
		t.Fatal(err)
	} // startup discovery
	loader.markets = []market.Market{{Token: token, Curve: curve, Stage: market.StageCurve, SourceStartBlock: 10}}
	if changed, err := svc.reconcile(context.Background()); err != nil || !changed {
		t.Fatalf("changed=%t err=%v", changed, err)
	}
	entry := curveBuyLog(curve, token, 12)
	header := canonicalHeader(&entry, 123)
	client := &testClient{headers: map[common.Hash]*types.Header{entry.BlockHash: header}}
	if err := svc.handleLog(context.Background(), client, entry); err != nil {
		t.Fatal(err)
	} // delivered by WSS before catch-up returns
	client.head, client.logs = 12, []types.Log{entry}
	if err := svc.backfillPending(context.Background(), client); err != nil {
		t.Fatal(err)
	}
	if len(client.queries) != 1 {
		t.Fatalf("queries=%d", len(client.queries))
	}
	query := client.queries[0]
	if len(query.Addresses) != 1 || query.Addresses[0] != curve || query.FromBlock.Uint64() != 10 || query.ToBlock.Uint64() != 12 {
		t.Fatalf("backfill was not source-bounded: %+v", query)
	}
	if len(query.Topics) != 1 || len(query.Topics[0]) != 2 || query.Topics[0][0] != market.TokensBoughtTopic || query.Topics[0][1] != market.TokensSoldTopic {
		t.Fatalf("backfill was not curve-topic-specific: %+v", query.Topics)
	}
	var events []market.Event
	decoder := json.NewDecoder(output)
	for {
		var event market.Event
		err := decoder.Decode(&event)
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		events = append(events, event)
	}
	if len(events) != 1 || events[0].USDCDecimals != 18 || events[0].BlockTimestamp == nil || *events[0].BlockTimestamp != 123 {
		t.Fatalf("events=%+v", events)
	}
}

func TestHeaderFailureDoesNotPublishFakeTimestampAndRemovedUsesCachedTimestamp(t *testing.T) {
	token := common.HexToAddress("0x1000000000000000000000000000000000000008")
	curve := common.HexToAddress("0x2000000000000000000000000000000000000008")
	loader, output := &testLoader{markets: []market.Market{{Token: token, Curve: curve, Stage: market.StageCurve, SourceStartBlock: 7}}}, &bytes.Buffer{}
	svc := newTestService(t, loader, output)
	if _, err := svc.reconcile(context.Background()); err != nil {
		t.Fatal(err)
	}
	entry := curveBuyLog(curve, token, 7)
	header := canonicalHeader(&entry, 456)
	if err := svc.handleLog(context.Background(), &testClient{}, entry); err == nil {
		t.Fatal("header failure published a normal trade")
	}
	if output.Len() != 0 {
		t.Fatal("header failure wrote an event")
	}
	client := &testClient{headers: map[common.Hash]*types.Header{entry.BlockHash: header}}
	if err := svc.handleLog(context.Background(), client, entry); err != nil {
		t.Fatal(err)
	}
	entry.Removed = true
	if err := svc.handleLog(context.Background(), &testClient{}, entry); err != nil {
		t.Fatal(err)
	}
	decoder := json.NewDecoder(output)
	var normal, removed market.Event
	if err := decoder.Decode(&normal); err != nil {
		t.Fatal(err)
	}
	if err := decoder.Decode(&removed); err != nil {
		t.Fatal(err)
	}
	if normal.BlockTimestamp == nil || removed.BlockTimestamp == nil || *normal.BlockTimestamp != 456 || *removed.BlockTimestamp != 456 || !removed.Removed {
		t.Fatalf("normal=%+v removed=%+v", normal, removed)
	}
}

func TestRemovedLogWithoutCachedHeaderOmitsTimestamp(t *testing.T) {
	token := common.HexToAddress("0x1000000000000000000000000000000000000007")
	curve := common.HexToAddress("0x2000000000000000000000000000000000000007")
	output := &bytes.Buffer{}
	svc := newTestService(t, &testLoader{markets: []market.Market{{Token: token, Curve: curve, Stage: market.StageCurve, SourceStartBlock: 7}}}, output)
	if _, err := svc.reconcile(context.Background()); err != nil {
		t.Fatal(err)
	}
	entry := curveBuyLog(curve, token, 7)
	entry.Removed = true
	if err := svc.handleLog(context.Background(), &testClient{}, entry); err != nil {
		t.Fatal(err)
	}
	var event market.Event
	if err := json.NewDecoder(output).Decode(&event); err != nil {
		t.Fatal(err)
	}
	if !event.Removed || event.BlockTimestamp != nil {
		t.Fatalf("removed event=%+v", event)
	}
}

func TestBackfillFailsClosedAtOperationalCatchupLimit(t *testing.T) {
	token := common.HexToAddress("0x1000000000000000000000000000000000000002")
	curve := common.HexToAddress("0x2000000000000000000000000000000000000002")
	loader, output := &testLoader{}, &bytes.Buffer{}
	svc := newTestService(t, loader, output)
	if _, err := svc.reconcile(context.Background()); err != nil {
		t.Fatal(err)
	}
	loader.markets = []market.Market{{Token: token, Curve: curve, Stage: market.StageCurve, SourceStartBlock: 1}}
	if _, err := svc.reconcile(context.Background()); err != nil {
		t.Fatal(err)
	}
	client := &testClient{head: maximumBackfillBlocks + 2}
	if err := svc.backfillPending(context.Background(), client); err == nil {
		t.Fatal("unbounded catch-up was accepted")
	}
	if len(client.queries) != 0 {
		t.Fatal("out-of-bound source queried logs")
	}
}
