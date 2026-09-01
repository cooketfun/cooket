-- Phase 10A: explicit endpoint-cp-v3 curve graduation and external LP settlement data.
-- Historical generic liquidity columns remain for compatibility but are not
-- authoritative for endpoint-cp-v3.

ALTER TABLE curves ADD COLUMN IF NOT EXISTS canonical_pool_address TEXT;

ALTER TABLE graduations ADD COLUMN IF NOT EXISTS graduation_manager_address TEXT;
ALTER TABLE graduations ADD COLUMN IF NOT EXISTS eth_amount NUMERIC(78,0);

ALTER TABLE liquidity_events ADD COLUMN IF NOT EXISTS graduation_manager_address TEXT;
ALTER TABLE liquidity_events ADD COLUMN IF NOT EXISTS lp_custodian_address TEXT;
ALTER TABLE liquidity_events ADD COLUMN IF NOT EXISTS position_token_id NUMERIC(78,0);
ALTER TABLE liquidity_events ADD COLUMN IF NOT EXISTS liquidity_amount NUMERIC(78,0);

COMMENT ON COLUMN curves.canonical_pool_address IS
    'Canonical token/WETH Uniswap V3 pool emitted by endpoint-cp-v3 TokenLaunchedV3.';
COMMENT ON COLUMN graduations.graduation_manager_address IS
    'GraduationManagerV3 address emitted by the curve Graduated event.';
COMMENT ON COLUMN graduations.eth_amount IS
    'Native ETH principal forwarded by the curve Graduated event.';
COMMENT ON COLUMN graduations.liquidity_token_address IS
    'Deprecated generic field; never use as the endpoint-cp-v3 graduation manager, pool, custodian, or LP NFT.';
COMMENT ON COLUMN graduations.quote_amount IS
    'Deprecated generic field; endpoint-cp-v3 ETH principal is stored in eth_amount.';
COMMENT ON COLUMN graduations.lock_id IS
    'Deprecated generic field; an endpoint-cp-v3 Uniswap position token ID is not a lock ID.';
COMMENT ON COLUMN graduations.unlock_timestamp IS
    'Deprecated generic field; endpoint-cp-v3 LP custody is permanent and has no unlock timestamp.';
COMMENT ON COLUMN liquidity_events.graduation_manager_address IS
    'Emitter of the canonical endpoint-cp-v3 GraduatedV3 settlement event.';
COMMENT ON COLUMN liquidity_events.lp_custodian_address IS
    'Permanent custodian that owns and binds the endpoint-cp-v3 Uniswap V3 LP NFT.';
COMMENT ON COLUMN liquidity_events.position_token_id IS
    'Uniswap V3 nonfungible position token ID emitted by GraduatedV3.';
COMMENT ON COLUMN liquidity_events.liquidity_amount IS
    'Exact uint128 Uniswap V3 liquidity emitted by GraduatedV3.';

-- Backfill only values already proven by canonical raw events. Concrete LP
-- settlement fields deliberately remain NULL until GraduatedV3 is replayed.
UPDATE curves c
SET canonical_pool_address = e.decoded->>'canonicalPool'
FROM chain_events e
WHERE c.chain_id = e.chain_id
  AND c.transaction_hash = e.transaction_hash
  AND c.log_index = e.log_index
  AND c.is_canonical
  AND e.is_canonical
  AND e.event_name = 'TokenLaunchedV3'
  AND e.decoded->>'canonicalPool' IS NOT NULL;

UPDATE graduations g
SET graduation_manager_address = e.decoded->>'graduationManager',
    eth_amount = (e.decoded->>'ethAmount')::NUMERIC(78,0)
FROM chain_events e
WHERE g.chain_id = e.chain_id
  AND g.transaction_hash = e.transaction_hash
  AND g.log_index = e.log_index
  AND g.is_canonical
  AND e.is_canonical
  AND e.event_name = 'Graduated'
  AND e.decoded->>'graduationManager' IS NOT NULL
  AND e.decoded->>'ethAmount' IS NOT NULL;

CREATE INDEX IF NOT EXISTS curves_canonical_pool
    ON curves(chain_id, lower(canonical_pool_address))
    WHERE is_canonical AND canonical_pool_address IS NOT NULL;
CREATE INDEX IF NOT EXISTS graduations_canonical_token
    ON graduations(chain_id, lower(token_address), block_number DESC, log_index DESC)
    WHERE is_canonical;
CREATE INDEX IF NOT EXISTS liquidity_events_canonical_token
    ON liquidity_events(chain_id, lower(token_address), block_number DESC, log_index DESC)
    WHERE is_canonical AND event_name = 'GraduatedV3';
