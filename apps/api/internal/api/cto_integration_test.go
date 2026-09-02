package api

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

type namedDatabase struct {
	name string
	url  string
}

func preparedAPIDatabases(t *testing.T) []namedDatabase {
	t.Helper()
	var out []namedDatabase
	for _, env := range []struct{ name, key string }{{"clean", "API_TEST_DATABASE_URL"}, {"upgrade", "API_UPGRADE_TEST_DATABASE_URL"}} {
		if os.Getenv(env.key) == "" {
			continue
		}
		out = append(out, namedDatabase{name: env.name, url: integrationDatabaseURL(t, env.key)})
	}
	if len(out) == 0 {
		t.Skip("set API_TEST_DATABASE_URL to run PostgreSQL API integration tests")
	}
	return out
}

func withPreparedRepos(t *testing.T, fn func(*testing.T, *PostgresRepository)) {
	t.Helper()
	for _, db := range preparedAPIDatabases(t) {
		t.Run(db.name, func(t *testing.T) {
			repo, err := NewPostgresRepository(context.Background(), db.url)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(repo.Close)
			fn(t, repo)
		})
	}
}

const ctoTestChain int64 = 5042002

func insertBlock(t *testing.T, repo *PostgresRepository, hash string, number, timestamp int64) {
	t.Helper()
	if _, err := repo.pool.Exec(context.Background(), `INSERT INTO chain_blocks(chain_id,block_number,block_hash,parent_hash,block_timestamp) VALUES($1,$2,$3,'0xparent',$4) ON CONFLICT (chain_id,block_hash) DO NOTHING`, ctoTestChain, number, hash, timestamp); err != nil {
		t.Fatal(err)
	}
}

func insertToken(t *testing.T, repo *PostgresRepository, token, creator, blockHash, tx string, block int64) {
	t.Helper()
	insertBlock(t, repo, blockHash, block, block)
	if _, err := repo.pool.Exec(context.Background(), `INSERT INTO tokens(chain_id,token_address,creator_address,name,symbol,initial_supply,protocol_version,block_number,block_hash,transaction_hash,log_index) VALUES($1,lower($2),lower($3),'CTO','CTO',1000,'endpoint-cp-v3',$4,$5,$6,0)`, ctoTestChain, token, creator, block, blockHash, tx); err != nil {
		t.Fatal(err)
	}
}

func TestCTOInactiveKnownTokenAndUnknownToken(t *testing.T) {
	withPreparedRepos(t, func(t *testing.T, repo *PostgresRepository) {
		ctx := context.Background()
		token := "0x000000000000000000000000000000000000c001"
		creator := "0x000000000000000000000000000000000000c002"
		blockHash := "0x" + strings.Repeat("c1", 32)
		tx := "0x" + strings.Repeat("c2", 32)
		cleanup := func() {
			_, _ = repo.pool.Exec(ctx, `DELETE FROM tokens WHERE chain_id=$1 AND token_address=$2`, ctoTestChain, token)
			_, _ = repo.pool.Exec(ctx, `DELETE FROM chain_blocks WHERE chain_id=$1 AND block_hash=$2`, ctoTestChain, blockHash)
		}
		cleanup()
		t.Cleanup(cleanup)
		insertToken(t, repo, token, creator, blockHash, tx, 70001)
		status, err := repo.CTOStatus(ctx, ctoTestChain, token)
		if err != nil || status.Active || status.Token != token || status.ChainID != ctoTestChain || status.Treasury != "" {
			t.Fatalf("inactive=%+v err=%v", status, err)
		}
		page, err := repo.CTOProposals(ctx, ctoTestChain, token, 20, "")
		if err != nil || page.Items == nil || len(page.Items) != 0 {
			t.Fatalf("empty history=%+v err=%v", page, err)
		}
		if _, err = repo.CTOStatus(ctx, ctoTestChain, "0x000000000000000000000000000000000000c099"); err != ErrNotFound {
			t.Fatalf("unknown token err=%v", err)
		}
	})
}

