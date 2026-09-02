#!/usr/bin/env bash
set -euo pipefail

root_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
migration_dir="$root_dir/db/migrations"

mapfile -t migrations < <(find "$migration_dir" -maxdepth 1 -type f -name '[0-9][0-9][0-9]_*.sql' -printf '%f\n' | sort)
if [[ ${#migrations[@]} -ne 12 ]]; then
  echo "expected exactly migrations 001 through 012" >&2
  exit 1
fi
for i in "${!migrations[@]}"; do
  expected=$(printf '%03d' "$((i + 1))")
  if [[ ${migrations[$i]} != "$expected"_* ]]; then
    echo "migration ordering error: expected $expected, found ${migrations[$i]}" >&2
    exit 1
  fi
done

migration="$migration_dir/012_cto_v1.sql"
required_tables=(
  cto_treasuries cto_proposals cto_token_state
  cto_creator_fee_checkpoint_ledger cto_supported_assets
  cto_treasury_transfers cto_fee_pulls
)
for table in "${required_tables[@]}"; do
  rg -q "CREATE TABLE ${table}[ (]" "$migration" || {
    echo "migration 012 is missing table $table" >&2
    exit 1
  }
done

required_fragments=(
  "NUMERIC(20,0)"
  "NUMERIC(78,0)"
  "is_canonical BOOLEAN"
  "orphaned_at TIMESTAMPTZ"
  "PRIMARY KEY (chain_id, transaction_hash, log_index)"
  "RENAME COLUMN eth_amount TO native_usdc_amount"
  "native_usdc_amount"
  "cto_proposals_canonical_executable"
  "cto_token_state_canonical_status"
  "cto_checkpoint_ledger_canonical_lookup"
  "cto_treasury_transfers_canonical_history"
)
for fragment in "${required_fragments[@]}"; do
  rg -Fq "$fragment" "$migration" || {
    echo "migration 012 is missing required schema fragment: $fragment" >&2
    exit 1
  }
done

# 009 is frozen committed history. Native-USDC renaming belongs only in 012.
if ! rg -q 'ADD COLUMN IF NOT EXISTS eth_amount' "$migration_dir/009_v3_graduation_data_plane.sql"; then
  echo "migration 009 lost its committed eth_amount column" >&2
  exit 1
fi
if rg -n 'native_usdc_amount|nativeUsdcAmount' "$migration_dir/009_v3_graduation_data_plane.sql"; then
  echo "migration 009 must remain historical; native-USDC changes belong in 012" >&2
  exit 1
fi
if rg -n -i 'weth' "$migration"; then
  echo "migration 012 retains stale WETH terminology" >&2
  exit 1
fi

rg -q 'expected" -ne 13' "$root_dir/db/migrate.sh"
rg -q 'ARRAY\[1,2,3,4,5,6,7,8,9,10,11,12\]' "$root_dir/db/migrate.sh"

echo "Static migration ordering, CTO schema, provenance, and native-USDC validation passed without Docker or a database connection."
