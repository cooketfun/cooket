-- Phase D2a: canonical, replayable voluntary CTO v1 projections.
-- Metadata URI/hash values are untrusted event history and are never fetched.
-- Migration 009 is frozen committed history and still introduces eth_amount;
-- this migration is the only place that renames it to native_usdc_amount.

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='graduations' AND column_name='eth_amount')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='graduations' AND column_name='native_usdc_amount') THEN
        ALTER TABLE graduations RENAME COLUMN eth_amount TO native_usdc_amount;
    END IF;
END $$;

COMMENT ON COLUMN graduations.native_usdc_amount IS
    'Arc native-USDC principal forwarded by CooketCurveV3.Graduated.';
COMMENT ON COLUMN graduations.quote_amount IS
    'Deprecated generic field; endpoint-cp-v3 native-USDC principal is stored in native_usdc_amount.';
COMMENT ON COLUMN curves.canonical_pool_address IS
    'Canonical post-graduation pool emitted by endpoint-cp-v3 TokenLaunchedV3; execution remains disabled pending Phase E.';

UPDATE graduations g
SET native_usdc_amount = (e.decoded->>'nativeUsdcAmount')::NUMERIC(78,0)
FROM chain_events e
WHERE g.chain_id = e.chain_id
  AND g.transaction_hash = e.transaction_hash
  AND g.log_index = e.log_index
  AND g.is_canonical
  AND e.is_canonical
  AND e.event_name = 'Graduated'
  AND e.decoded->>'nativeUsdcAmount' IS NOT NULL;

CREATE TABLE cto_treasuries (
    chain_id BIGINT NOT NULL,
    registry_address TEXT NOT NULL CHECK (registry_address = lower(registry_address) AND registry_address ~ '^0x[0-9a-f]{40}$'),
    treasury_address TEXT NOT NULL CHECK (treasury_address = lower(treasury_address) AND treasury_address ~ '^0x[0-9a-f]{40}$'),
    token_address TEXT NOT NULL CHECK (token_address = lower(token_address) AND token_address ~ '^0x[0-9a-f]{40}$'),
    controller_address TEXT NOT NULL CHECK (controller_address = lower(controller_address) AND controller_address ~ '^0x[0-9a-f]{40}$'),
    canonical_usdc_address TEXT CHECK (canonical_usdc_address IS NULL OR (canonical_usdc_address = lower(canonical_usdc_address) AND canonical_usdc_address ~ '^0x[0-9a-f]{40}$')),
    token_nonce NUMERIC(20,0) NOT NULL CHECK (token_nonce >= 0 AND token_nonce <= 18446744073709551615),
    create2_salt TEXT NOT NULL CHECK (create2_salt ~ '^0x[0-9a-f]{64}$'),
    block_number BIGINT NOT NULL, block_hash TEXT NOT NULL, transaction_hash TEXT NOT NULL, log_index BIGINT NOT NULL,
    is_canonical BOOLEAN NOT NULL DEFAULT TRUE, orphaned_at TIMESTAMPTZ,
    PRIMARY KEY (chain_id, transaction_hash, log_index),
    FOREIGN KEY (chain_id, block_hash) REFERENCES chain_blocks(chain_id, block_hash)
);
CREATE UNIQUE INDEX cto_treasuries_canonical_address ON cto_treasuries(chain_id, treasury_address) WHERE is_canonical;
CREATE UNIQUE INDEX cto_treasuries_canonical_token_nonce ON cto_treasuries(chain_id, registry_address, token_address, token_nonce) WHERE is_canonical;