func TestCTOActiveCanonicalOrphanAndReplacement(t *testing.T) {
	withPreparedRepos(t, func(t *testing.T, repo *PostgresRepository) {
		ctx := context.Background()
		token := "0x000000000000000000000000000000000000c011"
		creator := "0x000000000000000000000000000000000000c012"
		registry := "0x000000000000000000000000000000000000c013"
		fees := "0x000000000000000000000000000000000000c014"
		controller := "0x000000000000000000000000000000000000c015"
		treasury := "0x000000000000000000000000000000000000c016"
		replacement := "0x000000000000000000000000000000000000c017"
		proposal := "0x" + strings.Repeat("11", 32)
		replacementProposal := "0x" + strings.Repeat("12", 32)
		blockHash := "0x" + strings.Repeat("d1", 32)
		replacementHash := "0x" + strings.Repeat("d2", 32)
		launchTx := "0x" + strings.Repeat("d3", 32)
		deployTx := "0x" + strings.Repeat("d4", 32)
		replaceTx := "0x" + strings.Repeat("d5", 32)
		cleanup := func() {
			_, _ = repo.pool.Exec(ctx, `DELETE FROM cto_token_state WHERE chain_id=$1 AND token_address=$2`, ctoTestChain, token)
			_, _ = repo.pool.Exec(ctx, `DELETE FROM cto_proposals WHERE chain_id=$1 AND token_address=$2`, ctoTestChain, token)
			_, _ = repo.pool.Exec(ctx, `DELETE FROM cto_treasuries WHERE chain_id=$1 AND token_address=$2`, ctoTestChain, token)
			_, _ = repo.pool.Exec(ctx, `DELETE FROM tokens WHERE chain_id=$1 AND token_address=$2`, ctoTestChain, token)
			_, _ = repo.pool.Exec(ctx, `DELETE FROM chain_blocks WHERE chain_id=$1 AND block_hash IN ($2,$3)`, ctoTestChain, blockHash, replacementHash)
		}
		cleanup()
		t.Cleanup(cleanup)
		insertToken(t, repo, token, creator, blockHash, launchTx, 71001)
		insertBlock(t, repo, replacementHash, 71002, 71002)
		if _, err := repo.pool.Exec(ctx, `INSERT INTO cto_treasuries(chain_id,registry_address,treasury_address,token_address,controller_address,canonical_usdc_address,token_nonce,create2_salt,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,$4,$5,$6,1,$7,71001,$8,$9,1)`, ctoTestChain, registry, treasury, token, controller, "0x3600000000000000000000000000000000000000", "0x"+strings.Repeat("a1", 32), blockHash, deployTx); err != nil {
			t.Fatal(err)
		}
		if _, err := repo.pool.Exec(ctx, `INSERT INTO cto_proposals(chain_id,registry_address,proposal_id,token_address,treasury_address,creator_address,controller_address,previous_recipient_address,metadata_hash,metadata_uri,token_nonce,state,created_timestamp,acceptance_deadline,created_block_number,created_block_hash,created_transaction_hash,created_log_index,lifecycle_block_number,lifecycle_block_hash,lifecycle_transaction_hash,lifecycle_log_index,activated_timestamp,activated_block_number,activated_block_hash,activated_transaction_hash,activated_log_index) VALUES($1,$2,$3,$4,$5,$6,$7,$6,$8,'ipfs://untrusted',1,'active',100,200,71001,$9,$10,2,71001,$9,$10,2,100,71001,$9,$10,2)`, ctoTestChain, registry, proposal, token, treasury, creator, controller, "0x"+strings.Repeat("b1", 32), blockHash, deployTx); err != nil {
			t.Fatal(err)
		}
		if _, err := repo.pool.Exec(ctx, `INSERT INTO cto_token_state(chain_id,fee_manager_address,token_address,registry_address,active,treasury_address,proposal_id,previous_recipient_address,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,$4,true,$5,$6,$7,71001,$8,$9,2)`, ctoTestChain, fees, token, registry, treasury, proposal, creator, blockHash, deployTx); err != nil {
			t.Fatal(err)
		}
		status, err := repo.CTOStatus(ctx, ctoTestChain, token)
		if err != nil || !status.Active || status.Treasury != treasury || status.Controller != controller || status.ActiveProposalID != proposal || status.Activation == nil || status.Activation.BlockHash != blockHash {
			t.Fatalf("active=%+v err=%v", status, err)
		}
		if _, err = repo.pool.Exec(ctx, `UPDATE cto_token_state SET is_canonical=false,orphaned_at=now() WHERE chain_id=$1 AND token_address=$2`, ctoTestChain, token); err != nil {
			t.Fatal(err)
		}
		status, err = repo.CTOStatus(ctx, ctoTestChain, token)
		if err != nil || status.Active {
			t.Fatalf("orphaned activation remained active=%+v err=%v", status, err)
		}
		if _, err = repo.pool.Exec(ctx, `DELETE FROM cto_token_state WHERE chain_id=$1 AND token_address=$2 AND NOT is_canonical`, ctoTestChain, token); err != nil {
			t.Fatal(err)
		}
		if _, err = repo.pool.Exec(ctx, `INSERT INTO cto_treasuries(chain_id,registry_address,treasury_address,token_address,controller_address,canonical_usdc_address,token_nonce,create2_salt,block_number,block_hash,transaction_hash,log_index,is_canonical) VALUES($1,$2,$3,$4,$5,$6,2,$7,71002,$8,$9,1,true)`, ctoTestChain, registry, replacement, token, controller, "0x3600000000000000000000000000000000000000", "0x"+strings.Repeat("a2", 32), replacementHash, replaceTx); err != nil {
			t.Fatal(err)
		}
		if _, err = repo.pool.Exec(ctx, `INSERT INTO cto_proposals(chain_id,registry_address,proposal_id,token_address,treasury_address,creator_address,controller_address,previous_recipient_address,metadata_hash,metadata_uri,token_nonce,state,created_timestamp,acceptance_deadline,created_block_number,created_block_hash,created_transaction_hash,created_log_index,lifecycle_block_number,lifecycle_block_hash,lifecycle_transaction_hash,lifecycle_log_index) VALUES($1,$2,$3,$4,$5,$6,$7,$6,$8,'ipfs://replacement',2,'proposed',300,400,71002,$9,$10,1,71002,$9,$10,1)`, ctoTestChain, registry, replacementProposal, token, replacement, creator, controller, "0x"+strings.Repeat("b2", 32), replacementHash, replaceTx); err != nil {
			t.Fatal(err)
		}
		if _, err = repo.pool.Exec(ctx, `INSERT INTO cto_token_state(chain_id,fee_manager_address,token_address,registry_address,active,treasury_address,proposal_id,previous_recipient_address,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,$4,true,$5,$6,$7,71002,$8,$9,1)`, ctoTestChain, fees, token, registry, replacement, replacementProposal, creator, replacementHash, replaceTx); err != nil {
			t.Fatal(err)
		}
		status, err = repo.CTOStatus(ctx, ctoTestChain, token)
		if err != nil || !status.Active || status.Treasury != replacement || status.ActiveProposalID != replacementProposal {
			t.Fatalf("replacement=%+v err=%v", status, err)
		}
	})
}

