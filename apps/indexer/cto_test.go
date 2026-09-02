package indexer

import (
	"context"
	"errors"
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
)

type ctoRPC struct {
	calls   map[string][]byte
	filters func(ethereum.FilterQuery) ([]types.Log, error)
	count   int
}

func (r *ctoRPC) HeaderByNumber(context.Context, *big.Int) (*types.Header, error) {
	r.count++
	return nil, errors.New("unexpected header")
}
func (r *ctoRPC) FilterLogs(_ context.Context, query ethereum.FilterQuery) ([]types.Log, error) {
	r.count++
	if r.filters == nil {
		return nil, errors.New("unexpected filter")
	}
	return r.filters(query)
}
func (r *ctoRPC) CallContract(_ context.Context, call ethereum.CallMsg, _ *big.Int) ([]byte, error) {
	r.count++
	if call.To == nil || len(call.Data) < 4 {
		return nil, errors.New("invalid call")
	}
	value, ok := r.calls[call.To.Hex()+":"+common.Bytes2Hex(call.Data[:4])]
	if !ok {
		return nil, errors.New("unexpected call")
	}
	return value, nil
}

func addView(t *testing.T, rpc *ctoRPC, contract common.Address, decoder abi.ABI, method string, values ...any) {
	t.Helper()
	output, err := decoder.Methods[method].Outputs.Pack(values...)
	if err != nil {
		t.Fatal(err)
	}
	if rpc.calls == nil {
		rpc.calls = map[string][]byte{}
	}
	rpc.calls[contract.Hex()+":"+common.Bytes2Hex(decoder.Methods[method].ID)] = output
}

func TestGeneratedABIExactCTOEventsAndNativeUsdcName(t *testing.T) {
	required := map[string]abi.ABI{
		"CTOTreasuryDeployed": ctoRegistryABI, "CTOProposed": ctoRegistryABI, "CTOAccepted": ctoRegistryABI,
		"CTOReady": ctoRegistryABI, "CTOCancelled": ctoRegistryABI, "CTOExpired": ctoRegistryABI,
		"CTOActivated": ctoRegistryABI, "CreatorFeeCheckpointed": feeManagerABI,
		"PendingCreatorPayoutInvalidated": feeManagerABI, "CTOFeeRouteActivated": feeManagerABI,
		"CheckpointedCreatorFeesClaimed": feeManagerABI, "CTOAcceptanceSubmitted": ctoTreasuryABI,
		"SupportedAssetRegistered": ctoTreasuryABI, "TreasuryAssetTransferred": ctoTreasuryABI,
		"CreatorFeesPulled": ctoTreasuryABI,
	}
	for name, decoder := range required {
		event, ok := decoder.Events[name]
		if !ok {
			t.Fatalf("missing event %s", name)
		}
		if event.ID != crypto.Keccak256Hash([]byte(event.Sig)) {
			t.Fatalf("topic mismatch for %s", name)
		}
	}
	graduated := curveABI.Events["Graduated"]
	if graduated.Inputs[3].Name != "nativeUsdcAmount" {
		t.Fatalf("Graduated field=%s", graduated.Inputs[3].Name)
	}
	if _, exists := feeManagerABI.Events["CheckpointedFeesClaimed"]; exists {
		t.Fatal("invented shorthand event must not exist")
	}
	if _, exists := feeManagerABI.Events["PendingPayoutInvalidated"]; exists {
		t.Fatal("invented PendingPayoutInvalidated alias must not exist; Solidity emits PendingCreatorPayoutInvalidated")
	}
	if got := allCTOEventNames(); len(got) != 15 {
		t.Fatalf("exact CTO event count=%d", len(got))
	}
}

