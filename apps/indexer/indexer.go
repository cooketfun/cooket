package indexer

import (
	"bytes"
	"context"
	"fmt"
	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
	"math/big"
	"sort"
	"strings"
	"time"
)

type Indexer struct {
	cfg   Config
	rpc   RPC
	store *Store
	roots CTOProvenance
}

func New(cfg Config, rpc RPC, store *Store) *Indexer {
	cfg.defaults()
	return &Indexer{cfg: cfg, rpc: rpc, store: store}
}
func (x *Indexer) Run(ctx context.Context) error {
	if x.cfg.Mode != "active" && x.cfg.Mode != "once" {
		return fmt.Errorf("indexer run is disabled in %q mode", x.cfg.Mode)
	}
	roots, e := DiscoverCTORoots(ctx, x.rpc, x.cfg.Factory, x.cfg.FeeManager)
	if e != nil {
		return e
	}
	x.roots = roots
	x.cfg.Contracts = []common.Address{roots.Factory, roots.FeeManager, roots.Registry}
	last, lastHash, e := x.store.Checkpoint(ctx, x.cfg.ChainID, x.cfg.IndexerName)
	if e != nil {
		return e
	}
	// StartBlock seeds a new indexer. It must never rewind a durable checkpoint
	// on process restart, otherwise every Compose rebuild replays the entire
	// deployment history and can remain hours behind new launches.
	last, lastHash = initialCheckpoint(last, lastHash, x.cfg.StartBlock)
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		head, e := x.rpc.HeaderByNumber(ctx, nil)
		if e != nil {
			return e
		}
		target := uint64(0)
		if head.Number.Uint64() > x.cfg.Confirmations {
			target = head.Number.Uint64() - x.cfg.Confirmations
		}
		if x.cfg.StopBlock > 0 && target > x.cfg.StopBlock {
			target = x.cfg.StopBlock
		}
		if lastHash != "" {
			h, e := x.rpc.HeaderByNumber(ctx, new(big.Int).SetUint64(last))
			if e != nil {
				return e
			}
			if h.Hash().Hex() != lastHash {
				last, lastHash, e = x.recover(ctx, last)
				if e != nil {
					return e
				}
			}
		}
		for last < target {
			end := last + x.cfg.BatchSize
			if end > target {
				end = target
			}
			from := last + 1
			contracts, e := x.store.ScanContracts(ctx, x.cfg.ChainID, x.cfg.Contracts)
			if e != nil {
				return e
			}
			logs, e := x.rpc.FilterLogs(ctx, ethereum.FilterQuery{FromBlock: new(big.Int).SetUint64(from), ToBlock: new(big.Int).SetUint64(end), Addresses: contracts})
			if e != nil {
				return e
			}
			logs, e = x.discoverLaunchLogs(ctx, end, logs)
			if e != nil {
				return e
			}
			logs, e = x.discoverGraduationSettlements(ctx, logs)
			if e != nil {
				return e
			}
			logs, e = x.discoverCTOTreasuryLogs(ctx, x.roots, end, logs)
			if e != nil {
				return e
			}
			logs, e = canonicalLogs(logs)
			if e != nil {
				return e
			}
			senders, e := x.uniswapSwapSenders(ctx, logs)
			if e != nil {
				return e
			}
			by := map[uint64][]types.Log{}
			for _, l := range logs {
				by[l.BlockNumber] = append(by[l.BlockNumber], l)
			}
			// Persist the range boundaries and every event-bearing block. Empty
			// blocks contain no projections, so writing and rebuilding metrics for
			// each one only makes catch-up linearly slower without adding event
			// provenance. Boundary hashes retain a durable canonical checkpoint.
			blocks := map[uint64]struct{}{from: {}, end: {}}
			for n := range by {
				blocks[n] = struct{}{}
			}
			numbers := make([]uint64, 0, len(blocks))
			for n := range blocks {
				numbers = append(numbers, n)
			}
			sort.Slice(numbers, func(i, j int) bool { return numbers[i] < numbers[j] })
			for _, n := range numbers {
				b, e := x.rpc.HeaderByNumber(ctx, new(big.Int).SetUint64(n))
				if e != nil {
					return e
				}
				if n == last+1 && b.ParentHash.Hex() != lastHash && last > 0 && lastHash != "" {
					return fmt.Errorf("parent mismatch at block %d", n)
				}
				metadata, e := x.v3Metadata(ctx, by[n])
				if e != nil {
					return e
				}
				if e = x.store.ApplyWithProvenance(ctx, x.cfg.ChainID, x.cfg.IndexerName, b, by[n], metadata, senders, x.roots); e != nil {
					return e
				}
				last = n
				lastHash = b.Hash().Hex()
			}
		}
		if x.cfg.StopBlock > 0 && last >= target {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(3 * time.Second):
		}
	}
}

