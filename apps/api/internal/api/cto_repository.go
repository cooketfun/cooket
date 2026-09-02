package api

import (
	"context"
	"errors"
	"math/big"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

const ctoHistoryPreviewLimit = 20
const ctoSupportedAssetLimit = 100

const ctoProposalSelect = `SELECT proposal_id,token_address,registry_address,treasury_address,creator_address,controller_address,previous_recipient_address,token_nonce::text,metadata_hash,metadata_uri,state,created_timestamp,created_block_number,created_block_hash,created_transaction_hash,created_log_index,acceptance_deadline,accepted_timestamp,accepted_block_number,accepted_block_hash,accepted_transaction_hash,accepted_log_index,execute_after,execute_deadline,ready_block_number,ready_block_hash,ready_transaction_hash,ready_log_index,cancelled_timestamp,cancelled_block_number,cancelled_block_hash,cancelled_transaction_hash,cancelled_log_index,expired_timestamp,expired_block_number,expired_block_hash,expired_transaction_hash,expired_log_index,activated_timestamp,activated_block_number,activated_block_hash,activated_transaction_hash,activated_log_index,lifecycle_block_number,lifecycle_block_hash,lifecycle_transaction_hash,lifecycle_log_index
	FROM cto_proposals WHERE chain_id=$1 AND is_canonical`

func (r *PostgresRepository) canonicalTokenExists(ctx context.Context, chain int64, token string) (bool, error) {
	var ok bool
	err := r.pool.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM tokens t
		WHERE t.chain_id=$1 AND lower(t.token_address)=lower($2) AND t.is_canonical
		  AND NOT EXISTS (SELECT 1 FROM application_token_exclusions x WHERE x.chain_id=t.chain_id AND x.token_address=lower(t.token_address))
	)`, chain, token).Scan(&ok)
	return ok, err
}

func (r *PostgresRepository) requireCanonicalToken(ctx context.Context, chain int64, token string) error {
	ok, err := r.canonicalTokenExists(ctx, chain, token)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresRepository) CTOStatus(ctx context.Context, chain int64, token string) (CTOStatus, error) {
	if err := r.requireCanonicalToken(ctx, chain, token); err != nil {
		return CTOStatus{}, err
	}
	out := CTOStatus{ChainID: chain, Token: token, Active: false}
	var registry, treasury, proposalID, previous, controller *string
	var blockNumber, logIndex *int64
	var blockHash, txHash *string
	err := r.pool.QueryRow(ctx, `SELECT s.active,s.registry_address,s.treasury_address,s.proposal_id,s.previous_recipient_address,
			s.block_number,s.block_hash,s.transaction_hash,s.log_index,
			COALESCE(tr.controller_address, p.controller_address)
		FROM cto_token_state s
		LEFT JOIN cto_treasuries tr ON tr.chain_id=s.chain_id AND tr.treasury_address=s.treasury_address AND tr.is_canonical
		LEFT JOIN cto_proposals p ON p.chain_id=s.chain_id AND p.registry_address=s.registry_address AND p.proposal_id=s.proposal_id AND p.is_canonical
		WHERE s.chain_id=$1 AND s.token_address=lower($2) AND s.is_canonical`, chain, token).Scan(&out.Active, &registry, &treasury, &proposalID, &previous, &blockNumber, &blockHash, &txHash, &logIndex, &controller)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return CTOStatus{}, err
	}
	out.Registry = optionalValue(registry)
	out.Treasury = optionalValue(treasury)
	out.ActiveProposalID = optionalValue(proposalID)
	out.PreviousRecipient = optionalValue(previous)
	out.Controller = optionalValue(controller)
	if blockNumber != nil && blockHash != nil && txHash != nil && logIndex != nil {
		out.Activation = &IndexedProvenance{BlockNumber: *blockNumber, BlockHash: *blockHash, TransactionHash: *txHash, LogIndex: *logIndex}
	}
	return out, nil
}

func scanCTOProposal(row pgx.Row) (CTOProposal, error) {
	var p CTOProposal
	var acceptedAt, cancelledAt, expiredAt, activatedAt *int64
	var executeAfter, executeDeadline *int64
	var acceptedBlock, acceptedLog, readyBlock, readyLog, cancelledBlock, cancelledLog, expiredBlock, expiredLog, activatedBlock, activatedLog *int64
	var acceptedHash, acceptedTx, readyHash, readyTx, cancelledHash, cancelledTx, expiredHash, expiredTx, activatedHash, activatedTx *string
	err := row.Scan(
		&p.ProposalID, &p.Token, &p.Registry, &p.Treasury, &p.Creator, &p.Controller, &p.PreviousRecipient, &p.Nonce, &p.MetadataHash, &p.MetadataURI, &p.State,
		&p.CreatedTimestamp, &p.Created.BlockNumber, &p.Created.BlockHash, &p.Created.TransactionHash, &p.Created.LogIndex, &p.AcceptanceDeadline,
		&acceptedAt, &acceptedBlock, &acceptedHash, &acceptedTx, &acceptedLog,
		&executeAfter, &executeDeadline, &readyBlock, &readyHash, &readyTx, &readyLog,
		&cancelledAt, &cancelledBlock, &cancelledHash, &cancelledTx, &cancelledLog,
		&expiredAt, &expiredBlock, &expiredHash, &expiredTx, &expiredLog,
		&activatedAt, &activatedBlock, &activatedHash, &activatedTx, &activatedLog,
		&p.lifecycle.BlockNumber, &p.lifecycle.BlockHash, &p.lifecycle.TransactionHash, &p.lifecycle.LogIndex,
	)
	if err != nil {
		return p, err
	}
	p.AcceptedAt = acceptedAt
	p.ExecuteAfter = executeAfter
	p.ExecuteDeadline = executeDeadline
	p.CancelledAt = cancelledAt
	p.ExpiredAt = expiredAt
	p.ActivatedAt = activatedAt
	p.Accepted = optionalProvenance(acceptedBlock, acceptedHash, acceptedTx, acceptedLog)
	p.Ready = optionalProvenance(readyBlock, readyHash, readyTx, readyLog)
	p.Cancelled = optionalProvenance(cancelledBlock, cancelledHash, cancelledTx, cancelledLog)
	p.Expired = optionalProvenance(expiredBlock, expiredHash, expiredTx, expiredLog)
	p.Activated = optionalProvenance(activatedBlock, activatedHash, activatedTx, activatedLog)
	return p, nil
}

func optionalProvenance(block *int64, hash, tx *string, log *int64) *IndexedProvenance {
	if block == nil || hash == nil || tx == nil || log == nil {
		return nil
	}
	return &IndexedProvenance{BlockNumber: *block, BlockHash: *hash, TransactionHash: *tx, LogIndex: *log}
}

func (r *PostgresRepository) CTOProposals(ctx context.Context, chain int64, token string, limit int, rawCursor string) (CTOProposalPage, error) {
	if err := r.requireCanonicalToken(ctx, chain, token); err != nil {
		return CTOProposalPage{}, err
	}
	c, err := decodeCursor(rawCursor, "cto_proposals")
	if err != nil {
		return CTOProposalPage{}, err
	}
	args := []any{chain, token}
	where := " AND token_address=lower($2)"
	if rawCursor != "" {
		args = append(args, c.BlockNumber, c.Transaction, c.LogIndex, c.ProposalID)
		where += " AND (lifecycle_block_number < $3 OR (lifecycle_block_number = $3 AND (lifecycle_transaction_hash < $4 OR (lifecycle_transaction_hash = $4 AND (lifecycle_log_index < $5 OR (lifecycle_log_index = $5 AND proposal_id < $6))))))"
	}
	args = append(args, limit+1)
	rows, err := r.pool.Query(ctx, ctoProposalSelect+where+` ORDER BY lifecycle_block_number DESC,lifecycle_transaction_hash DESC,lifecycle_log_index DESC,proposal_id DESC LIMIT $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		return CTOProposalPage{}, err
	}
	defer rows.Close()
	out := CTOProposalPage{Items: []CTOProposal{}}
	for rows.Next() {
		p, scanErr := scanCTOProposal(rows)
		if scanErr != nil {
			return CTOProposalPage{}, scanErr
		}
		out.Items = append(out.Items, p)
	}
	if err = rows.Err(); err != nil {
		return CTOProposalPage{}, err
	}
	if len(out.Items) > limit {
		out.Items = out.Items[:limit]
		last := out.Items[len(out.Items)-1]
		out.NextCursor = encodeCursor(pageCursor{Kind: "cto_proposals", BlockNumber: last.lifecycle.BlockNumber, Transaction: last.lifecycle.TransactionHash, LogIndex: last.lifecycle.LogIndex, ProposalID: last.ProposalID})
	}
	return out, nil
}

