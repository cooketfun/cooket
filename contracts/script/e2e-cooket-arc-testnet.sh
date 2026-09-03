#!/usr/bin/env bash
# Destructive Arc Testnet E2E runner. `run` is the only broadcasting mode.
set -euo pipefail

MODE="${1:-plan}"
case "$MODE" in plan|preflight|run) ;; *) echo "usage: $0 [plan|preflight|run]" >&2; exit 64;; esac
readonly CHAIN_ID=5042002
readonly RPC_URL="${ARC_TESTNET_RPC_URL:-https://rpc.testnet.arc.io}"
readonly COOKET_MANIFEST=deployments/arc-testnet/cooket-v3.json
readonly PERIPHERY_MANIFEST=deployments/arc-testnet/uniswap-v3-periphery.json
readonly RUN_MANIFEST=deployments/arc-testnet/e2e-run.json
readonly SAFE=0x2741b0E8bC8c90A48CA16cd983a9Ade0dF716d9a
readonly DEPLOYER=0x6BE7035f62Ce8ddB4574fE6399eD85E81827c182
readonly USDC=0x3600000000000000000000000000000000000000
readonly EXPECTED_E2E_ACCOUNT=cooket-arc-testnet-e2e
readonly ZERO=0x0000000000000000000000000000000000000000
readonly POOL_FEE=10000
readonly TEST_BUY_WEI=1000000000000000000
readonly POST_GRAD_BUY_USDC6=1000000

die() { echo "$*" >&2; exit 1; }
eq() { [[ "${1,,}" == "${2,,}" ]]; }
j() { jq -er ".$1" "$2"; }
call() { cast call --rpc-url "$RPC_URL" "$@"; }
call_uint() { local output; output=$(call "$@"); printf '%s\n' "${output%%[[:space:]]*}"; }
code() { [[ "$(cast code --rpc-url "$RPC_URL" "$1")" != 0x ]] || die "no bytecode at $1"; }
bigmath() { node -e "console.log(($1).toString())"; }
big_ge() { node -e "process.exit(BigInt(process.argv[1]) >= BigInt(process.argv[2]) ? 0 : 1)" "$1" "$2"; }
big_gt() { node -e "process.exit(BigInt(process.argv[1]) > BigInt(process.argv[2]) ? 0 : 1)" "$1" "$2"; }
big_lt() { node -e "process.exit(BigInt(process.argv[1]) < BigInt(process.argv[2]) ? 0 : 1)" "$1" "$2"; }

for command_name in cast jq node; do command -v "$command_name" >/dev/null || die "missing required command: $command_name"; done
[[ -f "$COOKET_MANIFEST" ]] || die "missing verified deployment manifest: $COOKET_MANIFEST"
[[ "$(j chainId "$COOKET_MANIFEST")" == "$CHAIN_ID" && "$(j verified "$COOKET_MANIFEST")" == true ]] || die "Cooket manifest is not final and verified"
eq "$(j safe "$COOKET_MANIFEST")" "$SAFE" || die "Cooket manifest Safe mismatch"
eq "$(j canonicalUsdc "$COOKET_MANIFEST")" "$USDC" || die "Cooket manifest canonical USDC mismatch"

factory=$(j cooketFactory "$COOKET_MANIFEST")
fees=$(j feeManager "$COOKET_MANIFEST")
graduation=$(j graduationManager "$COOKET_MANIFEST")
npm=$(j nonfungiblePositionManager "$COOKET_MANIFEST")
vault=$(j permanentLPFeeVault "$COOKET_MANIFEST")
custodian_deployer=$(j permanentLPCustodianDeployer "$COOKET_MANIFEST")
uniswap_factory=$(j uniswapV3Factory "$COOKET_MANIFEST")
community=$(j communityVault "$COOKET_MANIFEST")
rewards=$(j rewardsVault "$COOKET_MANIFEST")
distributor=$(j rewardsDistributor "$COOKET_MANIFEST")
cto_registry=$(j ctoRegistry "$COOKET_MANIFEST")
token_deployer=$(j tokenDeployer "$COOKET_MANIFEST")
curve_deployer=$(j curveDeployer "$COOKET_MANIFEST")
settlement_executor=$(j graduationSettlementExecutor "$COOKET_MANIFEST")