func TestCTOProposalHistoryPaginationLifecycleAndTerminalStates(t *testing.T) {
	withPreparedRepos(t, func(t *testing.T, repo *PostgresRepository) {
		ctx := context.Background()
		token := "0x000000000000000000000000000000000000c021"
		creator := "0x000000000000000000000000000000000000c022"
		registry := "0x000000000000000000000000000000000000c023"
		controller := "0x000000000000000000000000000000000000c024"
		treasury := "0x000000000000000000000000000000000000c025"
		blockHash := "0x" + strings.Repeat("e1", 32)
		launchTx := "0x" + strings.Repeat("e2", 32)
		cleanup := func() {
			_, _ = repo.pool.Exec(ctx, `DELETE FROM cto_proposals WHERE chain_id=$1 AND token_address=$2`, ctoTestChain, token)
			_, _ = repo.pool.Exec(ctx, `DELETE FROM cto_treasuries WHERE chain_id=$1 AND token_address=$2`, ctoTestChain, token)
			_, _ = repo.pool.Exec(ctx, `DELETE FROM tokens WHERE chain_id=$1 AND token_address=$2`, ctoTestChain, token)
			_, _ = repo.pool.Exec(ctx, `DELETE FROM chain_blocks WHERE chain_id=$1 AND block_hash=$2`, ctoTestChain, blockHash)
		}
		cleanup()
		t.Cleanup(cleanup)
		insertToken(t, repo, token, creator, blockHash, launchTx, 72001)
		if _, err := repo.pool.Exec(ctx, `INSERT INTO cto_treasuries(chain_id,registry_address,treasury_address,token_address,controller_address,token_nonce,create2_salt,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,$4,$5,1,$6,72001,$7,$8,1)`, ctoTestChain, registry, treasury, token, controller, "0x"+strings.Repeat("aa", 32), blockHash, "0x"+strings.Repeat("e3", 32)); err != nil {
			t.Fatal(err)
		}
		states := []string{"cancelled", "expired", "proposed"}
		for i, state := range states {
			proposal := "0x" + strings.Repeat(string("3456789abcdef0"[i]), 64)
			tx := "0x" + strings.Repeat(string("cdef0123456789"[i]), 64)
			block := int64(72010 + i)
			cancelledBlock, expiredBlock := any(nil), any(nil)
			cancelledTs, expiredTs := any(nil), any(nil)
			if state == "cancelled" {
				cancelledBlock, cancelledTs = block, int64(500+i)
			}
			if state == "expired" {
				expiredBlock, expiredTs = block, int64(600+i)
			}
			if _, err := repo.pool.Exec(ctx, `INSERT INTO cto_proposals(chain_id,registry_address,proposal_id,token_address,treasury_address,creator_address,controller_address,previous_recipient_address,metadata_hash,metadata_uri,token_nonce,state,created_timestamp,acceptance_deadline,created_block_number,created_block_hash,created_transaction_hash,created_log_index,lifecycle_block_number,lifecycle_block_hash,lifecycle_transaction_hash,lifecycle_log_index,cancelled_timestamp,cancelled_block_number,cancelled_block_hash,cancelled_transaction_hash,cancelled_log_index,expired_timestamp,expired_block_number,expired_block_hash,expired_transaction_hash,expired_log_index) VALUES($1,$2,$3,$4,$5,$6,$7,$6,$8,'ipfs://history', $9,$10,100,200,$11,$12,$13,0,$11,$12,$13,0,$14,$15,$16,$17,0,$18,$19,$20,$21,0)`,
				ctoTestChain, registry, proposal, token, treasury, creator, controller, "0x"+strings.Repeat("bb", 32), i+1, state, block, blockHash, tx, cancelledTs, cancelledBlock, nullableHash(state == "cancelled", blockHash), nullableHash(state == "cancelled", tx), expiredTs, expiredBlock, nullableHash(state == "expired", blockHash), nullableHash(state == "expired", tx)); err != nil {
				t.Fatal(err)
			}
		}
		page, err := repo.CTOProposals(ctx, ctoTestChain, token, 1, "")
		if err != nil || len(page.Items) != 1 || page.NextCursor == "" || page.Items[0].State != "proposed" {
			t.Fatalf("newest page=%+v err=%v", page, err)
		}
		page2, err := repo.CTOProposals(ctx, ctoTestChain, token, 2, page.NextCursor)
		if err != nil || len(page2.Items) != 2 || page2.Items[0].ProposalID == page.Items[0].ProposalID {
			t.Fatalf("next page=%+v err=%v", page2, err)
		}
		if _, err = repo.CTOProposals(ctx, ctoTestChain, token, 1, "not-a-cursor"); err != ErrInvalidCursor {
			t.Fatalf("malformed cursor err=%v", err)
		}
		replayed, err := repo.CTOProposals(ctx, ctoTestChain, token, 1, page.NextCursor)
		if err != nil || len(replayed.Items) == 0 || replayed.Items[0].ProposalID != page2.Items[0].ProposalID {
			t.Fatalf("replayed cursor=%+v err=%v", replayed, err)
		}
		detail, err := repo.CTOProposal(ctx, ctoTestChain, page2.Items[1].ProposalID)
		if err != nil || (detail.State != "cancelled" && detail.State != "expired") {
			t.Fatalf("detail=%+v err=%v", detail, err)
		}
		if _, err = repo.CTOProposal(ctx, ctoTestChain, "0x"+strings.Repeat("00", 32)); err != ErrNotFound {
			t.Fatalf("unknown proposal err=%v", err)
		}
		if _, err = repo.pool.Exec(ctx, `UPDATE cto_proposals SET is_canonical=false,orphaned_at=now() WHERE chain_id=$1 AND proposal_id=$2`, ctoTestChain, detail.ProposalID); err != nil {
			t.Fatal(err)
		}
		if _, err = repo.CTOProposal(ctx, ctoTestChain, detail.ProposalID); err != ErrNotFound {
			t.Fatalf("orphaned proposal err=%v", err)
		}
	})
}