func (x *Indexer) uniswapSwapSenders(ctx context.Context, logs []types.Log) (map[common.Hash]common.Address, error) {
	hashes := map[common.Hash]struct{}{}
	for _, l := range logs {
		if len(l.Topics) > 0 && l.Topics[0] == uniswapV3PoolABI.Events["Swap"].ID {
			hashes[l.TxHash] = struct{}{}
		}
	}
	if len(hashes) == 0 {
		return nil, nil
	}
	provider, ok := x.rpc.(transactionSenderRPC)
	if !ok {
		return nil, fmt.Errorf("transaction sender RPC is required for canonical Uniswap V3 swaps")
	}
	result := make(map[common.Hash]common.Address, len(hashes))
	signer := types.LatestSignerForChainID(big.NewInt(x.cfg.ChainID))
	for hash := range hashes {
		tx, pending, err := provider.TransactionByHash(ctx, hash)
		if err != nil {
			return nil, fmt.Errorf("load canonical Uniswap V3 swap sender %s: %w", hash.Hex(), err)
		}
		if pending {
			return nil, fmt.Errorf("canonical Uniswap V3 swap %s is unexpectedly pending", hash.Hex())
		}
		from, err := types.Sender(signer, tx)
		if err != nil {
			return nil, fmt.Errorf("recover canonical Uniswap V3 swap sender %s: %w", hash.Hex(), err)
		}
		result[hash] = from
	}
	return result, nil
}

type launchDiscovery struct {
	token, curve common.Address
	block        uint64
}

// discoverLaunchLogs closes the range-query address-discovery gap without a
// global topic scan. Each factory-authenticated launch causes bounded queries
// against only its token and curve from the launch block through this batch.
func (x *Indexer) discoverLaunchLogs(ctx context.Context, end uint64, logs []types.Log) ([]types.Log, error) {
	seen := map[common.Address]launchDiscovery{}
	for _, l := range logs {
		if len(l.Topics) == 0 || l.Topics[0] != contractABI.Events["TokenLaunchedV3"].ID {
			continue
		}
		values, err := decodeLog(contractABI, "TokenLaunchedV3", l)
		if err != nil {
			return nil, fmt.Errorf("decode launch discovery: %w", err)
		}
		token, tokenOK := values["token"].(common.Address)
		curve, curveOK := values["curve"].(common.Address)
		if !tokenOK || !curveOK || token == (common.Address{}) || curve == (common.Address{}) {
			return nil, fmt.Errorf("decode launch discovery: invalid token or curve")
		}
		discovery := launchDiscovery{token: token, curve: curve, block: l.BlockNumber}
		if prior, ok := seen[token]; ok && prior != discovery {
			return nil, fmt.Errorf("contradictory launch discovery for token %s", token.Hex())
		}
		seen[token] = discovery
	}
	if len(seen) > 32 {
		return nil, fmt.Errorf("too many token launches in batch for bounded address discovery: %d", len(seen))
	}
	discoveries := make([]launchDiscovery, 0, len(seen))
	for _, discovery := range seen {
		discoveries = append(discoveries, discovery)
	}
	sort.Slice(discoveries, func(i, j int) bool {
		if discoveries[i].block != discoveries[j].block {
			return discoveries[i].block < discoveries[j].block
		}
		return bytes.Compare(discoveries[i].token.Bytes(), discoveries[j].token.Bytes()) < 0
	})
	out := append([]types.Log(nil), logs...)
	for _, discovery := range discoveries {
		transfers, err := x.rpc.FilterLogs(ctx, ethereum.FilterQuery{
			FromBlock: new(big.Int).SetUint64(discovery.block), ToBlock: new(big.Int).SetUint64(end),
			Addresses: []common.Address{discovery.token}, Topics: [][]common.Hash{{contractABI.Events["Transfer"].ID}},
		})
		if err != nil {
			return nil, err
		}
		curveLogs, err := x.rpc.FilterLogs(ctx, ethereum.FilterQuery{
			FromBlock: new(big.Int).SetUint64(discovery.block), ToBlock: new(big.Int).SetUint64(end),
			Addresses: []common.Address{discovery.curve}, Topics: [][]common.Hash{{
				v3TradeABI.Events["TokensBought"].ID,
				v3TradeABI.Events["TokensSold"].ID,
				contractABI.Events["Graduated"].ID,
			}},
		})
		if err != nil {
			return nil, err
		}
		for _, discovered := range transfers {
			if discovered.BlockNumber < discovery.block || discovered.BlockNumber > end {
				return nil, fmt.Errorf("discovered launch log outside requested range")
			}
			if discovered.Address != discovery.token || len(discovered.Topics) == 0 || discovered.Topics[0] != contractABI.Events["Transfer"].ID {
				return nil, fmt.Errorf("token discovery returned unexpected log from %s", discovered.Address.Hex())
			}
		}
		for _, discovered := range curveLogs {
			if discovered.BlockNumber < discovery.block || discovered.BlockNumber > end {
				return nil, fmt.Errorf("discovered launch log outside requested range")
			}
			if discovered.Address != discovery.curve || len(discovered.Topics) == 0 || !isCurveRuntimeTopic(discovered.Topics[0]) {
				return nil, fmt.Errorf("curve discovery returned unexpected log from %s", discovered.Address.Hex())
			}
		}
		out = append(out, transfers...)
		out = append(out, curveLogs...)
	}
	return out, nil
}