echo "mode: $MODE"
echo "chain id: $CHAIN_ID"
echo "Cooket manifest: $COOKET_MANIFEST"
echo "CooketFactoryV3: $factory"
echo "Safe governance/treasury: $SAFE"
echo "dedicated E2E account required: $EXPECTED_E2E_ACCOUNT"

if [[ "$MODE" == plan ]]; then
  if [[ -f "$PERIPHERY_MANIFEST" ]]; then
    echo "Uniswap trading periphery manifest: $PERIPHERY_MANIFEST"
  else
    echo "missing dependency: verified SwapRouter and QuoterV2 manifest ($PERIPHERY_MANIFEST)"
  fi
  echo "flow: launch -> curve buy -> curve sell -> graduation -> pool/LP custody -> quote -> ERC20 USDC buy -> token sell"
  echo "plan complete; no RPC, account, password, or broadcast access"
  exit 0
fi

[[ "$(cast chain-id --rpc-url "$RPC_URL")" == "$CHAIN_ID" ]] || die "RPC is not Arc Testnet $CHAIN_ID"
for address in "$factory" "$fees" "$graduation" "$npm" "$vault" "$custodian_deployer" "$uniswap_factory" "$USDC" "$community" "$rewards" "$distributor" "$cto_registry" "$token_deployer" "$curve_deployer" "$settlement_executor"; do code "$address"; done
eq "$(call "$fees" 'owner()(address)')" "$SAFE" || die "FeeManager owner is not Safe"
eq "$(call "$fees" 'treasury()(address)')" "$SAFE" || die "FeeManager treasury is not Safe"
eq "$(call "$fees" 'factory()(address)')" "$factory" || die "FeeManager factory mismatch"
eq "$(call "$fees" 'communityVault()(address)')" "$community" || die "FeeManager community vault mismatch"
eq "$(call "$fees" 'traderRewardsVault()(address)')" "$rewards" || die "FeeManager rewards vault mismatch"
eq "$(call "$fees" 'ctoRegistry()(address)')" "$cto_registry" || die "FeeManager CTO registry mismatch"
eq "$(call "$cto_registry" 'feeManager()(address)')" "$fees" || die "CTO registry fee manager mismatch"
eq "$(call "$factory" 'feeManager()(address)')" "$fees" || die "Cooket factory fee manager mismatch"
eq "$(call "$factory" 'graduationManager()(address)')" "$graduation" || die "Cooket factory graduation manager mismatch"
eq "$(call "$factory" 'tokenDeployer()(address)')" "$token_deployer" || die "Cooket token deployer mismatch"
eq "$(call "$factory" 'curveDeployer()(address)')" "$curve_deployer" || die "Cooket curve deployer mismatch"
eq "$(call "$community" 'owner()(address)')" "$SAFE" || die "Community vault owner is not Safe"
eq "$(call "$community" 'treasury()(address)')" "$SAFE" || die "Community vault treasury is not Safe"
eq "$(call "$community" 'feeManager()(address)')" "$fees" || die "Community vault fee manager mismatch"
eq "$(call "$community" 'permanentLPFeeVault()(address)')" "$vault" || die "Community LP vault mismatch"
eq "$(call "$rewards" 'feeManager()(address)')" "$fees" || die "Rewards vault fee manager mismatch"
eq "$(call "$rewards" 'distributor()(address)')" "$distributor" || die "Rewards distributor mismatch"
eq "$(call "$rewards" 'permanentLPFeeVault()(address)')" "$vault" || die "Rewards LP vault mismatch"
eq "$(call "$distributor" 'owner()(address)')" "$SAFE" || die "Rewards distributor owner is not Safe"
eq "$(call "$graduation" 'factory()(address)')" "$factory" || die "Graduation factory mismatch"
eq "$(call "$graduation" 'nonfungiblePositionManager()(address)')" "$npm" || die "Graduation Position Manager mismatch"
eq "$(call "$graduation" 'permanentLPFeeVault()(address)')" "$vault" || die "Graduation LP vault mismatch"
eq "$(call "$graduation" 'permanentLPCustodianDeployer()(address)')" "$custodian_deployer" || die "Graduation custodian deployer mismatch"
eq "$(call "$graduation" 'canonicalUsdc()(address)')" "$USDC" || die "Graduation USDC mismatch"
eq "$(call "$npm" 'factory()(address)')" "$uniswap_factory" || die "Position Manager factory mismatch"
eq "$(call "$vault" 'factory()(address)')" "$factory" || die "LP vault factory mismatch"
eq "$(call "$vault" 'feeManager()(address)')" "$fees" || die "LP vault fee manager mismatch"
eq "$(call "$vault" 'graduationManager()(address)')" "$graduation" || die "LP vault graduation manager mismatch"
eq "$(call "$vault" 'communityVault()(address)')" "$community" || die "LP vault community mismatch"
eq "$(call "$vault" 'traderRewardsVault()(address)')" "$rewards" || die "LP vault rewards mismatch"
eq "$(call "$vault" 'permanentLPCustodianDeployer()(address)')" "$custodian_deployer" || die "LP vault custodian deployer mismatch"
eq "$(call "$custodian_deployer" 'settlementExecutor()(address)')" "$settlement_executor" || die "settlement executor binding mismatch"
eq "$(call "$settlement_executor" 'graduationManager()(address)')" "$graduation" || die "settlement executor manager mismatch"
eq "$(call "$settlement_executor" 'nonfungiblePositionManager()(address)')" "$npm" || die "settlement executor Position Manager mismatch"
for authority in \
  "$(call "$fees" 'factoryBootstrapAuthority()(address)')" \
  "$(call "$fees" 'ecosystemBootstrapAuthority()(address)')" \
  "$(call "$graduation" 'factoryBootstrapAuthority()(address)')" \
  "$(call "$graduation" 'dependencyBootstrapAuthority()(address)')" \
  "$(call "$community" 'lpFeeVaultBootstrapAuthority()(address)')" \
  "$(call "$rewards" 'bootstrapAuthority()(address)')" \
  "$(call "$vault" 'custodianDeployerBootstrapAuthority()(address)')"; do
  eq "$authority" "$ZERO" || die "a one-time bootstrap authority remains active at $authority"
