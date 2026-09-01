package indexer

import (
	"testing"

	"github.com/ethereum/go-ethereum/common"
)

func TestProjectedTokenAddressMakesReplayExclusionsTokenSpecific(t *testing.T) {
	token := common.HexToAddress("0xEC2710A9df34b66B07BF96933d13B76e1D526c07")
	other := common.HexToAddress("0x0000000000000000000000000000000000000002")
	if got := projectedTokenAddress("TokenLaunchedV3", map[string]any{"token": token}); got != token.Hex() {
		t.Fatalf("launch token=%s want=%s", got, token.Hex())
	}
	if got := projectedTokenAddress("TokensBoughtV3", map[string]any{"token": other}); got != other.Hex() {
		t.Fatalf("other token=%s want=%s", got, other.Hex())
	}
	if got := projectedTokenAddress("UniswapV3Swap", map[string]any{"token": token}); got != "" {
		t.Fatalf("pool swap must resolve through the exclusion-aware canonical curve query: %s", got)
	}
}
