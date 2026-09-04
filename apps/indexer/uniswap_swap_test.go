package indexer

import (
	"math/big"
	"testing"
)

func TestNormalizeUniswapV3SwapUsesExecutedSignedDeltas(t *testing.T) {
	// token0: pool paying Cooket and receiving 6-decimal USDC is a buy.
	token := "0x1000000000000000000000000000000000000000"
	side, tokens, usdc, err := normalizeUniswapV3Swap(token, big.NewInt(-2_000_000_000_000_000_000), big.NewInt(3_000_000))
	if err != nil || side != "buy" || tokens.String() != "2000000000000000000" || usdc.String() != "3000000" {
		t.Fatalf("buy side=%s token=%v usdc=%v err=%v", side, tokens, usdc, err)
	}
	// token0: pool receiving Cooket and paying USDC is a sell.
	side, tokens, usdc, err = normalizeUniswapV3Swap(token, big.NewInt(2_000_000_000_000_000_000), big.NewInt(-1_500_000))
	if err != nil || side != "sell" || tokens.String() != "2000000000000000000" || usdc.String() != "1500000" {
		t.Fatalf("sell side=%s token=%v usdc=%v err=%v", side, tokens, usdc, err)
	}
}
