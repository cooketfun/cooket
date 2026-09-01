package indexer

import (
	"context"
	"errors"
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

type discoveryRPC struct {
	filter func(ethereum.FilterQuery) ([]types.Log, error)
}

func (r discoveryRPC) HeaderByNumber(context.Context, *big.Int) (*types.Header, error) {
	return nil, errors.New("unexpected HeaderByNumber")
}
func (r discoveryRPC) FilterLogs(_ context.Context, query ethereum.FilterQuery) ([]types.Log, error) {
	return r.filter(query)
}
func (r discoveryRPC) CallContract(context.Context, ethereum.CallMsg, *big.Int) ([]byte, error) {
	return nil, errors.New("unexpected CallContract")
}

func TestGraduatedV3ABIExactDecode(t *testing.T) {
	token := common.HexToAddress("0x0000000000000000000000000000000000000101")
	custodian := common.HexToAddress("0x0000000000000000000000000000000000000102")
	tokenID := big.NewInt(987654321)
	liquidity := new(big.Int).SetUint64(123456789)
	log := eventLog(t, v3GraduationABI.Events, "GraduatedV3", []common.Hash{common.BytesToHash(token.Bytes()), common.BytesToHash(custodian.Bytes()), common.BigToHash(tokenID)}, liquidity)

	decoded, err := decodeLog(v3GraduationABI, "GraduatedV3", log)
	if err != nil {
		t.Fatal(err)
	}
	if decoded["token"].(common.Address) != token || decoded["custodian"].(common.Address) != custodian || decoded["tokenId"].(*big.Int).Cmp(tokenID) != 0 || decoded["liquidity"].(*big.Int).Cmp(liquidity) != 0 {
		t.Fatalf("decoded GraduatedV3=%v", decoded)
	}
}

func TestSameBatchLaunchAndGraduationDiscovery(t *testing.T) {
	factory := common.HexToAddress("0x0000000000000000000000000000000000000201")
	token := common.HexToAddress("0x0000000000000000000000000000000000000202")
	curve := common.HexToAddress("0x0000000000000000000000000000000000000203")
	creator := common.HexToAddress("0x0000000000000000000000000000000000000204")
	buyer := common.HexToAddress("0x0000000000000000000000000000000000000205")
	manager := common.HexToAddress("0x0000000000000000000000000000000000000206")
	custodian := common.HexToAddress("0x0000000000000000000000000000000000000207")
	pool := common.HexToAddress("0x0000000000000000000000000000000000000208")
	b10 := &types.Header{Number: big.NewInt(10), Time: 10}
	b11 := &types.Header{Number: big.NewInt(11), ParentHash: b10.Hash(), Time: 11}
	launchTx := common.HexToHash("0x1001")
	graduationTx := common.HexToHash("0x1002")

	launch := eventLog(t, contractABI.Events, "TokenLaunchedV3", []common.Hash{common.BytesToHash(creator.Bytes()), common.BytesToHash(token.Bytes()), common.BytesToHash(curve.Bytes())}, "endpoint-cp-v3", big.NewInt(1000), big.NewInt(800), big.NewInt(200), creator, pool, [32]byte{}, [32]byte{}, uint16(0))
	launch.Address, launch.BlockNumber, launch.BlockHash, launch.TxHash, launch.TxIndex, launch.Index = factory, 10, b10.Hash(), launchTx, 0, 8
	transfer := eventLog(t, contractABI.Events, "Transfer", []common.Hash{{}, common.BytesToHash(buyer.Bytes())}, big.NewInt(800))
	transfer.Address, transfer.BlockNumber, transfer.BlockHash, transfer.TxHash, transfer.TxIndex, transfer.Index = token, 11, b11.Hash(), graduationTx, 0, 2
	settlement := eventLog(t, v3GraduationABI.Events, "GraduatedV3", []common.Hash{common.BytesToHash(token.Bytes()), common.BytesToHash(custodian.Bytes()), common.BigToHash(big.NewInt(77))}, big.NewInt(1234))
	settlement.Address, settlement.BlockNumber, settlement.BlockHash, settlement.TxHash, settlement.TxIndex, settlement.Index = manager, 11, b11.Hash(), graduationTx, 0, 4
	graduated := eventLog(t, contractABI.Events, "Graduated", []common.Hash{common.BytesToHash(token.Bytes()), common.BytesToHash(manager.Bytes())}, big.NewInt(200), big.NewInt(3), big.NewInt(800))
	graduated.Address, graduated.BlockNumber, graduated.BlockHash, graduated.TxHash, graduated.TxIndex, graduated.Index = curve, 11, b11.Hash(), graduationTx, 0, 6
	buy := eventLog(t, v3TradeABI.Events, "TokensBought", []common.Hash{common.BytesToHash(token.Bytes()), common.BytesToHash(buyer.Bytes())}, big.NewInt(4), big.NewInt(3), big.NewInt(3), big.NewInt(800), big.NewInt(0), big.NewInt(0), big.NewInt(0), big.NewInt(0), big.NewInt(0), big.NewInt(1))
	buy.Address, buy.BlockNumber, buy.BlockHash, buy.TxHash, buy.TxIndex, buy.Index = curve, 11, b11.Hash(), graduationTx, 0, 7

	rpc := discoveryRPC{filter: func(query ethereum.FilterQuery) ([]types.Log, error) {
		if len(query.Addresses) != 1 || len(query.Topics) != 1 || len(query.Topics[0]) == 0 {
			return nil, errors.New("unexpected unbounded query")
		}
		switch query.Addresses[0] {
		case token:
			if query.FromBlock.Uint64() != 10 || query.ToBlock.Uint64() != 12 || query.Topics[0][0] != contractABI.Events["Transfer"].ID {
				return nil, errors.New("invalid token discovery query")
			}
			return []types.Log{transfer}, nil
		case curve:
			if query.FromBlock.Uint64() != 10 || query.ToBlock.Uint64() != 12 || len(query.Topics[0]) != 3 {
				return nil, errors.New("invalid curve discovery query")
			}
			return []types.Log{graduated, buy, graduated}, nil
		case pool:
			if query.FromBlock.Uint64() != 10 || query.ToBlock.Uint64() != 12 || query.Topics[0][0] != uniswapV3PoolABI.Events["Swap"].ID {
				return nil, errors.New("invalid pool discovery query")
			}
			return nil, nil
		case manager:
			if query.FromBlock.Uint64() != 11 || query.ToBlock.Uint64() != 11 || query.Topics[0][0] != v3GraduationABI.Events["GraduatedV3"].ID {
				return nil, errors.New("invalid manager discovery query")
			}
			return []types.Log{settlement}, nil
		default:
			return nil, errors.New("unexpected emitter")
		}
	}}
	indexer := New(Config{Contracts: []common.Address{factory}}, rpc, nil)
	logs, err := indexer.discoverLaunchLogs(context.Background(), 12, []types.Log{launch})
	if err != nil {
		t.Fatal(err)
	}
	logs, err = indexer.discoverGraduationSettlements(context.Background(), logs)
	if err != nil {
		t.Fatal(err)
	}
	logs, err = canonicalLogs(logs)
	if err != nil {
		t.Fatal(err)
	}
	wantTopics := map[common.Hash]bool{
		contractABI.Events["TokenLaunchedV3"].ID: false,
		contractABI.Events["Transfer"].ID:        false,
		v3TradeABI.Events["TokensBought"].ID:     false,
		contractABI.Events["Graduated"].ID:       false,
		v3GraduationABI.Events["GraduatedV3"].ID: false,
	}
	for _, log := range logs {
		if _, ok := wantTopics[log.Topics[0]]; ok {
			wantTopics[log.Topics[0]] = true
		}
	}
	for topic, found := range wantTopics {
		if !found {
			t.Fatalf("missing discovered topic %s in %v", topic.Hex(), logs)
		}
	}
	if len(logs) != 5 || logs[2].Topics[0] != v3GraduationABI.Events["GraduatedV3"].ID || logs[3].Topics[0] != contractABI.Events["Graduated"].ID {
		t.Fatalf("canonical order/deduplication=%v", logs)
	}
}

func TestGraduationPairValidationRejectsContradictions(t *testing.T) {
	token := common.HexToAddress("0x0000000000000000000000000000000000000301")
	manager := common.HexToAddress("0x0000000000000000000000000000000000000302")
	custodian := common.HexToAddress("0x0000000000000000000000000000000000000303")
	block := &types.Header{Number: big.NewInt(20), Time: 20}
	txHash := common.HexToHash("0x2001")
	curve := eventLog(t, contractABI.Events, "Graduated", []common.Hash{common.BytesToHash(token.Bytes()), common.BytesToHash(manager.Bytes())}, big.NewInt(200), big.NewInt(3), big.NewInt(800))
	curve.Address, curve.BlockNumber, curve.BlockHash, curve.TxHash, curve.Index = common.HexToAddress("0x304"), 20, block.Hash(), txHash, 9
	settlementFor := func(emitter, eventToken common.Address, tx common.Hash, index uint) types.Log {
		log := eventLog(t, v3GraduationABI.Events, "GraduatedV3", []common.Hash{common.BytesToHash(eventToken.Bytes()), common.BytesToHash(custodian.Bytes()), common.BigToHash(big.NewInt(7))}, big.NewInt(55))
		log.Address, log.BlockNumber, log.BlockHash, log.TxHash, log.Index = emitter, 20, block.Hash(), tx, index
		return log
	}
	valid := settlementFor(manager, token, txHash, 7)
	if err := validateGraduationPairs([]types.Log{valid, curve}); err != nil {
		t.Fatalf("valid pair rejected: %v", err)
	}
	for name, logs := range map[string][]types.Log{
		"missing":           {curve},
		"wrong manager":     {settlementFor(common.HexToAddress("0x999"), token, txHash, 7), curve},
		"wrong token":       {settlementFor(manager, common.HexToAddress("0x998"), txHash, 7), curve},
		"wrong transaction": {settlementFor(manager, token, common.HexToHash("0x999"), 7), curve},
		"duplicate":         {valid, settlementFor(manager, token, txHash, 8), curve},
	} {
		t.Run(name, func(t *testing.T) {
			if err := validateGraduationPairs(logs); err == nil {
				t.Fatal("expected graduation pair validation failure")
			}
		})
	}
	contradictory := valid
	contradictory.Address = common.HexToAddress("0x997")
	if _, err := canonicalLogs([]types.Log{valid, contradictory}); err == nil {
		t.Fatal("expected contradictory canonical log identity failure")
	}
}
