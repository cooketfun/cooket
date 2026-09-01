-- Phase 4: canonical chain data and replayable projections.
CREATE TABLE IF NOT EXISTS chain_blocks (
    chain_id BIGINT NOT NULL,
    block_number BIGINT NOT NULL,
    block_hash TEXT NOT NULL,
    parent_hash TEXT NOT NULL,
    block_timestamp BIGINT NOT NULL,
    is_canonical BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    orphaned_at TIMESTAMPTZ,
    PRIMARY KEY (chain_id, block_hash),
    UNIQUE (chain_id, block_number, block_hash)
);
CREATE UNIQUE INDEX IF NOT EXISTS chain_blocks_one_canonical_height
    ON chain_blocks(chain_id, block_number) WHERE is_canonical;

CREATE TABLE IF NOT EXISTS chain_events (
    id BIGSERIAL PRIMARY KEY,
    chain_id BIGINT NOT NULL,
    block_number BIGINT NOT NULL,
    block_hash TEXT NOT NULL,
    transaction_hash TEXT NOT NULL,
    log_index BIGINT NOT NULL,
    contract_address TEXT NOT NULL,
    topic0 TEXT NOT NULL,
    topics JSONB NOT NULL DEFAULT '[]',
    data BYTEA NOT NULL DEFAULT ''::bytea,
    event_name TEXT NOT NULL,
    decoded JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_canonical BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    orphaned_at TIMESTAMPTZ,
    UNIQUE (chain_id, transaction_hash, log_index)
);
CREATE INDEX IF NOT EXISTS chain_events_canonical_block ON chain_events(chain_id, block_number) WHERE is_canonical;
CREATE INDEX IF NOT EXISTS chain_events_name ON chain_events(chain_id, event_name) WHERE is_canonical;

CREATE TABLE IF NOT EXISTS indexer_checkpoints (
    chain_id BIGINT NOT NULL,
    indexer_name TEXT NOT NULL,
    last_block_number BIGINT NOT NULL,
    last_block_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, indexer_name)
);

