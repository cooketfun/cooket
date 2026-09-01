package api

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestChainlinkETHUSDReaderNormalizesFreshAnswer(t *testing.T) {
	now := time.Unix(2_000_000_000, 0).UTC()
	server := chainlinkRPCServer(t, 8, big.NewInt(250012345678), now.Add(-5*time.Minute).Unix(), big.NewInt(17), big.NewInt(17))
	defer server.Close()
	reader, err := NewChainlinkETHUSDReader(server.URL, BaseSepoliaETHUSDFeed, time.Hour, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	reader.now = func() time.Time { return now }
	price, err := reader.Read(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if price.Price != "2500.12345678" || price.PriceDecimals != 8 || !price.UpdatedAt.Equal(now.Add(-5*time.Minute)) || price.Source != "chainlink_eth_usd" || price.MaxAgeSeconds != 3600 {
		t.Fatalf("price=%+v", price)
	}
}

func TestChainlinkETHUSDReaderScalesDecimalsAndRejectsInvalidRounds(t *testing.T) {
	now := time.Unix(2_000_000_000, 0).UTC()
	for _, tc := range []struct {
		name      string
		decimals  int64
		answer    *big.Int
		updatedAt int64
		round     *big.Int
		answered  *big.Int
		want      string
		wantError bool
	}{
		{name: "scales six decimals", decimals: 6, answer: big.NewInt(2500123456), updatedAt: now.Unix(), round: big.NewInt(2), answered: big.NewInt(2), want: "2500.12345600"},
		{name: "stale", decimals: 8, answer: big.NewInt(250000000000), updatedAt: now.Add(-time.Hour - time.Second).Unix(), round: big.NewInt(2), answered: big.NewInt(2), wantError: true},
		{name: "non positive", decimals: 8, answer: big.NewInt(0), updatedAt: now.Unix(), round: big.NewInt(2), answered: big.NewInt(2), wantError: true},
		{name: "incomplete", decimals: 8, answer: big.NewInt(250000000000), updatedAt: now.Unix(), round: big.NewInt(3), answered: big.NewInt(2), wantError: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := chainlinkRPCServer(t, tc.decimals, tc.answer, tc.updatedAt, tc.round, tc.answered)
			defer server.Close()
			reader, err := NewChainlinkETHUSDReader(server.URL, BaseSepoliaETHUSDFeed, time.Hour, server.Client())
			if err != nil {
				t.Fatal(err)
			}
			reader.now = func() time.Time { return now }
			price, err := reader.Read(context.Background())
			if (err != nil) != tc.wantError {
				t.Fatalf("price=%+v err=%v", price, err)
			}
			if !tc.wantError && price.Price != tc.want {
				t.Fatalf("price=%s want=%s", price.Price, tc.want)
			}
		})
	}
}

func chainlinkRPCServer(t *testing.T, decimals int64, answer *big.Int, updatedAt int64, roundID, answeredInRound *big.Int) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Params []json.RawMessage `json:"params"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil || len(request.Params) == 0 {
			t.Fatalf("request err=%v", err)
		}
		var call map[string]string
		if err := json.Unmarshal(request.Params[0], &call); err != nil {
			t.Fatal(err)
		}
		var result string
		switch call["data"] {
		case chainlinkDecimalsCall:
			result = "0x" + hex.EncodeToString(abiWord(big.NewInt(decimals)))
		case chainlinkLatestCall:
			raw := append([]byte{}, abiWord(roundID)...)
			raw = append(raw, abiSignedWord(answer)...)
			raw = append(raw, abiWord(big.NewInt(updatedAt))...)
			raw = append(raw, abiWord(big.NewInt(updatedAt))...)
			raw = append(raw, abiWord(answeredInRound)...)
			result = "0x" + hex.EncodeToString(raw)
		default:
			t.Fatalf("unexpected call %q", call["data"])
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "result": result})
	}))
}

func abiWord(value *big.Int) []byte {
	out := make([]byte, 32)
	value.FillBytes(out)
	return out
}

func abiSignedWord(value *big.Int) []byte {
	if value.Sign() >= 0 {
		return abiWord(value)
	}
	encoded := new(big.Int).Add(value, new(big.Int).Lsh(big.NewInt(1), 256))
	return abiWord(encoded)
}