func (r *PostgresRepository) CTOProposal(ctx context.Context, chain int64, proposalID string) (CTOProposal, error) {
	p, err := scanCTOProposal(r.pool.QueryRow(ctx, ctoProposalSelect+` AND proposal_id=lower($2)`, chain, proposalID))
	if errors.Is(err, pgx.ErrNoRows) {
		return CTOProposal{}, ErrNotFound
	}
	return p, err
}

func (r *PostgresRepository) CTOTreasury(ctx context.Context, chain int64, treasury string, previewLimit int) (CTOTreasury, error) {
	if previewLimit <= 0 {
		previewLimit = ctoHistoryPreviewLimit
	}
	var out CTOTreasury
	err := r.pool.QueryRow(ctx, `SELECT treasury_address,registry_address,token_address,controller_address,coalesce(canonical_usdc_address,''),token_nonce::text,block_number,block_hash,transaction_hash,log_index
		FROM cto_treasuries WHERE chain_id=$1 AND treasury_address=lower($2) AND is_canonical`, chain, treasury).Scan(
		&out.Treasury, &out.Registry, &out.Token, &out.Controller, &out.CanonicalUsdc, &out.Nonce,
		&out.Deployment.BlockNumber, &out.Deployment.BlockHash, &out.Deployment.TransactionHash, &out.Deployment.LogIndex,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return CTOTreasury{}, ErrNotFound
	}
	if err != nil {
		return CTOTreasury{}, err
	}
	assets, err := r.ctoSupportedAssets(ctx, chain, out.Treasury)
	if err != nil {
		return CTOTreasury{}, err
	}
	out.SupportedAssets = assets
	transfers, err := r.CTOTreasuryTransfers(ctx, chain, out.Treasury, previewLimit, "")
	if err != nil {
		return CTOTreasury{}, err
	}
	out.RecentTransfers = transfers.Items
	out.TransfersNextCursor = transfers.NextCursor
	pulls, err := r.CTOTreasuryFeePulls(ctx, chain, out.Treasury, previewLimit, "")
	if err != nil {
		return CTOTreasury{}, err
	}
	out.RecentFeePulls = pulls.Items
	out.FeePullsNextCursor = pulls.NextCursor
	return out, nil
}