done

periphery_ready=false
if [[ -f "$PERIPHERY_MANIFEST" ]]; then
  [[ "$(j chainId "$PERIPHERY_MANIFEST")" == "$CHAIN_ID" && "$(j verified "$PERIPHERY_MANIFEST")" == true ]] || die "periphery manifest is not verified Arc Testnet configuration"
  router=$(j swapRouter "$PERIPHERY_MANIFEST")
  quoter=$(j quoterV2 "$PERIPHERY_MANIFEST")
  unsupported=$(j unsupportedProtocol "$PERIPHERY_MANIFEST")
  for address in "$router" "$quoter" "$unsupported"; do code "$address"; done
  for address in "$router" "$quoter"; do
    eq "$(call "$address" 'factory()(address)')" "$uniswap_factory" || die "$address factory mismatch"
    eq "$(call "$address" 'WETH9()(address)')" "$unsupported" || die "$address no-WETH marker mismatch"
  done
  periphery_ready=true
fi

[[ -n "${E2E_ADDRESS:-}" ]] || die "E2E_ADDRESS is required for preflight and run"
[[ "$E2E_ADDRESS" =~ ^0x[[:xdigit:]]{40}$ ]] || die "E2E_ADDRESS is invalid"
eq "$E2E_ADDRESS" "$ZERO" && die "E2E address cannot be zero"
eq "$E2E_ADDRESS" "$SAFE" && die "Safe cannot be the E2E actor"
eq "$E2E_ADDRESS" "$DEPLOYER" && die "deployer cannot be the E2E actor"
native_balance=$(cast balance --rpc-url "$RPC_URL" "$E2E_ADDRESS")
native_balance=${native_balance%%[[:space:]]*}
usdc_balance=$(call_uint "$USDC" 'balanceOf(address)(uint256)' "$E2E_ADDRESS")
echo "E2E address: $E2E_ADDRESS"
echo "native USDC balance (18 decimals): $native_balance"
echo "canonical ERC20 USDC balance (6 decimals): $usdc_balance"