func isCurveRuntimeTopic(topic common.Hash) bool {
	return topic == v3TradeABI.Events["TokensBought"].ID || topic == v3TradeABI.Events["TokensSold"].ID || topic == contractABI.Events["Graduated"].ID
}

type curveGraduation struct {
	token, manager common.Address
	log            types.Log
}

// discoverGraduationSettlements queries only the manager declared by each
// curve event and only at the exact graduation block. Pair validation is done
// after discovery because GraduatedV3 has a lower log index than Graduated.
func (x *Indexer) discoverGraduationSettlements(ctx context.Context, logs []types.Log) ([]types.Log, error) {
	graduations := []curveGraduation{}
	queries := map[string]curveGraduation{}
	for _, l := range logs {
		if len(l.Topics) == 0 || l.Topics[0] != contractABI.Events["Graduated"].ID {
			continue
		}
		values, err := decodeLog(contractABI, "Graduated", l)
		if err != nil {
			return nil, fmt.Errorf("decode curve graduation discovery: %w", err)
		}
		token, tokenOK := values["token"].(common.Address)
		manager, managerOK := values["graduationManager"].(common.Address)
		if !tokenOK || !managerOK || token == (common.Address{}) || manager == (common.Address{}) {
			return nil, fmt.Errorf("decode curve graduation discovery: invalid token or manager")
		}
		graduation := curveGraduation{token: token, manager: manager, log: l}
		graduations = append(graduations, graduation)
		queries[fmt.Sprintf("%d:%s", l.BlockNumber, manager.Hex())] = graduation
	}
	if len(graduations) > 32 || len(queries) > 32 {
		return nil, fmt.Errorf("too many curve graduations in batch for bounded settlement discovery: %d", len(graduations))
	}
	queryKeys := make([]string, 0, len(queries))
	for key := range queries {
		queryKeys = append(queryKeys, key)
	}
	sort.Strings(queryKeys)
	out := append([]types.Log(nil), logs...)
	for _, key := range queryKeys {
		graduation := queries[key]
		settlements, err := x.rpc.FilterLogs(ctx, ethereum.FilterQuery{
			FromBlock: new(big.Int).SetUint64(graduation.log.BlockNumber),
			ToBlock:   new(big.Int).SetUint64(graduation.log.BlockNumber),
			Addresses: []common.Address{graduation.manager},
			Topics:    [][]common.Hash{{v3GraduationABI.Events["GraduatedV3"].ID}},
		})
		if err != nil {
			return nil, err
		}
		for _, settlement := range settlements {
			if settlement.Address != graduation.manager || settlement.BlockNumber != graduation.log.BlockNumber {
				return nil, fmt.Errorf("GraduatedV3 discovery returned inconsistent manager or block")
			}
		}
		out = append(out, settlements...)
	}
	canonical, err := canonicalLogs(out)
	if err != nil {
		return nil, err
	}
	if err := validateGraduationPairs(canonical); err != nil {
		return nil, err
	}
	return canonical, nil
}

