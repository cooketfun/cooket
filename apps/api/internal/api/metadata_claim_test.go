package api

import (
	"encoding/hex"
	"fmt"
	"strings"
	"testing"

	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
	"golang.org/x/crypto/sha3"
)

func signedMetadataFinalizeBody(t *testing.T, chain int64, draftID, token, txHash string) (string, string) {
	t.Helper()
	keyBytes, err := hex.DecodeString("4c0883a69102937d6231471b5dbb6204fe512961708279b7d45e4b0c73881457")
	if err != nil {
		t.Fatal(err)
	}
	key := secp256k1.PrivKeyFromBytes(keyBytes)
	compact := ecdsa.SignCompact(key, ethereumPersonalMessageHash(metadataClaimMessage(chain, draftID, token, txHash)), false)
	sig := append(append([]byte{}, compact[1:]...), compact[0]-27)
	signature := "0x" + hex.EncodeToString(sig)
	serialized := key.PubKey().SerializeUncompressed()
	hash := ethereumKeccak(serialized[1:])
	return fmt.Sprintf(`{"token_address":%q,"transaction_hash":%q,"signature":%q}`, token, txHash, signature), "0x" + hex.EncodeToString(hash[len(hash)-20:])
}

func ethereumKeccak(value []byte) []byte {
	hasher := sha3.NewLegacyKeccak256()
	_, _ = hasher.Write(value)
	return hasher.Sum(nil)
}

func TestMetadataClaimSignatureBindsEveryLaunchIdentityField(t *testing.T) {
	const chain int64 = 5042002
	const draft = "draft-a"
	const token = "0x0000000000000000000000000000000000000001"
	const txHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	body, creator := signedMetadataFinalizeBody(t, chain, draft, token, txHash)
	signature := strings.Split(strings.Split(body, `"signature":"`)[1], `"`)[0]
	got, err := recoverMetadataClaimSigner(chain, draft, token, txHash, signature)
	if err != nil || !strings.EqualFold(got, creator) {
		t.Fatalf("signer=%s err=%v", got, err)
	}
	for _, changed := range []struct {
		chain            int64
		draft, token, tx string
	}{
		{chain + 1, draft, token, txHash},
		{chain, "draft-b", token, txHash},
		{chain, draft, "0x0000000000000000000000000000000000000002", txHash},
		{chain, draft, token, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
	} {
		signer, changedErr := recoverMetadataClaimSigner(changed.chain, changed.draft, changed.token, changed.tx, signature)
		if changedErr == nil && strings.EqualFold(signer, creator) {
			t.Fatalf("signature remained valid for changed identity: %+v", changed)
		}
	}
}
