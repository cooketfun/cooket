#!/usr/bin/env bash
# Render public/local runtime configuration from the verified Cooket manifest.
set -euo pipefail

MODE="${1:-render}"
[[ "$MODE" == render || "$MODE" == check ]] || { echo "usage: $0 [render|check]" >&2; exit 64; }
readonly MANIFEST=deployments/arc-testnet/cooket-v3.json
readonly ROOT_ENV=../.env.example

command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }
[[ -f "$MANIFEST" ]] || { echo "missing $MANIFEST" >&2; exit 1; }
[[ "$(jq -er .chainId "$MANIFEST")" == 5042002 && "$(jq -er .verified "$MANIFEST")" == true ]] || {
  echo "Cooket manifest is not the verified Arc Testnet deployment" >&2
  exit 1
}

factory=$(jq -er .cooketFactory "$MANIFEST")
fees=$(jq -er .feeManager "$MANIFEST")
graduation=$(jq -er .graduationManager "$MANIFEST")
vault=$(jq -er .permanentLPFeeVault "$MANIFEST")
custodian=$(jq -er .permanentLPCustodianDeployer "$MANIFEST")
executor=$(jq -er .graduationSettlementExecutor "$MANIFEST")
uniswap=$(jq -er .uniswapV3Factory "$MANIFEST")
usdc=$(jq -er .canonicalUsdc "$MANIFEST")

render() {
  printf '%s\n' \
    "COOKET_FACTORY_V3_ADDRESS=$factory" \
    "COOKET_FEE_MANAGER_V3_ADDRESS=$fees" \
    "COOKET_INDEXER_CONTRACTS=$factory,$fees" \
    "NEXT_PUBLIC_COOKET_FACTORY_V3_ADDRESS=$factory" \
    "NEXT_PUBLIC_FEE_MANAGER_V3_ADDRESS=$fees" \
    "NEXT_PUBLIC_GRADUATION_MANAGER_V3_ADDRESS=$graduation" \
    "NEXT_PUBLIC_PERMANENT_LP_FEE_VAULT_V3_ADDRESS=$vault" \
    "NEXT_PUBLIC_PERMANENT_LP_CUSTODIAN_DEPLOYER_V3_ADDRESS=$custodian" \
    "NEXT_PUBLIC_GRADUATION_SETTLEMENT_EXECUTOR_V3_ADDRESS=$executor" \
    "NEXT_PUBLIC_ARC_TESTNET_UNISWAP_V3_FACTORY=$uniswap" \
    "NEXT_PUBLIC_ARC_TESTNET_CANONICAL_USDC=$usdc"
}

if [[ "$MODE" == render ]]; then render; exit 0; fi
while IFS= read -r expected; do
  grep -Fxq "$expected" "$ROOT_ENV" || { echo "runtime template mismatch: $expected" >&2; exit 1; }
done < <(render)
echo "runtime template matches $MANIFEST"