func TestConfigValidateFailClosedWithoutRootsAndIdleSkipsRPC(t *testing.T) {
	idle := Config{Mode: "idle", ChainID: ArcTestnetChainID, BatchSize: 1}
	if err := idle.Validate(); err != nil {
		t.Fatalf("idle without roots should validate: %v", err)
	}
	rpc := &ctoRPC{}
	if err := New(idle, rpc, nil).Run(context.Background()); err == nil {
		t.Fatal("idle Run should fail closed")
	}
	if rpc.count != 0 {
		t.Fatalf("idle Run made %d RPC calls", rpc.count)
	}
	active := Config{Mode: "active", ChainID: ArcTestnetChainID, RPCURL: "http://127.0.0.1:1", DatabaseURL: "postgres://cooket_test/cooket_test", BatchSize: 1}
	if err := active.Validate(); err == nil {
		t.Fatal("active mode without factory and fee manager roots must fail closed")
	}
	active.Factory = common.HexToAddress("0x0000000000000000000000000000000000000001")
	active.FeeManager = common.HexToAddress("0x0000000000000000000000000000000000000002")
	if err := active.Validate(); err != nil {
		t.Fatalf("configured roots should validate: %v", err)
	}
}

func TestRegistryDerivationRequiresBidirectionalRoots(t *testing.T) {
	factory := common.HexToAddress("0x0000000000000000000000000000000000000101")
	fees := common.HexToAddress("0x0000000000000000000000000000000000000102")
	registry := common.HexToAddress("0x0000000000000000000000000000000000000103")
	rpc := &ctoRPC{}
	addView(t, rpc, fees, feeManagerABI, "factory", factory)
	addView(t, rpc, factory, factoryABI, "feeManager", fees)
	addView(t, rpc, fees, feeManagerABI, "ctoRegistry", registry)
	addView(t, rpc, registry, ctoRegistryABI, "feeManager", fees)
	roots, err := DiscoverCTORoots(context.Background(), rpc, factory, fees)
	if err != nil || roots.Registry != registry || roots.Factory != factory || roots.FeeManager != fees {
		t.Fatalf("roots=%+v err=%v", roots, err)
	}
	wrong := common.HexToAddress("0x0000000000000000000000000000000000000199")
	if _, err := DiscoverCTORoots(context.Background(), rpc, wrong, fees); err == nil {
		t.Fatal("expected root mismatch")
	}
}

func TestCanonicalTreasuryDiscoveryValidatesRegistryTokenAndImmutables(t *testing.T) {
	factory := common.HexToAddress("0x0000000000000000000000000000000000000201")
	fees := common.HexToAddress("0x0000000000000000000000000000000000000202")
	registry := common.HexToAddress("0x0000000000000000000000000000000000000203")
	token := common.HexToAddress("0x0000000000000000000000000000000000000204")
	controller := common.HexToAddress("0x0000000000000000000000000000000000000205")
	treasury := common.HexToAddress("0x0000000000000000000000000000000000000206")
	manager := common.HexToAddress("0x0000000000000000000000000000000000000207")
	creator := common.HexToAddress("0x0000000000000000000000000000000000000208")
	curve := common.HexToAddress("0x0000000000000000000000000000000000000209")
	roots := CTOProvenance{Factory: factory, FeeManager: fees, Registry: registry}
	rpc := &ctoRPC{}
	addView(t, rpc, registry, ctoRegistryABI, "isCanonicalTreasury", true)
	addView(t, rpc, treasury, ctoTreasuryABI, "registry", registry)
	addView(t, rpc, treasury, ctoTreasuryABI, "launchToken", token)
	addView(t, rpc, treasury, ctoTreasuryABI, "controller", controller)
	addView(t, rpc, factory, factoryABI, "isToken", true)
	addView(t, rpc, fees, feeManagerABI, "creatorOf", creator)
	addView(t, rpc, fees, feeManagerABI, "curveOf", curve)
	addView(t, rpc, token, tokenABI, "factory", factory)
	addView(t, rpc, factory, factoryABI, "graduationManager", manager)
	addView(t, rpc, manager, graduationManagerABI, "canonicalUsdc", common.HexToAddress(ArcCanonicalUsdc))
	addView(t, rpc, manager, graduationManagerABI, "factory", factory)
	addView(t, rpc, treasury, ctoTreasuryABI, "canonicalUsdc", common.HexToAddress(ArcCanonicalUsdc))
	acceptance := eventLog(t, ctoTreasuryABI.Events, "CTOAcceptanceSubmitted", []common.Hash{common.HexToHash("0x77"), common.BytesToHash(controller.Bytes()), common.BytesToHash(treasury.Bytes())})
	acceptance.Address, acceptance.BlockNumber, acceptance.BlockHash, acceptance.TxHash, acceptance.Index = treasury, 10, common.HexToHash("0x10"), common.HexToHash("0x11"), 2
	rpc.filters = func(query ethereum.FilterQuery) ([]types.Log, error) {
		if len(query.Addresses) != 1 || query.Addresses[0] != treasury || query.FromBlock.Uint64() != 10 || query.ToBlock.Uint64() != 12 {
			return nil, errors.New("unbounded treasury discovery")
		}
		return []types.Log{acceptance}, nil
	}
	deployed := eventLog(t, ctoRegistryABI.Events, "CTOTreasuryDeployed", []common.Hash{common.BytesToHash(token.Bytes()), common.BytesToHash(controller.Bytes()), common.BytesToHash(treasury.Bytes())}, uint64(1), [32]byte{})
	deployed.Address, deployed.BlockNumber, deployed.BlockHash, deployed.TxHash, deployed.Index = registry, 10, common.HexToHash("0x10"), common.HexToHash("0x12"), 1
	logs, err := New(Config{}, rpc, nil).discoverCTOTreasuryLogs(context.Background(), roots, 12, []types.Log{deployed})
	if err != nil || len(logs) != 2 {
		t.Fatalf("logs=%d err=%v", len(logs), err)
	}
	bad := &ctoRPC{calls: map[string][]byte{}}
	addView(t, bad, registry, ctoRegistryABI, "isCanonicalTreasury", false)
	if _, err := New(Config{}, bad, nil).discoverCTOTreasuryLogs(context.Background(), roots, 12, []types.Log{deployed}); err == nil {
		t.Fatal("expected spoofed treasury rejection")
	}
}