func (r *PostgresRepository) ctoSupportedAssets(ctx context.Context, chain int64, treasury string) ([]CTOSupportedAsset, error) {
	rows, err := r.pool.Query(ctx, `SELECT asset_address,controller_address,block_number,block_hash,transaction_hash,log_index
		FROM cto_supported_assets WHERE chain_id=$1 AND treasury_address=lower($2) AND is_canonical
		ORDER BY block_number DESC,log_index DESC,transaction_hash DESC LIMIT $3`, chain, treasury, ctoSupportedAssetLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CTOSupportedAsset{}
	for rows.Next() {
		var asset CTOSupportedAsset
		if err = rows.Scan(&asset.Asset, &asset.Controller, &asset.Registered.BlockNumber, &asset.Registered.BlockHash, &asset.Registered.TransactionHash, &asset.Registered.LogIndex); err != nil {
			return nil, err
		}
		out = append(out, asset)
	}
	return out, rows.Err()
}

func (r *PostgresRepository) requireCanonicalTreasury(ctx context.Context, chain int64, treasury string) error {
	var ok bool
	err := r.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM cto_treasuries WHERE chain_id=$1 AND treasury_address=lower($2) AND is_canonical)`, chain, treasury).Scan(&ok)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresRepository) CTOTreasuryTransfers(ctx context.Context, chain int64, treasury string, limit int, rawCursor string) (CTOTreasuryTransferPage, error) {
	if err := r.requireCanonicalTreasury(ctx, chain, treasury); err != nil {
		return CTOTreasuryTransferPage{}, err
	}
	c, err := decodeCursor(rawCursor, "cto_transfers")
	if err != nil {
		return CTOTreasuryTransferPage{}, err
	}
	args := []any{chain, treasury}
	where := ""
	if rawCursor != "" {
		args = append(args, c.BlockNumber, c.Transaction, c.LogIndex)
		where = " AND (block_number < $3 OR (block_number = $3 AND (transaction_hash < $4 OR (transaction_hash = $4 AND log_index < $5))))"
	}
	args = append(args, limit+1)
	rows, err := r.pool.Query(ctx, `SELECT asset_address,recipient_address,amount::text,controller_address,block_number,block_hash,transaction_hash,log_index
		FROM cto_treasury_transfers WHERE chain_id=$1 AND treasury_address=lower($2) AND is_canonical`+where+`
		ORDER BY block_number DESC,transaction_hash DESC,log_index DESC LIMIT $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		return CTOTreasuryTransferPage{}, err
	}
	defer rows.Close()
	out := CTOTreasuryTransferPage{Items: []CTOTreasuryTransfer{}}
	for rows.Next() {
		var item CTOTreasuryTransfer
		if err = rows.Scan(&item.Asset, &item.Recipient, &item.Amount, &item.Controller, &item.Provenance.BlockNumber, &item.Provenance.BlockHash, &item.Provenance.TransactionHash, &item.Provenance.LogIndex); err != nil {
			return CTOTreasuryTransferPage{}, err
		}
		out.Items = append(out.Items, item)
	}
	if err = rows.Err(); err != nil {
		return CTOTreasuryTransferPage{}, err
	}
	if len(out.Items) > limit {
		out.Items = out.Items[:limit]
		last := out.Items[len(out.Items)-1]
		out.NextCursor = encodeCursor(pageCursor{Kind: "cto_transfers", BlockNumber: last.Provenance.BlockNumber, Transaction: last.Provenance.TransactionHash, LogIndex: last.Provenance.LogIndex})
	}
	return out, nil
}

