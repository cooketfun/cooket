package main

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

func TestFormatReceivedLogPreservesSubscriptionPayload(t *testing.T) {
	receivedAt := time.Date(2026, 9, 4, 7, 8, 9, 123, time.FixedZone("test", 7*60*60))
	entry := types.Log{
		BlockNumber: 42,
		TxHash:      common.HexToHash("0x1234"),
		Index:       7,
		Removed:     true,
		Data:        []byte{0xde, 0xad, 0xbe, 0xef},
		Topics:      []common.Hash{common.HexToHash(swapTopic), common.HexToHash("0xabcd")},
	}

	encoded, err := formatReceivedLog(receivedAt, entry)
	if err != nil {
		t.Fatal(err)
	}
	var got receivedLog
	if err := json.Unmarshal(encoded, &got); err != nil {
		t.Fatal(err)
	}
	if got.ReceivedAt != "2026-09-04T00:08:09.000000123Z" || got.BlockNumber != 42 || got.Transaction != entry.TxHash.Hex() || got.LogIndex != 7 || !got.Removed || got.Data != "0xdeadbeef" {
		t.Fatalf("unexpected formatted log: %+v", got)
	}
	if len(got.Topics) != 2 || got.Topics[0] != common.HexToHash(swapTopic).Hex() || got.Topics[1] != common.HexToHash("0xabcd").Hex() {
		t.Fatalf("unexpected topics: %v", got.Topics)
	}
}
