# Cooket Dune analytics exporter

This isolated, read-only workflow exports public canonical Cooket API projections
to four normalized CSV datasets for Dune. It does not mutate PostgreSQL, the
indexer, contracts, API behavior, or the application.

The default command is a dry run:

```bash
python3 tools/analytics-exporter/export.py
```

Files are written under the ignored `tmp/cooket-analytics/` directory. The
`validation.json` file records the canonical indexer cutoff, source totals,
row counts, decimal rules, deployment provenance, and SHA-256 checksums.

For an incremental delta export (no Dune upload):

```bash
python3 tools/analytics-exporter/export.py --since-block 60900000
python3 tools/analytics-exporter/export.py --since-timestamp 2026-09-07T00:00:00Z
```

The overview remains a complete snapshot. Daily rows are emitted for affected
days and top-token rows for affected tokens. The documented CSV upload endpoint
replaces an existing table, so this exporter refuses to upload an incremental
delta. A future scheduled pipeline can merge deltas before a full replacement,
or use Dune's create/insert APIs with an explicit idempotency design.

To replace the four public Dune datasets with a validated full snapshot:

```bash
export DUNE_API_KEY='...'
export DUNE_UPLOAD_ENABLED=true
python3 tools/analytics-exporter/export.py --upload
```

The API key is sent only in the `X-DUNE-API-KEY` request header. It is never
written to CSV, validation output, descriptions, SQL, or logs. Upload remains
disabled unless both the command flag and environment gate are present.

Accounting rules:

- `curve_volume_native_usdc` is summed from curve `curve_value` integers and
  divided exactly by 10^18.
- `graduated_volume_erc20_usdc` is summed from Uniswap V3 `reserve_amount`
  integers and divided exactly by 10^6.
- The two columns are never combined. Values are Arc Testnet units, not real
  financial value and not oracle-priced USD.
- The export cutoff is the minimum positive `indexed_through_block` observed
  across token details and paginated trade responses, so every included API
  surface has indexed at least through that block.

The uploaded tables are expected at
`dune.<Cooket Dune handle>.dataset_cooket_<name>`. Discover the exact namespace
after upload rather than hardcoding it.
