-- Bind pending metadata claims to a proven wallet signer and make holder-first
-- portfolio reads scale independently of the number of Cooket tokens.
ALTER TABLE token_metadata_drafts ADD COLUMN IF NOT EXISTS creator_address TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS token_metadata_drafts_launch_creator_claim
    ON token_metadata_drafts(lower(token_address), lower(transaction_hash), lower(creator_address))
    WHERE token_address IS NOT NULL AND transaction_hash IS NOT NULL AND creator_address IS NOT NULL;

CREATE INDEX IF NOT EXISTS token_holder_balances_holder_positive
    ON token_holder_balances(chain_id, lower(holder_address), lower(token_address))
    WHERE balance > 0;