salt="${E2E_USER_SALT:-$(cast keccak 'cooket-arc-testnet-e2e-v1')}"
[[ "$salt" =~ ^0x[[:xdigit:]]{64}$ ]] || die "E2E_USER_SALT must be bytes32"

if [[ "$MODE" == preflight ]]; then
  [[ ! -e "$RUN_MANIFEST" ]] || die "$RUN_MANIFEST exists; refusing to preflight a duplicate E2E run"
  launch_gas=$(cast estimate --rpc-url "$RPC_URL" --from "$E2E_ADDRESS" "$factory" 'createToken(string,string,bytes32)' 'Cooket Arc E2E' 'CAE2E' "$salt")
  gas_price=$(cast gas-price --rpc-url "$RPC_URL")
  echo "gas price: $gas_price"
  echo "token launch estimated gas: $launch_gas"
  echo "required graduation budget upper bound (18 decimals): 7318181818181818181818"
  [[ "$periphery_ready" == true ]] || die "post-graduation E2E blocked: deploy and verify $PERIPHERY_MANIFEST first"
  echo "preflight passed; no keystore, password, or broadcast access"
  exit 0
fi

[[ "$periphery_ready" == true ]] || die "post-graduation E2E blocked: deploy and verify $PERIPHERY_MANIFEST first"
[[ "${E2E_ACCOUNT:-}" == "$EXPECTED_E2E_ACCOUNT" ]] || die "E2E_ACCOUNT must be $EXPECTED_E2E_ACCOUNT"
eq "$(cast wallet address --account "$E2E_ACCOUNT")" "$E2E_ADDRESS" || die "named E2E account address mismatch"
[[ ! -e "$RUN_MANIFEST" ]] || die "$RUN_MANIFEST already exists; refusing duplicate E2E run"
big_ge "$native_balance" 7321000000000000000000 || die "E2E account needs at least 7,321 native USDC including a gas reserve"
big_ge "$usdc_balance" "$POST_GRAD_BUY_USDC6" || die "E2E account needs at least 1 canonical ERC20 USDC"

send() {
  local target=$1; shift
  cast send --json --rpc-url "$RPC_URL" --account "$E2E_ACCOUNT" "$target" "$@"
}
tx_hash() { jq -er '.transactionHash' <<<"$1"; }
require_success() { [[ "$(jq -r '.status' <<<"$1")" == 0x1 ]] || die "$2 transaction failed"; }
require_event() {
  local receipt=$1 signature=$2 label=$3 topic
  topic=$(cast keccak "$signature")
  jq -e --arg topic "${topic,,}" '[.logs[].topics[0] | ascii_downcase] | index($topic) != null' <<<"$receipt" >/dev/null || die "$label event missing"
}

launch_receipt=$(send "$factory" 'createToken(string,string,bytes32)' 'Cooket Arc E2E' 'CAE2E' "$salt")
require_success "$launch_receipt" launch
require_event "$launch_receipt" 'TokenLaunchedV3(address,address,address,string,uint256,uint256,uint256,address,address,bytes32,bytes32,uint16)' TokenLaunchedV3
launch_topic=$(cast keccak 'TokenLaunchedV3(address,address,address,string,uint256,uint256,uint256,address,address,bytes32,bytes32,uint16)')
launch_log=$(jq -cer --arg address "${factory,,}" --arg topic "${launch_topic,,}" '.logs[] | select((.address|ascii_downcase)==$address and (.topics[0]|ascii_downcase)==$topic)' <<<"$launch_receipt")
token="0x$(jq -r '.topics[2]' <<<"$launch_log" | tail -c 41)"
curve="0x$(jq -r '.topics[3]' <<<"$launch_log" | tail -c 41)"
eq "$(call "$factory" 'curveOf(address)(address)' "$token")" "$curve" || die "launched token/curve binding mismatch"
pool=$(call "$graduation" 'canonicalPoolOf(address)(address)' "$token")
for address in "$token" "$curve" "$pool"; do code "$address"; done
eq "$(call "$pool" 'factory()(address)')" "$uniswap_factory" || die "pool factory mismatch"
[[ "$(call_uint "$pool" 'liquidity()(uint128)')" == 0 ]] || die "launch pool unexpectedly has liquidity"

