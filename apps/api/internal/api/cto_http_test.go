package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCTOStatusInactiveKnownTokenAndUnknownToken(t *testing.T) {
	address := "0x0000000000000000000000000000000000000001"
	r := testHandler(&fakeRepo{})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens/"+address+"/cto", nil))
	if w.Code != 200 || w.Header().Get("Cache-Control") != "public, max-age=5, must-revalidate" || !strings.Contains(w.Body.String(), `"active":false`) || !strings.Contains(w.Body.String(), `"chain_id":5042002`) {
		t.Fatalf("status=%d headers=%v body=%s", w.Code, w.Header(), w.Body.String())
	}

	r = testHandler(&fakeRepo{tokenErr: ErrNotFound})
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens/"+address+"/cto", nil))
	if w.Code != 404 {
		t.Fatalf("unknown token status=%d", w.Code)
	}
}

func TestCTORoutesRejectMalformedIDsAndMutations(t *testing.T) {
	r := testHandler(&fakeRepo{})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens/0x123/cto", nil))
	if w.Code != 400 || !strings.Contains(w.Body.String(), `"code":"invalid_address"`) {
		t.Fatalf("short address status=%d body=%s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens/0x0000000000000000000000000000000000000001/cto?chain_id=1", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"chain_id":5042002`) || strings.Contains(w.Body.String(), `"chain_id":1`) {
		t.Fatalf("user chain id was accepted: %s", w.Body.String())
	}
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/cto/proposals/0x123", nil))
	if w.Code != 400 || !strings.Contains(w.Body.String(), `"code":"invalid_proposal_id"`) {
		t.Fatalf("short proposal status=%d body=%s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/cto/proposals/0x%27%3Bdrop%20table%20cto_proposals%3B--", nil))
	if w.Code != 400 {
		t.Fatalf("injection proposal status=%d", w.Code)
	}
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/cto/treasuries/0xgggggggggggggggggggggggggggggggggggggggg", nil))
	if w.Code != 400 {
		t.Fatalf("non-hex treasury status=%d", w.Code)
	}
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		w = httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(method, "/api/v1/tokens/0x0000000000000000000000000000000000000001/cto", nil))
		if w.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s cto status=%d", method, w.Code)
		}
	}
}

func TestCTOMalformedAndReplayedCursorRejected(t *testing.T) {
	address := "0x0000000000000000000000000000000000000001"
	r := testHandler(&fakeRepo{})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens/"+address+"/cto/proposals?cursor=not-a-cursor", nil))
	if w.Code != 400 || !strings.Contains(w.Body.String(), `"code":"invalid_request"`) {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	tokensCursor := encodeCursor(pageCursor{Kind: "tokens", BlockNumber: 1, TokenAddress: address})
	if _, err := decodeCursor(tokensCursor, "cto_proposals"); err != ErrInvalidCursor {
		t.Fatalf("wrong-kind cursor accepted: %v", err)
	}
}

func TestCTOActiveStatusAndProposalJSON(t *testing.T) {
	token := "0x00000000000000000000000000000000000000aa"
	proposalID := "0x" + strings.Repeat("ab", 32)
	status := CTOStatus{ChainID: 5042002, Token: token, Active: true, Registry: "0x00000000000000000000000000000000000000bb", Treasury: "0x00000000000000000000000000000000000000cc", Controller: "0x00000000000000000000000000000000000000dd", PreviousRecipient: "0x00000000000000000000000000000000000000ee", ActiveProposalID: proposalID, Activation: &IndexedProvenance{BlockNumber: 9, BlockHash: "0x" + strings.Repeat("11", 32), TransactionHash: "0x" + strings.Repeat("22", 32), LogIndex: 3}}
	proposal := CTOProposal{ProposalID: proposalID, Token: token, Registry: status.Registry, Treasury: status.Treasury, Creator: "0x00000000000000000000000000000000000000ff", Controller: status.Controller, PreviousRecipient: status.PreviousRecipient, Nonce: "18446744073709551615", MetadataHash: "0x" + strings.Repeat("33", 32), MetadataURI: "ipfs://untrusted", State: "active", CreatedTimestamp: 1, Created: IndexedProvenance{BlockNumber: 1, BlockHash: "0x" + strings.Repeat("44", 32), TransactionHash: "0x" + strings.Repeat("55", 32), LogIndex: 0}, AcceptanceDeadline: 2}
	r := testHandler(&fakeRepo{ctoStatus: &status, ctoProposal: proposal, ctoProposals: CTOProposalPage{Items: []CTOProposal{proposal}}})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens/"+strings.ToUpper(token)+"/cto", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"active":true`) || !strings.Contains(w.Body.String(), `"block_hash"`) {
		t.Fatalf("active status=%s", w.Body.String())
	}
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/cto/proposals/"+proposalID, nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"nonce":"18446744073709551615"`) || !strings.Contains(w.Body.String(), `"metadata_uri":"ipfs://untrusted"`) {
		t.Fatalf("proposal=%s", w.Body.String())
	}
	var decoded CTOProposal
	if err := json.Unmarshal(w.Body.Bytes(), &decoded); err != nil || decoded.MetadataURI != "ipfs://untrusted" {
		t.Fatalf("proposal decode=%v body=%s", err, w.Body.String())
	}
}

func TestCTOCheckpointInconsistentAccountingIsInternal(t *testing.T) {
	address := "0x0000000000000000000000000000000000000001"
	r := testHandler(&fakeRepo{ctoErr: ErrInconsistentAccounting})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens/"+address+"/cto/checkpoints", nil))
	if w.Code != 500 || !strings.Contains(w.Body.String(), `"code":"inconsistent_accounting"`) {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestCTOEmptyHistoryIs200(t *testing.T) {
	address := "0x0000000000000000000000000000000000000001"
	r := testHandler(&fakeRepo{})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens/"+address+"/cto/proposals", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"items":[]`) {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestCTOUnknownProposalAndTreasuryAre404(t *testing.T) {
	r := testHandler(&fakeRepo{ctoErr: ErrNotFound})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/cto/proposals/0x"+strings.Repeat("ab", 32), nil))
	if w.Code != 404 {
		t.Fatalf("proposal status=%d", w.Code)
	}
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/cto/treasuries/0x00000000000000000000000000000000000000aa", nil))
	if w.Code != 404 {
		t.Fatalf("treasury status=%d", w.Code)
	}
}