func validateGraduationPairs(logs []types.Log) error {
	curves := []curveGraduation{}
	settlements := []struct {
		token common.Address
		log   types.Log
	}{}
	for _, l := range logs {
		if len(l.Topics) == 0 {
			continue
		}
		switch l.Topics[0] {
		case contractABI.Events["Graduated"].ID:
			values, err := decodeLog(contractABI, "Graduated", l)
			if err != nil {
				return err
			}
			token, tokenOK := values["token"].(common.Address)
			manager, managerOK := values["graduationManager"].(common.Address)
			if !tokenOK || !managerOK || token == (common.Address{}) || manager == (common.Address{}) {
				return fmt.Errorf("invalid curve graduation identity")
			}
			curves = append(curves, curveGraduation{token: token, manager: manager, log: l})
		case v3GraduationABI.Events["GraduatedV3"].ID:
			values, err := decodeLog(v3GraduationABI, "GraduatedV3", l)
			if err != nil {
				return err
			}
			token, ok := values["token"].(common.Address)
			if !ok || token == (common.Address{}) {
				return fmt.Errorf("invalid GraduatedV3 token")
			}
			settlements = append(settlements, struct {
				token common.Address
				log   types.Log
			}{token: token, log: l})
		}
	}
	matchedSettlements := make([]bool, len(settlements))
	for _, curve := range curves {
		matches := 0
		for i, settlement := range settlements {
			if settlement.log.Address == curve.manager && settlement.token == curve.token && settlement.log.TxHash == curve.log.TxHash && settlement.log.BlockNumber == curve.log.BlockNumber && settlement.log.BlockHash == curve.log.BlockHash {
				matches++
				matchedSettlements[i] = true
			}
		}
		if matches != 1 {
			return fmt.Errorf("curve graduation tx=%s token=%s has %d matching GraduatedV3 events", curve.log.TxHash.Hex(), curve.token.Hex(), matches)
		}
	}
	for i, matched := range matchedSettlements {
		if !matched {
			return fmt.Errorf("unpaired GraduatedV3 tx=%s token=%s manager=%s", settlements[i].log.TxHash.Hex(), settlements[i].token.Hex(), settlements[i].log.Address.Hex())
		}
	}
	return nil
}

func decodeLog(decoder abi.ABI, event string, l types.Log) (map[string]any, error) {
	values := map[string]any{}
	if err := decoder.UnpackIntoMap(values, event, l.Data); err != nil {
		return nil, err
	}
	if err := abi.ParseTopicsIntoMap(values, indexedArguments(decoder.Events[event].Inputs), l.Topics[1:]); err != nil {
		return nil, err
	}
	return values, nil
}

func canonicalLogs(logs []types.Log) ([]types.Log, error) {
	byIdentity := map[string]types.Log{}
	for _, l := range logs {
		key := fmt.Sprintf("%s:%s:%d", l.BlockHash.Hex(), l.TxHash.Hex(), l.Index)
		if prior, ok := byIdentity[key]; ok {
			if prior.Address != l.Address || prior.BlockNumber != l.BlockNumber || prior.TxIndex != l.TxIndex || !bytes.Equal(prior.Data, l.Data) || !equalTopics(prior.Topics, l.Topics) {
				return nil, fmt.Errorf("contradictory logs share canonical identity %s", key)
			}
			continue
		}
		byIdentity[key] = l
	}
	out := make([]types.Log, 0, len(byIdentity))
	for _, l := range byIdentity {
		out = append(out, l)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].BlockNumber != out[j].BlockNumber {
			return out[i].BlockNumber < out[j].BlockNumber
		}
		if out[i].TxIndex != out[j].TxIndex {
			return out[i].TxIndex < out[j].TxIndex
		}
		return out[i].Index < out[j].Index
	})
	return out, nil
}

func equalTopics(left, right []common.Hash) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

var erc20MetadataABI = func() abi.ABI {
	a, err := abi.JSON(strings.NewReader(`[
{"type":"function","name":"name","stateMutability":"view","inputs":[],"outputs":[{"type":"string"}]},
{"type":"function","name":"symbol","stateMutability":"view","inputs":[],"outputs":[{"type":"string"}]},
{"type":"function","name":"decimals","stateMutability":"view","inputs":[],"outputs":[{"type":"uint8"}]}
]`))
	if err != nil {
		panic(err)
	}
	return a
}()