func TestCTOActivationAndRouteMustAgreeExactly(t *testing.T) {
	registry := common.HexToAddress("0x0000000000000000000000000000000000000301")
	fees := common.HexToAddress("0x0000000000000000000000000000000000000302")
	token := common.HexToAddress("0x0000000000000000000000000000000000000303")
	treasury := common.HexToAddress("0x0000000000000000000000000000000000000304")
	previous := common.HexToAddress("0x0000000000000000000000000000000000000305")
	controller := common.HexToAddress("0x0000000000000000000000000000000000000306")
	activation := eventLog(t, ctoRegistryABI.Events, "CTOActivated", []common.Hash{common.HexToHash("0x44"), common.BytesToHash(token.Bytes()), common.BytesToHash(treasury.Bytes())}, controller, previous, controller)
	route := eventLog(t, feeManagerABI.Events, "CTOFeeRouteActivated", []common.Hash{common.BytesToHash(token.Bytes()), common.BytesToHash(previous.Bytes()), common.BytesToHash(treasury.Bytes())})
	block := &types.Header{Number: big.NewInt(20), Time: 20}
	logs := stamp(block, activation, route)
	logs[0].Address, logs[1].Address, logs[1].TxHash = registry, fees, logs[0].TxHash
	roots := CTOProvenance{FeeManager: fees, Registry: registry}
	if err := validateCTOActivationPairs(logs, roots); err != nil {
		t.Fatal(err)
	}
	bad := append([]types.Log(nil), logs...)
	bad[1].TxHash = common.HexToHash("0xbad")
	if err := validateCTOActivationPairs(bad, roots); err == nil {
		t.Fatal("expected mismatched activation rollback")
	}
}

func TestIdleConstructionPerformsNoRPCActivity(t *testing.T) {
	rpc := &ctoRPC{}
	_ = New(Config{Mode: "idle"}, rpc, nil)
	if rpc.count != 0 {
		t.Fatalf("idle construction made %d RPC calls", rpc.count)
	}
}

