# Terminal finalization evidence and release gates

## Status

Renderer-independent implementation is ready for review. Runtime E2E is pending.
`OFFICIAL_TRADINGVIEW_RENDERER_BLOCKED_BY_EXTERNAL_ACCESS`: no official
charting_library assets, vendor package, or configured library path were found
in this checkout. No library was downloaded. TokenAdvancedChart continues to
delegate to TokenChart. CooketTradingViewDatafeed remains the reusable adapter;
it is not an official renderer or a substitute for licensed assets.

## Consumer presentation

The chart uses a dynamic TOKEN / USDC identity, optional candle details, and a
Volume label. The existing chart-first desktop grid and mobile stack remain.
Prices and market values use dollar presentation; transaction amounts identify
USDC and token quantities use K/M/B/T with exact tooltips where supplied.
No percentage change is inferred because the token API does not prove one.
Trade times come from canonical block timestamps (or provisional event block
timestamps); absent time falls back to a block label. V3 recipients are not
presented as verified traders. Swap execution, approval, simulation, deadlines,
slippage and receipt checks are unchanged.

## Hardening and bounds

- Token navigation remounts the terminal owner, resetting surface proofs and
  subscriptions. Closed EventSource callbacks cannot write to the next token.
- Weekly overlays use Monday buckets, matching the historical API.
- Retirement requires valid nonnegative integer proof from all three surfaces;
  the shared floor remains their minimum. Interval changes require fresh proof.
- Datafeed history rejects invalid ranges/countBack before fetching. Stale
  interval and regressing watermark snapshots cannot replace a subscription.
- SSE fanout queues remain bounded, with at most 1024 subscribers. Excess
  subscribers receive a closed stream. Slow subscribers disconnect; each
  socket write has a five-second deadline. Shutdown explicitly ends streams.
- WSS reconnection subscribes before bounded catch-up from the last delivered
  block (inclusive), preserving new-source registration boundaries. Latest
  replacement subscriptions are cleaned up on exit, including backfill failure.
- Existing catch-up limit stays 512 blocks. Longer interruptions fail closed
  and require operational recovery; they are not silently truncated. This is
  not durable replay across process restarts. Browser SSE reconnect is live-only;
  authoritative polling recovers missed browser activity.
- Timestamp caching remains hash-keyed, singleflight-coalesced, and capped at
  1024 headers; service identity dedupe stays capped at 10000. Browser pending
  events remain capped at 256. Overflow beyond that window relies on canonical
  polling; this does not establish lossless provisional delivery under overload.
- Browser overlay operations are bounded by pending capacity plus loaded bars;
  fanout is linear in subscribers. No second transport, unbounded replay queue,
  or chart recreation on count rollover was introduced.
- Historical API results remain capped at 1000; countBack and adjacent ranges
  retain their prior semantics. Result bounds do not establish constant SQL
  cost: execution-OHLC reconstruction still needs database load measurements.

## Local checks and tooling

Run `pnpm --filter web test` and `pnpm --filter web exec tsc --noEmit`.
From apps/api: `go test ./...` and `go vet ./...`.
From apps/realtime: `GOWORK=off go test -race ./...` and
`GOWORK=off go vet ./...` (the root workspace does not list realtime).

In-memory coverage includes 10000 duplicate browser deliveries, subscriber
churn (32 workers x 100 lifecycles), subscriber admission, shutdown, timestamp
singleflight, bounded reconnect queries, removals, watermark permutations,
out-of-order interval responses, and chart rollover/pan/unmount behavior.

Optional live local SSE smoke load:
`node tools/terminal-stress.mjs http://127.0.0.1:4300/events 8 5`.
It permits loopback only, refuses redirects, limits clients to 32 and duration
to 30 seconds, and sends no trades. Do not point load tests at public services.

## Pending release evidence

Official licensed TradingView assets and permission remain external gates.
After review: local Docker rebuild; browser desktop/mobile checks for all seven
intervals; disconnect/reconnect and reorg fixtures; database-backed history and
trade timestamp checks against a dedicated test database; live local SSE smoke
load; separately authorized real-trade regression. No Docker rebuild, browser
E2E, live-chain trade, deployment, or production load test is claimed here.
Do not mark roadmap phases 5B, 6, or 7 DONE based only on automated checks.
