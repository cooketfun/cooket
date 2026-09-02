# Cooket

Cooket is an Arc-native token launch protocol in testnet development. Its
current and only runtime target is **Arc Testnet** (chain ID `5042002`).

## Phase 0 status

- Network: Arc Testnet
- RPC: `https://rpc.testnet.arc.io`
- Explorer: `https://testnet.arcscan.app`
- Native gas/value currency: USDC with 18-decimal native representation
- USDC ERC-20 representation: 6 decimals; it is a distinct representation
- Graduation indexed field: `native_usdc_amount` (not `eth_amount`, not ETH)
- CTO HTTP API and token-page UI are read-only indexed views
- Frontend, API, and indexer reject Base chain IDs
- Token creation, trading, graduation, indexing, oracle reads, and deployment
  are fail-closed
- No Cooket Arc contracts, DEX dependencies, oracle, or governance addresses are
  configured or approved

See [COOKET_ARC_READINESS.md](COOKET_ARC_READINESS.md) before changing any
financial, contract, or deployment code. Live environment application of
migration 012, Arc RPC/DEX verification, deployment, and testnet execution
remain later phases.

## Repository layout

- `apps/web` — Next.js frontend
- `apps/api` — Go HTTP API
- `apps/indexer` — Go Arc blockchain indexer foundation
- `contracts` — Solidity source and tests; no Cooket deployment artifacts
- `packages/contracts-sdk` — centralized chain metadata and contract bindings
- `db` — migrations and database tooling
- `docs` — Cooket product and safety documentation

## Local development

Prerequisites: Docker with Compose, Node.js 22+, pnpm 10.33.0, Go 1.26+,
and Foundry.

```shell
pnpm install --frozen-lockfile
cp .env.example .env
```

Set a unique local-only PostgreSQL password and a browser-public Reown project
ID in the untracked `.env`. Set the AppKit metadata URL to the local origin for
development; do not add any contract address during Phase 0.

```shell
docker compose up -d --build
```

Local host endpoints are isolated from other projects:

- web: `http://localhost:3200`
- API and health: `http://localhost:4200` and `http://localhost:4200/health`
- PostgreSQL: `127.0.0.1:15436`
- Redis: internal Compose network only

The indexer defaults to idle mode. Active indexing is rejected in Phase 0.

## Validation

```shell
pnpm install --frozen-lockfile
pnpm --filter web lint
pnpm --filter web exec tsc --noEmit
pnpm --filter web test
pnpm --filter web build
(cd apps/api && go test ./... && go build ./cmd/server)
(cd apps/indexer && go test ./... && go build ./cmd/indexer)
(cd contracts && forge build && forge test)
./scripts/validate-compose-isolation.sh
docker compose config
git diff --check
```

No validation command deploys contracts, broadcasts transactions, starts
production containers, or connects to a VPS.

## Security

Never commit private keys, seed phrases, wallet credentials, private RPC URLs,
database credentials, API keys, deployment keys, or real `.env` files.

For Vercel/VPS split-production preparation, see
[split production deployment](docs/operations/split-production.mdx). Contact
[team@cooket.fun](mailto:team@cooket.fun).
