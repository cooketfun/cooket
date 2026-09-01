-- Atomic Option A launches. Existing indexed contracts and tokens remain visible
-- but are explicitly classified as legacy test assets.
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS protocol_version TEXT NOT NULL DEFAULT 'legacy-v1';
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE tokens ADD COLUMN IF NOT EXISTS orphaned_at TIMESTAMPTZ;
ALTER TABLE curves ADD COLUMN IF NOT EXISTS orphaned_at TIMESTAMPTZ;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS orphaned_at TIMESTAMPTZ;
ALTER TABLE fees ADD COLUMN IF NOT EXISTS orphaned_at TIMESTAMPTZ;
ALTER TABLE graduations ADD COLUMN IF NOT EXISTS orphaned_at TIMESTAMPTZ;
ALTER TABLE liquidity_events ADD COLUMN IF NOT EXISTS orphaned_at TIMESTAMPTZ;

UPDATE tokens SET protocol_version = 'legacy-v1', is_legacy = TRUE
WHERE protocol_version IS NULL OR protocol_version = '';

-- Event-backed projections use the same identity as chain_events. This permits
-- a transaction/log to be re-included after a reorg with entirely new decoded
-- values without leaving a second canonical projection behind.
ALTER TABLE tokens DROP CONSTRAINT IF EXISTS tokens_pkey;
ALTER TABLE tokens ADD CONSTRAINT tokens_pkey PRIMARY KEY (chain_id, transaction_hash, log_index);
ALTER TABLE curves DROP CONSTRAINT IF EXISTS curves_pkey;
ALTER TABLE curves ADD CONSTRAINT curves_pkey PRIMARY KEY (chain_id, transaction_hash, log_index);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tokens_protocol_compatibility_check') THEN
        ALTER TABLE tokens ADD CONSTRAINT tokens_protocol_compatibility_check CHECK (
            (is_legacy AND protocol_version = 'legacy-v1') OR
            (NOT is_legacy AND protocol_version IN ('option-a-v2', 'endpoint-cp-v3'))
        );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS tokens_protocol_compatibility
    ON tokens(chain_id, protocol_version, is_legacy) WHERE is_canonical;
