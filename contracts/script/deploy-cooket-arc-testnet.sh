#!/usr/bin/env bash
# Resumable Arc Testnet Cooket deployment. Safe calls are emitted, never broadcast.
set -euo pipefail

MODE="${1:-plan}"
case "$MODE" in plan|preflight|core-deploy|stage1-manifest|verify-stage1|lp-deploy|stage2-manifest|verify-stage2|verify-final) ;; *) echo "usage: $0 {plan|preflight|core-deploy|stage1-manifest|verify-stage1|lp-deploy|stage2-manifest|verify-stage2|verify-final}" >&2; exit 64;; esac
readonly CHAIN_ID=5042002 RPC_URL="${ARC_TESTNET_RPC_URL:-https://rpc.testnet.arc.io}"
readonly SAFE=0x2741b0E8bC8c90A48CA16cd983a9Ade0dF716d9a DEPLOYER=0x6BE7035f62Ce8ddB4574fE6399eD85E81827c182
readonly UNI_FACTORY=0xc70593E016A5d50451b1A2Cf3173E7d77F120B37 NPM=0x6f8795b30ab107d6306434d979f50181c0bb68a9 USDC=0x3600000000000000000000000000000000000000
readonly DIR=deployments/arc-testnet
readonly CORE="$DIR/core.json" LP="$DIR/lp.json" STAGE1="$DIR/safe-stage1.json" STAGE2="$DIR/safe-stage2.json"
readonly SCRIPT=script/DeployCooketArcTestnet.s.sol:DeployCooketArcTestnet ACCOUNT=cooket-arc-testnet-deployer

die(){ echo "$*" >&2; exit 1; }
eq(){ [[ "${1,,}" == "${2,,}" ]]; }
safe_or_consumed(){ eq "$1" "$SAFE" || eq "$1" 0x0000000000000000000000000000000000000000; }
j(){ jq -er ".$1" "$2"; }
chain(){ [[ "$(cast chain-id --rpc-url "$RPC_URL")" == "$CHAIN_ID" ]] || die "wrong RPC chain"; }
code(){ [[ "$(cast code --rpc-url "$RPC_URL" "$1")" != 0x ]] || die "no code at $1"; }
call(){ cast call --rpc-url "$RPC_URL" "$@"; }
safe_call(){ cast call --rpc-url "$RPC_URL" --from "$SAFE" "$@" >/dev/null; }
require_core(){ [[ -f "$CORE" ]] || die "missing $CORE; run core-deploy first"; }
require_lp(){ [[ -f "$LP" ]] || die "missing $LP; run lp-deploy first"; }
require_account(){
  [[ "${DEPLOYER_ACCOUNT:-}" == "$ACCOUNT" ]] || die "DEPLOYER_ACCOUNT must be $ACCOUNT"
  eq "$(cast wallet address --account "$ACCOUNT")" "$DEPLOYER" || die "named account address is not $DEPLOYER"
}
verify_core_manifest(){
  local manifest=$1 a f g c r d
  [[ "$(j chainId "$manifest")" == "$CHAIN_ID" ]] || die "core manifest chain mismatch"
  eq "$(j safe "$manifest")" "$SAFE" || die "core manifest Safe mismatch"
  eq "$(j deployer "$manifest")" "$DEPLOYER" || die "core manifest deployer mismatch"
  f=$(j feeManager "$manifest"); g=$(j graduationManager "$manifest"); a=$(j cooketFactory "$manifest"); c=$(j communityVault "$manifest"); r=$(j rewardsVault "$manifest"); d=$(j rewardsDistributor "$manifest")
  for a in "$f" "$g" "$a" "$c" "$r" "$d"; do code "$a"; done
  eq "$(call "$f" 'owner()(address)')" "$SAFE" || die "FeeManager owner is not Safe"
  eq "$(call "$f" 'treasury()(address)')" "$SAFE" || die "FeeManager treasury is not Safe"
  safe_or_consumed "$(call "$f" 'factoryBootstrapAuthority()(address)')" || die "unsafe FeeManager bootstrap"
  safe_or_consumed "$(call "$f" 'ecosystemBootstrapAuthority()(address)')" || die "unsafe FeeManager ecosystem bootstrap"
  safe_or_consumed "$(call "$g" 'factoryBootstrapAuthority()(address)')" || die "unsafe Graduation factory bootstrap"
  safe_or_consumed "$(call "$g" 'dependencyBootstrapAuthority()(address)')" || die "unsafe Graduation dependency bootstrap"
  eq "$(call "$c" 'owner()(address)')" "$SAFE" || die "Community owner is not Safe"
  eq "$(call "$c" 'treasury()(address)')" "$SAFE" || die "Community treasury is not Safe"
  safe_or_consumed "$(call "$c" 'lpFeeVaultBootstrapAuthority()(address)')" || die "unsafe Community bootstrap"
  safe_or_consumed "$(call "$r" 'bootstrapAuthority()(address)')" || die "unsafe Rewards bootstrap"
  eq "$(call "$d" 'owner()(address)')" "$SAFE" || die "Distributor owner is not Safe"
  eq "$(call "$g" 'uniswapV3Factory()(address)')" "$UNI_FACTORY" || die "Graduation Uniswap factory mismatch"
  eq "$(call "$g" 'canonicalUsdc()(address)')" "$USDC" || die "Graduation USDC mismatch"
}

