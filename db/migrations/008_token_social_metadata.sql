-- Optional presentation metadata. These fields are finalized through the same
-- canonical launch handshake as the existing description and image metadata.
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS website_url TEXT;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS x_url TEXT;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS telegram_url TEXT;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS discord_url TEXT;

ALTER TABLE token_metadata_drafts ADD COLUMN IF NOT EXISTS website_url TEXT;
ALTER TABLE token_metadata_drafts ADD COLUMN IF NOT EXISTS x_url TEXT;
ALTER TABLE token_metadata_drafts ADD COLUMN IF NOT EXISTS telegram_url TEXT;
ALTER TABLE token_metadata_drafts ADD COLUMN IF NOT EXISTS discord_url TEXT;
