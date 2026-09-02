package indexer

import (
	_ "embed"
	"encoding/json"
	"strings"

	"github.com/ethereum/go-ethereum/accounts/abi"
)

// selectedABIJSON is generated from the same reviewed allowlist as the SDK.
//
//go:embed abi/selected.generated.json
var selectedABIJSON []byte

var selectedABIs = mustSelectedABIs()
var factoryABI = selectedABIs["CooketFactoryV3"]
var curveABI = selectedABIs["CooketCurveV3"]
var tokenABI = selectedABIs["CooketTokenV3"]
var graduationManagerABI = selectedABIs["GraduationManagerV3"]
var feeManagerABI = selectedABIs["FeeManagerV3"]
var ctoRegistryABI = selectedABIs["CTORegistryV3"]
var ctoTreasuryABI = selectedABIs["CTOTreasuryV3"]
var contractABI = combinedEventABI(factoryABI, curveABI, tokenABI)
var v3TradeABI = curveABI
var v3GraduationABI = graduationManagerABI

func mustSelectedABIs() map[string]abi.ABI {
	var envelope struct {
		Contracts map[string]json.RawMessage `json:"contracts"`
	}
	if err := json.Unmarshal(selectedABIJSON, &envelope); err != nil {
		panic(err)
	}
	out := make(map[string]abi.ABI, len(envelope.Contracts))
	for name, raw := range envelope.Contracts {
		parsed, err := abi.JSON(strings.NewReader(string(raw)))
		if err != nil {
			panic(name + ": " + err.Error())
		}
		out[name] = parsed
	}
	return out
}

func combinedEventABI(parts ...abi.ABI) abi.ABI {
	combined := abi.ABI{Events: map[string]abi.Event{}, Methods: map[string]abi.Method{}, Errors: map[string]abi.Error{}}
	for _, part := range parts {
		for name, event := range part.Events {
			combined.Events[name] = event
		}
	}
	return combined
}
