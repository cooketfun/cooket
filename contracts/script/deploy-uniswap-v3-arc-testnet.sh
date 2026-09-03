#!/usr/bin/env bash
# Arc Testnet (5042002) Uniswap V3 deployment utility.
# Core artifact provenance: Uniswap/v3-core d0831dc6; periphery: Uniswap/v3-periphery 06823871.
set -euo pipefail

MODE="${1:-plan}"
if [[ "$MODE" != "plan" && "$MODE" != "preflight" && "$MODE" != "broadcast" ]]; then
  echo "usage: $0 [plan|preflight|broadcast]" >&2
  exit 64
fi

readonly CHAIN_ID="5042002"
readonly RPC_URL="${ARC_TESTNET_RPC_URL:-https://rpc.testnet.arc.io}"
readonly ARTIFACT_ROOT="${UNISWAP_V3_ARTIFACT_ROOT:-/tmp/uniswap-v3-artifacts}"
readonly FACTORY_ARTIFACT="$ARTIFACT_ROOT/core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json"
readonly NFT_DESCRIPTOR_ARTIFACT="$ARTIFACT_ROOT/periphery/artifacts/contracts/libraries/NFTDescriptor.sol/NFTDescriptor.json"
readonly POSITION_DESCRIPTOR_ARTIFACT="$ARTIFACT_ROOT/periphery/artifacts/contracts/NonfungibleTokenPositionDescriptor.sol/NonfungibleTokenPositionDescriptor.json"
readonly POSITION_MANAGER_ARTIFACT="$ARTIFACT_ROOT/periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json"
readonly FACTORY_INITCODE_KECCAK="0xa9cb11ffa1b1bf9a9a2b70b66f6a22db3e8328b37ec44e6ce602749081efdb6d"
# Official Uniswap/contracts UnsupportedProtocol initcode, commit 56928a9. It is the legacy WETH9 parameter; never deploy WETH.
readonly UNSUPPORTED_PROTOCOL_INITCODE="0x6080604052348015600e575f5ffd5b50603580601a5f395ff3fe6080604052348015600e575f5ffd5b5060405163ea3559ef60e01b815260040160405180910390fdfea164736f6c634300081e000a"
readonly UNSUPPORTED_PROTOCOL_INITCODE_KECCAK="0xbe71b3dccc59971adbbc194a78fa72cdcc604e5f13e5305e725620f24378ce65"
readonly NATIVE_LABEL="0x5553444300000000000000000000000000000000000000000000000000000000" # bytes32("USDC")

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing required command: $1" >&2; exit 1; }
}

require_command jq
require_command cast

for artifact in "$FACTORY_ARTIFACT" "$NFT_DESCRIPTOR_ARTIFACT" "$POSITION_DESCRIPTOR_ARTIFACT" "$POSITION_MANAGER_ARTIFACT"; do
  [[ -f "$artifact" ]] || { echo "missing artifact: $artifact" >&2; exit 1; }
done

factory_bytecode="$(jq -er '.bytecode | select(type == "string" and startswith("0x"))' "$FACTORY_ARTIFACT")"
factory_hash="$(cast keccak "$factory_bytecode")"
[[ "${factory_hash,,}" == "$FACTORY_INITCODE_KECCAK" ]] || {
  echo "Factory initcode hash mismatch: got $factory_hash, expected $FACTORY_INITCODE_KECCAK" >&2
  exit 1
}
unsupported_protocol_hash="$(cast keccak "$UNSUPPORTED_PROTOCOL_INITCODE")"
[[ "${unsupported_protocol_hash,,}" == "$UNSUPPORTED_PROTOCOL_INITCODE_KECCAK" ]] || {
  echo "UnsupportedProtocol initcode hash mismatch: got $unsupported_protocol_hash, expected $UNSUPPORTED_PROTOCOL_INITCODE_KECCAK" >&2
  exit 1
}

# The periphery artifact must contain precisely its one declared NFTDescriptor address slot.
link_count="$(jq '[.linkReferences["contracts/libraries/NFTDescriptor.sol"].NFTDescriptor[]?] | length' "$POSITION_DESCRIPTOR_ARTIFACT")"
link_is_exact="$(jq '.linkReferences as $references
  | ([$references | to_entries[] | .value | to_entries[] | .value[]] | length == 1)
  and ($references | keys == ["contracts/libraries/NFTDescriptor.sol"])
  and ($references["contracts/libraries/NFTDescriptor.sol"] | keys == ["NFTDescriptor"])
  and ($references["contracts/libraries/NFTDescriptor.sol"].NFTDescriptor[0] | (.start | type == "number") and .length == 20)' "$POSITION_DESCRIPTOR_ARTIFACT")"