func nullableHash(present bool, value string) any {
	if !present {
		return nil
	}
	return value
}

func TestCTOTreasuryAssetsTransfersPullsAndUint64Nonce(t *testing.T) {
	withPreparedRepos(t, func(t *testing.T, repo *PostgresRepository) {
		ctx := context.Background()
		token := "0x000000000000000000000000000000000000c031"
		creator := "0x000000000000000000000000000000000000c032"
		registry := "0x000000000000000000000000000000000000c033"
		controller := "0x000000000000000000000000000000000000c034"
		treasury := "0x000000000000000000000000000000000000c035"
		asset := "0x000000000000000000000000000000000000c036"
		recipient := "0x000000000000000000000000000000000000c037"
		blockHash := "0x" + strings.Repeat("f1", 32)
		launchTx := "0x" + strings.Repeat("f2", 32)
		deployTx := "0x" + strings.Repeat("f3", 32)
		maxNonce := "18446744073709551615"
		huge := "9223372036854775808"
		cleanup := func() {
			_, _ = repo.pool.Exec(ctx, `DELETE FROM cto_fee_pulls WHERE chain_id=$1 AND treasury_address=$2`, ctoTestChain, treasury)
			_, _ = repo.pool.Exec(ctx, `DELETE FROM cto_treasury_transfers WHERE chain_id=$1 AND treasury_address=$2`, ctoTestChain, treasury)
			_, _ = repo.pool.Exec(ctx, `DELETE FROM cto_supported_assets WHERE chain_id=$1 AND treasury_address=$2`, ctoTestChain, treasury)
			_, _ = repo.pool.Exec(ctx, `DELETE FROM cto_treasuries WHERE chain_id=$1 AND treasury_address=$2`, ctoTestChain, treasury)
			_, _ = repo.pool.Exec(ctx, `DELETE FROM tokens WHERE chain_id=$1 AND token_address=$2`, ctoTestChain, token)
			_, _ = repo.pool.Exec(ctx, `DELETE FROM chain_blocks WHERE chain_id=$1 AND block_hash=$2`, ctoTestChain, blockHash)
		}
		cleanup()
		t.Cleanup(cleanup)
		insertToken(t, repo, token, creator, blockHash, launchTx, 73001)
		if _, err := repo.pool.Exec(ctx, `INSERT INTO cto_treasuries(chain_id,registry_address,treasury_address,token_address,controller_address,canonical_usdc_address,token_nonce,create2_salt,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,$4,$5,$6,$7,$8,73001,$9,$10,1)`, ctoTestChain, registry, treasury, token, controller, "0x3600000000000000000000000000000000000000", maxNonce, "0x"+strings.Repeat("cc", 32), blockHash, deployTx); err != nil {
			t.Fatal(err)
		}
		if _, err := repo.pool.Exec(ctx, `INSERT INTO cto_supported_assets(chain_id,treasury_address,asset_address,controller_address,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,$4,73001,$5,$6,2)`, ctoTestChain, treasury, asset, controller, blockHash, "0x"+strings.Repeat("f4", 32)); err != nil {
			t.Fatal(err)
		}
		for i := 0; i < 3; i++ {
			tx := "0x" + strings.Repeat(string("89abcdef"[i]), 64)
			if _, err := repo.pool.Exec(ctx, `INSERT INTO cto_treasury_transfers(chain_id,transaction_hash,log_index,treasury_address,asset_address,recipient_address,amount,controller_address,block_number,block_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,73001,$9)`, ctoTestChain, tx, i, treasury, asset, recipient, huge, controller, blockHash); err != nil {
				t.Fatal(err)
			}
			if _, err := repo.pool.Exec(ctx, `INSERT INTO cto_fee_pulls(chain_id,transaction_hash,log_index,treasury_address,token_address,asset_address,amount,triggered_by_address,block_number,block_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,73001,$9)`, ctoTestChain, "0x"+strings.Repeat(string("01234567"[i]), 64), i, treasury, token, asset, huge, recipient, blockHash); err != nil {
				t.Fatal(err)
			}
		}
		got, err := repo.CTOTreasury(ctx, ctoTestChain, strings.ToUpper(treasury), 2)
		if err != nil || got.Nonce != maxNonce || got.CanonicalUsdc != "0x3600000000000000000000000000000000000000" || len(got.SupportedAssets) != 1 || len(got.RecentTransfers) != 2 || got.TransfersNextCursor == "" || len(got.RecentFeePulls) != 2 || got.FeePullsNextCursor == "" || got.RecentTransfers[0].Amount != huge {
			t.Fatalf("treasury=%+v err=%v", got, err)
		}
		more, err := repo.CTOTreasuryTransfers(ctx, ctoTestChain, treasury, 2, got.TransfersNextCursor)
		if err != nil || len(more.Items) != 1 {
			t.Fatalf("transfer page=%+v err=%v", more, err)
		}
	})
}

