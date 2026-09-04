-- Canonical Cooket tokens are verified 18-decimal ERC-20s. Persisting this
-- launch metadata makes ERC-20 USDC/token chart normalization explicit.
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS token_decimals SMALLINT NOT NULL DEFAULT 18;
ALTER TABLE tokens ADD CONSTRAINT tokens_token_decimals_check CHECK (token_decimals = 18);
COMMENT ON COLUMN tokens.token_decimals IS 'Verified ERC-20 decimals; Cooket V3 requires 18.';
COMMENT ON COLUMN trades.reserve_amount IS 'Curve: native USDC (18 decimals). Uniswap V3: canonical ERC-20 USDC (6 decimals).';