CREATE TABLE cto_proposals (
    chain_id BIGINT NOT NULL,
    registry_address TEXT NOT NULL CHECK (registry_address = lower(registry_address) AND registry_address ~ '^0x[0-9a-f]{40}$'),
    proposal_id TEXT NOT NULL CHECK (proposal_id ~ '^0x[0-9a-f]{64}$'),
    token_address TEXT NOT NULL CHECK (token_address = lower(token_address) AND token_address ~ '^0x[0-9a-f]{40}$'),
    treasury_address TEXT NOT NULL CHECK (treasury_address = lower(treasury_address) AND treasury_address ~ '^0x[0-9a-f]{40}$'),
    creator_address TEXT NOT NULL CHECK (creator_address = lower(creator_address) AND creator_address ~ '^0x[0-9a-f]{40}$'),
    controller_address TEXT NOT NULL CHECK (controller_address = lower(controller_address) AND controller_address ~ '^0x[0-9a-f]{40}$'),
    previous_recipient_address TEXT NOT NULL CHECK (previous_recipient_address = lower(previous_recipient_address) AND previous_recipient_address ~ '^0x[0-9a-f]{40}$'),
    metadata_hash TEXT NOT NULL CHECK (metadata_hash ~ '^0x[0-9a-f]{64}$'),
    metadata_uri TEXT NOT NULL CHECK (octet_length(metadata_uri) <= 256),
    token_nonce NUMERIC(20,0) NOT NULL CHECK (token_nonce >= 0 AND token_nonce <= 18446744073709551615),
    state TEXT NOT NULL CHECK (state IN ('proposed','accepted','cancelled','expired','active')),
    created_timestamp BIGINT NOT NULL,
    acceptance_deadline BIGINT NOT NULL,
    accepted_timestamp BIGINT,
    execute_after BIGINT,
    execute_deadline BIGINT,
    created_block_number BIGINT NOT NULL, created_block_hash TEXT NOT NULL, created_transaction_hash TEXT NOT NULL, created_log_index BIGINT NOT NULL,
    accepted_block_number BIGINT, accepted_block_hash TEXT, accepted_transaction_hash TEXT, accepted_log_index BIGINT,
    ready_block_number BIGINT, ready_block_hash TEXT, ready_transaction_hash TEXT, ready_log_index BIGINT,
    cancelled_block_number BIGINT, cancelled_block_hash TEXT, cancelled_transaction_hash TEXT, cancelled_log_index BIGINT,
    expired_block_number BIGINT, expired_block_hash TEXT, expired_transaction_hash TEXT, expired_log_index BIGINT,
    activated_block_number BIGINT, activated_block_hash TEXT, activated_transaction_hash TEXT, activated_log_index BIGINT,
    lifecycle_block_number BIGINT NOT NULL, lifecycle_block_hash TEXT NOT NULL, lifecycle_transaction_hash TEXT NOT NULL, lifecycle_log_index BIGINT NOT NULL,
    cancelled_timestamp BIGINT, expired_timestamp BIGINT, activated_timestamp BIGINT,
    is_canonical BOOLEAN NOT NULL DEFAULT TRUE, orphaned_at TIMESTAMPTZ,
    PRIMARY KEY (chain_id, registry_address, proposal_id),
    FOREIGN KEY (chain_id, created_block_hash) REFERENCES chain_blocks(chain_id, block_hash),
    FOREIGN KEY (chain_id, lifecycle_block_hash) REFERENCES chain_blocks(chain_id, block_hash)
);
CREATE INDEX cto_proposals_canonical_token_history ON cto_proposals(chain_id, token_address, token_nonce DESC) WHERE is_canonical;
CREATE UNIQUE INDEX cto_proposals_canonical_token_nonce ON cto_proposals(chain_id, registry_address, token_address, token_nonce) WHERE is_canonical;
CREATE INDEX cto_proposals_canonical_creator_history ON cto_proposals(chain_id, creator_address, created_block_number DESC) WHERE is_canonical;
CREATE INDEX cto_proposals_canonical_executable ON cto_proposals(chain_id, execute_after, execute_deadline) WHERE is_canonical AND state='accepted';