if [[ "$MODE" == plan ]]; then
  echo "mode: plan"
  echo "chain id: $CHAIN_ID"
  echo "Safe governance/treasury: $SAFE"
  echo "EOA deployer: $DEPLOYER"
  echo "UniswapV3Factory: $UNI_FACTORY"
  echo "NonfungiblePositionManager: $NPM"
  echo "canonical ERC20 USDC: $USDC"
  echo "legs: core-deploy -> stage1-manifest/verify-stage1 -> lp-deploy -> stage2-manifest/verify-stage2 -> verify-final"
  echo "plan validated; no RPC, keystore, or broadcast access"
  exit 0
fi

command -v cast >/dev/null && command -v forge >/dev/null && command -v jq >/dev/null || die "cast, forge, and jq are required"
chain; code "$UNI_FACTORY"; code "$NPM"; code "$USDC"

if [[ "$MODE" == preflight ]]; then
  [[ "${DEPLOYER_ADDRESS:-}" == "$DEPLOYER" ]] || die "DEPLOYER_ADDRESS must be $DEPLOYER"
  [[ ! -f "$CORE" ]] || die "core manifest already exists; refusing duplicate preflight"
  forge script "$SCRIPT" --sig 'core(bool)' false --rpc-url "$RPC_URL" --sender "$DEPLOYER"
  exit 0
fi

if [[ "$MODE" == core-deploy ]]; then
  require_account; [[ ! -e "$CORE" && ! -e "$DIR/core.pending.json" ]] || die "core leg already exists"
  forge script "$SCRIPT" --sig 'core(bool)' true --rpc-url "$RPC_URL" --account "$ACCOUNT" --broadcast
  [[ -f "$DIR/core.pending.json" ]] || die "core pending manifest missing after broadcast"
  verify_core_manifest "$DIR/core.pending.json"
  mv "$DIR/core.pending.json" "$CORE"
  exit 0
fi

require_core
verify_core_manifest "$CORE"
fees=$(j feeManager "$CORE"); grad=$(j graduationManager "$CORE"); factory=$(j cooketFactory "$CORE"); community=$(j communityVault "$CORE"); rewards=$(j rewardsVault "$CORE"); distributor=$(j rewardsDistributor "$CORE")
for a in "$fees" "$grad" "$factory" "$community" "$rewards" "$distributor"; do code "$a"; done
verify_lp_manifest(){
  local manifest=$1 v c e
  v=$(j permanentLPFeeVault "$manifest"); c=$(j permanentLPCustodianDeployer "$manifest"); e=$(j graduationSettlementExecutor "$manifest")
  for a in "$v" "$c" "$e"; do code "$a"; done
  eq "$(call "$v" 'factory()(address)')" "$factory" || die "LP vault factory mismatch"
  eq "$(call "$v" 'feeManager()(address)')" "$fees" || die "LP vault fee manager mismatch"
  eq "$(call "$v" 'graduationManager()(address)')" "$grad" || die "LP vault graduation mismatch"
  eq "$(call "$v" 'communityVault()(address)')" "$community" || die "LP vault community mismatch"
  eq "$(call "$v" 'traderRewardsVault()(address)')" "$rewards" || die "LP vault rewards mismatch"
  eq "$(call "$c" 'factory()(address)')" "$factory" || die "custodian factory mismatch"
  eq "$(call "$c" 'feeVault()(address)')" "$v" || die "custodian vault mismatch"
  eq "$(call "$c" 'graduationManager()(address)')" "$grad" || die "custodian graduation mismatch"
  eq "$(call "$c" 'nonfungiblePositionManager()(address)')" "$NPM" || die "custodian NPM mismatch"
  eq "$(call "$c" 'settlementExecutor()(address)')" "$e" || die "executor mismatch"
  eq "$(call "$e" 'graduationManager()(address)')" "$grad" || die "executor graduation mismatch"
  eq "$(call "$e" 'nonfungiblePositionManager()(address)')" "$NPM" || die "executor NPM mismatch"
}

