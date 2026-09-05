package market

import (
	"testing"

	"github.com/ethereum/go-ethereum/common"
)

func TestDeduperUsesDeterministicIdentityAndRemainsBounded(t *testing.T) {
	deduper := NewDeduper(2)
	first := EventID{ChainID: ChainID, TransactionHash: common.HexToHash("0x1"), LogIndex: 7}
	second := EventID{ChainID: ChainID, TransactionHash: common.HexToHash("0x2"), LogIndex: 7}
	third := EventID{ChainID: ChainID, TransactionHash: common.HexToHash("0x3"), LogIndex: 7}
	if !deduper.Accept(first, false) || deduper.Accept(first, false) {
		t.Fatal("duplicate canonical delivery was not suppressed")
	}
	if !deduper.Accept(first, true) || deduper.Accept(first, true) {
		t.Fatal("removed delivery must be published exactly once")
	}
	if !deduper.Accept(second, false) || !deduper.Accept(third, false) {
		t.Fatal("new identities were rejected")
	}
	if !deduper.Accept(first, false) {
		t.Fatal("oldest identity was not evicted from bounded dedup")
	}
}
