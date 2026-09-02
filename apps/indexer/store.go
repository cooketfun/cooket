package indexer

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"log"
	"math/big"
	"strings"
)

type Store struct{ pool *pgxpool.Pool }

func (s *Store) ScanContracts(ctx context.Context, chain int64, configured []common.Address) ([]common.Address, error) {
	out := append([]common.Address(nil), configured...)
	known := map[string]struct{}{}
	for _, address := range out {
		known[strings.ToLower(address.Hex())] = struct{}{}
	}
	rows, err := s.pool.Query(ctx, `SELECT address FROM (
		SELECT DISTINCT curve_address AS address FROM curves WHERE chain_id=$1 AND is_canonical AND curve_address <> ''
		UNION
		SELECT DISTINCT token_address AS address FROM tokens WHERE chain_id=$1 AND is_canonical AND token_address <> ''
		UNION
		SELECT DISTINCT treasury_address AS address FROM cto_treasuries WHERE chain_id=$1 AND is_canonical
		UNION
		SELECT DISTINCT e.decoded->>'token' AS address FROM chain_events e
		JOIN application_token_exclusions x ON x.chain_id=e.chain_id AND x.token_address=lower(e.decoded->>'token')
		WHERE e.chain_id=$1 AND e.is_canonical AND e.event_name='TokenLaunchedV3'
		UNION
		SELECT DISTINCT e.decoded->>'curve' AS address FROM chain_events e
		JOIN application_token_exclusions x ON x.chain_id=e.chain_id AND x.token_address=lower(e.decoded->>'token')
		WHERE e.chain_id=$1 AND e.is_canonical AND e.event_name='TokenLaunchedV3'
		UNION
		SELECT DISTINCT e.decoded->>'canonicalPool' AS address FROM chain_events e
		JOIN application_token_exclusions x ON x.chain_id=e.chain_id AND x.token_address=lower(e.decoded->>'token')
		WHERE e.chain_id=$1 AND e.is_canonical AND e.event_name='TokenLaunchedV3'
	) known`, chain)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		if !common.IsHexAddress(raw) {
			continue
		}
		address := common.HexToAddress(raw)
		key := strings.ToLower(address.Hex())
		if _, ok := known[key]; !ok {
			known[key] = struct{}{}
			out = append(out, address)
		}
	}
	return out, rows.Err()
}

var blockNumberProjectionTables = []string{
	"tokens", "curves", "trades", "fees", "graduations", "liquidity_events",
	"cto_treasuries", "cto_token_state", "cto_creator_fee_checkpoint_ledger",
	"cto_supported_assets", "cto_treasury_transfers", "cto_fee_pulls",
}

func orphanCanonicalByBlock(ctx context.Context, tx pgx.Tx, predicate string, args ...any) error {
	for _, table := range blockNumberProjectionTables {
		if _, err := tx.Exec(ctx, `UPDATE `+table+` SET is_canonical=false,orphaned_at=now() WHERE chain_id=$1 AND is_canonical AND `+predicate, args...); err != nil {
			return err
		}
	}
	proposalPredicate := strings.NewReplacer("block_number", "lifecycle_block_number", "block_hash", "lifecycle_block_hash").Replace(predicate)
	_, err := tx.Exec(ctx, `UPDATE cto_proposals SET is_canonical=false,orphaned_at=now() WHERE chain_id=$1 AND is_canonical AND `+proposalPredicate, args...)
	return err
}