CREATE TABLE cto_token_state (
    chain_id BIGINT NOT NULL,
    fee_manager_address TEXT NOT NULL CHECK (fee_manager_address = lower(fee_manager_address) AND fee_manager_address ~ '^0x[0-9a-f]{40}$'),
    token_address TEXT NOT NULL CHECK (token_address = lower(token_address) AND token_address ~ '^0x[0-9a-f]{40}$'),
    registry_address TEXT NOT NULL CHECK (registry_address = lower(registry_address) AND registry_address ~ '^0x[0-9a-f]{40}$'),
    active BOOLEAN NOT NULL DEFAULT FALSE,
    treasury_address TEXT CHECK (treasury_address IS NULL OR (treasury_address = lower(treasury_address) AND treasury_address ~ '^0x[0-9a-f]{40}$')),
    proposal_id TEXT CHECK (proposal_id IS NULL OR proposal_id ~ '^0x[0-9a-f]{64}$'),
    previous_recipient_address TEXT CHECK (previous_recipient_address IS NULL OR (previous_recipient_address = lower(previous_recipient_address) AND previous_recipient_address ~ '^0x[0-9a-f]{40}$')),
    block_number BIGINT NOT NULL, block_hash TEXT NOT NULL, transaction_hash TEXT NOT NULL, log_index BIGINT NOT NULL,
    is_canonical BOOLEAN NOT NULL DEFAULT TRUE, orphaned_at TIMESTAMPTZ,
    PRIMARY KEY (chain_id, fee_manager_address, token_address),
    FOREIGN KEY (chain_id, block_hash) REFERENCES chain_blocks(chain_id, block_hash)
);
CREATE INDEX cto_token_state_canonical_status ON cto_token_state(chain_id, token_address, active) WHERE is_canonical;

CREATE TABLE cto_creator_fee_checkpoint_ledger (
    chain_id BIGINT NOT NULL, transaction_hash TEXT NOT NULL, log_index BIGINT NOT NULL,
    fee_manager_address TEXT NOT NULL CHECK (fee_manager_address = lower(fee_manager_address) AND fee_manager_address ~ '^0x[0-9a-f]{40}$'),
    token_address TEXT NOT NULL CHECK (token_address = lower(token_address) AND token_address ~ '^0x[0-9a-f]{40}$'),
    recipient_address TEXT NOT NULL CHECK (recipient_address = lower(recipient_address) AND recipient_address ~ '^0x[0-9a-f]{40}$'),
    action TEXT NOT NULL CHECK (action IN ('checkpoint','claim')),
    amount NUMERIC(78,0) NOT NULL CHECK (amount >= 0),
    triggered_by_address TEXT CHECK (triggered_by_address IS NULL OR (triggered_by_address = lower(triggered_by_address) AND triggered_by_address ~ '^0x[0-9a-f]{40}$')),
    block_number BIGINT NOT NULL, block_hash TEXT NOT NULL, is_canonical BOOLEAN NOT NULL DEFAULT TRUE, orphaned_at TIMESTAMPTZ,
    PRIMARY KEY (chain_id, transaction_hash, log_index),
    FOREIGN KEY (chain_id, block_hash) REFERENCES chain_blocks(chain_id, block_hash)
);
CREATE INDEX cto_checkpoint_ledger_canonical_lookup ON cto_creator_fee_checkpoint_ledger(chain_id, token_address, recipient_address, block_number DESC, log_index DESC) WHERE is_canonical;

