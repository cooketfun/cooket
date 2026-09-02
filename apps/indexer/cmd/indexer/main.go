package main

import (
	"context"
	"errors"
	"fmt"
	indexer "github.com/cooketfun/cooket/apps/indexer"
	"github.com/ethereum/go-ethereum/common"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func main() {
	ctx, stop := signal.NotifyContext(
		context.Background(),
		os.Interrupt,
		syscall.SIGTERM,
	)
	defer stop()

	mode := os.Getenv("INDEXER_MODE")
	if mode == "" {
		mode = "idle"
	}
	chain, err := indexer.ResolveChainRuntime(os.Getenv("COOKET_CHAIN_ID"), os.Getenv("ARC_TESTNET_RPC_URL"))
	if err != nil {
		fmt.Fprintf(os.Stderr, "cooket-indexer: %v\n", err)
		os.Exit(1)
	}
	if err := validateArcIndexerMode(mode); err != nil {
		fmt.Fprintf(os.Stderr, "cooket-indexer: %v\n", err)
		os.Exit(1)
	}
	rpcURL := chain.RPCURL
	if mode != "idle" && rpcURL == "" {
		fmt.Fprintf(os.Stderr, "cooket-indexer: %s is required unless INDEXER_MODE=idle\n", chain.RPCEnvName)
		os.Exit(1)
	}

	if mode == "idle" {
		fmt.Printf("%s started in idle development mode (no RPC connection)\n", chain.Name)
	} else {
		dbURL := os.Getenv("DATABASE_URL")
		if dbURL == "" {
			fmt.Fprintln(os.Stderr, "cooket-indexer: DATABASE_URL is required in active mode")
			os.Exit(1)
		}
		store, err := indexer.NewStore(ctx, dbURL)
		if err != nil {
			panic(err)
		}
		defer store.Close()
		start, _ := strconv.ParseUint(os.Getenv("INDEXER_START_BLOCK"), 10, 64)
		stopBlock, _ := strconv.ParseUint(os.Getenv("INDEXER_STOP_BLOCK"), 10, 64)
		confirm, _ := strconv.ParseUint(os.Getenv("INDEXER_CONFIRMATIONS"), 10, 64)
		if os.Getenv("INDEXER_CONFIRMATIONS") == "" {
			confirm = 6
		}
		batch, _ := strconv.ParseUint(os.Getenv("INDEXER_BATCH_SIZE"), 10, 64)
		maxAttempts, _ := strconv.Atoi(os.Getenv("INDEXER_RPC_MAX_ATTEMPTS"))
		initialMS, _ := strconv.Atoi(os.Getenv("INDEXER_RPC_INITIAL_DELAY_MS"))
		maxMS, _ := strconv.Atoi(os.Getenv("INDEXER_RPC_MAX_DELAY_MS"))
		rpc, err := indexer.NewRPCWithRetry(rpcURL, indexer.RetryConfig{MaxAttempts: maxAttempts, InitialDelay: time.Duration(initialMS) * time.Millisecond, MaxDelay: time.Duration(maxMS) * time.Millisecond})
		if err != nil {
			panic(err)
		}
		factory, feeManager, err := configuredRoots(os.Getenv("COOKET_FACTORY_V3_ADDRESS"), os.Getenv("COOKET_FEE_MANAGER_V3_ADDRESS"))
		if err != nil {
			fmt.Fprintf(os.Stderr, "cooket-indexer: %v\n", err)
			os.Exit(1)
		}
		cfg := indexer.Config{RPCURL: rpcURL, DatabaseURL: dbURL, Mode: mode, ChainID: chain.ChainID, IndexerName: chain.Name, StartBlock: start, StopBlock: stopBlock, Confirmations: confirm, BatchSize: batch, Factory: factory, FeeManager: feeManager}
		if err := cfg.Validate(); err != nil {
			panic(err)
		}
		x := indexer.New(cfg, rpc, store)
		go func() {
			if err := x.Run(ctx); err != nil && ctx.Err() == nil {
				fmt.Fprintf(os.Stderr, "cooket-indexer: %v\n", err)
			}
			stop()
		}()
		fmt.Printf("%s started in %s mode\n", chain.Name, mode)
	}

	<-ctx.Done()

	fmt.Println("cooket-indexer shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	<-shutdownCtx.Done()
}

func validateArcIndexerMode(mode string) error {
	if mode != "idle" && mode != "active" && mode != "once" {
		return errors.New("INDEXER_MODE must be idle, active, or once")
	}
	return nil
}

func configuredRoots(factoryValue, feeManagerValue string) (common.Address, common.Address, error) {
	factoryValue = strings.TrimSpace(factoryValue)
	feeManagerValue = strings.TrimSpace(feeManagerValue)
	if !common.IsHexAddress(factoryValue) || common.HexToAddress(factoryValue) == (common.Address{}) {
		return common.Address{}, common.Address{}, errors.New("COOKET_FACTORY_V3_ADDRESS is required in active mode")
	}
	if !common.IsHexAddress(feeManagerValue) || common.HexToAddress(feeManagerValue) == (common.Address{}) {
		return common.Address{}, common.Address{}, errors.New("COOKET_FEE_MANAGER_V3_ADDRESS is required in active mode")
	}
	return common.HexToAddress(factoryValue), common.HexToAddress(feeManagerValue), nil
}