func NewStore(ctx context.Context, url string) (*Store, error) {
	p, e := pgxpool.New(ctx, url)
	if e != nil {
		return nil, e
	}
	if e = p.Ping(ctx); e != nil {
		p.Close()
		return nil, e
	}
	var ready bool
	e = p.QueryRow(ctx, `SELECT
		(SELECT array_agg(version ORDER BY version) FROM schema_migrations) = ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]
		AND to_regclass('public.chain_events') IS NOT NULL
		AND to_regclass('public.tokens') IS NOT NULL
		AND to_regclass('public.curves') IS NOT NULL
		AND to_regclass('public.application_token_exclusions') IS NOT NULL
		AND to_regclass('public.cto_treasuries') IS NOT NULL
		AND to_regclass('public.cto_proposals') IS NOT NULL
		AND to_regclass('public.cto_token_state') IS NOT NULL
		AND to_regclass('public.cto_creator_fee_checkpoint_ledger') IS NOT NULL
		AND to_regclass('public.cto_supported_assets') IS NOT NULL
		AND to_regclass('public.cto_treasury_transfers') IS NOT NULL
		AND to_regclass('public.cto_fee_pulls') IS NOT NULL
		AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='graduations' AND column_name='native_usdc_amount')
		AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='graduations' AND column_name='eth_amount')`).Scan(&ready)
	if e != nil {
		p.Close()
		return nil, fmt.Errorf("database schema is not ready; run db/migrate.sh: %w", e)
	}
	if !ready {
		p.Close()
		return nil, fmt.Errorf("database schema is not ready; run db/migrate.sh")
	}
	return &Store{p}, nil
}
func (s *Store) Close() { s.pool.Close() }
func (s *Store) Checkpoint(ctx context.Context, chain int64, name string) (uint64, string, error) {
	var n uint64
	var h string
	e := s.pool.QueryRow(ctx, `SELECT last_block_number,last_block_hash FROM indexer_checkpoints WHERE chain_id=$1 AND indexer_name=$2`, chain, name).Scan(&n, &h)
	if e == pgx.ErrNoRows {
		return 0, "", nil
	}
	return n, h, e
}
func (s *Store) CanonicalBlockHash(ctx context.Context, chain int64, number uint64) (string, error) {
	var h string
	e := s.pool.QueryRow(ctx, `SELECT block_hash FROM chain_blocks WHERE chain_id=$1 AND block_number=$2 AND is_canonical`, chain, number).Scan(&h)
	if e == pgx.ErrNoRows {
		return "", nil
	}
	return h, e
}
func (s *Store) Rewind(ctx context.Context, chain int64, name string, from uint64) error {
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, `UPDATE chain_blocks SET is_canonical=false,orphaned_at=now() WHERE chain_id=$1 AND block_number >= $2 AND is_canonical`, chain, from); e != nil {
		return e
	}
	if e = orphanCanonicalByBlock(ctx, tx, "block_number >= $2", chain, from); e != nil {
		return e
	}
	if _, e = tx.Exec(ctx, `UPDATE chain_events SET is_canonical=false,orphaned_at=now() WHERE chain_id=$1 AND block_number >= $2 AND is_canonical`, chain, from); e != nil {
		return e
	}
	if e = rebuildCTOTx(ctx, tx, chain); e != nil {
		return e
	}
	if e = rebuildMetricsTx(ctx, tx, chain); e != nil {
		return e
	}
	if e = rebuildCurveStateTx(ctx, tx, chain); e != nil {
		return e
	}
	if e = rebuildAnalyticsTx(ctx, tx, chain); e != nil {
		return e
	}
	checkpoint := uint64(0)
	if from > 0 {
		checkpoint = from - 1
	}
	checkpointHash := ""
	if checkpoint > 0 {
		e = tx.QueryRow(ctx, `SELECT block_hash FROM chain_blocks WHERE chain_id=$1 AND block_number=$2 AND is_canonical`, chain, checkpoint).Scan(&checkpointHash)
		if e != nil && e != pgx.ErrNoRows {
			return e
		}
	}
	if _, e = tx.Exec(ctx, `UPDATE indexer_checkpoints SET last_block_number=$3,last_block_hash=$4,updated_at=now() WHERE chain_id=$1 AND indexer_name=$2`, chain, name, checkpoint, checkpointHash); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (s *Store) Apply(ctx context.Context, chain int64, name string, b *types.Header, logs []types.Log) error {
	return s.ApplyWithMetadataAndSenders(ctx, chain, name, b, logs, nil, nil)
}
func (s *Store) ApplyWithMetadata(ctx context.Context, chain int64, name string, b *types.Header, logs []types.Log, metadata map[string]TokenMetadata) error {
	return s.ApplyWithMetadataAndSenders(ctx, chain, name, b, logs, metadata, nil)
}
func (s *Store) ApplyWithMetadataAndSenders(ctx context.Context, chain int64, name string, b *types.Header, logs []types.Log, metadata map[string]TokenMetadata, senders map[common.Hash]common.Address) error {
	return s.ApplyWithProvenance(ctx, chain, name, b, logs, metadata, senders, CTOProvenance{})
}

