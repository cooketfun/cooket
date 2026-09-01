package main

import "testing"

func TestResolveAPIChainConfigDefaultsToArcTestnet(t *testing.T) {
	config, err := resolveAPIChainConfig("", "")
	if err != nil || config.ChainID != arcTestnetChainID || config.RPCURL != arcTestnetRPC || config.Name != "arc_testnet" {
		t.Fatalf("config=%+v err=%v", config, err)
	}
}

func TestResolveAPIChainConfigAcceptsArcOverride(t *testing.T) {
	config, err := resolveAPIChainConfig("5042002", "https://arc.invalid")
	if err != nil || config.ChainID != arcTestnetChainID || config.RPCURL != "https://arc.invalid" {
		t.Fatalf("config=%+v err=%v", config, err)
	}
}

func TestResolveAPIChainConfigRejectsUnsupportedChains(t *testing.T) {
	for _, value := range []string{"1", "8453", "84532", "invalid"} {
		if _, err := resolveAPIChainConfig(value, "https://arc.invalid"); err == nil {
			t.Fatalf("expected %q to fail", value)
		}
	}
}