CREATE TABLE IF NOT EXISTS tokens (
    chain_id BIGINT NOT NULL, token_address TEXT NOT NULL, creator_address TEXT NOT NULL,
    name TEXT NOT NULL, symbol TEXT NOT NULL, initial_supply NUMERIC(78,0) NOT NULL,
    block_number BIGINT NOT NULL, block_hash TEXT NOT NULL, transaction_hash TEXT NOT NULL, log_index BIGINT NOT NULL,
    is_canonical BOOLEAN NOT NULL DEFAULT TRUE, PRIMARY KEY (chain_id, token_address, transaction_hash, log_index)
);
CREATE TABLE IF NOT EXISTS curves (
    chain_id BIGINT NOT NULL, token_address TEXT NOT NULL, curve_address TEXT NOT NULL,
    creator_address TEXT, curve_supply NUMERIC(78,0), sold_supply NUMERIC(78,0) NOT NULL DEFAULT 0,
    reserve_balance NUMERIC(78,0) NOT NULL DEFAULT 0, starting_price NUMERIC(78,0), slope NUMERIC(78,0), graduation_threshold NUMERIC(78,0), lifecycle TEXT,
    block_number BIGINT NOT NULL, block_hash TEXT NOT NULL, transaction_hash TEXT NOT NULL, log_index BIGINT NOT NULL,
    is_canonical BOOLEAN NOT NULL DEFAULT TRUE, PRIMARY KEY (chain_id, token_address, transaction_hash, log_index)
);
CREATE TABLE IF NOT EXISTS trades (
    chain_id BIGINT NOT NULL, token_address TEXT NOT NULL, trader_address TEXT NOT NULL, side TEXT NOT NULL,
    token_amount NUMERIC(78,0) NOT NULL, reserve_amount NUMERIC(78,0) NOT NULL, curve_value NUMERIC(78,0) NOT NULL,
    protocol_fee NUMERIC(78,0) NOT NULL, creator_fee NUMERIC(78,0) NOT NULL,
    block_number BIGINT NOT NULL, block_hash TEXT NOT NULL, transaction_hash TEXT NOT NULL, log_index BIGINT NOT NULL,
    is_canonical BOOLEAN NOT NULL DEFAULT TRUE, PRIMARY KEY (chain_id, transaction_hash, log_index)
);
CREATE TABLE IF NOT EXISTS fees (
    chain_id BIGINT NOT NULL, token_address TEXT, creator_address TEXT, fee_kind TEXT NOT NULL,
    protocol_fee NUMERIC(78,0) NOT NULL DEFAULT 0, creator_fee NUMERIC(78,0) NOT NULL DEFAULT 0, amount NUMERIC(78,0) NOT NULL DEFAULT 0,
    block_number BIGINT NOT NULL, block_hash TEXT NOT NULL, transaction_hash TEXT NOT NULL, log_index BIGINT NOT NULL,
    is_canonical BOOLEAN NOT NULL DEFAULT TRUE, PRIMARY KEY (chain_id, transaction_hash, log_index)
);
CREATE TABLE IF NOT EXISTS graduations (
    chain_id BIGINT NOT NULL, token_address TEXT NOT NULL, liquidity_token_address TEXT, phase TEXT NOT NULL,
    sold_supply NUMERIC(78,0), reserve_balance NUMERIC(78,0), token_amount NUMERIC(78,0), quote_amount NUMERIC(78,0), liquidity_amount NUMERIC(78,0), lock_id NUMERIC(78,0), unlock_timestamp BIGINT,
    block_number BIGINT NOT NULL, block_hash TEXT NOT NULL, transaction_hash TEXT NOT NULL, log_index BIGINT NOT NULL,
    is_canonical BOOLEAN NOT NULL DEFAULT TRUE, PRIMARY KEY (chain_id, transaction_hash, log_index)
);
CREATE TABLE IF NOT EXISTS liquidity_events (
    chain_id BIGINT NOT NULL, token_address TEXT, liquidity_token_address TEXT, event_name TEXT NOT NULL,
    amount NUMERIC(78,0), lock_id NUMERIC(78,0), beneficiary_address TEXT, unlock_timestamp BIGINT,
    block_number BIGINT NOT NULL, block_hash TEXT NOT NULL, transaction_hash TEXT NOT NULL, log_index BIGINT NOT NULL,
    is_canonical BOOLEAN NOT NULL DEFAULT TRUE, PRIMARY KEY (chain_id, transaction_hash, log_index)
);
CREATE TABLE IF NOT EXISTS token_metrics (
    chain_id BIGINT NOT NULL, token_address TEXT NOT NULL, trade_count BIGINT NOT NULL DEFAULT 0,
    buy_count BIGINT NOT NULL DEFAULT 0, sell_count BIGINT NOT NULL DEFAULT 0, volume NUMERIC(78,0) NOT NULL DEFAULT 0,
    fees NUMERIC(78,0) NOT NULL DEFAULT 0, block_number BIGINT NOT NULL DEFAULT 0, block_hash TEXT NOT NULL DEFAULT '', transaction_hash TEXT NOT NULL DEFAULT '', log_index BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (chain_id, token_address)
);

DO $$
DECLARE
    relation_name TEXT;
    constraint_name TEXT;
BEGIN
    FOREACH relation_name IN ARRAY ARRAY['chain_events','tokens','curves','trades','fees','graduations','liquidity_events'] LOOP
        constraint_name := relation_name || '_block_fk';
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = constraint_name) THEN
            EXECUTE format(
                'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (chain_id, block_hash) REFERENCES chain_blocks(chain_id, block_hash)',
                relation_name,
                constraint_name
            );
        END IF;
    END LOOP;
END $$;