func (s *Store) ApplyWithProvenance(ctx context.Context, chain int64, name string, b *types.Header, logs []types.Log, metadata map[string]TokenMetadata, senders map[common.Hash]common.Address, roots CTOProvenance) error {
	if e := validateGraduationPairs(logs); e != nil {
		return e
	}
	if e := validateCTOActivationPairs(logs, roots); e != nil {
		return e
	}
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	hash := b.Hash().Hex()
	parent := b.ParentHash.Hex()
	// A replacement block at the same height must first orphan the old
	// canonical row, otherwise the partial unique height index rejects it.
	if _, e = tx.Exec(ctx, `UPDATE chain_blocks SET is_canonical=false,orphaned_at=now() WHERE chain_id=$1 AND block_number=$2 AND block_hash<>$3 AND is_canonical`, chain, b.Number.Uint64(), hash); e != nil {
		return e
	}
	if e = orphanCanonicalByBlock(ctx, tx, "block_number=$2 AND block_hash<>$3", chain, b.Number.Uint64(), hash); e != nil {
		return e
	}
	if _, e = tx.Exec(ctx, `UPDATE chain_events SET is_canonical=false,orphaned_at=now() WHERE chain_id=$1 AND block_number=$2 AND block_hash<>$3 AND is_canonical`, chain, b.Number.Uint64(), hash); e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `INSERT INTO chain_blocks(chain_id,block_number,block_hash,parent_hash,block_timestamp) VALUES($1,$2,$3,$4,$5) ON CONFLICT(chain_id,block_hash) DO UPDATE SET block_number=excluded.block_number,parent_hash=excluded.parent_hash,block_timestamp=excluded.block_timestamp,is_canonical=true,orphaned_at=NULL`, chain, b.Number.Uint64(), hash, parent, b.Time)
	if e != nil {
		return e
	}
	for _, l := range logs {
		if l.BlockNumber != b.Number.Uint64() || l.BlockHash != b.Hash() {
			return fmt.Errorf("log provenance does not match block header: block=%d tx=%s log_index=%d", l.BlockNumber, l.TxHash.Hex(), l.Index)
		}
		if e = insertEvent(ctx, tx, chain, l, metadata, senders, roots); e != nil {
			return e
		}
	}
	if e = rebuildCTOTx(ctx, tx, chain); e != nil {
		return e
	}
	if e = rebuildMetricsTx(ctx, tx, chain); e != nil {
		return e
	}
	if e = rebuildCurveStateTx(ctx, tx, chain); e != nil {
		return e
	}
	if e = rebuildAnalyticsTx(ctx, tx, chain); e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `INSERT INTO indexer_checkpoints(chain_id,indexer_name,last_block_number,last_block_hash) VALUES($1,$2,$3,$4) ON CONFLICT(chain_id,indexer_name) DO UPDATE SET last_block_number=excluded.last_block_number,last_block_hash=excluded.last_block_hash,updated_at=now()`, chain, name, b.Number.Uint64(), hash)
	if e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func rebuildMetricsTx(ctx context.Context, tx pgx.Tx, chain int64) error {
	if _, e := tx.Exec(ctx, `UPDATE token_metrics SET trade_count=0,buy_count=0,sell_count=0,volume=0,fees=0,block_number=0,block_hash='',transaction_hash='',log_index=0,updated_at=now() WHERE chain_id=$1`, chain); e != nil {
		return e
	}
	_, e := tx.Exec(ctx, `WITH stats AS (
		SELECT chain_id,token_address,count(*) trade_count,count(*) FILTER (WHERE side='buy') buy_count,
			count(*) FILTER (WHERE side='sell') sell_count,coalesce(sum(CASE WHEN source='uniswap_v3' THEN reserve_amount ELSE curve_value END),0) volume,
			coalesce(sum(protocol_fee+creator_fee),0) fees
		FROM trades WHERE chain_id=$1 AND is_canonical GROUP BY chain_id,token_address
	), latest AS (
		SELECT DISTINCT ON (chain_id,token_address) chain_id,token_address,block_number,block_hash,transaction_hash,log_index
		FROM trades WHERE chain_id=$1 AND is_canonical
		ORDER BY chain_id,token_address,block_number DESC,transaction_index DESC,log_index DESC
	)
	INSERT INTO token_metrics(chain_id,token_address,trade_count,buy_count,sell_count,volume,fees,block_number,block_hash,transaction_hash,log_index,updated_at)
	SELECT s.chain_id,s.token_address,s.trade_count,s.buy_count,s.sell_count,s.volume,s.fees,l.block_number,l.block_hash,l.transaction_hash,l.log_index,now()
	FROM stats s JOIN latest l USING(chain_id,token_address)
	ON CONFLICT(chain_id,token_address) DO UPDATE SET trade_count=excluded.trade_count,buy_count=excluded.buy_count,
		sell_count=excluded.sell_count,volume=excluded.volume,fees=excluded.fees,block_number=excluded.block_number,
		block_hash=excluded.block_hash,transaction_hash=excluded.transaction_hash,log_index=excluded.log_index,updated_at=now()`, chain)
	return e
}
func rebuildCurveStateTx(ctx context.Context, tx pgx.Tx, chain int64) error {
	if _, e := tx.Exec(ctx, `UPDATE curves SET sold_supply=0,reserve_balance=0,lifecycle='active' WHERE chain_id=$1 AND is_canonical`, chain); e != nil {
		return e
	}
	if _, e := tx.Exec(ctx, `UPDATE curves c SET sold_supply=q.sold_supply,reserve_balance=q.reserve_balance FROM (
		SELECT chain_id,token_address,sum(CASE WHEN side='buy' THEN token_amount ELSE -token_amount END) sold_supply,
			sum(CASE WHEN side='buy' THEN curve_value ELSE -curve_value END) reserve_balance
		FROM trades WHERE chain_id=$1 AND is_canonical AND source='curve' GROUP BY chain_id,token_address
	) q WHERE c.chain_id=q.chain_id AND c.token_address=q.token_address AND c.is_canonical`, chain); e != nil {
		return e
	}
	_, e := tx.Exec(ctx, `UPDATE curves c SET lifecycle=q.lifecycle FROM (
		SELECT DISTINCT ON (chain_id,lower(decoded->>'token')) chain_id,lower(decoded->>'token') token_address,
			CASE event_name WHEN 'Graduated' THEN 'graduated' END lifecycle
		FROM chain_events
		WHERE chain_id=$1 AND is_canonical AND event_name='Graduated'
		ORDER BY chain_id,lower(decoded->>'token'),block_number DESC,log_index DESC
	) q WHERE c.chain_id=q.chain_id AND lower(c.token_address)=q.token_address AND c.is_canonical`, chain)
	return e
}