func TestCTOLifecycleIdempotencyLedgerAssetsAndReorg(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	registry := common.HexToAddress("0x0000000000000000000000000000000000000401")
	fees := common.HexToAddress("0x0000000000000000000000000000000000000402")
	token := common.HexToAddress("0x0000000000000000000000000000000000000403")
	treasury := common.HexToAddress("0x0000000000000000000000000000000000000404")
	creator := common.HexToAddress("0x0000000000000000000000000000000000000405")
	controller := common.HexToAddress("0x0000000000000000000000000000000000000406")
	asset := common.HexToAddress("0x0000000000000000000000000000000000000407")
	recipient := common.HexToAddress("0x0000000000000000000000000000000000000408")
	proposal := common.HexToHash("0xabc1")
	roots := CTOProvenance{FeeManager: fees, Registry: registry}
	spoofBlock := &types.Header{Number: big.NewInt(99), Time: 999_999}
	spoofRegistry := eventLog(t, ctoRegistryABI.Events, "CTOExpired", []common.Hash{proposal, common.BytesToHash(token.Bytes())}, uint8(1))
	spoofTreasury := eventLog(t, ctoTreasuryABI.Events, "SupportedAssetRegistered", []common.Hash{common.BytesToHash(asset.Bytes()), common.BytesToHash(controller.Bytes())})
	spoofFee := eventLog(t, feeManagerABI.Events, "CreatorFeeCheckpointed", []common.Hash{common.BytesToHash(token.Bytes()), common.BytesToHash(creator.Bytes())}, big.NewInt(1))
	spoofLogs := stamp(spoofBlock, spoofRegistry, spoofTreasury, spoofFee)
	spoofLogs[0].Address = common.HexToAddress("0x00000000000000000000000000000000000004f1")
	spoofLogs[1].Address = common.HexToAddress("0x00000000000000000000000000000000000004f2")
	spoofLogs[2].Address = common.HexToAddress("0x00000000000000000000000000000000000004f3")
	if err := s.ApplyWithProvenance(ctx, ArcTestnetChainID, "cto", spoofBlock, spoofLogs, nil, nil, roots); err != nil {
		t.Fatal(err)
	}
	var spoofed int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM chain_events WHERE chain_id=$1 AND transaction_hash=ANY($2)`, ArcTestnetChainID, []string{spoofLogs[0].TxHash.Hex(), spoofLogs[1].TxHash.Hex(), spoofLogs[2].TxHash.Hex()}).Scan(&spoofed); err != nil || spoofed != 0 {
		t.Fatalf("spoofed CTO raw logs=%d err=%v", spoofed, err)
	}

	b1 := &types.Header{Number: big.NewInt(100), ParentHash: spoofBlock.Hash(), Time: 1_000_000}
	deployed := eventLog(t, ctoRegistryABI.Events, "CTOTreasuryDeployed", []common.Hash{common.BytesToHash(token.Bytes()), common.BytesToHash(controller.Bytes()), common.BytesToHash(treasury.Bytes())}, uint64(1), [32]byte{1})
	proposed := eventLog(t, ctoRegistryABI.Events, "CTOProposed", []common.Hash{proposal, common.BytesToHash(token.Bytes()), common.BytesToHash(creator.Bytes())}, controller, treasury, creator, uint64(1), uint64(b1.Time+604800), [32]byte{2}, "ipfs://untrusted-agreement")
	logs1 := stamp(b1, deployed, proposed)
	for i := range logs1 {
		logs1[i].Address = registry
	}
	if err := s.ApplyWithProvenance(ctx, ArcTestnetChainID, "cto", b1, logs1, nil, nil, roots); err != nil {
		t.Fatal(err)
	}
	if err := s.ApplyWithProvenance(ctx, ArcTestnetChainID, "cto", b1, logs1, nil, nil, roots); err != nil {
		t.Fatal(err)
	}

	b2 := &types.Header{Number: big.NewInt(101), ParentHash: b1.Hash(), Time: 1_000_100}
	accepted := eventLog(t, ctoRegistryABI.Events, "CTOAccepted", []common.Hash{proposal, common.BytesToHash(token.Bytes()), common.BytesToHash(treasury.Bytes())}, controller, uint64(b2.Time))
	ready := eventLog(t, ctoRegistryABI.Events, "CTOReady", []common.Hash{proposal, common.BytesToHash(token.Bytes())}, uint64(b2.Time+259200), uint64(b2.Time+259200+604800))
	submitted := eventLog(t, ctoTreasuryABI.Events, "CTOAcceptanceSubmitted", []common.Hash{proposal, common.BytesToHash(controller.Bytes()), common.BytesToHash(treasury.Bytes())})
	logs2 := stamp(b2, accepted, ready, submitted)
	logs2[0].Address, logs2[1].Address, logs2[2].Address = registry, registry, treasury
	if err := s.ApplyWithProvenance(ctx, ArcTestnetChainID, "cto", b2, logs2, nil, nil, roots); err != nil {
		t.Fatal(err)
	}

	b3 := &types.Header{Number: big.NewInt(102), ParentHash: b2.Hash(), Time: 1_300_000}
	checkpoint := eventLog(t, feeManagerABI.Events, "CreatorFeeCheckpointed", []common.Hash{common.BytesToHash(token.Bytes()), common.BytesToHash(creator.Bytes())}, big.NewInt(55))
	invalidated := eventLog(t, feeManagerABI.Events, "PendingCreatorPayoutInvalidated", []common.Hash{common.BytesToHash(token.Bytes()), common.BytesToHash(recipient.Bytes())})
	route := eventLog(t, feeManagerABI.Events, "CTOFeeRouteActivated", []common.Hash{common.BytesToHash(token.Bytes()), common.BytesToHash(creator.Bytes()), common.BytesToHash(treasury.Bytes())})
	activated := eventLog(t, ctoRegistryABI.Events, "CTOActivated", []common.Hash{proposal, common.BytesToHash(token.Bytes()), common.BytesToHash(treasury.Bytes())}, controller, creator, recipient)
	logs3 := stamp(b3, checkpoint, invalidated, route, activated)
	logs3[0].Address, logs3[1].Address, logs3[2].Address, logs3[3].Address = fees, fees, fees, registry
	logs3[1].TxHash, logs3[2].TxHash, logs3[3].TxHash = logs3[0].TxHash, logs3[0].TxHash, logs3[0].TxHash
	if err := s.ApplyWithProvenance(ctx, ArcTestnetChainID, "cto", b3, logs3, nil, nil, roots); err != nil {
		t.Fatal(err)
	}

	b4 := &types.Header{Number: big.NewInt(103), ParentHash: b3.Hash(), Time: 1_300_100}
	registered := eventLog(t, ctoTreasuryABI.Events, "SupportedAssetRegistered", []common.Hash{common.BytesToHash(asset.Bytes()), common.BytesToHash(controller.Bytes())})
	transferred := eventLog(t, ctoTreasuryABI.Events, "TreasuryAssetTransferred", []common.Hash{common.BytesToHash(asset.Bytes()), common.BytesToHash(recipient.Bytes()), common.BytesToHash(controller.Bytes())}, big.NewInt(7))
	pulled := eventLog(t, ctoTreasuryABI.Events, "CreatorFeesPulled", []common.Hash{common.BytesToHash(token.Bytes()), {}, common.BytesToHash(recipient.Bytes())}, big.NewInt(9))
	claimed := eventLog(t, feeManagerABI.Events, "CheckpointedCreatorFeesClaimed", []common.Hash{common.BytesToHash(token.Bytes()), common.BytesToHash(creator.Bytes()), common.BytesToHash(recipient.Bytes())}, big.NewInt(55))
	logs4 := stamp(b4, registered, transferred, pulled, claimed)
	logs4[0].Address, logs4[1].Address, logs4[2].Address, logs4[3].Address = treasury, treasury, treasury, fees
	if err := s.ApplyWithProvenance(ctx, ArcTestnetChainID, "cto", b4, logs4, nil, nil, roots); err != nil {
		t.Fatal(err)
	}

	var state string
	var active bool
	var proposalCount, ledgerCount, assetCount, transferCount, pullCount int
	if err := s.pool.QueryRow(ctx, `SELECT state FROM cto_proposals WHERE chain_id=$1 AND proposal_id=lower($2) AND is_canonical`, ArcTestnetChainID, proposal.Hex()).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT active FROM cto_token_state WHERE chain_id=$1 AND token_address=lower($2) AND is_canonical`, ArcTestnetChainID, token.Hex()).Scan(&active); err != nil {
		t.Fatal(err)
	}
	for query, destination := range map[string]*int{
		`SELECT count(*) FROM cto_proposals WHERE chain_id=$1 AND is_canonical`:                     &proposalCount,
		`SELECT count(*) FROM cto_creator_fee_checkpoint_ledger WHERE chain_id=$1 AND is_canonical`: &ledgerCount,
		`SELECT count(*) FROM cto_supported_assets WHERE chain_id=$1 AND is_canonical`:              &assetCount,
		`SELECT count(*) FROM cto_treasury_transfers WHERE chain_id=$1 AND is_canonical`:            &transferCount,
		`SELECT count(*) FROM cto_fee_pulls WHERE chain_id=$1 AND is_canonical`:                     &pullCount,
	} {
		if err := s.pool.QueryRow(ctx, query, ArcTestnetChainID).Scan(destination); err != nil {
			t.Fatal(err)
		}
	}
	if state != "active" || !active || proposalCount != 1 || ledgerCount != 2 || assetCount != 1 || transferCount != 1 || pullCount != 1 {
		t.Fatalf("state=%s active=%t counts=%d/%d/%d/%d/%d", state, active, proposalCount, ledgerCount, assetCount, transferCount, pullCount)
	}
	for _, name := range []string{
		"CTOTreasuryDeployed", "CTOProposed", "CTOAccepted", "CTOReady", "CTOActivated",
		"CreatorFeeCheckpointed", "PendingCreatorPayoutInvalidated", "CTOFeeRouteActivated", "CheckpointedCreatorFeesClaimed",
		"CTOAcceptanceSubmitted", "SupportedAssetRegistered", "TreasuryAssetTransferred", "CreatorFeesPulled",
	} {
		var stored int
		if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM chain_events WHERE chain_id=$1 AND event_name=$2 AND is_canonical`, ArcTestnetChainID, name).Scan(&stored); err != nil || stored == 0 {
			t.Fatalf("missing raw canonical %s count=%d err=%v", name, stored, err)
		}
	}

	if err := s.Rewind(ctx, ArcTestnetChainID, "cto", 102); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT state FROM cto_proposals WHERE chain_id=$1 AND proposal_id=lower($2) AND is_canonical`, ArcTestnetChainID, proposal.Hex()).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != "accepted" {
		t.Fatalf("rewound state=%s", state)
	}
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM cto_token_state WHERE chain_id=$1 AND token_address=lower($2) AND is_canonical)`, ArcTestnetChainID, token.Hex()).Scan(&active); err != nil {
		t.Fatal(err)
	}
	if active {
		t.Fatal("orphaned activation remained canonical")
	}

	replacement := &types.Header{Number: big.NewInt(102), ParentHash: b2.Hash(), Time: 1_300_001, Nonce: types.EncodeNonce(2)}
	replacementLogs := stamp(replacement, checkpoint, invalidated, route, activated)
	replacementLogs[0].Address, replacementLogs[1].Address, replacementLogs[2].Address, replacementLogs[3].Address = fees, fees, fees, registry
	replacementLogs[1].TxHash, replacementLogs[2].TxHash, replacementLogs[3].TxHash = replacementLogs[0].TxHash, replacementLogs[0].TxHash, replacementLogs[0].TxHash
	if err := s.ApplyWithProvenance(ctx, ArcTestnetChainID, "cto", replacement, replacementLogs, nil, nil, roots); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT active FROM cto_token_state WHERE chain_id=$1 AND token_address=lower($2) AND is_canonical`, ArcTestnetChainID, token.Hex()).Scan(&active); err != nil || !active {
		t.Fatalf("replacement active=%t err=%v", active, err)
	}
}