if [[ "$MODE" == stage1-manifest ]]; then
  [[ ! -f "$STAGE1" ]] || die "Stage 1 manifest already exists"
  c1=$(cast calldata 'setFactoryOnce(address)' "$factory"); safe_call "$fees" 'setFactoryOnce(address)' "$factory"
  c2=$(cast calldata 'setFactoryOnce(address)' "$factory"); safe_call "$grad" 'setFactoryOnce(address)' "$factory"
  c3=$(cast calldata 'bindEcosystemVaultsOnce(address,address)' "$community" "$rewards"); safe_call "$fees" 'bindEcosystemVaultsOnce(address,address)' "$community" "$rewards"
  c4=$(cast calldata 'setDistributorOnce(address)' "$distributor"); safe_call "$rewards" 'setDistributorOnce(address)' "$distributor"
  mkdir -p "$DIR"
  jq -n --arg safe "$SAFE" --arg f "$fees" --arg g "$grad" --arg r "$rewards" --arg c1 "$c1" --arg c2 "$c2" --arg c3 "$c3" --arg c4 "$c4" '{chainId:5042002,safe:$safe,status:"pending",transactions:[{target:$f,functionSignature:"setFactoryOnce(address)",calldata:$c1,value:"0"},{target:$g,functionSignature:"setFactoryOnce(address)",calldata:$c2,value:"0"},{target:$f,functionSignature:"bindEcosystemVaultsOnce(address,address)",calldata:$c3,value:"0"},{target:$r,functionSignature:"setDistributorOnce(address)",calldata:$c4,value:"0"}]}' >"$STAGE1"
  echo "$STAGE1"
  exit 0
fi

verify_stage1(){
  eq "$(call "$fees" 'factory()(address)')" "$factory" || die "Stage 1 fee factory not confirmed"
  eq "$(call "$grad" 'factory()(address)')" "$factory" || die "Stage 1 graduation factory not confirmed"
  eq "$(call "$fees" 'communityVault()(address)')" "$community" || die "Stage 1 community not confirmed"
  eq "$(call "$fees" 'traderRewardsVault()(address)')" "$rewards" || die "Stage 1 rewards not confirmed"
  eq "$(call "$rewards" 'distributor()(address)')" "$distributor" || die "Stage 1 distributor not confirmed"
  [[ "$(call "$fees" 'factoryBootstrapAuthority()(address)')" == 0x0000000000000000000000000000000000000000 ]] || die "fee bootstrap remains"
  [[ "$(call "$grad" 'factoryBootstrapAuthority()(address)')" == 0x0000000000000000000000000000000000000000 ]] || die "graduation bootstrap remains"
}
if [[ "$MODE" == verify-stage1 ]]; then
  verify_stage1
  if [[ -f "$STAGE1" ]]; then tmp=$(mktemp "$DIR/.stage1.XXXXXX"); jq '.status="confirmed"' "$STAGE1" >"$tmp"; mv "$tmp" "$STAGE1"; fi
  echo "Stage 1 verified"; exit 0
fi

if [[ "$MODE" == lp-deploy ]]; then
  require_account; verify_stage1; [[ ! -e "$LP" && ! -e "$DIR/lp.pending.json" ]] || die "LP leg already exists"
  forge script "$SCRIPT" --sig 'lp(address,address,address,address,address,bool)' "$grad" "$fees" "$factory" "$community" "$rewards" true --rpc-url "$RPC_URL" --account "$ACCOUNT" --broadcast
  [[ -f "$DIR/lp.pending.json" ]] || die "LP pending manifest missing after broadcast"
  verify_lp_manifest "$DIR/lp.pending.json"
  mv "$DIR/lp.pending.json" "$LP"
  exit 0