// rebuildAnalyticsTx derives every market discovery projection from canonical events in
// the same transaction as block application or rewind. The existing indexer
// already rebuilds chain-wide trade metrics on each applied event block; keeping
// the dependent holder and bucket projections together prevents a reorg from
// exposing a mixed canonical state. All values remain integer NUMERIC values.
func rebuildAnalyticsTx(ctx context.Context, tx pgx.Tx, chain int64) error {
	if _, e := tx.Exec(ctx, `DELETE FROM token_holder_balances WHERE chain_id=$1`, chain); e != nil {
		return e
	}
	// Transfer is the source of balances. A launch seed is only used when the
	// constructor mint was not collected because the token address was unknown
	// before its launch event; a collected zero-address mint always takes precedence.
	if _, e := tx.Exec(ctx, `WITH known_tokens AS (
		SELECT DISTINCT lower(token_address) token_address FROM tokens WHERE chain_id=$1 AND is_canonical
	), transfers AS (
		SELECT lower(e.contract_address) token_address, lower(e.decoded->>'from') holder_address,
			-(e.decoded->>'value')::numeric amount, e.block_number,e.block_hash,e.transaction_hash,e.log_index
		FROM chain_events e JOIN known_tokens k ON k.token_address=lower(e.contract_address)
		WHERE e.chain_id=$1 AND e.is_canonical AND e.event_name='Transfer' AND lower(e.decoded->>'from') <> '0x0000000000000000000000000000000000000000'
		UNION ALL
		SELECT lower(e.contract_address), lower(e.decoded->>'to'), (e.decoded->>'value')::numeric,
			e.block_number,e.block_hash,e.transaction_hash,e.log_index
		FROM chain_events e JOIN known_tokens k ON k.token_address=lower(e.contract_address)
		WHERE e.chain_id=$1 AND e.is_canonical AND e.event_name='Transfer' AND lower(e.decoded->>'to') <> '0x0000000000000000000000000000000000000000'
	), seeds AS (
		SELECT lower(e.decoded->>'token') token_address, lower(e.decoded->>'curve') holder_address,
			(e.decoded->>'totalSupply')::numeric amount,e.block_number,e.block_hash,e.transaction_hash,e.log_index
		FROM chain_events e WHERE e.chain_id=$1 AND e.is_canonical AND e.event_name='TokenLaunchedV3'
		AND NOT EXISTS (SELECT 1 FROM chain_events m WHERE m.chain_id=e.chain_id AND m.is_canonical AND m.event_name='Transfer'
			AND lower(m.contract_address)=lower(e.decoded->>'token') AND lower(m.decoded->>'from')='0x0000000000000000000000000000000000000000')
		), deltas AS (SELECT * FROM transfers UNION ALL SELECT * FROM seeds), balances AS (
		SELECT token_address,holder_address,sum(amount) balance FROM deltas GROUP BY token_address,holder_address
	), latest AS (
		SELECT DISTINCT ON (token_address,holder_address) token_address,holder_address,block_number,block_hash,transaction_hash,log_index
		FROM deltas ORDER BY token_address,holder_address,block_number DESC,transaction_hash DESC,log_index DESC
	)
	INSERT INTO token_holder_balances(chain_id,token_address,holder_address,balance,block_number,block_hash,transaction_hash,log_index)
	SELECT $1,b.token_address,b.holder_address,b.balance,l.block_number,l.block_hash,l.transaction_hash,l.log_index
	FROM balances b JOIN latest l USING(token_address,holder_address) WHERE b.balance > 0`, chain); e != nil {
		return e
	}
	if _, e := tx.Exec(ctx, `INSERT INTO token_metrics(chain_id,token_address)
		SELECT $1, lower(token_address) FROM tokens WHERE chain_id=$1 AND is_canonical
		ON CONFLICT(chain_id,token_address) DO NOTHING`, chain); e != nil {
		return e
	}
	if _, e := tx.Exec(ctx, `WITH holders AS (
		SELECT token_address,count(*) holder_count FROM token_holder_balances WHERE chain_id=$1 AND balance>0 GROUP BY token_address
	), traders AS (
		SELECT lower(token_address) token_address,count(DISTINCT lower(trader_address)) trader_count FROM trades WHERE chain_id=$1 AND is_canonical GROUP BY lower(token_address)
	), latest AS (
		SELECT DISTINCT ON (lower(t.token_address)) lower(t.token_address) token_address,b.block_timestamp
		FROM trades t JOIN chain_blocks b ON b.chain_id=t.chain_id AND b.block_hash=t.block_hash AND b.is_canonical
		WHERE t.chain_id=$1 AND t.is_canonical ORDER BY lower(t.token_address),t.block_number DESC,t.transaction_hash DESC,t.log_index DESC
	)
	UPDATE token_metrics m SET holder_count=coalesce(h.holder_count,0),unique_trader_count=coalesce(tr.trader_count,0),latest_trade_timestamp=l.block_timestamp
	FROM (SELECT lower(token_address) token_address FROM tokens WHERE chain_id=$1 AND is_canonical) tk
	LEFT JOIN holders h ON h.token_address=tk.token_address LEFT JOIN traders tr ON tr.token_address=tk.token_address LEFT JOIN latest l ON l.token_address=tk.token_address
	WHERE m.chain_id=$1 AND lower(m.token_address)=tk.token_address`, chain); e != nil {
		return e
	}
	// The ranking window is anchored to indexed canonical time, making replay,
	// pagination, and reorg recovery independent of API host wall-clock time.
	if _, e := tx.Exec(ctx, `WITH anchor AS (
		SELECT max(block_timestamp) timestamp FROM chain_blocks WHERE chain_id=$1 AND is_canonical
	), recent AS (
		SELECT lower(t.token_address) token_address,count(*) trade_count,coalesce(sum(CASE WHEN t.source='uniswap_v3' THEN t.reserve_amount ELSE t.curve_value END),0) volume,
			count(DISTINCT lower(t.trader_address)) trader_count
		FROM trades t JOIN chain_blocks b ON b.chain_id=t.chain_id AND b.block_hash=t.block_hash AND b.is_canonical
		CROSS JOIN anchor a
		WHERE t.chain_id=$1 AND t.is_canonical AND a.timestamp IS NOT NULL AND b.block_timestamp > a.timestamp-86400
		GROUP BY lower(t.token_address)
	)
	UPDATE token_metrics m SET recent_trade_count=coalesce(r.trade_count,0),recent_volume=coalesce(r.volume,0),
		recent_trader_count=coalesce(r.trader_count,0),recent_window_start=(SELECT timestamp-86400 FROM anchor)
	FROM (SELECT lower(token_address) token_address FROM tokens WHERE chain_id=$1 AND is_canonical) tk
	LEFT JOIN recent r ON r.token_address=tk.token_address
	WHERE m.chain_id=$1 AND lower(m.token_address)=tk.token_address`, chain); e != nil {
		return e
	}
	if _, e := tx.Exec(ctx, `UPDATE token_metrics SET current_price=NULL,fully_diluted_value=NULL WHERE chain_id=$1`, chain); e != nil {
		return e
	}
	if _, e := tx.Exec(ctx, `WITH state AS (
		SELECT DISTINCT ON (lower(t.token_address)) lower(t.token_address) token_address,t.initial_supply,c.sold_supply,c.reserve_balance
		FROM tokens t JOIN LATERAL (SELECT * FROM curves c WHERE c.chain_id=t.chain_id AND lower(c.token_address)=lower(t.token_address) AND c.is_canonical ORDER BY c.block_number DESC,c.log_index DESC LIMIT 1) c ON true
		WHERE t.chain_id=$1 AND t.is_canonical AND t.protocol_version='endpoint-cp-v3'
		ORDER BY lower(t.token_address),t.block_number DESC,t.log_index DESC
	), prices AS (
		SELECT token_address, ceil(((1000000000000000000::numeric + reserve_balance) * 1000000000000000000::numeric) / (1066666666666666666666666667::numeric - sold_supply)) price, initial_supply
		FROM state WHERE sold_supply >= 0 AND sold_supply < 1066666666666666666666666667::numeric AND reserve_balance >= 0
	)
		UPDATE token_metrics m SET current_price=p.price,fully_diluted_value=floor(p.price*p.initial_supply/1000000000000000000::numeric)
		FROM prices p WHERE m.chain_id=$1 AND lower(m.token_address)=p.token_address`, chain); e != nil {
		return e
	}
	// Historical post-graduation rows, if present from a prior verified replay,
	// remain readable. D2a does not discover or decode a market venue.
	if _, e := tx.Exec(ctx, `WITH latest AS (
		SELECT DISTINCT ON (lower(t.token_address)) lower(t.token_address) token_address,
			floor(t.reserve_amount * 1000000000000000000::numeric / NULLIF(t.token_amount,0)) price
		FROM trades t WHERE t.chain_id=$1 AND t.is_canonical AND t.source='uniswap_v3'
		ORDER BY lower(t.token_address),t.block_number DESC,t.transaction_index DESC,t.log_index DESC
	), supplies AS (
		SELECT lower(token_address) token_address,initial_supply FROM tokens WHERE chain_id=$1 AND is_canonical
	)
	UPDATE token_metrics m SET current_price=l.price,fully_diluted_value=floor(l.price*s.initial_supply/1000000000000000000::numeric)
	FROM latest l JOIN supplies s USING(token_address)
	WHERE m.chain_id=$1 AND lower(m.token_address)=l.token_address`, chain); e != nil {
		return e
	}
	if _, e := tx.Exec(ctx, `DELETE FROM token_trade_buckets WHERE chain_id=$1`, chain); e != nil {
		return e
	}
	// Curve state advances only for curve trades. Historical post-graduation
	// candles preserve their already indexed quote/token ratio and chain order across the
	// graduation boundary.
	_, e := tx.Exec(ctx, `WITH ordered AS (
		SELECT lower(t.token_address) token_address,(b.block_timestamp / 3600) * 3600 bucket_start,t.side,t.source,t.token_amount,t.reserve_amount,t.curve_value,t.trader_address,t.block_number,t.block_hash,t.transaction_hash,t.transaction_index,t.log_index,
			sum(CASE WHEN t.source='curve' AND t.side='buy' THEN t.token_amount WHEN t.source='curve' AND t.side='sell' THEN -t.token_amount ELSE 0 END) OVER (PARTITION BY lower(t.token_address) ORDER BY t.block_number,t.transaction_index,t.log_index,t.transaction_hash) sold_supply,
			sum(CASE WHEN t.source='curve' AND t.side='buy' THEN t.curve_value WHEN t.source='curve' AND t.side='sell' THEN -t.curve_value ELSE 0 END) OVER (PARTITION BY lower(t.token_address) ORDER BY t.block_number,t.transaction_index,t.log_index,t.transaction_hash) reserve_balance
		FROM trades t JOIN chain_blocks b ON b.chain_id=t.chain_id AND b.block_hash=t.block_hash AND b.is_canonical
		WHERE t.chain_id=$1 AND t.is_canonical
	), priced AS (
		SELECT *,CASE WHEN source='uniswap_v3' THEN floor(reserve_amount * 1000000000000000000::numeric / NULLIF(token_amount,0))
			WHEN sold_supply >= 0 AND sold_supply < 1066666666666666666666666667::numeric AND reserve_balance >= 0
			THEN ceil(((1000000000000000000::numeric + reserve_balance) * 1000000000000000000::numeric) / (1066666666666666666666666667::numeric - sold_supply)) END price
		FROM ordered
	), totals AS (
		SELECT token_address,bucket_start,count(*) trade_count,count(*) FILTER (WHERE side='buy') buy_count,count(*) FILTER (WHERE side='sell') sell_count,
			coalesce(sum(CASE WHEN source='uniswap_v3' THEN reserve_amount ELSE curve_value END),0) volume,count(DISTINCT lower(trader_address)) unique_trader_count FROM priced GROUP BY token_address,bucket_start
	), latest AS (
		SELECT DISTINCT ON (token_address,bucket_start) * FROM priced ORDER BY token_address,bucket_start,block_number DESC,transaction_index DESC,log_index DESC,transaction_hash DESC
	), candles AS (
		SELECT token_address,bucket_start,
			CASE WHEN count(price)=count(*) THEN (array_agg(price ORDER BY block_number,transaction_index,log_index,transaction_hash))[1] END open_price,
			CASE WHEN count(price)=count(*) THEN max(price) END high_price,
			CASE WHEN count(price)=count(*) THEN min(price) END low_price,
			CASE WHEN count(price)=count(*) THEN (array_agg(price ORDER BY block_number DESC,transaction_index DESC,log_index DESC,transaction_hash DESC))[1] END close_price
		FROM priced GROUP BY token_address,bucket_start
	)
	INSERT INTO token_trade_buckets(chain_id,token_address,bucket_start,trade_count,buy_count,sell_count,volume,unique_trader_count,open_price,high_price,low_price,close_price,block_number,block_hash,transaction_hash,log_index)
	SELECT $1,t.token_address,t.bucket_start,t.trade_count,t.buy_count,t.sell_count,t.volume,t.unique_trader_count,c.open_price,c.high_price,c.low_price,c.close_price,l.block_number,l.block_hash,l.transaction_hash,l.log_index
	FROM totals t JOIN latest l USING(token_address,bucket_start) LEFT JOIN candles c USING(token_address,bucket_start)`, chain)
	return e
}
func insertEvent(ctx context.Context, tx pgx.Tx, chain int64, l types.Log, metadata map[string]TokenMetadata, senders map[common.Hash]common.Address, roots CTOProvenance) error {
	if len(l.Topics) == 0 {
		return nil
	}
	ev, decoderABI, decoderEvent, ctoKind, ok := selectedEvent(l.Topics[0])
	if ok && ctoKind != "" {
		if !isExactCTOEvent(ev) {
			return nil
		}
		trusted, err := trustedCTOEmitter(ctx, tx, chain, l.Address, ctoKind, roots)
		if err != nil {
			return err
		}
		if !trusted {
			return nil
		}
	}
	if !ok && l.Topics[0] == v3TradeABI.Events["TokensBought"].ID {
		ev, decoderABI, decoderEvent, ok = "TokensBoughtV3", v3TradeABI, "TokensBought", true
	}
	if !ok && l.Topics[0] == v3TradeABI.Events["TokensSold"].ID {
		ev, decoderABI, decoderEvent, ok = "TokensSoldV3", v3TradeABI, "TokensSold", true
	}
	if !ok && l.Topics[0] == v3GraduationABI.Events["GraduatedV3"].ID {
		ev, decoderABI, decoderEvent, ok = "GraduatedV3", v3GraduationABI, "GraduatedV3", true
	}
	if !ok {
		log.Printf("cooket-indexer: unknown event chain_id=%d contract=%s tx=%s block=%d log_index=%d topic=%s", chain, l.Address.Hex(), l.TxHash.Hex(), l.BlockNumber, l.Index, l.Topics[0].Hex())
		return nil
	}
	vals := map[string]any{}
	if e := decoderABI.UnpackIntoMap(vals, decoderEvent, l.Data); e != nil {
		return fmt.Errorf("decode %s: %w", ev, e)
	}
	if e := abi.ParseTopicsIntoMap(vals, indexedArguments(decoderABI.Events[decoderEvent].Inputs), l.Topics[1:]); e != nil {
		return fmt.Errorf("decode indexed %s: %w", ev, e)
	}
	raw, _ := json.Marshal(normalizedEventValues(vals))
	topics := make([]string, len(l.Topics))
	for i, t := range l.Topics {
		topics[i] = t.Hex()
	}
	tb, _ := json.Marshal(topics)
	eventData := l.Data
	if eventData == nil {
		eventData = []byte{}
	}
	_, e := tx.Exec(ctx, `INSERT INTO chain_events(chain_id,block_number,block_hash,transaction_hash,transaction_index,log_index,contract_address,topic0,topics,data,event_name,decoded) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(chain_id,transaction_hash,log_index) DO UPDATE SET block_number=excluded.block_number,block_hash=excluded.block_hash,transaction_index=excluded.transaction_index,contract_address=excluded.contract_address,topic0=excluded.topic0,topics=excluded.topics,data=excluded.data,event_name=excluded.event_name,decoded=excluded.decoded,is_canonical=true,orphaned_at=NULL`, chain, l.BlockNumber, l.BlockHash.Hex(), l.TxHash.Hex(), l.TxIndex, l.Index, l.Address.Hex(), l.Topics[0].Hex(), tb, eventData, ev, raw)
	if e != nil {
		return e
	}
	return projection(ctx, tx, chain, l, ev, vals, metadata, senders)
}

