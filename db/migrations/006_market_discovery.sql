-- V3-only market discovery projections. Recent metrics use the trailing 24
-- whole hours from the latest canonical indexed block timestamp, not wall time,
-- so ranking is deterministic during replay and reorg recovery.

ALTER TABLE token_metrics RENAME COLUMN market_cap TO fully_diluted_value;
ALTER TABLE token_metrics ADD COLUMN recent_volume NUMERIC(78,0) NOT NULL DEFAULT 0;
ALTER TABLE token_metrics ADD COLUMN recent_trade_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE token_metrics ADD COLUMN recent_trader_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE token_metrics ADD COLUMN recent_window_start BIGINT;

COMMENT ON COLUMN token_metrics.fully_diluted_value IS
    'V3 price in wei per whole token multiplied by fixed total supply, divided by 1e18. This is FDV, not circulating market cap.';
COMMENT ON COLUMN token_metrics.recent_window_start IS
    'UTC epoch seconds for the deterministic 24-hour ranking window anchored to the latest canonical block.';
COMMENT ON COLUMN token_trade_buckets.close_price IS
    'Nullable V3 close price in wei per whole token after the bucket final canonical trade; never a present-day price.';

-- Discovery search intentionally uses normalized prefix matching. It is bounded
-- by the API and supports the deterministic btree indexes below without a
-- database extension dependency.
CREATE INDEX IF NOT EXISTS tokens_search_name_prefix
    ON tokens(chain_id, lower(name), block_number DESC, token_address ASC) WHERE is_canonical;
CREATE INDEX IF NOT EXISTS tokens_search_symbol_prefix
    ON tokens(chain_id, lower(symbol), block_number DESC, token_address ASC) WHERE is_canonical;
CREATE INDEX IF NOT EXISTS tokens_search_address_prefix
    ON tokens(chain_id, lower(token_address), block_number DESC) WHERE is_canonical;
CREATE INDEX IF NOT EXISTS token_metrics_trending_recent
    ON token_metrics(chain_id, recent_volume DESC, recent_trade_count DESC, recent_trader_count DESC);