func (x *Indexer) v3Metadata(ctx context.Context, logs []types.Log) (map[string]TokenMetadata, error) {
	out := map[string]TokenMetadata{}
	for _, l := range logs {
		if len(l.Topics) == 0 || l.Topics[0] != contractABI.Events["TokenLaunchedV3"].ID {
			continue
		}
		values := map[string]any{}
		if err := contractABI.UnpackIntoMap(values, "TokenLaunchedV3", l.Data); err != nil {
			return nil, err
		}
		if err := abi.ParseTopicsIntoMap(values, indexedArguments(contractABI.Events["TokenLaunchedV3"].Inputs), l.Topics[1:]); err != nil {
			return nil, err
		}
		token, ok := values["token"].(common.Address)
		if !ok {
			return nil, fmt.Errorf("TokenLaunchedV3 token has unexpected type %T", values["token"])
		}
		metadata := TokenMetadata{}
		for _, name := range []string{"name", "symbol"} {
			method := erc20MetadataABI.Methods[name]
			data, err := x.rpc.CallContract(ctx, ethereum.CallMsg{To: &token, Data: method.ID}, new(big.Int).SetUint64(l.BlockNumber))
			if err != nil {
				return nil, fmt.Errorf("read %s for %s: %w", name, token.Hex(), err)
			}
			decoded, err := method.Outputs.Unpack(data)
			if err != nil || len(decoded) != 1 {
				return nil, fmt.Errorf("decode %s for %s: %w", name, token.Hex(), err)
			}
			value, ok := decoded[0].(string)
			if !ok {
				return nil, fmt.Errorf("%s for %s has unexpected type %T", name, token.Hex(), decoded[0])
			}
			if name == "name" {
				metadata.Name = value
			} else {
				metadata.Symbol = value
			}
		}
		method := erc20MetadataABI.Methods["decimals"]
		data, err := x.rpc.CallContract(ctx, ethereum.CallMsg{To: &token, Data: method.ID}, new(big.Int).SetUint64(l.BlockNumber))
		if err != nil {
			return nil, fmt.Errorf("read decimals for %s: %w", token.Hex(), err)
		}
		decoded, err := method.Outputs.Unpack(data)
		if err != nil || len(decoded) != 1 {
			return nil, fmt.Errorf("decode decimals for %s: %w", token.Hex(), err)
		}
		var okDecimals bool
		metadata.Decimals, okDecimals = decoded[0].(uint8)
		if !okDecimals {
			return nil, fmt.Errorf("decimals for %s has unexpected type %T", token.Hex(), decoded[0])
		}
		out[token.Hex()] = metadata
	}
	return out, nil
}

func initialCheckpoint(last uint64, lastHash string, start uint64) (uint64, string) {
	if start > 0 && last < start {
		return start - 1, ""
	}
	return last, lastHash
}
func (x *Indexer) recover(ctx context.Context, last uint64) (uint64, string, error) {
	for {
		stored, e := x.store.CanonicalBlockHash(ctx, x.cfg.ChainID, last)
		if e != nil {
			return 0, "", e
		}
		h, e := x.rpc.HeaderByNumber(ctx, new(big.Int).SetUint64(last))
		if e != nil {
			return 0, "", e
		}
		if stored == h.Hash().Hex() {
			if e = x.store.Rewind(ctx, x.cfg.ChainID, x.cfg.IndexerName, last+1); e != nil {
				return 0, "", e
			}
			return last, stored, nil
		}
		if last == 0 {
			if e = x.store.Rewind(ctx, x.cfg.ChainID, x.cfg.IndexerName, 1); e != nil {
				return 0, "", e
			}
			return 0, "", nil
		}
		last--
	}
}

// NewRPC exists separately from the database so the API process never owns an
// RPC client or an indexer checkpoint.
func NewRPC(url string) (RPC, error) {
	return NewRPCWithRetry(url, RetryConfig{})
}
func NewRPCWithRetry(url string, cfg RetryConfig) (RPC, error) {
	c, err := ethclient.Dial(url)
	if err != nil {
		return nil, err
	}
	return NewRetryingRPC(c, cfg), nil
}