func selectedEvent(topic common.Hash) (string, abi.ABI, string, string, bool) {
	for _, candidate := range []struct {
		decoder abi.ABI
		kind    string
	}{
		{ctoRegistryABI, "registry"}, {feeManagerABI, "feeManager"}, {ctoTreasuryABI, "treasury"}, {contractABI, ""},
	} {
		for name, event := range candidate.decoder.Events {
			if event.ID != topic {
				continue
			}
			if candidate.kind != "" && !isExactCTOEvent(name) {
				continue
			}
			if candidate.kind == "" && name == "TokensBought" {
				return "TokensBoughtV3", candidate.decoder, name, "", true
			}
			if candidate.kind == "" && name == "TokensSold" {
				return "TokensSoldV3", candidate.decoder, name, "", true
			}
			return name, candidate.decoder, name, candidate.kind, true
		}
	}
	return "", abi.ABI{}, "", "", false
}

func indexedArguments(args abi.Arguments) abi.Arguments {
	out := make(abi.Arguments, 0, len(args))
	for _, arg := range args {
		if arg.Indexed {
			out = append(out, arg)
		}
	}
	return out
}

func str(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case common.Address:
		return x.Hex()
	case *big.Int:
		return x.String()
	case bool:
		if x {
			return "true"
		}
		return "false"
	}
	return fmt.Sprint(v)
}