func (r *PostgresRepository) CTOTreasuryFeePulls(ctx context.Context, chain int64, treasury string, limit int, rawCursor string) (CTOFeePullPage, error) {
	if err := r.requireCanonicalTreasury(ctx, chain, treasury); err != nil {
		return CTOFeePullPage{}, err
	}
	c, err := decodeCursor(rawCursor, "cto_fee_pulls")
	if err != nil {
		return CTOFeePullPage{}, err
	}
	args := []any{chain, treasury}
	where := ""
	if rawCursor != "" {
		args = append(args, c.BlockNumber, c.Transaction, c.LogIndex)
		where = " AND (block_number < $3 OR (block_number = $3 AND (transaction_hash < $4 OR (transaction_hash = $4 AND log_index < $5))))"
	}
	args = append(args, limit+1)
	rows, err := r.pool.Query(ctx, `SELECT token_address,asset_address,amount::text,triggered_by_address,block_number,block_hash,transaction_hash,log_index
		FROM cto_fee_pulls WHERE chain_id=$1 AND treasury_address=lower($2) AND is_canonical`+where+`
		ORDER BY block_number DESC,transaction_hash DESC,log_index DESC LIMIT $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		return CTOFeePullPage{}, err
	}
	defer rows.Close()
	out := CTOFeePullPage{Items: []CTOFeePull{}}
	for rows.Next() {
		var item CTOFeePull
		if err = rows.Scan(&item.Token, &item.Asset, &item.Amount, &item.TriggeredBy, &item.Provenance.BlockNumber, &item.Provenance.BlockHash, &item.Provenance.TransactionHash, &item.Provenance.LogIndex); err != nil {
			return CTOFeePullPage{}, err
		}
		out.Items = append(out.Items, item)
	}
	if err = rows.Err(); err != nil {
		return CTOFeePullPage{}, err
	}
	if len(out.Items) > limit {
		out.Items = out.Items[:limit]
		last := out.Items[len(out.Items)-1]
		out.NextCursor = encodeCursor(pageCursor{Kind: "cto_fee_pulls", BlockNumber: last.Provenance.BlockNumber, Transaction: last.Provenance.TransactionHash, LogIndex: last.Provenance.LogIndex})
	}
	return out, nil
}

func (r *PostgresRepository) CTOCheckpoints(ctx context.Context, chain int64, token string, limit int, rawCursor string) (CTOCheckpointPage, error) {
	if err := r.requireCanonicalToken(ctx, chain, token); err != nil {
		return CTOCheckpointPage{}, err
	}
	aggregates, err := r.ctoCheckpointAggregates(ctx, chain, token)
	if err != nil {
		return CTOCheckpointPage{}, err
	}
	c, err := decodeCursor(rawCursor, "cto_checkpoints")
	if err != nil {
		return CTOCheckpointPage{}, err
	}
	args := []any{chain, token}
	where := ""
	if rawCursor != "" {
		args = append(args, c.BlockNumber, c.Transaction, c.LogIndex)
		where = " AND (block_number < $3 OR (block_number = $3 AND (transaction_hash < $4 OR (transaction_hash = $4 AND log_index < $5))))"
	}
	args = append(args, limit+1)
	rows, err := r.pool.Query(ctx, `SELECT recipient_address,action,amount::text,coalesce(triggered_by_address,''),block_number,block_hash,transaction_hash,log_index
		FROM cto_creator_fee_checkpoint_ledger WHERE chain_id=$1 AND token_address=lower($2) AND is_canonical`+where+`
		ORDER BY block_number DESC,transaction_hash DESC,log_index DESC LIMIT $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		return CTOCheckpointPage{}, err
	}
	defer rows.Close()
	out := CTOCheckpointPage{Token: token, Aggregates: aggregates, Items: []CTOCheckpointEvent{}}
	for rows.Next() {
		var item CTOCheckpointEvent
		if err = rows.Scan(&item.Recipient, &item.Action, &item.Amount, &item.TriggeredBy, &item.Provenance.BlockNumber, &item.Provenance.BlockHash, &item.Provenance.TransactionHash, &item.Provenance.LogIndex); err != nil {
			return CTOCheckpointPage{}, err
		}
		out.Items = append(out.Items, item)
	}
	if err = rows.Err(); err != nil {
		return CTOCheckpointPage{}, err
	}
	if len(out.Items) > limit {
		out.Items = out.Items[:limit]
		last := out.Items[len(out.Items)-1]
		out.NextCursor = encodeCursor(pageCursor{Kind: "cto_checkpoints", BlockNumber: last.Provenance.BlockNumber, Transaction: last.Provenance.TransactionHash, LogIndex: last.Provenance.LogIndex})
	}
	return out, nil
}

