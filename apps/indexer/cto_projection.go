package indexer

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/jackc/pgx/v5"
)

func trustedCTOEmitter(ctx context.Context, tx pgx.Tx, chain int64, emitter common.Address, kind string, roots CTOProvenance) (bool, error) {
	if roots.Registry == (common.Address{}) || roots.FeeManager == (common.Address{}) {
		return false, nil
	}
	switch kind {
	case "registry":
		return emitter == roots.Registry, nil
	case "feeManager":
		return emitter == roots.FeeManager, nil
	case "treasury":
		var trusted bool
		err := tx.QueryRow(ctx, `SELECT EXISTS(
			SELECT 1 FROM cto_treasuries WHERE chain_id=$1 AND treasury_address=lower($2) AND is_canonical
			UNION ALL
			SELECT 1 FROM chain_events WHERE chain_id=$1 AND is_canonical AND event_name='CTOTreasuryDeployed'
				AND lower(contract_address)=lower($3) AND lower(decoded->>'treasury')=lower($2)
		)`, chain, emitter.Hex(), roots.Registry.Hex()).Scan(&trusted)
		return trusted, err
	default:
		return false, nil
	}
}

type activationEvidence struct {
	token, treasury, previous common.Address
	log                       types.Log
}

func validateCTOActivationPairs(logs []types.Log, roots CTOProvenance) error {
	if roots.Registry == (common.Address{}) || roots.FeeManager == (common.Address{}) {
		return nil
	}
	registryActivations := []activationEvidence{}
	routeActivations := []activationEvidence{}
	for _, l := range logs {
		if len(l.Topics) == 0 {
			continue
		}
		if l.Address == roots.Registry && l.Topics[0] == ctoRegistryABI.Events["CTOActivated"].ID {
			v, err := decodeLog(ctoRegistryABI, "CTOActivated", l)
			if err != nil {
				return err
			}
			registryActivations = append(registryActivations, activationEvidence{v["token"].(common.Address), v["treasury"].(common.Address), v["previousRecipient"].(common.Address), l})
		}
		if l.Address == roots.FeeManager && l.Topics[0] == feeManagerABI.Events["CTOFeeRouteActivated"].ID {
			v, err := decodeLog(feeManagerABI, "CTOFeeRouteActivated", l)
			if err != nil {
				return err
			}
			routeActivations = append(routeActivations, activationEvidence{v["token"].(common.Address), v["treasury"].(common.Address), v["previousRecipient"].(common.Address), l})
		}
	}
	matched := make([]bool, len(routeActivations))
	for _, activation := range registryActivations {
		matches := 0
		for i, route := range routeActivations {
			if activation.token == route.token && activation.treasury == route.treasury && activation.previous == route.previous && activation.log.TxHash == route.log.TxHash && activation.log.BlockHash == route.log.BlockHash && activation.log.BlockNumber == route.log.BlockNumber {
				matches++
				matched[i] = true
			}
		}
		if matches != 1 {
			return fmt.Errorf("CTO activation for token %s has %d matching FeeManager routes", activation.token.Hex(), matches)
		}
	}
	for i, ok := range matched {
		if !ok {
			return fmt.Errorf("CTO fee route for token %s has no matching registry activation", routeActivations[i].token.Hex())
		}
	}
	return nil
}

type canonicalCTOEvent struct {
	name, emitter, blockHash, txHash string
	blockNumber, logIndex, timestamp int64
	values                           map[string]any
}

