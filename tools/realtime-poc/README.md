# Arc canonical-pool realtime POC

This standalone tool subscribes directly to Arc Testnet logs for the current
Cooket E2E token's canonical Uniswap V3 pool. It prints each matching raw Swap
log as one JSON line and does not write to a database or call Cooket services.

Run it from the repository root:

```sh
(cd tools/realtime-poc && GOWORK=off go run .)
```

Press Ctrl+C for a graceful shutdown. The POC makes one connection and one
`eth_subscribe` logs subscription; connection or subscription failure exits
with a non-zero status and does not retry forever.