func (r *PostgresRepository) ctoCheckpointAggregates(ctx context.Context, chain int64, token string) ([]CTOCheckpointAggregate, error) {
	rows, err := r.pool.Query(ctx, `SELECT recipient_address,
			coalesce(sum(amount) FILTER (WHERE action='checkpoint'),0)::text,
			coalesce(sum(amount) FILTER (WHERE action='claim'),0)::text
		FROM cto_creator_fee_checkpoint_ledger
		WHERE chain_id=$1 AND token_address=lower($2) AND is_canonical
		GROUP BY recipient_address
		ORDER BY recipient_address`, chain, token)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CTOCheckpointAggregate{}
	for rows.Next() {
		var item CTOCheckpointAggregate
		item.Token = strings.ToLower(token)
		if err = rows.Scan(&item.Recipient, &item.Checkpointed, &item.Claimed); err != nil {
			return nil, err
		}
		checkpointed, ok := new(big.Int).SetString(item.Checkpointed, 10)
		if !ok {
			return nil, errors.New("invalid checkpointed amount")
		}
		claimed, ok := new(big.Int).SetString(item.Claimed, 10)
		if !ok {
			return nil, errors.New("invalid claimed amount")
		}
		if claimed.Cmp(checkpointed) > 0 {
			return nil, ErrInconsistentAccounting
		}
		item.Outstanding = new(big.Int).Sub(checkpointed, claimed).String()
		out = append(out, item)
	}
	return out, rows.Err()
}
