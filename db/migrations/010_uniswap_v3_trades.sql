-- Phase 10C.2: preserve venue and canonical chain position for post-graduation trades.
-- Deployment requirement: the DEFAULT 0 values below are only a compatibility
-- value for historical rows. Migration 010 cannot derive a historical
-- transaction index from the stored transaction hash. After applying this
-- migration, stop the indexer/API consumers and deterministically replay the
-- affected canonical range from RPC so every event/trade is rewritten from
-- types.Log.TxIndex before serving ordered history. Never invent ordering from
-- transaction-hash lexicographic order.
ALTER TABLE chain_events ADD COLUMN IF NOT EXISTS transaction_index BIGINT NOT NULL DEFAULT 0;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'curve';
ALTER TABLE trades ADD COLUMN IF NOT EXISTS transaction_index BIGINT NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trades_source_check') THEN
        ALTER TABLE trades ADD CONSTRAINT trades_source_check CHECK (source IN ('curve', 'uniswap_v3'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS trades_canonical_position
    ON trades(chain_id, token_address, block_number, transaction_index, log_index)
    WHERE is_canonical;
