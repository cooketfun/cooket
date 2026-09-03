#!/usr/bin/env bash
# Arc Testnet-only Uniswap V3 trading periphery extension.
# Official artifact provenance: Uniswap/v3-periphery commit 06823871.
set -euo pipefail

MODE="${1:-plan}"
case "$MODE" in
  plan|preflight|broadcast) ;;
  *) echo "usage: $0 [plan|preflight|broadcast]" >&2; exit 64 ;;
esac

readonly CHAIN_ID=5042002
readonly RPC_URL="${ARC_TESTNET_RPC_URL:-https://rpc.testnet.arc.io}"
readonly ARTIFACT_ROOT="${UNISWAP_V3_ARTIFACT_ROOT:-/tmp/uniswap-v3-artifacts}"
readonly FACTORY=0xc70593E016A5d50451b1A2Cf3173E7d77F120B37
readonly POSITION_MANAGER=0x6f8795B30aB107d6306434d979F50181C0bb68a9
# Deployed from official Uniswap/contracts commit 56928a9. This reverts for every
# legacy wrapped-native operation; Arc pools use canonical ERC-20 USDC instead.
readonly UNSUPPORTED_PROTOCOL=0x1BB1348ab8900D0F04c483fBaeCfd6472D808EF9
readonly UNSUPPORTED_RUNTIME_HASH=0xb16b4aa5c5f14b9d186d48bb074c2d02a96e9e2e3aef74d0815f6d4a9a9f7bdd
readonly ROUTER_ARTIFACT="$ARTIFACT_ROOT/periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json"
readonly QUOTER_ARTIFACT="$ARTIFACT_ROOT/periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json"
readonly ROUTER_INITCODE_HASH=0x4ab2bb678b8aa5c9267d00ec2ac6e6603909f2a6c9e8c59daaaf5f4af1ba6710
readonly QUOTER_INITCODE_HASH=0x807900529037b0db5b299ed312e4b1820210b5e9922b6c4fcd4c23de67ee5f1a
readonly MANIFEST=deployments/arc-testnet/uniswap-v3-periphery.json
readonly EXPECTED_ACCOUNT=cooket-arc-testnet-deployer

die() { echo "$*" >&2; exit 1; }
eq() { [[ "${1,,}" == "${2,,}" ]]; }
for command_name in cast jq; do command -v "$command_name" >/dev/null || die "missing required command: $command_name"; done
for artifact in "$ROUTER_ARTIFACT" "$QUOTER_ARTIFACT"; do [[ -f "$artifact" ]] || die "missing artifact: $artifact"; done

artifact_bytecode() { jq -er '.bytecode | select(type == "string" and startswith("0x"))' "$1"; }
validate_artifact() {
  local artifact=$1 expected_hash=$2 label=$3 bytecode actual_hash links constructor_types
  bytecode=$(artifact_bytecode "$artifact")
  actual_hash=$(cast keccak "$bytecode")
  eq "$actual_hash" "$expected_hash" || die "$label initcode hash mismatch: got $actual_hash, expected $expected_hash"
  links=$(jq '[.linkReferences | to_entries[]? | .value | to_entries[]? | .value[]] | length' "$artifact")
  [[ "$links" == 0 ]] || die "$label artifact unexpectedly contains link references"
  constructor_types=$(jq -r '[.abi[] | select(.type == "constructor") | .inputs[].type] | join(",")' "$artifact")
  [[ "$constructor_types" == address,address ]] || die "$label constructor is not (address,address)"
  printf '%s\n' "$actual_hash"
}

router_hash=$(validate_artifact "$ROUTER_ARTIFACT" "$ROUTER_INITCODE_HASH" SwapRouter)
quoter_hash=$(validate_artifact "$QUOTER_ARTIFACT" "$QUOTER_INITCODE_HASH" QuoterV2)

echo "mode: $MODE"
echo "chain id: $CHAIN_ID"
echo "UniswapV3Factory: $FACTORY"
echo "NonfungiblePositionManager (unchanged): $POSITION_MANAGER"
echo "UnsupportedProtocol legacy WETH9 parameter: $UNSUPPORTED_PROTOCOL"
echo "SwapRouter initcode keccak: $router_hash"
echo "QuoterV2 initcode keccak: $quoter_hash"

if [[ "$MODE" == plan ]]; then
  echo "deployments: SwapRouter -> QuoterV2"
  echo "plan validated; no RPC, account, password, or broadcast access"
  exit 0
fi

[[ ! -e "$MANIFEST" ]] || die "$MANIFEST already exists; refusing duplicate deployment"
actual_chain=$(cast chain-id --rpc-url "$RPC_URL")
[[ "$actual_chain" == "$CHAIN_ID" ]] || die "RPC chain id is $actual_chain, expected $CHAIN_ID"