func TestCTOCheckpointsAggregateClaimedExceedsAndHugeAmounts(t *testing.T) {
	withPreparedRepos(t, func(t *testing.T, repo *PostgresRepository) {
		ctx := context.Background()
		token := "0x000000000000000000000000000000000000c041"
		creator := "0x000000000000000000000000000000000000c042"
		fees := "0x000000000000000000000000000000000000c043"
		recipient := "0x000000000000000000000000000000000000c044"
		blockHash := "0x" + strings.Repeat("a9", 32)
		launchTx := "0x" + strings.Repeat("b9", 32)
		huge := "115792089237316195423570985008687907853269984665640564039457584007913129639935"
		cleanup := func() {
			_, _ = repo.pool.Exec(ctx, `DELETE FROM cto_creator_fee_checkpoint_ledger WHERE chain_id=$1 AND token_address=$2`, ctoTestChain, token)
			_, _ = repo.pool.Exec(ctx, `DELETE FROM tokens WHERE chain_id=$1 AND token_address=$2`, ctoTestChain, token)
			_, _ = repo.pool.Exec(ctx, `DELETE FROM chain_blocks WHERE chain_id=$1 AND block_hash=$2`, ctoTestChain, blockHash)
		}
		cleanup()
		t.Cleanup(cleanup)
		insertToken(t, repo, token, creator, blockHash, launchTx, 74001)
		if _, err := repo.pool.Exec(ctx, `INSERT INTO cto_creator_fee_checkpoint_ledger(chain_id,transaction_hash,log_index,fee_manager_address,token_address,recipient_address,action,amount,block_number,block_hash) VALUES($1,$2,1,$3,$4,$5,'checkpoint',$6,74001,$7)`, ctoTestChain, "0x"+strings.Repeat("11", 32), fees, token, recipient, huge, blockHash); err != nil {
			t.Fatal(err)
		}
		if _, err := repo.pool.Exec(ctx, `INSERT INTO cto_creator_fee_checkpoint_ledger(chain_id,transaction_hash,log_index,fee_manager_address,token_address,recipient_address,action,amount,triggered_by_address,block_number,block_hash) VALUES($1,$2,2,$3,$4,$5,'claim',1,$5,74001,$6)`, ctoTestChain, "0x"+strings.Repeat("22", 32), fees, token, recipient, blockHash); err != nil {
			t.Fatal(err)
		}
		page, err := repo.CTOCheckpoints(ctx, ctoTestChain, token, 10, "")
		if err != nil || len(page.Aggregates) != 1 || page.Aggregates[0].Checkpointed != huge || page.Aggregates[0].Claimed != "1" || page.Aggregates[0].Outstanding == "0" || len(page.Items) != 2 {
			t.Fatalf("checkpoints=%+v err=%v", page, err)
		}
		if _, err = repo.pool.Exec(ctx, `INSERT INTO cto_creator_fee_checkpoint_ledger(chain_id,transaction_hash,log_index,fee_manager_address,token_address,recipient_address,action,amount,block_number,block_hash) VALUES($1,$2,3,$3,$4,$5,'claim',$6,74001,$7)`, ctoTestChain, "0x"+strings.Repeat("33", 32), fees, token, recipient, huge, blockHash); err != nil {
			t.Fatal(err)
		}
		if _, err = repo.CTOCheckpoints(ctx, ctoTestChain, token, 10, ""); err != ErrInconsistentAccounting {
			t.Fatalf("claimed>checkpointed err=%v", err)
		}
	})
}