func u(v any) string {
	if v == nil {
		return "0"
	}
	return str(v)
}
func projection(ctx context.Context, tx pgx.Tx, c int64, l types.Log, n string, v map[string]any, metadata map[string]TokenMetadata, senders map[common.Hash]common.Address) error {
	b := l.BlockHash.Hex()
	t := l.TxHash.Hex()
	i := l.Index
	if token := projectedTokenAddress(n, v); token != "" {
		var excluded bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM application_token_exclusions WHERE chain_id=$1 AND token_address=lower($2))`, c, token).Scan(&excluded); err != nil {
			return err
		}
		if excluded {
			return nil
		}
	}
	switch n {
	case "TokenLaunchedV3":
		m, ok := metadata[common.Address(v["token"].(common.Address)).Hex()]
		if !ok || m.Name == "" || m.Symbol == "" {
			return fmt.Errorf("missing ERC-20 metadata for v3 token %s", u(v["token"]))
		}
		// Presentation metadata is finalized by the API after the launch is indexed.
		// Preserve it only when a conflict still describes the same launch identity;
		// a reorg that changes identity must not carry metadata from the orphaned row.
		_, e := tx.Exec(ctx, `INSERT INTO tokens(chain_id,token_address,creator_address,name,symbol,initial_supply,protocol_version,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,$4,$5,$6,'endpoint-cp-v3',$7,$8,$9,$10)
			ON CONFLICT (chain_id,transaction_hash,log_index) DO UPDATE SET
				description=CASE WHEN lower(tokens.token_address)=lower(excluded.token_address) AND lower(tokens.creator_address)=lower(excluded.creator_address) AND tokens.name=excluded.name AND tokens.symbol=excluded.symbol AND tokens.initial_supply=excluded.initial_supply AND tokens.protocol_version=excluded.protocol_version THEN tokens.description ELSE NULL END,
				image_url=CASE WHEN lower(tokens.token_address)=lower(excluded.token_address) AND lower(tokens.creator_address)=lower(excluded.creator_address) AND tokens.name=excluded.name AND tokens.symbol=excluded.symbol AND tokens.initial_supply=excluded.initial_supply AND tokens.protocol_version=excluded.protocol_version THEN tokens.image_url ELSE NULL END,
				metadata_url=CASE WHEN lower(tokens.token_address)=lower(excluded.token_address) AND lower(tokens.creator_address)=lower(excluded.creator_address) AND tokens.name=excluded.name AND tokens.symbol=excluded.symbol AND tokens.initial_supply=excluded.initial_supply AND tokens.protocol_version=excluded.protocol_version THEN tokens.metadata_url ELSE NULL END,
				website_url=CASE WHEN lower(tokens.token_address)=lower(excluded.token_address) AND lower(tokens.creator_address)=lower(excluded.creator_address) AND tokens.name=excluded.name AND tokens.symbol=excluded.symbol AND tokens.initial_supply=excluded.initial_supply AND tokens.protocol_version=excluded.protocol_version THEN tokens.website_url ELSE NULL END,
				x_url=CASE WHEN lower(tokens.token_address)=lower(excluded.token_address) AND lower(tokens.creator_address)=lower(excluded.creator_address) AND tokens.name=excluded.name AND tokens.symbol=excluded.symbol AND tokens.initial_supply=excluded.initial_supply AND tokens.protocol_version=excluded.protocol_version THEN tokens.x_url ELSE NULL END,
				telegram_url=CASE WHEN lower(tokens.token_address)=lower(excluded.token_address) AND lower(tokens.creator_address)=lower(excluded.creator_address) AND tokens.name=excluded.name AND tokens.symbol=excluded.symbol AND tokens.initial_supply=excluded.initial_supply AND tokens.protocol_version=excluded.protocol_version THEN tokens.telegram_url ELSE NULL END,
				discord_url=CASE WHEN lower(tokens.token_address)=lower(excluded.token_address) AND lower(tokens.creator_address)=lower(excluded.creator_address) AND tokens.name=excluded.name AND tokens.symbol=excluded.symbol AND tokens.initial_supply=excluded.initial_supply AND tokens.protocol_version=excluded.protocol_version THEN tokens.discord_url ELSE NULL END,
				token_address=excluded.token_address,creator_address=excluded.creator_address,name=excluded.name,symbol=excluded.symbol,initial_supply=excluded.initial_supply,protocol_version='endpoint-cp-v3',block_number=excluded.block_number,block_hash=excluded.block_hash,is_canonical=true,orphaned_at=NULL`, c, u(v["token"]), u(v["creator"]), m.Name, m.Symbol, u(v["totalSupply"]), l.BlockNumber, b, t, i)
		if e != nil {
			return e
		}
		_, e = tx.Exec(ctx, `INSERT INTO curves(chain_id,token_address,curve_address,creator_address,curve_supply,starting_price,slope,graduation_threshold,lifecycle,canonical_pool_address,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,$4,$5,0,0,$5,'active',$6,$7,$8,$9,$10)
			ON CONFLICT (chain_id,transaction_hash,log_index) DO UPDATE SET token_address=excluded.token_address,curve_address=excluded.curve_address,creator_address=excluded.creator_address,curve_supply=excluded.curve_supply,graduation_threshold=excluded.graduation_threshold,lifecycle='active',canonical_pool_address=excluded.canonical_pool_address,block_number=excluded.block_number,block_hash=excluded.block_hash,is_canonical=true,orphaned_at=NULL`, c, u(v["token"]), u(v["curve"]), u(v["creator"]), u(v["curveAllocation"]), u(v["canonicalPool"]), l.BlockNumber, b, t, i)
		return e
	case "TokensBoughtV3", "TokensSoldV3":
		side := "buy"
		trader := v["buyer"]
		reserve := v["reserveIn"]
		value := v["curveCost"]
		tokenAmount := v["tokenAmount"]
		if n == "TokensBoughtV3" {
			tokenAmount = v["tokensOut"]
			reserve = v["acceptedGross"]
			value = v["netCurveInput"]
		}
		if n == "TokensSoldV3" {
			side = "sell"
			trader = v["seller"]
			tokenAmount = v["tokensIn"]
			reserve = v["netSellerOutput"]
			value = v["grossCurveOutput"]
		}
		_, e := tx.Exec(ctx, `INSERT INTO trades(chain_id,token_address,trader_address,side,token_amount,reserve_amount,curve_value,protocol_fee,creator_fee,source,transaction_index,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'curve',$10,$11,$12,$13,$14)
			ON CONFLICT (chain_id,transaction_hash,log_index) DO UPDATE SET token_address=excluded.token_address,trader_address=excluded.trader_address,side=excluded.side,token_amount=excluded.token_amount,reserve_amount=excluded.reserve_amount,curve_value=excluded.curve_value,protocol_fee=excluded.protocol_fee,creator_fee=excluded.creator_fee,source='curve',transaction_index=excluded.transaction_index,block_number=excluded.block_number,block_hash=excluded.block_hash,is_canonical=true,orphaned_at=NULL`, c, u(v["token"]), u(trader), side, u(tokenAmount), u(reserve), u(value), u(v["protocolFee"]), u(v["creatorFee"]), l.TxIndex, l.BlockNumber, b, t, i)
		if e != nil {
			return e
		}
		return nil
	case "Graduated":
		// V3 emits the graduation manager, forwarded native USDC, and terminal sold supply.
		_, e := tx.Exec(ctx, `INSERT INTO graduations(chain_id,token_address,phase,sold_supply,token_amount,graduation_manager_address,native_usdc_amount,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,'graduated',$3,$4,$5,$6,$7,$8,$9,$10)
			ON CONFLICT (chain_id,transaction_hash,log_index) DO UPDATE SET token_address=excluded.token_address,phase='graduated',sold_supply=excluded.sold_supply,reserve_balance=NULL,token_amount=excluded.token_amount,graduation_manager_address=excluded.graduation_manager_address,native_usdc_amount=excluded.native_usdc_amount,liquidity_token_address=NULL,quote_amount=NULL,liquidity_amount=NULL,lock_id=NULL,unlock_timestamp=NULL,block_number=excluded.block_number,block_hash=excluded.block_hash,is_canonical=true,orphaned_at=NULL`, c, u(v["token"]), u(v["soldSupply"]), u(v["tokenAmount"]), u(v["graduationManager"]), u(v["nativeUsdcAmount"]), l.BlockNumber, b, t, i)
		return e
	case "GraduatedV3":
		_, e := tx.Exec(ctx, `INSERT INTO liquidity_events(chain_id,token_address,event_name,graduation_manager_address,lp_custodian_address,position_token_id,liquidity_amount,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,'GraduatedV3',$3,$4,$5,$6,$7,$8,$9,$10)
			ON CONFLICT (chain_id,transaction_hash,log_index) DO UPDATE SET token_address=excluded.token_address,event_name='GraduatedV3',graduation_manager_address=excluded.graduation_manager_address,lp_custodian_address=excluded.lp_custodian_address,position_token_id=excluded.position_token_id,liquidity_amount=excluded.liquidity_amount,liquidity_token_address=NULL,amount=NULL,lock_id=NULL,beneficiary_address=NULL,unlock_timestamp=NULL,block_number=excluded.block_number,block_hash=excluded.block_hash,is_canonical=true,orphaned_at=NULL`, c, u(v["token"]), l.Address.Hex(), u(v["custodian"]), u(v["tokenId"]), u(v["liquidity"]), l.BlockNumber, b, t, i)
		return e
	}
	return nil
}

func projectedTokenAddress(event string, values map[string]any) string {
	if token, ok := values["token"]; ok {
		return u(token)
	}
	return ""
}