code_hash() { cast keccak "$(cast code --rpc-url "$RPC_URL" "$1")"; }
[[ "$(cast code --rpc-url "$RPC_URL" "$FACTORY")" != 0x ]] || die "Factory has no bytecode"
[[ "$(cast code --rpc-url "$RPC_URL" "$POSITION_MANAGER")" != 0x ]] || die "Position Manager has no bytecode"
eq "$(cast call --rpc-url "$RPC_URL" "$POSITION_MANAGER" 'factory()(address)')" "$FACTORY" || die "Position Manager factory mismatch"
eq "$(cast call --rpc-url "$RPC_URL" "$POSITION_MANAGER" 'WETH9()(address)')" "$UNSUPPORTED_PROTOCOL" || die "Position Manager no-WETH marker mismatch"
eq "$(code_hash "$UNSUPPORTED_PROTOCOL")" "$UNSUPPORTED_RUNTIME_HASH" || die "UnsupportedProtocol runtime hash mismatch"

constructor=$(cast abi-encode 'f(address,address)' "$FACTORY" "$UNSUPPORTED_PROTOCOL")
router_initcode="$(artifact_bytecode "$ROUTER_ARTIFACT")${constructor#0x}"
quoter_initcode="$(artifact_bytecode "$QUOTER_ARTIFACT")${constructor#0x}"

if [[ "$MODE" == preflight ]]; then
  [[ -n "${DEPLOYER_ADDRESS:-}" ]] || die "DEPLOYER_ADDRESS is required for preflight"
  [[ "$DEPLOYER_ADDRESS" =~ ^0x[[:xdigit:]]{40}$ ]] || die "DEPLOYER_ADDRESS is invalid"
  gas_price=$(cast gas-price --rpc-url "$RPC_URL")
  router_gas=$(cast estimate --rpc-url "$RPC_URL" --from "$DEPLOYER_ADDRESS" --create "$router_initcode")
  quoter_gas=$(cast estimate --rpc-url "$RPC_URL" --from "$DEPLOYER_ADDRESS" --create "$quoter_initcode")
  echo "gas price: $gas_price"
  echo "SwapRouter estimated gas: $router_gas"
  echo "QuoterV2 estimated gas: $quoter_gas"
  echo "total estimated gas: $((router_gas + quoter_gas))"
  echo "preflight complete; no account, password, or broadcast access"
  exit 0
fi

[[ "${DEPLOYER_ACCOUNT:-}" == "$EXPECTED_ACCOUNT" ]] || die "DEPLOYER_ACCOUNT must be $EXPECTED_ACCOUNT"
mkdir -p "$(dirname "$MANIFEST")"
probe=$(mktemp "$(dirname "$MANIFEST")/.periphery-write.XXXXXX")
rm -f "$probe"

deploy() {
  cast send --json --rpc-url "$RPC_URL" --account "$DEPLOYER_ACCOUNT" --create "$1" | jq -er '.contractAddress'
}

echo "deployer account: $DEPLOYER_ACCOUNT"
router=$(deploy "$router_initcode")
quoter=$(deploy "$quoter_initcode")
for deployed in "$router" "$quoter"; do [[ "$(cast code --rpc-url "$RPC_URL" "$deployed")" != 0x ]] || die "no code at deployed address $deployed"; done
for deployed in "$router" "$quoter"; do
  eq "$(cast call --rpc-url "$RPC_URL" "$deployed" 'factory()(address)')" "$FACTORY" || die "$deployed factory mismatch"
  eq "$(cast call --rpc-url "$RPC_URL" "$deployed" 'WETH9()(address)')" "$UNSUPPORTED_PROTOCOL" || die "$deployed no-WETH marker mismatch"
done

tmp=$(mktemp "$(dirname "$MANIFEST")/.periphery-manifest.XXXXXX")
jq -n --arg factory "$FACTORY" --arg npm "$POSITION_MANAGER" --arg unsupported "$UNSUPPORTED_PROTOCOL" --arg router "$router" --arg quoter "$quoter" \
  '{chainId:5042002,provenance:{v3Periphery:"06823871",unsupportedProtocol:"Uniswap/contracts@56928a9"},uniswapV3Factory:$factory,nonfungiblePositionManager:$npm,unsupportedProtocol:$unsupported,swapRouter:$router,quoterV2:$quoter,verified:true}' >"$tmp"
mv "$tmp" "$MANIFEST"
echo "SwapRouter: $router"
echo "QuoterV2: $quoter"
echo "manifest: $MANIFEST"
