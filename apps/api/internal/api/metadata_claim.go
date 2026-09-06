package api

import (
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
	"golang.org/x/crypto/sha3"
)

func metadataClaimMessage(chain int64, draftID, token, txHash string) string {
	return fmt.Sprintf("Cooket metadata finalization\n\nChain ID: %d\nDraft ID: %s\nToken address: %s\nCreation transaction: %s", chain, draftID, strings.ToLower(token), strings.ToLower(txHash))
}

func recoverMetadataClaimSigner(chain int64, draftID, token, txHash, signature string) (string, error) {
	raw := strings.TrimPrefix(strings.TrimSpace(signature), "0x")
	if len(raw) != 130 {
		return "", errors.New("metadata claim signature must be 65 bytes")
	}
	sig, err := hex.DecodeString(raw)
	if err != nil {
		return "", errors.New("metadata claim signature is not hexadecimal")
	}
	recoveryID := sig[64]
	if recoveryID >= 27 {
		recoveryID -= 27
	}
	if recoveryID > 1 {
		return "", errors.New("metadata claim signature recovery id is invalid")
	}
	compact := make([]byte, 65)
	compact[0] = 27 + recoveryID
	copy(compact[1:], sig[:64])
	publicKey, _, err := ecdsa.RecoverCompact(compact, ethereumPersonalMessageHash(metadataClaimMessage(chain, draftID, token, txHash)))
	if err != nil {
		return "", errors.New("metadata claim signature is invalid")
	}
	serialized := publicKey.SerializeUncompressed()
	hasher := sha3.NewLegacyKeccak256()
	_, _ = hasher.Write(serialized[1:])
	digest := hasher.Sum(nil)
	return "0x" + hex.EncodeToString(digest[len(digest)-20:]), nil
}

func ethereumPersonalMessageHash(message string) []byte {
	hasher := sha3.NewLegacyKeccak256()
	_, _ = fmt.Fprintf(hasher, "\x19Ethereum Signed Message:\n%d", len([]byte(message)))
	_, _ = hasher.Write([]byte(message))
	return hasher.Sum(nil)
}
