package market

import (
	"bytes"
	"fmt"
	"math/big"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

type Decoder struct {
	registry      *Registry
	canonicalUSDC common.Address
}

func NewDecoder(registry *Registry, canonicalUSDC common.Address) (*Decoder, error) {
	if registry == nil || canonicalUSDC == (common.Address{}) {
		return nil, fmt.Errorf("registry and canonical USDC are required")
	}
	return &Decoder{registry: registry, canonicalUSDC: canonicalUSDC}, nil
}

func (d *Decoder) Decode(entry types.Log, receivedAt time.Time) (Event, error) {
	registration, ok := d.registry.Resolve(entry.Address)
	if !ok {
		return Event{}, fmt.Errorf("unregistered realtime market %s", entry.Address.Hex())
	}
	if len(entry.Topics) == 0 {
		return Event{}, fmt.Errorf("market log has no topic0")
	}
	if registration.Source == SourceCurve {
		return d.decodeCurve(registration.Market, entry, receivedAt)
	}
	return d.decodeSwap(registration.Market, entry, receivedAt)
}

func (d *Decoder) decodeCurve(market Market, entry types.Log, receivedAt time.Time) (Event, error) {
	name, side := "", Side("")
	switch entry.Topics[0] {
	case TokensBoughtTopic:
		name, side = "TokensBought", SideBuy
	case TokensSoldTopic:
		name, side = "TokensSold", SideSell
	default:
		return Event{}, fmt.Errorf("topic %s is not a curve trade event", entry.Topics[0].Hex())
	}
	values, err := decodeEvent(curveABI.Events[name], entry)
	if err != nil {
		return Event{}, err
	}
	token, ok := values["token"].(common.Address)
	if !ok || token != market.Token {
		return Event{}, fmt.Errorf("curve event token does not match registry")
	}

	raw := stringFields(values)
	var tokenAmount, usdcAmount *big.Int
	if side == SideBuy {
		tokenAmount, err = bigField(values, "tokensOut")
		if err == nil {
			usdcAmount, err = bigField(values, "acceptedGross")
		}
	} else {
		tokenAmount, err = bigField(values, "tokensIn")
		if err == nil {
			usdcAmount, err = bigField(values, "netSellerOutput")
		}
	}
	if err != nil {
		return Event{}, err
	}
	return baseEvent(market.Token, entry.Address, SourceCurve, side, entry, receivedAt, tokenAmount, usdcAmount, 18, raw), nil
}

func (d *Decoder) decodeSwap(market Market, entry types.Log, receivedAt time.Time) (Event, error) {
	if entry.Topics[0] != SwapTopic {
		return Event{}, fmt.Errorf("topic %s is not a Uniswap V3 Swap", entry.Topics[0].Hex())
	}
	values, err := decodeEvent(uniswapV3PoolABI.Events["Swap"], entry)
	if err != nil {
		return Event{}, err
	}
	amount0, err := bigField(values, "amount0")
	if err != nil {
		return Event{}, err
	}
	amount1, err := bigField(values, "amount1")
	if err != nil {
		return Event{}, err
	}
	if amount0.Sign() == 0 || amount1.Sign() == 0 || amount0.Sign() == amount1.Sign() {
		return Event{}, fmt.Errorf("invalid Uniswap V3 signed deltas")
	}
	tokenDelta, usdcDelta := amount1, amount0
	if bytes.Compare(market.Token.Bytes(), d.canonicalUSDC.Bytes()) < 0 {
		tokenDelta, usdcDelta = amount0, amount1
	}
	side := SideSell
	if tokenDelta.Sign() < 0 {
		side = SideBuy
	}
	tokenAmount, usdcAmount := absolute(tokenDelta), absolute(usdcDelta)
	event := baseEvent(market.Token, entry.Address, SourceUniswapV3, side, entry, receivedAt, tokenAmount, usdcAmount, 6, stringFields(values))
	if sqrtPrice, sqrtErr := bigField(values, "sqrtPriceX96"); sqrtErr == nil {
		event.SqrtPriceX96 = sqrtPrice.String()
	}
	if tick, tickErr := bigField(values, "tick"); tickErr == nil {
		event.Tick = tick.String()
	}
	return event, nil
}

func baseEvent(token, marketAddress common.Address, source Source, side Side, entry types.Log, receivedAt time.Time, tokenAmount, usdcAmount *big.Int, usdcDecimals uint8, raw map[string]string) Event {
	id := EventID{ChainID: ChainID, TransactionHash: entry.TxHash, LogIndex: entry.Index}
	return Event{
		Identity: id.String(), ChainID: ChainID, Token: token.Hex(), Market: marketAddress.Hex(), Source: source, Side: side,
		BlockNumber: entry.BlockNumber, TransactionHash: entry.TxHash.Hex(), LogIndex: entry.Index, Removed: entry.Removed,
		ReceivedAt: receivedAt.UTC(), TokenAmountRaw: tokenAmount.String(), USDCAmountRaw: usdcAmount.String(), USDCDecimals: usdcDecimals, RawFields: raw,
	}
}

func decodeEvent(event abi.Event, entry types.Log) (map[string]any, error) {
	values := map[string]any{}
	if err := event.Inputs.UnpackIntoMap(values, entry.Data); err != nil {
		return nil, fmt.Errorf("decode %s data: %w", event.Name, err)
	}
	if len(entry.Topics) != 1+len(indexedArguments(event.Inputs)) {
		return nil, fmt.Errorf("decode %s topics: got %d", event.Name, len(entry.Topics))
	}
	if err := abi.ParseTopicsIntoMap(values, indexedArguments(event.Inputs), entry.Topics[1:]); err != nil {
		return nil, fmt.Errorf("decode %s topics: %w", event.Name, err)
	}
	return values, nil
}

func bigField(values map[string]any, name string) (*big.Int, error) {
	value, ok := values[name].(*big.Int)
	if !ok {
		return nil, fmt.Errorf("field %s has type %T", name, values[name])
	}
	return value, nil
}

func stringFields(values map[string]any) map[string]string {
	out := make(map[string]string, len(values))
	for name, value := range values {
		switch typed := value.(type) {
		case *big.Int:
			out[name] = typed.String()
		case common.Address:
			out[name] = typed.Hex()
		default:
			out[name] = fmt.Sprint(value)
		}
	}
	return out
}