func TestCTOHTTPUsesConfiguredChainAndDoesNotFetchMetadataURI(t *testing.T) {
	url := integrationDatabaseURL(t, "API_TEST_DATABASE_URL")
	repo, err := NewPostgresRepository(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	fetches := 0
	handler := newHandler(repo, ctoTestChain, time.Second, slog.New(slog.NewJSONHandler(io.Discard, nil)), nil, nil, func(context.Context, string) ([]byte, string, error) {
		fetches++
		return nil, "", nil
	})
	token := "0x000000000000000000000000000000000000c051"
	creator := "0x000000000000000000000000000000000000c052"
	blockHash := "0x" + strings.Repeat("c8", 32)
	tx := "0x" + strings.Repeat("c9", 32)
	cleanup := func() {
		_, _ = repo.pool.Exec(context.Background(), `DELETE FROM tokens WHERE chain_id=$1 AND token_address=$2`, ctoTestChain, token)
		_, _ = repo.pool.Exec(context.Background(), `DELETE FROM chain_blocks WHERE chain_id=$1 AND block_hash=$2`, ctoTestChain, blockHash)
	}
	cleanup()
	t.Cleanup(cleanup)
	insertToken(t, repo, token, creator, blockHash, tx, 75001)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens/"+strings.ToUpper(token)+"/cto", nil))
	if w.Code != 200 || fetches != 0 || !strings.Contains(w.Body.String(), `"chain_id":5042002`) || w.Header().Get("Cache-Control") != "public, max-age=5, must-revalidate" {
		t.Fatalf("status=%d fetches=%d body=%s", w.Code, fetches, w.Body.String())
	}
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/v1/tokens/"+token+"/cto", nil))
	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("post status=%d", w.Code)
	}
}