deadline=$(( $(date +%s) + 600 ))
token_before=$(call_uint "$token" 'balanceOf(address)(uint256)' "$E2E_ADDRESS")
buy_receipt=$(send "$curve" --value "$TEST_BUY_WEI" 'buy(uint256,uint256)' 0 "$deadline")
require_success "$buy_receipt" curve-buy
require_event "$buy_receipt" 'TokensBought(address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)' TokensBought
token_after_buy=$(call_uint "$token" 'balanceOf(address)(uint256)' "$E2E_ADDRESS")
big_gt "$token_after_buy" "$token_before" || die "curve buy did not increase token balance"

curve_sell_amount=1000000000000000000
approve_receipt=$(send "$token" 'approve(address,uint256)' "$curve" "$curve_sell_amount")
require_success "$approve_receipt" curve-approval
big_ge "$(call_uint "$token" 'allowance(address,address)(uint256)' "$E2E_ADDRESS" "$curve")" "$curve_sell_amount" || die "curve allowance insufficient"
deadline=$(( $(date +%s) + 600 ))
sell_receipt=$(send "$curve" 'sell(uint256,uint256,uint256)' "$curve_sell_amount" 0 "$deadline")
require_success "$sell_receipt" curve-sell
require_event "$sell_receipt" 'TokensSold(address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)' TokensSold
token_after_sell=$(call_uint "$token" 'balanceOf(address)(uint256)' "$E2E_ADDRESS")
big_lt "$token_after_sell" "$token_after_buy" || die "curve sell did not reduce token balance"

reserve=$(call_uint "$curve" 'activeNativeUsdcReserve()(uint256)')
remaining=$(bigmath "7245000000000000000000n-BigInt('$reserve')")
graduation_gross=$(call_uint "$curve" 'grossRequiredForNet(uint256)(uint256)' "$remaining")
deadline=$(( $(date +%s) + 600 ))
graduation_receipt=$(send "$curve" --value "$graduation_gross" 'buy(uint256,uint256)' 0 "$deadline")
require_success "$graduation_receipt" graduation-buy
require_event "$graduation_receipt" 'GraduatedV3(address,address,uint256,uint128)' GraduatedV3
[[ "$(call "$curve" 'graduated()(bool)')" == true ]] || die "curve did not graduate"
[[ "$(call "$graduation" 'settled(address)(bool)' "$token")" == true ]] || die "graduation manager did not settle token"
big_gt "$(call_uint "$pool" 'liquidity()(uint128)')" 0 || die "graduated pool has no liquidity"

graduated_topic=$(cast keccak 'GraduatedV3(address,address,uint256,uint128)')
graduated_log=$(jq -cer --arg address "${graduation,,}" --arg topic "${graduated_topic,,}" '.logs[] | select((.address|ascii_downcase)==$address and (.topics[0]|ascii_downcase)==$topic)' <<<"$graduation_receipt")
custodian="0x$(jq -r '.topics[2]' <<<"$graduated_log" | tail -c 41)"
token_id=$(cast to-dec "$(jq -r '.topics[3]' <<<"$graduated_log")")
code "$custodian"
eq "$(call "$npm" 'ownerOf(uint256)(address)' "$token_id")" "$custodian" || die "LP NFT is not owned by permanent custodian"
[[ "$(call "$custodian" 'positionRegistered()(bool)')" == true ]] || die "custodian position is not registered"
[[ "$(call_uint "$custodian" 'positionTokenId()(uint256)')" == "$token_id" ]] || die "custodian token ID mismatch"

