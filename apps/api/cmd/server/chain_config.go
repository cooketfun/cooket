package main

import (
	"fmt"
	"strconv"
	"strings"
)

const (
	arcTestnetChainID int64 = 5042002
	arcTestnetRPC           = "https://rpc.testnet.arc.io"
)

type apiChainConfig struct {
	ChainID int64
	Name    string
	RPCURL  string
}

func resolveAPIChainConfig(rawChainID, rpcURL string) (apiChainConfig, error) {
	value := strings.TrimSpace(rawChainID)
	if value == "" {
		value = strconv.FormatInt(arcTestnetChainID, 10)
	}
	chainID, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return apiChainConfig{}, fmt.Errorf("invalid COOKET_CHAIN_ID %q", rawChainID)
	}
	if chainID != arcTestnetChainID {
		return apiChainConfig{}, fmt.Errorf("unsupported chain id %d", chainID)
	}
	selectedRPC := strings.TrimSpace(rpcURL)
	if selectedRPC == "" {
		selectedRPC = arcTestnetRPC
	}
	return apiChainConfig{ChainID: chainID, Name: "arc_testnet", RPCURL: selectedRPC}, nil
}
