# Migration 010 operational requirement

Migration `010_uniswap_v3_trades.sql` adds `transaction_index` to historical
`chain_events` and `trades` rows. PostgreSQL must initialize that new column,
so legacy rows temporarily receive `0`; the database does not contain enough
information to recover a real transaction index from a transaction hash.

After applying migration 010, production must perform a deterministic indexer
replay of the affected canonical range from the configured RPC. The replay
rewrites each row from the RPC log's `transactionIndex` (`types.Log.TxIndex`).
Consumers must not serve the migrated history as complete until that replay
has finished and the indexer checkpoint has advanced through the affected
range.

All ordering remains:

```text
block_number → transaction_index → log_index
```

Transaction-hash ordering is only a final deterministic tie-breaker where the
schema query needs one; it must never be used to invent `transaction_index`.
