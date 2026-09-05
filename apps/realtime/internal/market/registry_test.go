package market

import (
	"testing"

	"github.com/ethereum/go-ethereum/common"
)

func TestRegistryAddsAndMapsCurveMarket(t *testing.T) {
	registry := NewRegistry()
	token := common.HexToAddress("0x1000000000000000000000000000000000000001")
	curve := common.HexToAddress("0x2000000000000000000000000000000000000001")
	pool := common.HexToAddress("0x3000000000000000000000000000000000000001")
	changed, err := registry.Replace([]Market{{Token: token, Curve: curve, CanonicalPool: pool, Stage: StageCurve, SourceStartBlock: 10}})
	if err != nil || !changed || registry.Len() != 1 {
		t.Fatalf("replace changed=%t len=%d err=%v", changed, registry.Len(), err)
	}
	registration, ok := registry.Resolve(curve)
	if !ok || registration.Source != SourceCurve || registration.Market.Token != token {
		t.Fatalf("curve registration=%+v ok=%t", registration, ok)
	}
	if _, ok := registry.Resolve(pool); ok {
		t.Fatal("active curve market must not subscribe to its future pool")
	}
}

func TestRegistryTransitionsCurveToCanonicalPool(t *testing.T) {
	registry := NewRegistry()
	entry := Market{
		Token:            common.HexToAddress("0x1000000000000000000000000000000000000002"),
		Curve:            common.HexToAddress("0x2000000000000000000000000000000000000002"),
		CanonicalPool:    common.HexToAddress("0x3000000000000000000000000000000000000002"),
		Stage:            StageCurve,
		SourceStartBlock: 10,
	}
	if _, err := registry.Replace([]Market{entry}); err != nil {
		t.Fatal(err)
	}
	entry.Stage = StageGraduated
	entry.SourceStartBlock = 20
	changed, err := registry.Replace([]Market{entry})
	if err != nil || !changed {
		t.Fatalf("transition changed=%t err=%v", changed, err)
	}
	if _, ok := registry.Resolve(entry.Curve); ok {
		t.Fatal("graduated token retained active curve source")
	}
	registration, ok := registry.Resolve(entry.CanonicalPool)
	if !ok || registration.Source != SourceUniswapV3 || registration.Market.Token != entry.Token {
		t.Fatalf("pool registration=%+v ok=%t", registration, ok)
	}
}

func TestRegistryRejectsGraduationWithoutCanonicalPool(t *testing.T) {
	registry := NewRegistry()
	_, err := registry.Replace([]Market{{
		Token:            common.HexToAddress("0x1000000000000000000000000000000000000003"),
		Curve:            common.HexToAddress("0x2000000000000000000000000000000000000003"),
		Stage:            StageGraduated,
		SourceStartBlock: 10,
	}})
	if err == nil {
		t.Fatal("graduated market without canonical pool was accepted")
	}
}
