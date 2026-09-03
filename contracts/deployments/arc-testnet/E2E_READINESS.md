# Arc Testnet E2E readiness and runbook

The immutable address authority is `cooket-v3.json`. Do not copy addresses from
old deployments or redeploy any Cooket contract.

## Dependency audit

- Pool creation and initialization use `UniswapV3Factory` directly from
  `GraduationManagerV3`; no periphery router is involved.
- LP creation uses the existing `NonfungiblePositionManager`. Its NFT is minted
  directly to an ownerless per-token `PermanentLPCustodianV3` and then bound.
- Post-graduation quoting needs `QuoterV2`.
- Post-graduation ERC-20 USDC/token buys and sells need the official V3
  `SwapRouter`. `SwapRouter02` is not required.
- The legacy WETH9 constructor argument is the deployed `UnsupportedProtocol`.
  Calling wrap/unwrap is forbidden. The canonical pair is launch token and
  `0x3600000000000000000000000000000000000000` ERC-20 USDC.

Factory and Position Manager are already deployed. At audit time there was no
verified Arc address or manifest for SwapRouter, Quoter, QuoterV2, or
SwapRouter02. Deploy only SwapRouter and QuoterV2 with the separate extension.

## One-time setup

From WSL:

```bash
cd ~/projects/cooket/contracts
chmod +x script/deploy-uniswap-v3-periphery-arc-testnet.sh \
  script/e2e-cooket-arc-testnet.sh script/render-cooket-arc-testnet-env.sh

./script/deploy-uniswap-v3-periphery-arc-testnet.sh plan
DEPLOYER_ADDRESS=0x6BE7035f62Ce8ddB4574fE6399eD85E81827c182 \
  ./script/deploy-uniswap-v3-periphery-arc-testnet.sh preflight

# Explicit broadcast; Foundry asks for the named keystore password in WSL.
DEPLOYER_ACCOUNT=cooket-arc-testnet-deployer \
  ./script/deploy-uniswap-v3-periphery-arc-testnet.sh broadcast
```

The last command creates
`deployments/arc-testnet/uniswap-v3-periphery.json`. Review its on-chain values,
then copy its `swapRouter` and `quoterV2` values into the two blank local-only
runtime variables in `.env.example` when preparing a local `.env`. Never put an
account password or private key in an environment file.

## E2E actor and preflight

Create a dedicated Foundry keystore named `cooket-arc-testnet-e2e`. It must not
resolve to the deployment EOA or the Safe. Fund it with at least 7,321 native
USDC plus gas. Its canonical ERC-20 USDC view must show at least 1 USDC.

```bash
cd ~/projects/cooket/contracts
export E2E_ADDRESS='<public address of cooket-arc-testnet-e2e>'
./script/e2e-cooket-arc-testnet.sh plan
./script/e2e-cooket-arc-testnet.sh preflight
```

Preflight is RPC-only. It never opens the keystore or asks for a password.

## Real E2E run

Choose a fresh bytes32 salt if the default salt has ever been used. Then run:

```bash
cd ~/projects/cooket/contracts
export E2E_ADDRESS='<public address of cooket-arc-testnet-e2e>'
export E2E_USER_SALT="$(cast keccak "cooket-e2e-$(date -u +%Y%m%dT%H%M%SZ)")"
E2E_ACCOUNT=cooket-arc-testnet-e2e \
  ./script/e2e-cooket-arc-testnet.sh run
```

The `run` mode is the only broadcasting E2E mode and prompts through Foundry's
named keystore. It verifies chain and bytecode, the final Safe-owned graph,
actor separation, balances, launch/pool bindings, curve buy and sell events,
graduation settlement, nonzero pool liquidity, direct NFT ownership and
registration by the permanent custodian, QuoterV2 responses, exact allowances,
and token/USDC balance movement after both post-graduation swaps. A successful
run writes `deployments/arc-testnet/e2e-run.json`; an existing file blocks a
duplicate run.

The web transaction gate remains disabled until the Arc economic-release
decision is made separately. These testnet tools do not activate production or
mainnet runtime settings.
