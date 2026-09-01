package main

import (
	"testing"

	indexer "github.com/cooketfun/cooket/apps/indexer"
)

func TestConfiguredContractsUsesOnlyV3FactoryWhenNoExplicitList(t *testing.T) {
	addresses, err := configuredContracts("", "0x0000000000000000000000000000000000000001")
	if err != nil || len(addresses) != 1 || addresses[0].Hex() != "0x0000000000000000000000000000000000000001" {
		t.Fatalf("addresses=%v err=%v", addresses, err)
	}
	if _, err := configuredContracts("", ""); err == nil {
		t.Fatal("expected V3 factory configuration error")
	}
}

func TestResolveChainRuntimeSelectsSupportedRPCAndName(t *testing.T) {
	arc, err := indexer.ResolveChainRuntime("", "")
	if err != nil || arc.ChainID != indexer.ArcTestnetChainID || arc.RPCURL != indexer.ArcTestnetRPCURL || arc.Name != "cooket-arc-testnet" || arc.RPCEnvName != "ARC_TESTNET_RPC_URL" {
		t.Fatalf("arc=%+v err=%v", arc, err)
	}
}

func TestResolveChainRuntimeRejectsUnsupportedOrInvalidChain(t *testing.T) {
	for _, value := range []string{"1", "8453", "84532", "not-a-chain"} {
		if _, err := indexer.ResolveChainRuntime(value, "arc"); err == nil {
			t.Fatalf("expected %q to fail", value)
		}
	}
}

func TestArcIndexerRejectsActiveBaseDerivedProjection(t *testing.T) {
	if err := validateArcIndexerMode("idle"); err != nil {
		t.Fatalf("idle mode should remain available: %v", err)
	}
	for _, mode := range []string{"active", "once"} {
		if err := validateArcIndexerMode(mode); err == nil {
			t.Fatalf("expected %q mode to fail closed", mode)
		}
	}
}

func TestConfiguredContractsAcceptsExplicitV3ContractList(t *testing.T) {
	addresses, err := configuredContracts("0x0000000000000000000000000000000000000001,0x0000000000000000000000000000000000000002", "")
	if err != nil || len(addresses) != 2 {
		t.Fatalf("addresses=%v err=%v", addresses, err)
	}
	if _, err := configuredContracts("not-an-address", ""); err == nil {
		t.Fatal("expected invalid configured contract error")
	}
}