[[ "$link_count" == "1" && "$link_is_exact" == "true" ]] || {
  echo "position descriptor must have exactly one 20-byte NFTDescriptor link reference" >&2
  exit 1
}

npm_link_count="$(jq '[.linkReferences | to_entries[]? | .value | to_entries[]? | .value[]] | length' "$POSITION_MANAGER_ARTIFACT")"
[[ "$npm_link_count" == "0" ]] || { echo "position manager artifact must not have link references" >&2; exit 1; }

echo "mode: $MODE"
echo "chain id: $CHAIN_ID"
echo "factory initcode keccak: $factory_hash"
echo "UnsupportedProtocol initcode keccak: $unsupported_protocol_hash"
echo "position descriptor NFTDescriptor link references: $link_count"
echo "position manager link references: $npm_link_count"

if [[ "$MODE" == "plan" ]]; then
  echo "plan validated; no transaction broadcast"
  exit 0
fi

encode_constructor() {
  local signature="$1"
  shift
  cast abi-encode "$signature" "$@"
}

link_position_descriptor_bytecode() {
  local nft_descriptor_address="$1"
  local position_descriptor_bytecode
  local link_start
  local link_offset
  local link_placeholder
  local linked_position_descriptor_bytecode

  position_descriptor_bytecode="$(jq -er '.bytecode | select(type == "string" and startswith("0x"))' "$POSITION_DESCRIPTOR_ARTIFACT")"
  link_start="$(jq -er '.linkReferences["contracts/libraries/NFTDescriptor.sol"].NFTDescriptor[0].start' "$POSITION_DESCRIPTOR_ARTIFACT")"
  link_offset=$((2 + link_start * 2))
  link_placeholder="${position_descriptor_bytecode:link_offset:40}"
  [[ "$link_placeholder" =~ ^__\$[[:xdigit:]]{34}\$__$ ]] || {
    echo "position descriptor linker placeholder is invalid at offset $link_offset: $link_placeholder" >&2
    return 1
  }
  linked_position_descriptor_bytecode="${position_descriptor_bytecode:0:link_offset}${nft_descriptor_address#0x}${position_descriptor_bytecode:link_offset + 40}"
  [[ "$linked_position_descriptor_bytecode" != *"__"* ]] || {
    echo "linked position descriptor bytecode still contains Solidity linker placeholders" >&2
    return 1
  }
  printf '%s\n' "$linked_position_descriptor_bytecode"
}

if [[ "$MODE" == "preflight" ]]; then
  [[ -n "${DEPLOYER_ADDRESS:-}" ]] || { echo "DEPLOYER_ADDRESS is required for preflight mode" >&2; exit 1; }
fi

actual_chain_id="$(cast chain-id --rpc-url "$RPC_URL")"
[[ "$actual_chain_id" == "$CHAIN_ID" ]] || {
  echo "refusing $MODE: RPC chain id is $actual_chain_id, expected $CHAIN_ID" >&2
  exit 1
}

