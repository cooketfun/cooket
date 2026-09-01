-- Phase 9A: canonical, replayable analytics projections.
-- Amounts are uint256-compatible NUMERIC values. Hour buckets are UTC epoch hours.

CREATE TABLE IF NOT EXISTS token_holder_balances (
    chain_id BIGINT NOT NULL,
    token_address TEXT NOT NULL,
    holder_address TEXT NOT NULL,
    balance NUMERIC(78,0) NOT NULL CHECK (balance >= 0),
    block_number BIGINT NOT NULL,
    block_hash TEXT NOT NULL,
    transaction_hash TEXT NOT NULL,
    log_index BIGINT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, token_address, holder_address),
    FOREIGN KEY (chain_id, block_hash) REFERENCES chain_blocks(chain_id, block_hash)
);
CREATE INDEX IF NOT EXISTS token_holder_balances_positive
    ON token_holder_balances(chain_id, token_address) WHERE balance > 0;

ALTER TABLE token_metrics ADD COLUMN IF NOT EXISTS unique_trader_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE token_metrics ADD COLUMN IF NOT EXISTS holder_count BIGINT;
ALTER TABLE token_metrics ADD COLUMN IF NOT EXISTS current_price NUMERIC(78,0);
ALTER TABLE token_metrics ADD COLUMN IF NOT EXISTS market_cap NUMERIC(78,0);
ALTER TABLE token_metrics ADD COLUMN IF NOT EXISTS latest_trade_timestamp BIGINT;

CREATE TABLE IF NOT EXISTS token_trade_buckets (
    chain_id BIGINT NOT NULL,
    token_address TEXT NOT NULL,
    bucket_start BIGINT NOT NULL,
    trade_count BIGINT NOT NULL DEFAULT 0,
    buy_count BIGINT NOT NULL DEFAULT 0,
    sell_count BIGINT NOT NULL DEFAULT 0,
    volume NUMERIC(78,0) NOT NULL DEFAULT 0,
    unique_trader_count BIGINT NOT NULL DEFAULT 0,
    close_price NUMERIC(78,0),
    block_number BIGINT NOT NULL DEFAULT 0,
    block_hash TEXT NOT NULL DEFAULT '',
    transaction_hash TEXT NOT NULL DEFAULT '',
    log_index BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, token_address, bucket_start)
);
COMMENT ON COLUMN token_trade_buckets.close_price IS
    'Intentionally nullable: Phase 9A does not derive historical curve state at each bucket close. Never substitute current price.';
CREATE INDEX IF NOT EXISTS token_trade_buckets_recent
    ON token_trade_buckets(chain_id, token_address, bucket_start DESC);
CREATE INDEX IF NOT EXISTS token_metrics_discovery
    ON token_metrics(chain_id, trade_count DESC, volume DESC);
