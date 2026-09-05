# Cooket realtime market service

This service is a low-latency, non-persistent companion to the canonical
Cooket indexer. PostgreSQL supplies the canonical token/curve/graduation/pool
registry; Arc WebSocket subscriptions supply unconfirmed realtime trade logs.
Normalized events are written as JSON lines to stdout and broadcast live over
SSE. Operational logs go to stderr.

For local development, Docker Compose is the primary runtime. It starts after
PostgreSQL is healthy and migrations complete; it can begin with an empty
canonical registry and will discover markets on subsequent reconciliation.

```sh
docker compose up -d
docker logs -f cooket-realtime-1
```

Compose publishes the HTTP server at `http://localhost:4300`: `GET /healthz`
is a process-liveness check and `GET /events` is a live-only SSE stream.
Each event uses `event: trade`, its canonical `<chain_id>:<tx_hash>:<log_index>`
identity as `id`, and the existing normalized event JSON as `data`. A supplied
`Last-Event-ID` is intentionally not replayed: durable or historical replay is
not part of this service, so reconnecting clients receive only future events
and use deterministic IDs for deduplication.

Normal trade events include `block_timestamp`, the Unix-second timestamp from
the matching Arc block header; it is never derived from service receipt time.
Headers are cached by block hash (bounded to 1,024 entries) so same-block logs
reuse one lookup. A header lookup failure drops that provisional normal event
rather than publishing a guessed timestamp. Removed events carry the cached
timestamp when available and otherwise omit it, since their deterministic ID is
sufficient for consumers to retract the provisional event.

Each client has a bounded queue (64 by default). If it cannot keep up it is
removed/disconnected; this never blocks chain ingestion or other clients.
Heartbeats are SSE comments (`: ping`) every 15 seconds by default. Allowed
browser origins default to the two local Cooket web origins and are configured
with `REALTIME_SSE_ALLOWED_ORIGINS` as comma-separated absolute origins.

For optional direct debugging from the repository root, with a database
already maintained by the canonical indexer:

```sh
(cd apps/realtime && \
  DATABASE_URL='postgresql://...' \
  ARC_WSS_URL='wss://rpc.testnet.arc.io' \
  GOWORK=off go run .)
```

Optional settings:

- `COOKET_CHAIN_ID` defaults to `5042002` and rejects any other chain.
- `COOKET_CANONICAL_USDC` defaults to Arc canonical USDC.
- `REALTIME_RECONCILE_INTERVAL` defaults to `3s`.
- `REALTIME_HTTP_ADDR` defaults to `:4300`.
- `REALTIME_SSE_HEARTBEAT_INTERVAL` defaults to `15s`.
- `REALTIME_SSE_ALLOWED_ORIGINS` defaults to Cooket local web origins.
- `REALTIME_SSE_SUBSCRIBER_BUFFER` defaults to `64` (range 1–4096).

The service never writes to PostgreSQL. A short reconciliation loop discovers
newly indexed launches and canonical graduation transitions. Press Ctrl+C for
a graceful shutdown.

For a source added after startup, the service installs the WebSocket
subscription and then catches up only that address and its event topics from
its canonical launch or graduation block. Catch-up is deliberately capped at a
512-block distance to bound RPC work; exceeding it is a fail-closed connection
error, never a silent partial history scan. Operators should restore canonical
indexer/realtime liveness before that operational window is exceeded.
