-- Historical migrations 001 through 004 remain immutable so existing databases
-- can be upgraded safely. Runtime code indexes endpoint-cp-v3 only from this
-- point forward; historical token rows are retained without being reclassified.

ALTER TABLE tokens DROP CONSTRAINT IF EXISTS tokens_protocol_compatibility_check;
DROP INDEX IF EXISTS tokens_protocol_compatibility;
ALTER TABLE tokens DROP COLUMN IF EXISTS is_legacy;

-- protocol_version remains historical provenance for already-indexed rows. New
-- V3 projections always write endpoint-cp-v3 and no runtime query branches on it.
ALTER TABLE tokens ALTER COLUMN protocol_version SET DEFAULT 'endpoint-cp-v3';