quote_buy=$(call "$quoter" 'quoteExactInputSingle((address,address,uint256,uint24,uint160))(uint256,uint160,uint32,uint256)' "($USDC,$token,$POST_GRAD_BUY_USDC6,$POOL_FEE,0)")
buy_out=${quote_buy%%[[:space:]]*}
buy_min=$(bigmath "BigInt('$buy_out')*99n/100n")
approve_usdc=$(send "$USDC" 'approve(address,uint256)' "$router" "$POST_GRAD_BUY_USDC6")
require_success "$approve_usdc" post-graduation-USDC-approval
big_ge "$(call_uint "$USDC" 'allowance(address,address)(uint256)' "$E2E_ADDRESS" "$router")" "$POST_GRAD_BUY_USDC6" || die "router USDC allowance insufficient"
deadline=$(( $(date +%s) + 600 ))
token_before_swap=$(call_uint "$token" 'balanceOf(address)(uint256)' "$E2E_ADDRESS")
post_buy=$(send "$router" 'exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))' "($USDC,$token,$POOL_FEE,$E2E_ADDRESS,$deadline,$POST_GRAD_BUY_USDC6,$buy_min,0)")
require_success "$post_buy" post-graduation-buy
token_after_swap=$(call_uint "$token" 'balanceOf(address)(uint256)' "$E2E_ADDRESS")
big_gt "$token_after_swap" "$token_before_swap" || die "post-graduation buy did not increase token balance"

post_sell_amount=$(bigmath "(BigInt('$token_after_swap')-BigInt('$token_before_swap'))/2n")
quote_sell=$(call "$quoter" 'quoteExactInputSingle((address,address,uint256,uint24,uint160))(uint256,uint160,uint32,uint256)' "($token,$USDC,$post_sell_amount,$POOL_FEE,0)")
sell_out=${quote_sell%%[[:space:]]*}
sell_min=$(bigmath "BigInt('$sell_out')*99n/100n")
approve_token=$(send "$token" 'approve(address,uint256)' "$router" "$post_sell_amount")
require_success "$approve_token" post-graduation-token-approval
big_ge "$(call_uint "$token" 'allowance(address,address)(uint256)' "$E2E_ADDRESS" "$router")" "$post_sell_amount" || die "router token allowance insufficient"
usdc_before_sell=$(call_uint "$USDC" 'balanceOf(address)(uint256)' "$E2E_ADDRESS")
post_sell=$(send "$router" 'exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))' "($token,$USDC,$POOL_FEE,$E2E_ADDRESS,$deadline,$post_sell_amount,$sell_min,0)")
require_success "$post_sell" post-graduation-sell
usdc_after_sell=$(call_uint "$USDC" 'balanceOf(address)(uint256)' "$E2E_ADDRESS")
big_gt "$usdc_after_sell" "$usdc_before_sell" || die "post-graduation sell did not increase canonical USDC balance"

tmp=$(mktemp "$(dirname "$RUN_MANIFEST")/.e2e-run.XXXXXX")
jq -n --arg actor "$E2E_ADDRESS" --arg token "$token" --arg curve "$curve" --arg pool "$pool" --arg custodian "$custodian" --arg tokenId "$token_id" \
  --arg launchTx "$(tx_hash "$launch_receipt")" --arg graduationTx "$(tx_hash "$graduation_receipt")" --arg buyTx "$(tx_hash "$post_buy")" --arg sellTx "$(tx_hash "$post_sell")" \
  '{chainId:5042002,status:"verified",actor:$actor,token:$token,curve:$curve,pool:$pool,lpCustodian:$custodian,positionTokenId:$tokenId,transactions:{launch:$launchTx,graduation:$graduationTx,postGraduationBuy:$buyTx,postGraduationSell:$sellTx}}' >"$tmp"
mv "$tmp" "$RUN_MANIFEST"
echo "E2E verified: $RUN_MANIFEST"
