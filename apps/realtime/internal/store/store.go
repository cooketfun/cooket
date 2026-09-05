package store

import (
	"context"
	"fmt"
	"strings"

	"github.com/cooketfun/cooket/apps/realtime/internal/market"
	"github.com/ethereum/go-ethereum/common"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	pool *pgxpool.Pool
}

func Open(ctx context.Context, databaseURL string) (*Store, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("configure PostgreSQL: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("connect to PostgreSQL: %w", err)
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close() {
	s.pool.Close()
}

// Markets reads canonical projections maintained by the existing indexer. It
// never writes lifecycle state or creates an independent persistence model.
func (s *Store) Markets(ctx context.Context, chainID int64) ([]market.Market, error) {
	rows, err := s.pool.Query(ctx, `WITH latest_tokens AS (
		SELECT DISTINCT ON (lower(token_address)) lower(token_address) token_address
		FROM tokens WHERE chain_id=$1 AND is_canonical
		ORDER BY lower(token_address),block_number DESC,log_index DESC
	), latest_curves AS (
		SELECT DISTINCT ON (lower(token_address)) lower(token_address) token_address,lower(curve_address) curve_address,
			coalesce(lower(canonical_pool_address),'') canonical_pool_address,coalesce(lifecycle,'active') lifecycle,block_number curve_start_block
		FROM curves WHERE chain_id=$1 AND is_canonical
		ORDER BY lower(token_address),block_number DESC,log_index DESC
	), latest_graduations AS (
		SELECT DISTINCT ON (lower(token_address)) lower(token_address) token_address,block_number graduation_block
		FROM graduations WHERE chain_id=$1 AND is_canonical AND phase='graduated'
		ORDER BY lower(token_address),block_number DESC,log_index DESC
	)
	SELECT t.token_address,c.curve_address,c.canonical_pool_address,
		CASE WHEN c.lifecycle='graduated' OR EXISTS (
			SELECT 1 FROM latest_graduations g WHERE g.token_address=t.token_address
		) THEN 'graduated' ELSE 'curve' END stage,
		CASE WHEN c.lifecycle='graduated' OR g.graduation_block IS NOT NULL THEN g.graduation_block ELSE c.curve_start_block END source_start_block
	FROM latest_tokens t JOIN latest_curves c USING(token_address)
	LEFT JOIN latest_graduations g USING(token_address)
	ORDER BY t.token_address`, chainID)
	if err != nil {
		return nil, fmt.Errorf("query canonical Cooket markets: %w", err)
	}
	defer rows.Close()

	markets := []market.Market{}
	for rows.Next() {
		var tokenValue, curveValue, poolValue, stageValue string
		var sourceStartBlock uint64
		if err := rows.Scan(&tokenValue, &curveValue, &poolValue, &stageValue, &sourceStartBlock); err != nil {
			return nil, err
		}
		token, err := address("token", tokenValue)
		if err != nil {
			return nil, err
		}
		curve, err := address("curve", curveValue)
		if err != nil {
			return nil, err
		}
		pool := common.Address{}
		if strings.TrimSpace(poolValue) != "" {
			pool, err = address("canonical pool", poolValue)
			if err != nil {
				return nil, err
			}
		}
		entry := market.Market{Token: token, Curve: curve, CanonicalPool: pool, Stage: market.Stage(stageValue), SourceStartBlock: sourceStartBlock}
		if err := entry.Validate(); err != nil {
			return nil, err
		}
		markets = append(markets, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return markets, nil
}

func address(label, value string) (common.Address, error) {
	if !common.IsHexAddress(value) {
		return common.Address{}, fmt.Errorf("canonical %s is not an address: %q", label, value)
	}
	parsed := common.HexToAddress(value)
	if parsed == (common.Address{}) {
		return common.Address{}, fmt.Errorf("canonical %s is zero", label)
	}
	return parsed, nil
}
