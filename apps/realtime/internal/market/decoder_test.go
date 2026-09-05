package market

import (
	"math/big"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
)

func TestEventTopicsMatchReviewedContractInterfaces(t *testing.T) {
	cases := []struct {
		got       common.Hash
		signature string
	}{
		{TokensBoughtTopic, "TokensBought(address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)"},
		{TokensSoldTopic, "TokensSold(address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)"},
		{SwapTopic, "Swap(address,address,int256,int256,uint160,uint128,int24)"},
	}
	for _, test := range cases {
		if want := crypto.Keccak256Hash([]byte(test.signature)); test.got != want {
			t.Fatalf("topic for %s=%s want=%s", test.signature, test.got.Hex(), want.Hex())
		}
	}
	if SwapTopic.Hex() != "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67" {
		t.Fatalf("unexpected canonical Swap topic %s", SwapTopic.Hex())
	}
}

func TestDecoderNormalizesCurveBuyWithNativeUSDCDecimals(t *testing.T) {
	token := common.HexToAddress("0x1000000000000000000000000000000000000010")
	curve := common.HexToAddress("0x2000000000000000000000000000000000000010")
	registry := NewRegistry()
	if _, err := registry.Replace([]Market{{Token: token, Curve: curve, Stage: StageCurve, SourceStartBlock: 5}}); err != nil {
		t.Fatal(err)
	}
	decoder, err := NewDecoder(registry, common.HexToAddress("0x3600000000000000000000000000000000000000"))
	if err != nil {
		t.Fatal(err)
	}
	eventABI := curveABI.Events["TokensBought"]
	data, err := eventABI.Inputs.NonIndexed().Pack(
		big.NewInt(110), big.NewInt(100), big.NewInt(90), big.NewInt(1_000), big.NewInt(10),
		big.NewInt(2), big.NewInt(3), big.NewInt(4), big.NewInt(1), big.NewInt(10),
	)
	if err != nil {
		t.Fatal(err)
	}
	entry := types.Log{Address: curve, Topics: []common.Hash{TokensBoughtTopic, common.BytesToHash(token.Bytes()), common.HexToHash("0xbeef")}, Data: data, BlockNumber: 5, TxHash: common.HexToHash("0x1234"), Index: 2}
	normalized, err := decoder.Decode(entry, time.Unix(10, 0))
	if err != nil {
		t.Fatal(err)
	}
	if normalized.Source != SourceCurve || normalized.Side != SideBuy || normalized.TokenAmountRaw != "1000" || normalized.USDCAmountRaw != "100" || normalized.USDCDecimals != 18 {
		t.Fatalf("unexpected curve event: %+v", normalized)
	}
	if normalized.RawFields["netCurveInput"] != "90" || normalized.RawFields["submittedGross"] != "110" {
		t.Fatalf("missing raw curve fields: %v", normalized.RawFields)
	}
}

func TestDecoderNormalizesV3BuyAndSellWithERC20USDCDecimals(t *testing.T) {
	token := common.HexToAddress("0x1000000000000000000000000000000000000020")
	pool := common.HexToAddress("0x8000000000000000000000000000000000000020")
	registry := NewRegistry()
	if _, err := registry.Replace([]Market{{Token: token, Curve: common.HexToAddress("0x2000000000000000000000000000000000000020"), CanonicalPool: pool, Stage: StageGraduated, SourceStartBlock: 6}}); err != nil {
		t.Fatal(err)
	}
	decoder, err := NewDecoder(registry, common.HexToAddress("0x3600000000000000000000000000000000000000"))
	if err != nil {
		t.Fatal(err)
	}
	assertSwap := func(amount0, amount1 *big.Int, expectedSide Side, expectedToken, expectedUSDC string) {
		t.Helper()
		eventABI := uniswapV3PoolABI.Events["Swap"]
		data, packErr := eventABI.Inputs.NonIndexed().Pack(amount0, amount1, big.NewInt(123456), big.NewInt(789), big.NewInt(-42))
		if packErr != nil {
			t.Fatal(packErr)
		}
		entry := types.Log{Address: pool, Topics: []common.Hash{SwapTopic, common.HexToHash("0x1"), common.HexToHash("0x2")}, Data: data, BlockNumber: 6, TxHash: common.HexToHash("0x5678"), Index: 3, Removed: true}
		normalized, decodeErr := decoder.Decode(entry, time.Unix(20, 0))
		if decodeErr != nil {
			t.Fatal(decodeErr)
		}
		if normalized.Source != SourceUniswapV3 || normalized.Side != expectedSide || normalized.TokenAmountRaw != expectedToken || normalized.USDCAmountRaw != expectedUSDC || normalized.USDCDecimals != 6 || !normalized.Removed || normalized.SqrtPriceX96 != "123456" || normalized.Tick != "-42" {
			t.Fatalf("unexpected V3 event: %+v", normalized)
		}
	}
	assertSwap(big.NewInt(-2_000), big.NewInt(500_000_000), SideBuy, "2000", "500000000")
	assertSwap(big.NewInt(4_000), big.NewInt(-819_116_844), SideSell, "4000", "819116844")
}

func TestDecoderRejectsSourceTopicMismatch(t *testing.T) {
	registry := NewRegistry()
	curve := common.HexToAddress("0x2000000000000000000000000000000000000030")
	if _, err := registry.Replace([]Market{{Token: common.HexToAddress("0x1000000000000000000000000000000000000030"), Curve: curve, Stage: StageCurve, SourceStartBlock: 1}}); err != nil {
		t.Fatal(err)
	}
	decoder, _ := NewDecoder(registry, common.HexToAddress("0x3600000000000000000000000000000000000000"))
	if _, err := decoder.Decode(types.Log{Address: curve, Topics: []common.Hash{SwapTopic}}, time.Now()); err == nil {
		t.Fatal("curve address accepted a pool Swap topic")
	}
}