func TestSameBlockTreasuryEventsTrustDeployedRegistryLog(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	registry := common.HexToAddress("0x0000000000000000000000000000000000000601")
	fees := common.HexToAddress("0x0000000000000000000000000000000000000602")
	token := common.HexToAddress("0x0000000000000000000000000000000000000603")
	treasury := common.HexToAddress("0x0000000000000000000000000000000000000604")
	controller := common.HexToAddress("0x0000000000000000000000000000000000000605")
	asset := common.HexToAddress("0x0000000000000000000000000000000000000606")
	roots := CTOProvenance{FeeManager: fees, Registry: registry}
	b := &types.Header{Number: big.NewInt(300), Time: 3_000_000}
	deployed := eventLog(t, ctoRegistryABI.Events, "CTOTreasuryDeployed", []common.Hash{common.BytesToHash(token.Bytes()), common.BytesToHash(controller.Bytes()), common.BytesToHash(treasury.Bytes())}, uint64(1), [32]byte{9})
	registered := eventLog(t, ctoTreasuryABI.Events, "SupportedAssetRegistered", []common.Hash{common.BytesToHash(asset.Bytes()), common.BytesToHash(controller.Bytes())})
	logs := stamp(b, deployed, registered)
	logs[0].Address, logs[1].Address = registry, treasury
	if err := s.ApplyWithProvenance(ctx, ArcTestnetChainID, "cto-same-block", b, logs, nil, nil, roots); err != nil {
		t.Fatal(err)
	}
	var assets int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM cto_supported_assets WHERE chain_id=$1 AND is_canonical AND treasury_address=lower($2)`, ArcTestnetChainID, treasury.Hex()).Scan(&assets); err != nil || assets != 1 {
		t.Fatalf("same-block treasury projection=%d err=%v", assets, err)
	}
}

func TestCTOCancelledAndExpiredLifecycleProjection(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	registry := common.HexToAddress("0x0000000000000000000000000000000000000501")
	fees := common.HexToAddress("0x0000000000000000000000000000000000000502")
	creator := common.HexToAddress("0x0000000000000000000000000000000000000503")
	controller := common.HexToAddress("0x0000000000000000000000000000000000000504")
	treasury := common.HexToAddress("0x0000000000000000000000000000000000000505")
	roots := CTOProvenance{FeeManager: fees, Registry: registry}
	b := &types.Header{Number: big.NewInt(200), Time: 2_000_000}
	events := []types.Log{}
	for index, terminal := range []string{"CTOCancelled", "CTOExpired"} {
		token := common.BigToAddress(big.NewInt(int64(0x510 + index)))
		proposal := common.BigToHash(big.NewInt(int64(0x520 + index)))
		proposed := eventLog(t, ctoRegistryABI.Events, "CTOProposed", []common.Hash{proposal, common.BytesToHash(token.Bytes()), common.BytesToHash(creator.Bytes())}, controller, treasury, creator, uint64(index+1), uint64(b.Time+604800), [32]byte{}, "")
		var ended types.Log
		if terminal == "CTOCancelled" {
			ended = eventLog(t, ctoRegistryABI.Events, terminal, []common.Hash{proposal, common.BytesToHash(token.Bytes()), common.BytesToHash(creator.Bytes())})
		} else {
			ended = eventLog(t, ctoRegistryABI.Events, terminal, []common.Hash{proposal, common.BytesToHash(token.Bytes())}, uint8(1))
		}
		events = append(events, proposed, ended)
	}
	logs := stamp(b, events...)
	for i := range logs {
		logs[i].Address = registry
	}
	if err := s.ApplyWithProvenance(ctx, ArcTestnetChainID, "cto-terminal", b, logs, nil, nil, roots); err != nil {
		t.Fatal(err)
	}
	rows, err := s.pool.Query(ctx, `SELECT state FROM cto_proposals WHERE chain_id=$1 AND is_canonical ORDER BY token_nonce`, ArcTestnetChainID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	want := []string{"cancelled", "expired"}
	for i := 0; rows.Next(); i++ {
		var state string
		if err := rows.Scan(&state); err != nil {
			t.Fatal(err)
		}
		if i >= len(want) || state != want[i] {
			t.Fatalf("terminal state[%d]=%s", i, state)
		}
	}
}