CREATE TABLE cto_supported_assets (
    chain_id BIGINT NOT NULL,
    treasury_address TEXT NOT NULL CHECK (treasury_address = lower(treasury_address) AND treasury_address ~ '^0x[0-9a-f]{40}$'),
    asset_address TEXT NOT NULL CHECK (asset_address = lower(asset_address) AND asset_address ~ '^0x[0-9a-f]{40}$'),
    controller_address TEXT NOT NULL CHECK (controller_address = lower(controller_address) AND controller_address ~ '^0x[0-9a-f]{40}$'),
    block_number BIGINT NOT NULL, block_hash TEXT NOT NULL, transaction_hash TEXT NOT NULL, log_index BIGINT NOT NULL,
    is_canonical BOOLEAN NOT NULL DEFAULT TRUE, orphaned_at TIMESTAMPTZ,
    PRIMARY KEY (chain_id, transaction_hash, log_index),
    FOREIGN KEY (chain_id, block_hash) REFERENCES chain_blocks(chain_id, block_hash)
);
CREATE UNIQUE INDEX cto_supported_assets_canonical_asset ON cto_supported_assets(chain_id, treasury_address, asset_address) WHERE is_canonical;

CREATE TABLE cto_treasury_transfers (
    chain_id BIGINT NOT NULL, transaction_hash TEXT NOT NULL, log_index BIGINT NOT NULL,
    treasury_address TEXT NOT NULL CHECK (treasury_address = lower(treasury_address) AND treasury_address ~ '^0x[0-9a-f]{40}$'),
    asset_address TEXT NOT NULL CHECK (asset_address = lower(asset_address) AND asset_address ~ '^0x[0-9a-f]{40}$'),
    recipient_address TEXT NOT NULL CHECK (recipient_address = lower(recipient_address) AND recipient_address ~ '^0x[0-9a-f]{40}$'),
    amount NUMERIC(78,0) NOT NULL CHECK (amount > 0),
    controller_address TEXT NOT NULL CHECK (controller_address = lower(controller_address) AND controller_address ~ '^0x[0-9a-f]{40}$'),
    block_number BIGINT NOT NULL, block_hash TEXT NOT NULL, is_canonical BOOLEAN NOT NULL DEFAULT TRUE, orphaned_at TIMESTAMPTZ,
    PRIMARY KEY (chain_id, transaction_hash, log_index),
    FOREIGN KEY (chain_id, block_hash) REFERENCES chain_blocks(chain_id, block_hash)
);
CREATE INDEX cto_treasury_transfers_canonical_history ON cto_treasury_transfers(chain_id, treasury_address, block_number DESC, log_index DESC) WHERE is_canonical;

CREATE TABLE cto_fee_pulls (
    chain_id BIGINT NOT NULL, transaction_hash TEXT NOT NULL, log_index BIGINT NOT NULL,
    treasury_address TEXT NOT NULL CHECK (treasury_address = lower(treasury_address) AND treasury_address ~ '^0x[0-9a-f]{40}$'),
    token_address TEXT NOT NULL CHECK (token_address = lower(token_address) AND token_address ~ '^0x[0-9a-f]{40}$'),
    asset_address TEXT NOT NULL CHECK (asset_address = lower(asset_address) AND asset_address ~ '^0x[0-9a-f]{40}$'),
    amount NUMERIC(78,0) NOT NULL CHECK (amount > 0),
    triggered_by_address TEXT NOT NULL CHECK (triggered_by_address = lower(triggered_by_address) AND triggered_by_address ~ '^0x[0-9a-f]{40}$'),
    block_number BIGINT NOT NULL, block_hash TEXT NOT NULL, is_canonical BOOLEAN NOT NULL DEFAULT TRUE, orphaned_at TIMESTAMPTZ,
    PRIMARY KEY (chain_id, transaction_hash, log_index),
    FOREIGN KEY (chain_id, block_hash) REFERENCES chain_blocks(chain_id, block_hash)
);
CREATE INDEX cto_fee_pulls_canonical_history ON cto_fee_pulls(chain_id, treasury_address, block_number DESC, log_index DESC) WHERE is_canonical;

DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='graduations' AND column_name='eth_amount'
    ) THEN
        RAISE EXCEPTION '012 did not remove graduations.eth_amount';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='graduations' AND column_name='native_usdc_amount'
    ) THEN
        RAISE EXCEPTION '012 did not produce graduations.native_usdc_amount';
    END IF;
END $$;
