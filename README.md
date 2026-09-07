# Cooket

Cooket is an Arc-native token launch and trading protocol currently operating in Arc Testnet development and testing.

- Application: [https://cooket.fun](https://cooket.fun)
- Documentation: [https://docs.cooket.fun](https://docs.cooket.fun)
- API: [https://api.cooket.fun](https://api.cooket.fun)
- Network: Arc Testnet (`5042002`)
- Explorer: [https://testnet.arcscan.app](https://testnet.arcscan.app)

## Protocol

Every launch has a fixed supply of 1 billion 18-decimal tokens: 800 million are allocated to a dedicated shifted constant-product curve and 200 million to graduation liquidity. The curve begins with virtual reserves of 1,066,666,666.666666666666666667 tokens and 2,415 native USDC.

Curve trades charge 1%. Graduation occurs at 800 million tokens sold and 7,245 net native USDC; the exact gross input for an empty curve is 7,318.181818181818181818 native USDC. Settlement creates a full-range, 1% fee-tier Uniswap V3 token/canonical-USDC position held by an ownerless per-token custodian.

Arc native USDC uses 18-decimal native units. Canonical ERC-20 USDC uses 6 decimals. Neither is ETH or WETH.

## Architecture

- `apps/web` — Next.js application, external Reown/Wagmi wallets, curve and graduated trading, responsive terminal, and provisional realtime overlay
- `apps/api` — Go HTTP API for canonical indexed reads, CTO views, metadata, and stored objects
- `apps/indexer` — confirmed Arc event indexer with canonical provenance, reorg recovery, and PostgreSQL projections
- `apps/realtime` — non-persistent Arc WSS consumer and live-only SSE market stream
- `contracts` — Cooket V3 Solidity contracts, tests, deployment scripts, and Arc Testnet manifests
- `packages/contracts-sdk` — shared ABIs, Arc constants, receipt parsers, and deterministic helpers
- `db` — PostgreSQL migrations `001` through `014` and migration runner
- `docs` — public Mintlify documentation configured by root `docs.json`

Canonical deployment records are [Cooket V3](contracts/deployments/arc-testnet/cooket-v3.json) and [Uniswap V3 periphery](contracts/deployments/arc-testnet/uniswap-v3-periphery.json). The manifests record verified Arc Testnet addresses; source verification is not an independent security audit.

## Local development

Prerequisites: Node.js 22+, pnpm 10.33.0, Go 1.26+, Docker Compose, and Foundry.

```shell
pnpm install --frozen-lockfile
cp .env.example .env
docker compose up -d --build
```

Set a local PostgreSQL password and browser-public Reown project ID in the untracked `.env`. The default indexer mode is `idle`. Local endpoints are web `http://localhost:3200`, API `http://localhost:4200`, realtime SSE `http://localhost:4300/events`, and PostgreSQL `127.0.0.1:15436`.

```shell
pnpm --filter web lint
pnpm --filter web exec tsc --noEmit
pnpm --filter web test
pnpm --filter web build
(cd apps/api && go test ./... && go build ./cmd/server)
(cd apps/indexer && go test ./... && go build ./cmd/indexer)
(cd apps/realtime && GOWORK=off go test ./... && GOWORK=off go build .)
(cd contracts && forge build && forge test)
git diff --check
```

Development follows **Local → GitHub → VPS**. Deployment, remote operations, DNS, and production changes require a separate authorized phase.

## Testnet and security warning

Arc Testnet tokens and USDC do not represent real financial value. Testnet services and state may change or reset, and Arc Testnet deployment does not imply Arc Mainnet availability. Smart-contract, wallet, token, RPC, indexing, and third-party protocol risks remain despite tests and contract controls. Never commit or share private keys, seed phrases, wallet credentials, RPC credentials, database passwords, or real environment files.
