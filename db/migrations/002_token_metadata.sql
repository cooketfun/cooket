-- Phase 7: off-chain presentation metadata, finalized only against canonical TokenCreated data.
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS metadata_url TEXT;

CREATE TABLE IF NOT EXISTS token_metadata_drafts (
    draft_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    symbol TEXT NOT NULL,
    initial_supply NUMERIC(78,0) NOT NULL,
    description TEXT NOT NULL,
    image_url TEXT NOT NULL,
    metadata_url TEXT NOT NULL,
    token_address TEXT,
    transaction_hash TEXT,
    finalized_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
