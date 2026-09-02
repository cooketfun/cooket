package main

import (
	"testing"

	indexer "github.com/cooketfun/cooket/apps/indexer"
)

func TestConfiguredRootsRequiresFactoryAndFeeManager(t *testing.T) {
	factory, fees, err := configuredRoots("0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000002")
	if err != nil || factory.Hex() != "0x0000000000000000000000000000000000000001" || fees.Hex() != "0x0000000000000000000000000000000000000002" {
		t.Fatalf("factory=%v fees=%v err=%v", factory, fees, err)
	}
	if _, _, err := configuredRoots("", ""); err == nil {
		t.Fatal("expected root configuration error")
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

func TestArcIndexerAcceptsOnlyExplicitModes(t *testing.T) {
	if err := validateArcIndexerMode("idle"); err != nil {
		t.Fatalf("idle mode should remain available: %v", err)
	}
	for _, mode := range []string{"active", "once"} {
		if err := validateArcIndexerMode(mode); err != nil {
			t.Fatalf("expected %q mode to be recognized: %v", mode, err)
		}
	}
	if err := validateArcIndexerMode("unsafe"); err == nil {
		t.Fatal("expected unknown mode rejection")
	}
}

func TestConfiguredRootsRejectsMalformedOrZeroValues(t *testing.T) {
	for _, values := range [][2]string{{"not-an-address", "0x0000000000000000000000000000000000000002"}, {"0x0000000000000000000000000000000000000001", ""}, {"0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000002"}} {
		if _, _, err := configuredRoots(values[0], values[1]); err == nil {
			t.Fatalf("expected invalid roots %q/%q", values[0], values[1])
		}
	}
}
