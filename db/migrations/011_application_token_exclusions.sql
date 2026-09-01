-- Explicit, reversible application-only exclusions for exceptional launch cleanup.
-- Canonical chain_blocks and chain_events remain untouched. The indexer consults
-- this table before projecting a decoded event, so a deterministic replay cannot
-- accidentally restore an excluded token to public derived state.
CREATE TABLE IF NOT EXISTS application_token_exclusions (
    chain_id BIGINT NOT NULL,
    token_address TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, token_address),
    CHECK (token_address ~ '^0x[0-9a-f]{40}$'),
    CHECK (token_address = lower(token_address)),
    CHECK (length(trim(reason)) > 0)
);

COMMENT ON TABLE application_token_exclusions IS
    'Narrow application projection exclusions. This never deletes or changes onchain state or canonical raw chain provenance.';
