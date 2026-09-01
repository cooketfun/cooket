package api

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"
	"time"
)

const (
	BaseSepoliaETHUSDFeed = "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1"
	chainlinkDecimalsCall = "0x313ce567"
	chainlinkLatestCall   = "0xfeaf968c"
	priceDecimals         = 8
)

type ETHUSDPrice struct {
	Price         string    `json:"price"`
	PriceDecimals int       `json:"price_decimals"`
	UpdatedAt     time.Time `json:"updated_at"`
	Feed          string    `json:"feed"`
	Source        string    `json:"source"`
	MaxAgeSeconds int64     `json:"max_age_seconds"`
}

type ETHUSDReader interface {
	Read(context.Context) (ETHUSDPrice, error)
}

type ChainlinkETHUSDReader struct {
	rpcURL string
	feed   string
	maxAge time.Duration
	client *http.Client
	now    func() time.Time
}

func NewChainlinkETHUSDReader(rpcURL, feed string, maxAge time.Duration, client *http.Client) (*ChainlinkETHUSDReader, error) {
	if strings.TrimSpace(rpcURL) == "" {
		return nil, errors.New("RPC URL is required")
	}
	if !isAddress(feed) {
		return nil, errors.New("valid Chainlink feed address is required")
	}
	if maxAge <= 0 {
		return nil, errors.New("Chainlink max age must be positive")
	}
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	return &ChainlinkETHUSDReader{rpcURL: rpcURL, feed: feed, maxAge: maxAge, client: client, now: time.Now}, nil
}

func (r *ChainlinkETHUSDReader) Read(ctx context.Context) (ETHUSDPrice, error) {
	decimalsRaw, err := r.ethCall(ctx, chainlinkDecimalsCall)
	if err != nil {
		return ETHUSDPrice{}, fmt.Errorf("read Chainlink decimals: %w", err)
	}
	decimalsValue, err := decodeWord(decimalsRaw, 0)
	if err != nil || !decimalsValue.IsInt64() || decimalsValue.Int64() < 0 || decimalsValue.Int64() > 36 {
		return ETHUSDPrice{}, errors.New("Chainlink decimals response is invalid")
	}
	decimals := int(decimalsValue.Int64())

	latestRaw, err := r.ethCall(ctx, chainlinkLatestCall)
	if err != nil {
		return ETHUSDPrice{}, fmt.Errorf("read Chainlink latest round: %w", err)
	}
	roundID, err := decodeWord(latestRaw, 0)
	if err != nil {
		return ETHUSDPrice{}, err
	}
	answer, err := decodeSignedWord(latestRaw, 1)
	if err != nil || answer.Sign() <= 0 {
		return ETHUSDPrice{}, errors.New("Chainlink answer is not positive")
	}
	updatedAtValue, err := decodeWord(latestRaw, 3)
	if err != nil || !updatedAtValue.IsInt64() || updatedAtValue.Sign() <= 0 {
		return ETHUSDPrice{}, errors.New("Chainlink updatedAt is invalid")
	}
	answeredInRound, err := decodeWord(latestRaw, 4)
	if err != nil || answeredInRound.Cmp(roundID) < 0 {
		return ETHUSDPrice{}, errors.New("Chainlink round is incomplete")
	}
	updatedAt := time.Unix(updatedAtValue.Int64(), 0).UTC()
	now := r.now().UTC()
	if updatedAt.After(now.Add(time.Minute)) {
		return ETHUSDPrice{}, errors.New("Chainlink updatedAt is in the future")
	}
	if now.Sub(updatedAt) > r.maxAge {
		return ETHUSDPrice{}, errors.New("Chainlink price is stale")
	}

	normalized := new(big.Int).Set(answer)
	if decimals < priceDecimals {
		normalized.Mul(normalized, pow10(priceDecimals-decimals))
	} else if decimals > priceDecimals {
		normalized.Div(normalized, pow10(decimals-priceDecimals))
	}
	return ETHUSDPrice{
		Price:         formatScaledDecimal(normalized, priceDecimals),
		PriceDecimals: priceDecimals,
		UpdatedAt:     updatedAt,
		Feed:          r.feed,
		Source:        "chainlink_eth_usd",
		MaxAgeSeconds: int64(r.maxAge / time.Second),
	}, nil
}

func (r *ChainlinkETHUSDReader) ethCall(ctx context.Context, data string) ([]byte, error) {
	body, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": "eth_call", "params": []any{map[string]string{"to": r.feed, "data": data}, "latest"}})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.rpcURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	response, err := r.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("RPC status %d", response.StatusCode)
	}
	var payload struct {
		Result string `json:"result"`
		Error  *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&payload); err != nil {
		return nil, errors.New("invalid RPC response")
	}
	if payload.Error != nil {
		return nil, fmt.Errorf("RPC error %d", payload.Error.Code)
	}
	raw := strings.TrimPrefix(payload.Result, "0x")
	if raw == "" || len(raw)%2 != 0 {
		return nil, errors.New("empty RPC result")
	}
	decoded, err := hex.DecodeString(raw)
	if err != nil {
		return nil, errors.New("invalid RPC result")
	}
	return decoded, nil
}

func decodeWord(raw []byte, index int) (*big.Int, error) {
	start := index * 32
	if start < 0 || len(raw) < start+32 {
		return nil, errors.New("Chainlink ABI response is truncated")
	}
	return new(big.Int).SetBytes(raw[start : start+32]), nil
}

func decodeSignedWord(raw []byte, index int) (*big.Int, error) {
	value, err := decodeWord(raw, index)
	if err != nil {
		return nil, err
	}
	if value.Bit(255) == 1 {
		value.Sub(value, new(big.Int).Lsh(big.NewInt(1), 256))
	}
	return value, nil
}

func pow10(exponent int) *big.Int {
	return new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(exponent)), nil)
}

func formatScaledDecimal(value *big.Int, decimals int) string {
	digits := value.String()
	if decimals == 0 {
		return digits
	}
	if len(digits) <= decimals {
		digits = strings.Repeat("0", decimals-len(digits)+1) + digits
	}
	return digits[:len(digits)-decimals] + "." + digits[len(digits)-decimals:]
}

func isAddress(value string) bool {
	if len(value) != 42 || !strings.HasPrefix(value, "0x") {
		return false
	}
	_, err := hex.DecodeString(value[2:])
	return err == nil
}