func rebuildCTOTx(ctx context.Context, tx pgx.Tx, chain int64) error {
	for _, table := range []string{"cto_treasuries", "cto_proposals", "cto_token_state", "cto_creator_fee_checkpoint_ledger", "cto_supported_assets", "cto_treasury_transfers", "cto_fee_pulls"} {
		if _, err := tx.Exec(ctx, `UPDATE `+table+` SET is_canonical=false,orphaned_at=now() WHERE chain_id=$1 AND is_canonical`, chain); err != nil {
			return err
		}
	}
	rows, err := tx.Query(ctx, `SELECT e.event_name,lower(e.contract_address),e.block_number,e.block_hash,e.transaction_hash,e.log_index,b.block_timestamp,e.decoded
		FROM chain_events e JOIN chain_blocks b ON b.chain_id=e.chain_id AND b.block_hash=e.block_hash AND b.is_canonical
		WHERE e.chain_id=$1 AND e.is_canonical AND e.event_name = ANY($2)
		ORDER BY e.block_number,e.transaction_index,e.log_index`, chain, allCTOEventNames())
	if err != nil {
		return err
	}
	events := []canonicalCTOEvent{}
	for rows.Next() {
		var event canonicalCTOEvent
		var raw []byte
		if err := rows.Scan(&event.name, &event.emitter, &event.blockNumber, &event.blockHash, &event.txHash, &event.logIndex, &event.timestamp, &raw); err != nil {
			rows.Close()
			return err
		}
		if err := json.Unmarshal(raw, &event.values); err != nil {
			rows.Close()
			return err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, event := range events {
		if err := projectCanonicalCTOEvent(ctx, tx, chain, event); err != nil {
			return fmt.Errorf("project %s tx=%s index=%d: %w", event.name, event.txHash, event.logIndex, err)
		}
	}
	return nil
}

func allCTOEventNames() []string {
	return []string{
		"CTOTreasuryDeployed", "CTOProposed", "CTOAccepted", "CTOReady", "CTOCancelled", "CTOExpired", "CTOActivated",
		"CreatorFeeCheckpointed", "PendingCreatorPayoutInvalidated", "CTOFeeRouteActivated", "CheckpointedCreatorFeesClaimed",
		"CTOAcceptanceSubmitted", "SupportedAssetRegistered", "TreasuryAssetTransferred", "CreatorFeesPulled",
	}
}

func isExactCTOEvent(name string) bool {
	for _, event := range allCTOEventNames() {
		if event == name {
			return true
		}
	}
	return false
}

func field(event canonicalCTOEvent, name string) string {
	return strings.ToLower(fmt.Sprint(event.values[name]))
}

func projectCanonicalCTOEvent(ctx context.Context, tx pgx.Tx, chain int64, e canonicalCTOEvent) error {
	switch e.name {
	case "CTOTreasuryDeployed":
		_, err := tx.Exec(ctx, `INSERT INTO cto_treasuries(chain_id,registry_address,treasury_address,token_address,controller_address,canonical_usdc_address,token_nonce,create2_salt,block_number,block_hash,transaction_hash,log_index)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(chain_id,transaction_hash,log_index) DO UPDATE SET registry_address=excluded.registry_address,treasury_address=excluded.treasury_address,token_address=excluded.token_address,controller_address=excluded.controller_address,canonical_usdc_address=excluded.canonical_usdc_address,token_nonce=excluded.token_nonce,create2_salt=excluded.create2_salt,block_number=excluded.block_number,block_hash=excluded.block_hash,is_canonical=true,orphaned_at=NULL`, chain, e.emitter, field(e, "treasury"), field(e, "token"), field(e, "controller"), ArcCanonicalUsdc, field(e, "nonce"), field(e, "salt"), e.blockNumber, e.blockHash, e.txHash, e.logIndex)
		return err
	case "CTOProposed":
		deadline := field(e, "acceptanceDeadline")
		_, err := tx.Exec(ctx, `INSERT INTO cto_proposals(chain_id,registry_address,proposal_id,token_address,treasury_address,creator_address,controller_address,previous_recipient_address,metadata_hash,metadata_uri,token_nonce,state,created_timestamp,acceptance_deadline,created_block_number,created_block_hash,created_transaction_hash,created_log_index,lifecycle_block_number,lifecycle_block_hash,lifecycle_transaction_hash,lifecycle_log_index)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'proposed',$12,$13,$14,$15,$16,$17,$14,$15,$16,$17)
			ON CONFLICT(chain_id,registry_address,proposal_id) DO UPDATE SET token_address=excluded.token_address,treasury_address=excluded.treasury_address,creator_address=excluded.creator_address,controller_address=excluded.controller_address,previous_recipient_address=excluded.previous_recipient_address,metadata_hash=excluded.metadata_hash,metadata_uri=excluded.metadata_uri,token_nonce=excluded.token_nonce,state='proposed',created_timestamp=excluded.created_timestamp,acceptance_deadline=excluded.acceptance_deadline,accepted_timestamp=NULL,execute_after=NULL,execute_deadline=NULL,cancelled_timestamp=NULL,expired_timestamp=NULL,activated_timestamp=NULL,accepted_block_number=NULL,accepted_block_hash=NULL,accepted_transaction_hash=NULL,accepted_log_index=NULL,ready_block_number=NULL,ready_block_hash=NULL,ready_transaction_hash=NULL,ready_log_index=NULL,cancelled_block_number=NULL,cancelled_block_hash=NULL,cancelled_transaction_hash=NULL,cancelled_log_index=NULL,expired_block_number=NULL,expired_block_hash=NULL,expired_transaction_hash=NULL,expired_log_index=NULL,activated_block_number=NULL,activated_block_hash=NULL,activated_transaction_hash=NULL,activated_log_index=NULL,created_block_number=excluded.created_block_number,created_block_hash=excluded.created_block_hash,created_transaction_hash=excluded.created_transaction_hash,created_log_index=excluded.created_log_index,lifecycle_block_number=excluded.lifecycle_block_number,lifecycle_block_hash=excluded.lifecycle_block_hash,lifecycle_transaction_hash=excluded.lifecycle_transaction_hash,lifecycle_log_index=excluded.lifecycle_log_index,is_canonical=true,orphaned_at=NULL`, chain, e.emitter, field(e, "proposalId"), field(e, "token"), field(e, "treasury"), field(e, "creator"), field(e, "controller"), field(e, "previousRecipient"), field(e, "metadataHash"), fmt.Sprint(e.values["metadataURI"]), field(e, "nonce"), e.timestamp, deadline, e.blockNumber, e.blockHash, e.txHash, e.logIndex)
		return err
	case "CTOAccepted":
		return updateProposalLifecycle(ctx, tx, chain, e, "accepted", "accepted", field(e, "acceptedAt"))
	case "CTOReady":
		_, err := tx.Exec(ctx, `UPDATE cto_proposals SET execute_after=$4,execute_deadline=$5,ready_block_number=$6,ready_block_hash=$7,ready_transaction_hash=$8,ready_log_index=$9,lifecycle_block_number=$6,lifecycle_block_hash=$7,lifecycle_transaction_hash=$8,lifecycle_log_index=$9,is_canonical=true,orphaned_at=NULL WHERE chain_id=$1 AND registry_address=$2 AND proposal_id=$3`, chain, e.emitter, field(e, "proposalId"), field(e, "executeAfter"), field(e, "executeDeadline"), e.blockNumber, e.blockHash, e.txHash, e.logIndex)
		return err
	case "CTOCancelled":
		return updateProposalLifecycle(ctx, tx, chain, e, "cancelled", "cancelled", fmt.Sprint(e.timestamp))
	case "CTOExpired":
		return updateProposalLifecycle(ctx, tx, chain, e, "expired", "expired", fmt.Sprint(e.timestamp))
	case "CTOActivated":
		if err := updateProposalLifecycle(ctx, tx, chain, e, "active", "activated", fmt.Sprint(e.timestamp)); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO cto_token_state(chain_id,fee_manager_address,token_address,registry_address,active,treasury_address,proposal_id,previous_recipient_address,block_number,block_hash,transaction_hash,log_index)
			SELECT $1,r.contract_address,lower($2),$3,true,lower($4),lower($5),lower($6),$7,$8,$9,$10 FROM chain_events r
			WHERE r.chain_id=$1 AND r.is_canonical AND r.event_name='CTOFeeRouteActivated' AND r.transaction_hash=$9 AND lower(r.decoded->>'token')=lower($2) AND lower(r.decoded->>'treasury')=lower($4)
			ON CONFLICT(chain_id,fee_manager_address,token_address) DO UPDATE SET registry_address=excluded.registry_address,active=true,treasury_address=excluded.treasury_address,proposal_id=excluded.proposal_id,previous_recipient_address=excluded.previous_recipient_address,block_number=excluded.block_number,block_hash=excluded.block_hash,transaction_hash=excluded.transaction_hash,log_index=excluded.log_index,is_canonical=true,orphaned_at=NULL`, chain, field(e, "token"), e.emitter, field(e, "treasury"), field(e, "proposalId"), field(e, "previousRecipient"), e.blockNumber, e.blockHash, e.txHash, e.logIndex)
		return err
	case "CreatorFeeCheckpointed", "CheckpointedCreatorFeesClaimed":
		action, recipient, trigger := "checkpoint", field(e, "previousRecipient"), any(nil)
		if e.name == "CheckpointedCreatorFeesClaimed" {
			action, recipient, trigger = "claim", field(e, "recipient"), field(e, "triggeredBy")
		}
		_, err := tx.Exec(ctx, `INSERT INTO cto_creator_fee_checkpoint_ledger(chain_id,transaction_hash,log_index,fee_manager_address,token_address,recipient_address,action,amount,triggered_by_address,block_number,block_hash)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(chain_id,transaction_hash,log_index) DO UPDATE SET fee_manager_address=excluded.fee_manager_address,token_address=excluded.token_address,recipient_address=excluded.recipient_address,action=excluded.action,amount=excluded.amount,triggered_by_address=excluded.triggered_by_address,block_number=excluded.block_number,block_hash=excluded.block_hash,is_canonical=true,orphaned_at=NULL`, chain, e.txHash, e.logIndex, e.emitter, field(e, "token"), recipient, action, field(e, "amount"), trigger, e.blockNumber, e.blockHash)
		return err
	case "SupportedAssetRegistered":
		_, err := tx.Exec(ctx, `INSERT INTO cto_supported_assets(chain_id,treasury_address,asset_address,controller_address,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(chain_id,transaction_hash,log_index) DO UPDATE SET treasury_address=excluded.treasury_address,asset_address=excluded.asset_address,controller_address=excluded.controller_address,block_number=excluded.block_number,block_hash=excluded.block_hash,is_canonical=true,orphaned_at=NULL`, chain, e.emitter, field(e, "asset"), field(e, "controller"), e.blockNumber, e.blockHash, e.txHash, e.logIndex)
		return err
	case "TreasuryAssetTransferred":
		_, err := tx.Exec(ctx, `INSERT INTO cto_treasury_transfers(chain_id,transaction_hash,log_index,treasury_address,asset_address,recipient_address,amount,controller_address,block_number,block_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(chain_id,transaction_hash,log_index) DO UPDATE SET treasury_address=excluded.treasury_address,asset_address=excluded.asset_address,recipient_address=excluded.recipient_address,amount=excluded.amount,controller_address=excluded.controller_address,block_number=excluded.block_number,block_hash=excluded.block_hash,is_canonical=true,orphaned_at=NULL`, chain, e.txHash, e.logIndex, e.emitter, field(e, "asset"), field(e, "recipient"), field(e, "amount"), field(e, "controller"), e.blockNumber, e.blockHash)
		return err
	case "CreatorFeesPulled":
		_, err := tx.Exec(ctx, `INSERT INTO cto_fee_pulls(chain_id,transaction_hash,log_index,treasury_address,token_address,asset_address,amount,triggered_by_address,block_number,block_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(chain_id,transaction_hash,log_index) DO UPDATE SET treasury_address=excluded.treasury_address,token_address=excluded.token_address,asset_address=excluded.asset_address,amount=excluded.amount,triggered_by_address=excluded.triggered_by_address,block_number=excluded.block_number,block_hash=excluded.block_hash,is_canonical=true,orphaned_at=NULL`, chain, e.txHash, e.logIndex, e.emitter, field(e, "token"), field(e, "asset"), field(e, "amount"), field(e, "triggeredBy"), e.blockNumber, e.blockHash)
		return err
	}
	return nil
}

func updateProposalLifecycle(ctx context.Context, tx pgx.Tx, chain int64, e canonicalCTOEvent, state, prefix, timestamp string) error {
	query := fmt.Sprintf(`UPDATE cto_proposals SET state=$4,%s_timestamp=$5,%s_block_number=$6,%s_block_hash=$7,%s_transaction_hash=$8,%s_log_index=$9,lifecycle_block_number=$6,lifecycle_block_hash=$7,lifecycle_transaction_hash=$8,lifecycle_log_index=$9,is_canonical=true,orphaned_at=NULL WHERE chain_id=$1 AND registry_address=$2 AND proposal_id=$3`, prefix, prefix, prefix, prefix, prefix)
	_, err := tx.Exec(ctx, query, chain, e.emitter, field(e, "proposalId"), state, timestamp, e.blockNumber, e.blockHash, e.txHash, e.logIndex)
	return err
}

func normalizedEventValues(values map[string]any) map[string]any {
	out := make(map[string]any, len(values))
	for key, value := range values {
		switch typed := value.(type) {
		case common.Address:
			out[key] = strings.ToLower(typed.Hex())
		case common.Hash:
			out[key] = strings.ToLower(typed.Hex())
		case [32]byte:
			out[key] = "0x" + hex.EncodeToString(typed[:])
		default:
			out[key] = str(value)
		}
	}
	return out
}
