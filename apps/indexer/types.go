package indexer

import (
	"context"
	"fmt"
	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"math/big"
	"strconv"
	"strings"
)

const (
	ArcTestnetChainID     int64 = 5042002
	ArcTestnetRPCURL            = "https://rpc.testnet.arc.io"
	ArcCanonicalUsdc            = "0x3600000000000000000000000000000000000000"
	ArcCooketFactoryV3          = "0x96a1F09F0E85B3f1800eFBFb0CD6BE7EDD7a9BE5"
	ArcCooketFeeManagerV3       = "0x252BDd768Cc44070a84A4b8E86634eae25372571"
	// BaseSepoliaChainID is retained only for historical projection fixtures.
	// It is rejected by ResolveChainRuntime and Config.Validate.
	BaseSepoliaChainID int64 = 84532
)

type ChainRuntime struct {
	ChainID    int64
	Name       string
	RPCURL     string
	RPCEnvName string
}

func ResolveChainRuntime(rawChainID, arcRPC string) (ChainRuntime, error) {
	value := strings.TrimSpace(rawChainID)
	if value == "" {
		value = strconv.FormatInt(ArcTestnetChainID, 10)
	}
	chainID, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return ChainRuntime{}, fmt.Errorf("invalid COOKET_CHAIN_ID %q", rawChainID)
	}
	if chainID != ArcTestnetChainID {
		return ChainRuntime{}, fmt.Errorf("unsupported chain id %d", chainID)
	}
	rpcURL := strings.TrimSpace(arcRPC)
	if rpcURL == "" {
		rpcURL = ArcTestnetRPCURL
	}
	return ChainRuntime{ChainID: chainID, Name: "cooket-arc-testnet", RPCURL: rpcURL, RPCEnvName: "ARC_TESTNET_RPC_URL"}, nil
}

type RPC interface {
	HeaderByNumber(context.Context, *big.Int) (*types.Header, error)
	FilterLogs(context.Context, ethereum.FilterQuery) ([]types.Log, error)
	CallContract(context.Context, ethereum.CallMsg, *big.Int) ([]byte, error)
}

// transactionSenderRPC is optional so existing deterministic projection tests
// can continue to use a minimal RPC fake. The production ethclient implements
// it and supplies the wallet sender for router-emitted pool Swap events.
type transactionSenderRPC interface {
	TransactionByHash(context.Context, common.Hash) (*types.Transaction, bool, error)
}
type TokenMetadata struct {
	Name, Symbol string
	Decimals     uint8
}
type Config struct {
	RPCURL, DatabaseURL, Mode, IndexerName          string
	ChainID                                         int64
	StartBlock, StopBlock, Confirmations, BatchSize uint64
	Contracts                                       []common.Address
	Factory, FeeManager                             common.Address
}

type CTOProvenance struct {
	Factory, FeeManager, Registry common.Address
}

func (c *Config) defaults() {
	if c.ChainID == 0 {
		c.ChainID = ArcTestnetChainID
	}
	if c.IndexerName == "" {
		c.IndexerName = "cooket-arc-testnet"
	}
	if c.BatchSize == 0 {
		c.BatchSize = 500
	}
}
func (c Config) Validate() error {
	if c.ChainID != ArcTestnetChainID {
		return fmt.Errorf("unsupported chain id %d", c.ChainID)
	}
	if c.Mode != "idle" && c.RPCURL == "" {
		return fmt.Errorf("rpc url is required in active mode")
	}
	if c.Mode != "idle" && c.DatabaseURL == "" {
		return fmt.Errorf("database url is required in active mode")
	}
	if c.Mode != "idle" && (c.Factory == (common.Address{}) || c.FeeManager == (common.Address{})) {
		return fmt.Errorf("verified factory and fee manager roots are required in active mode")
	}
	if c.BatchSize == 0 {
		return fmt.Errorf("batch size must be positive")
	}
	return nil
}