if [[ "$MODE" == "preflight" ]]; then
  readonly PREFLIGHT_DUMMY_ADDRESS="0x000000000000000000000000000000000000dEaD"

  estimate() {
    cast estimate --rpc-url "$RPC_URL" --from "$DEPLOYER_ADDRESS" --create "$1"
  }

  nft_descriptor_bytecode="$(jq -er '.bytecode | select(type == "string" and startswith("0x"))' "$NFT_DESCRIPTOR_ARTIFACT")"
  linked_position_descriptor_bytecode="$(link_position_descriptor_bytecode "$PREFLIGHT_DUMMY_ADDRESS")"
  position_descriptor_args="$(encode_constructor 'f(address,bytes32)' "$PREFLIGHT_DUMMY_ADDRESS" "$NATIVE_LABEL")"
  position_manager_bytecode="$(jq -er '.bytecode | select(type == "string" and startswith("0x"))' "$POSITION_MANAGER_ARTIFACT")"
  position_manager_args="$(encode_constructor 'f(address,address,address)' "$PREFLIGHT_DUMMY_ADDRESS" "$PREFLIGHT_DUMMY_ADDRESS" "$PREFLIGHT_DUMMY_ADDRESS")"

  gas_price="$(cast gas-price --rpc-url "$RPC_URL")"
  unsupported_protocol_gas="$(estimate "$UNSUPPORTED_PROTOCOL_INITCODE")"
  factory_gas="$(estimate "$factory_bytecode")"
  nft_descriptor_gas="$(estimate "$nft_descriptor_bytecode")"
  position_descriptor_gas="$(estimate "${linked_position_descriptor_bytecode}${position_descriptor_args#0x}")"
  position_manager_gas="$(estimate "${position_manager_bytecode}${position_manager_args#0x}")"
  total_gas=$((unsupported_protocol_gas + factory_gas + nft_descriptor_gas + position_descriptor_gas + position_manager_gas))

  echo "gas price: $gas_price"
  echo "UnsupportedProtocol estimated gas: $unsupported_protocol_gas"
  echo "UniswapV3Factory estimated gas: $factory_gas"
  echo "NFTDescriptor estimated gas: $nft_descriptor_gas"
  echo "NonfungibleTokenPositionDescriptor estimated gas: $position_descriptor_gas"
  echo "NonfungiblePositionManager estimated gas: $position_manager_gas"
  echo "total estimated gas: $total_gas"
  exit 0
fi

[[ -n "${DEPLOYER_ACCOUNT:-}" ]] || { echo "DEPLOYER_ACCOUNT is required for broadcast mode" >&2; exit 1; }

deploy() {
  local initcode="$1"
  # Foundry prompts for the named local keystore password interactively; no password file or environment secret is used.
  cast send --json --rpc-url "$RPC_URL" --account "$DEPLOYER_ACCOUNT" --create "$initcode" | jq -er '.contractAddress'
}

echo "deployer account: $DEPLOYER_ACCOUNT"
unsupported_protocol="$(deploy "$UNSUPPORTED_PROTOCOL_INITCODE")"
factory="$(deploy "$factory_bytecode")"
nft_descriptor_bytecode="$(jq -er '.bytecode | select(type == "string" and startswith("0x"))' "$NFT_DESCRIPTOR_ARTIFACT")"
nft_descriptor="$(deploy "$nft_descriptor_bytecode")"

linked_position_descriptor_bytecode="$(link_position_descriptor_bytecode "$nft_descriptor")"
position_descriptor_args="$(encode_constructor 'f(address,bytes32)' "$unsupported_protocol" "$NATIVE_LABEL")"
position_descriptor="$(deploy "${linked_position_descriptor_bytecode}${position_descriptor_args#0x}")"

position_manager_bytecode="$(jq -er '.bytecode | select(type == "string" and startswith("0x"))' "$POSITION_MANAGER_ARTIFACT")"
position_manager_args="$(encode_constructor 'f(address,address,address)' "$factory" "$unsupported_protocol" "$position_descriptor")"
position_manager="$(deploy "${position_manager_bytecode}${position_manager_args#0x}")"

fee_spacing="$(cast call --rpc-url "$RPC_URL" "$factory" 'feeAmountTickSpacing(uint24)(int24)' 10000)"
npm_factory="$(cast call --rpc-url "$RPC_URL" "$position_manager" 'factory()(address)')"
npm_weth9="$(cast call --rpc-url "$RPC_URL" "$position_manager" 'WETH9()(address)')"
[[ "$fee_spacing" == "200" ]] || { echo "verification failed: feeAmountTickSpacing(10000) is $fee_spacing" >&2; exit 1; }
[[ "${npm_factory,,}" == "${factory,,}" ]] || { echo "verification failed: NPM factory is $npm_factory" >&2; exit 1; }
[[ "${npm_weth9,,}" == "${unsupported_protocol,,}" ]] || { echo "verification failed: NPM WETH9 is $npm_weth9" >&2; exit 1; }

echo "UnsupportedProtocol: $unsupported_protocol"
echo "UniswapV3Factory: $factory"
echo "NFTDescriptor: $nft_descriptor"
echo "NonfungibleTokenPositionDescriptor: $position_descriptor"
echo "NonfungiblePositionManager: $position_manager"