fi

require_lp
verify_lp_manifest "$LP"
vault=$(j permanentLPFeeVault "$LP"); custodian=$(j permanentLPCustodianDeployer "$LP"); executor=$(j graduationSettlementExecutor "$LP")
for a in "$vault" "$custodian" "$executor"; do code "$a"; done

if [[ "$MODE" == stage2-manifest ]]; then
  [[ ! -f "$STAGE2" ]] || die "Stage 2 manifest already exists"
  c1=$(cast calldata 'setPermanentLPFeeVaultOnce(address)' "$vault"); safe_call "$community" 'setPermanentLPFeeVaultOnce(address)' "$vault"
  c2=$(cast calldata 'setPermanentLPFeeVaultOnce(address)' "$vault"); safe_call "$rewards" 'setPermanentLPFeeVaultOnce(address)' "$vault"
  c3=$(cast calldata 'bindDependenciesOnce(address,address,address)' "$vault" "$custodian" "$NPM"); safe_call "$grad" 'bindDependenciesOnce(address,address,address)' "$vault" "$custodian" "$NPM"
  jq -n --arg safe "$SAFE" --arg c "$community" --arg r "$rewards" --arg g "$grad" --arg c1 "$c1" --arg c2 "$c2" --arg c3 "$c3" '{chainId:5042002,safe:$safe,status:"pending",note:"GraduationManager.bindDependenciesOnce internally calls PermanentLPFeeVault.setPermanentLPCustodianDeployerOnce",transactions:[{target:$c,functionSignature:"setPermanentLPFeeVaultOnce(address)",calldata:$c1,value:"0"},{target:$r,functionSignature:"setPermanentLPFeeVaultOnce(address)",calldata:$c2,value:"0"},{target:$g,functionSignature:"bindDependenciesOnce(address,address,address)",calldata:$c3,value:"0"}]}' >"$STAGE2"
  echo "$STAGE2"
  exit 0
fi

verify_stage2(){
  eq "$(call "$community" 'permanentLPFeeVault()(address)')" "$vault" || die "community vault not bound"
  eq "$(call "$rewards" 'permanentLPFeeVault()(address)')" "$vault" || die "rewards vault not bound"
  eq "$(call "$grad" 'permanentLPFeeVault()(address)')" "$vault" || die "graduation vault not bound"
  eq "$(call "$grad" 'permanentLPCustodianDeployer()(address)')" "$custodian" || die "custodian not bound"
  eq "$(call "$grad" 'settlementExecutor()(address)')" "$executor" || die "executor not bound"
  eq "$(call "$vault" 'permanentLPCustodianDeployer()(address)')" "$custodian" || die "LP vault internal binding missing"
}
if [[ "$MODE" == verify-stage2 ]]; then
  verify_stage2
  if [[ -f "$STAGE2" ]]; then tmp=$(mktemp "$DIR/.stage2.XXXXXX"); jq '.status="confirmed"' "$STAGE2" >"$tmp"; mv "$tmp" "$STAGE2"; fi
  echo "Stage 2 verified"; exit 0
fi
if [[ "$MODE" == verify-final ]]; then
  verify_stage1; verify_stage2
  eq "$(call "$fees" 'owner()(address)')" "$SAFE" || die "fee owner is not Safe"
  eq "$(call "$fees" 'treasury()(address)')" "$SAFE" || die "fee treasury is not Safe"
  eq "$(call "$community" 'owner()(address)')" "$SAFE" || die "community owner is not Safe"
  eq "$(call "$community" 'treasury()(address)')" "$SAFE" || die "community treasury is not Safe"
  eq "$(call "$distributor" 'owner()(address)')" "$SAFE" || die "distributor owner is not Safe"
  jq -s '.[0] * .[1] * {bootstrapStatus:"confirmed",verified:true}' "$CORE" "$LP" >"$DIR/cooket-v3.json"
  echo "final Cooket Arc Testnet deployment verified"
fi
