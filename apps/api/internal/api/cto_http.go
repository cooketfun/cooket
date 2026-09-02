package api

import (
	"encoding/hex"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

func (h *Handler) ctoStatus(w http.ResponseWriter, r *http.Request) {
	token, err := addressParam(r, "address")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_address", err.Error())
		return
	}
	out, err := h.repo.CTOStatus(r.Context(), h.chainID, token)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "token not found")
		return
	}
	if err != nil {
		h.repositoryError(w, r, err)
		return
	}
	writeIndexedJSON(w, http.StatusOK, out)
}

func (h *Handler) ctoProposals(w http.ResponseWriter, r *http.Request) {
	token, err := addressParam(r, "address")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_address", err.Error())
		return
	}
	limit, cursor, err := pagination(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	out, err := h.repo.CTOProposals(r.Context(), h.chainID, token, limit, cursor)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "token not found")
		return
	}
	if err != nil {
		h.repositoryError(w, r, err)
		return
	}
	writeIndexedJSON(w, http.StatusOK, out)
}

func (h *Handler) ctoProposal(w http.ResponseWriter, r *http.Request) {
	proposalID, err := proposalIDParam(r, "proposalId")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_proposal_id", err.Error())
		return
	}
	out, err := h.repo.CTOProposal(r.Context(), h.chainID, proposalID)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "proposal not found")
		return
	}
	if err != nil {
		h.repositoryError(w, r, err)
		return
	}
	writeIndexedJSON(w, http.StatusOK, out)
}

func (h *Handler) ctoTreasury(w http.ResponseWriter, r *http.Request) {
	treasury, err := addressParam(r, "treasury")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_address", err.Error())
		return
	}
	out, err := h.repo.CTOTreasury(r.Context(), h.chainID, treasury, ctoHistoryPreviewLimit)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "treasury not found")
		return
	}
	if err != nil {
		h.repositoryError(w, r, err)
		return
	}
	writeIndexedJSON(w, http.StatusOK, out)
}

func (h *Handler) ctoTreasuryTransfers(w http.ResponseWriter, r *http.Request) {
	treasury, err := addressParam(r, "treasury")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_address", err.Error())
		return
	}
	limit, cursor, err := pagination(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	out, err := h.repo.CTOTreasuryTransfers(r.Context(), h.chainID, treasury, limit, cursor)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "treasury not found")
		return
	}
	if err != nil {
		h.repositoryError(w, r, err)
		return
	}
	writeIndexedJSON(w, http.StatusOK, out)
}

func (h *Handler) ctoTreasuryFeePulls(w http.ResponseWriter, r *http.Request) {
	treasury, err := addressParam(r, "treasury")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_address", err.Error())
		return
	}
	limit, cursor, err := pagination(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	out, err := h.repo.CTOTreasuryFeePulls(r.Context(), h.chainID, treasury, limit, cursor)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "treasury not found")
		return
	}
	if err != nil {
		h.repositoryError(w, r, err)
		return
	}
	writeIndexedJSON(w, http.StatusOK, out)
}

func (h *Handler) ctoCheckpoints(w http.ResponseWriter, r *http.Request) {
	token, err := addressParam(r, "address")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_address", err.Error())
		return
	}
	limit, cursor, err := pagination(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	out, err := h.repo.CTOCheckpoints(r.Context(), h.chainID, token, limit, cursor)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "token not found")
		return
	}
	if err != nil {
		h.repositoryError(w, r, err)
		return
	}
	writeIndexedJSON(w, http.StatusOK, out)
}

func proposalIDParam(r *http.Request, name string) (string, error) {
	s := strings.ToLower(strings.TrimSpace(chi.URLParam(r, name)))
	if strings.HasPrefix(s, "0x") {
		s = s[2:]
	}
	if len(s) != 64 {
		return "", errors.New("proposal id must be a 32-byte hexadecimal value")
	}
	if _, err := hex.DecodeString(s); err != nil {
		return "", errors.New("proposal id must be a 32-byte hexadecimal value")
	}
	return "0x" + s, nil
}
