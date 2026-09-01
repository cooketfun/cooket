package indexer

import (
	"context"
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

func TestV3GraduationProjectionReplayRewindAndReplacement(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	token := common.HexToAddress("0x0000000000000000000000000000000000000401")
	creator := common.HexToAddress("0x0000000000000000000000000000000000000402")
	curveAddress := common.HexToAddress("0x0000000000000000000000000000000000000403")
	manager := common.HexToAddress("0x0000000000000000000000000000000000000404")
	pool := common.HexToAddress("0x0000000000000000000000000000000000000405")
	custodian := common.HexToAddress("0x0000000000000000000000000000000000000406")
	replacementCustodian := common.HexToAddress("0x0000000000000000000000000000000000000407")
	b1 := &types.Header{Number: big.NewInt(30), Time: 30}
	b2 := &types.Header{Number: big.NewInt(31), ParentHash: b1.Hash(), Time: 31}
	replacement := &types.Header{Number: big.NewInt(31), ParentHash: b1.Hash(), Time: 32, Nonce: types.EncodeNonce(5)}
	launchTx := common.HexToHash("0x3001")
	graduationTx := common.HexToHash("0x3002")

	launch := eventLog(t, contractABI.Events, "TokenLaunchedV3", []common.Hash{common.BytesToHash(creator.Bytes()), common.BytesToHash(token.Bytes()), common.BytesToHash(curveAddress.Bytes())}, "endpoint-cp-v3", big.NewInt(1000), big.NewInt(800), big.NewInt(200), creator, pool, [32]byte{}, [32]byte{}, uint16(0))
	launch.Address, launch.BlockNumber, launch.BlockHash, launch.TxHash, launch.Index = common.HexToAddress("0x499"), 30, b1.Hash(), launchTx, 2
	metadata := map[string]TokenMetadata{token.Hex(): {Name: "Graduation", Symbol: "GRAD", Decimals: 18}}
	if err := s.ApplyWithMetadata(ctx, BaseSepoliaChainID, "v3-graduation", b1, []types.Log{launch}, metadata); err != nil {
		t.Fatal(err)
	}

	makeGraduationLogs := func(header *types.Header, settlementIndex, curveIndex uint, settlementCustodian common.Address, tokenID, liquidity int64) []types.Log {
		settlement := eventLog(t, v3GraduationABI.Events, "GraduatedV3", []common.Hash{common.BytesToHash(token.Bytes()), common.BytesToHash(settlementCustodian.Bytes()), common.BigToHash(big.NewInt(tokenID))}, big.NewInt(liquidity))
		settlement.Address, settlement.BlockNumber, settlement.BlockHash, settlement.TxHash, settlement.TxIndex, settlement.Index = manager, header.Number.Uint64(), header.Hash(), graduationTx, 0, settlementIndex
		graduated := eventLog(t, contractABI.Events, "Graduated", []common.Hash{common.BytesToHash(token.Bytes()), common.BytesToHash(manager.Bytes())}, big.NewInt(200), big.NewInt(3), big.NewInt(800))
		graduated.Address, graduated.BlockNumber, graduated.BlockHash, graduated.TxHash, graduated.TxIndex, graduated.Index = curveAddress, header.Number.Uint64(), header.Hash(), graduationTx, 0, curveIndex
		return []types.Log{settlement, graduated}
	}
	originalLogs := makeGraduationLogs(b2, 4, 6, custodian, 77, 1234)
	for replay := 0; replay < 3; replay++ {
		if err := s.Apply(ctx, BaseSepoliaChainID, "v3-graduation", b2, originalLogs); err != nil {
			t.Fatal(err)
		}
	}

	var gotPool, gotManager, tokenAmount, ethAmount, soldSupply string
	if err := s.pool.QueryRow(ctx, `SELECT canonical_pool_address FROM curves WHERE chain_id=$1 AND token_address=$2 AND is_canonical`, BaseSepoliaChainID, token.Hex()).Scan(&gotPool); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT graduation_manager_address,token_amount::text,eth_amount::text,sold_supply::text FROM graduations WHERE chain_id=$1 AND token_address=$2 AND is_canonical`, BaseSepoliaChainID, token.Hex()).Scan(&gotManager, &tokenAmount, &ethAmount, &soldSupply); err != nil {
		t.Fatal(err)
	}
	var gotSettlementManager, gotCustodian, positionTokenID, liquidity string
	if err := s.pool.QueryRow(ctx, `SELECT graduation_manager_address,lp_custodian_address,position_token_id::text,liquidity_amount::text FROM liquidity_events WHERE chain_id=$1 AND token_address=$2 AND is_canonical AND event_name='GraduatedV3'`, BaseSepoliaChainID, token.Hex()).Scan(&gotSettlementManager, &gotCustodian, &positionTokenID, &liquidity); err != nil {
		t.Fatal(err)
	}
	var graduationCount, settlementCount int64
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM graduations WHERE chain_id=$1 AND token_address=$2`, BaseSepoliaChainID, token.Hex()).Scan(&graduationCount); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM liquidity_events WHERE chain_id=$1 AND token_address=$2`, BaseSepoliaChainID, token.Hex()).Scan(&settlementCount); err != nil {
		t.Fatal(err)
	}
	if gotPool != pool.Hex() || gotManager != manager.Hex() || gotSettlementManager != manager.Hex() || tokenAmount != "200" || ethAmount != "3" || soldSupply != "800" || gotCustodian != custodian.Hex() || positionTokenID != "77" || liquidity != "1234" || graduationCount != 1 || settlementCount != 1 {
		t.Fatalf("projection pool=%s manager=%s/%s amounts=%s/%s/%s settlement=%s/%s/%s counts=%d/%d", gotPool, gotManager, gotSettlementManager, tokenAmount, ethAmount, soldSupply, gotCustodian, positionTokenID, liquidity, graduationCount, settlementCount)
	}

	if err := s.Rewind(ctx, BaseSepoliaChainID, "v3-graduation", 31); err != nil {
		t.Fatal(err)
	}
	var canonicalGraduations, canonicalSettlements int64
	var lifecycle string
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM graduations WHERE chain_id=$1 AND token_address=$2 AND is_canonical`, BaseSepoliaChainID, token.Hex()).Scan(&canonicalGraduations); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM liquidity_events WHERE chain_id=$1 AND token_address=$2 AND is_canonical`, BaseSepoliaChainID, token.Hex()).Scan(&canonicalSettlements); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT lifecycle FROM curves WHERE chain_id=$1 AND token_address=$2 AND is_canonical`, BaseSepoliaChainID, token.Hex()).Scan(&lifecycle); err != nil {
		t.Fatal(err)
	}
	if canonicalGraduations != 0 || canonicalSettlements != 0 || lifecycle != "active" {
		t.Fatalf("rewind canonical graduation/settlement/lifecycle=%d/%d/%s", canonicalGraduations, canonicalSettlements, lifecycle)
	}

	replacementLogs := makeGraduationLogs(replacement, 14, 16, replacementCustodian, 88, 5678)
	if err := s.Apply(ctx, BaseSepoliaChainID, "v3-graduation", replacement, replacementLogs); err != nil {
		t.Fatal(err)
	}
	var canonicalPosition, canonicalLiquidity, canonicalCustodian string
	if err := s.pool.QueryRow(ctx, `SELECT position_token_id::text,liquidity_amount::text,lp_custodian_address FROM liquidity_events WHERE chain_id=$1 AND token_address=$2 AND is_canonical`, BaseSepoliaChainID, token.Hex()).Scan(&canonicalPosition, &canonicalLiquidity, &canonicalCustodian); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM graduations WHERE chain_id=$1 AND token_address=$2 AND is_canonical`, BaseSepoliaChainID, token.Hex()).Scan(&canonicalGraduations); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM liquidity_events WHERE chain_id=$1 AND token_address=$2 AND is_canonical`, BaseSepoliaChainID, token.Hex()).Scan(&canonicalSettlements); err != nil {
		t.Fatal(err)
	}
	if canonicalGraduations != 1 || canonicalSettlements != 1 || canonicalPosition != "88" || canonicalLiquidity != "5678" || canonicalCustodian != replacementCustodian.Hex() {
		t.Fatalf("replacement canonical=%d/%d position=%s liquidity=%s custodian=%s", canonicalGraduations, canonicalSettlements, canonicalPosition, canonicalLiquidity, canonicalCustodian)
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM graduations WHERE chain_id=$1 AND token_address=$2`, BaseSepoliaChainID, token.Hex()).Scan(&graduationCount); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM liquidity_events WHERE chain_id=$1 AND token_address=$2`, BaseSepoliaChainID, token.Hex()).Scan(&settlementCount); err != nil {
		t.Fatal(err)
	}
	if graduationCount != 2 || settlementCount != 2 {
		t.Fatalf("re-inclusion identities graduation/settlement=%d/%d want=2/2", graduationCount, settlementCount)
	}
}
