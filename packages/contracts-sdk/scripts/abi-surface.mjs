export const abiSurface = {
  CooketFactoryV3: {
    artifact: "CooketFactoryV3.sol/CooketFactoryV3.json",
    functions: ["CURVE_ALLOCATION", "LP_ALLOCATION", "PROTOCOL_VERSION", "PROTOCOL_VERSION_HASH", "TOTAL_SUPPLY", "createToken", "curveDeployer", "curveOf", "definitionToken", "feeManager", "graduationManager", "isToken", "protocolVersionHash", "tokenDeployer", "tokenInfo", "tokensByCreator"],
    events: ["TokenLaunchedV3"],
  },
  CooketCurveV3: {
    artifact: "CooketCurveV3.sol/CooketCurveV3.json",
    functions: ["CURVE_ALLOCATION", "EXACT_GRADUATION_GROSS_NATIVE_USDC", "FEE_DENOMINATOR", "GRADUATION_NATIVE_USDC_RESERVE", "INITIAL_NATIVE_USDC_PRICE", "K", "LP_ALLOCATION", "PROTOCOL_VERSION", "TERMINAL_NATIVE_USDC_PRICE", "TOTAL_FEE_BPS", "TOTAL_SUPPLY", "VIRTUAL_NATIVE_USDC_RESERVE", "VIRTUAL_TOKEN_RESERVE", "activeNativeUsdcReserve", "buy", "creator", "factory", "feeManager", "feePolicyHash", "graduated", "graduationManager", "graduationNativeUsdcForwarded", "grossRequiredForNet", "quoteBuy", "quoteSell", "reserveCoordinate", "sell", "soldSupply", "splitFee", "spotPrice", "terminalGraduationReserve", "token", "unaccountedNativeUsdc", "virtualNativeUsdcReserve", "virtualTokenReserve"],
    events: ["Graduated", "GraduationReserveForwarded", "TokensBought", "TokensSold"],
  },
  CooketTokenV3: {
    artifact: "CooketTokenV3.sol/CooketTokenV3.json",
    functions: ["allowance", "approve", "balanceOf", "creator", "decimals", "factory", "initialized", "name", "symbol", "totalSupply", "transfer", "transferFrom"],
    events: ["Approval", "Transfer"],
  },
  GraduationManagerV3: {
    artifact: "GraduationManagerV3.sol/GraduationManagerV3.json",
    functions: ["ARC_PROTOCOL_DOMAIN", "POOL_FEE", "POOL_TICK_SPACING", "PROTOCOL_VERSION_HASH", "canonicalPoolOf", "canonicalUsdc", "classifyPoolCandidate", "expectedSqrtPriceX96", "factory", "launchOf", "launchSelectionOf", "nonfungiblePositionManager", "permanentLPCustodianDeployer", "permanentLPFeeVault", "protocolVersionHash", "residualEscrowOf", "settled", "settlementExecutor", "uniswapV3Factory"],
    events: ["GraduatedV3", "LaunchRegistered"],
  },
  FeeManagerV3: {
    artifact: "FeeManagerV3.sol/FeeManagerV3.json",
    functions: ["CTO_POLICY_HASH", "PROTOCOL_VERSION_HASH", "acceptCreatorPayout", "activateCTO", "cancelCreatorPayout", "checkpointedCreatorFees", "claimCheckpointedCreatorFees", "claimCreatorFees", "claimProtocolFees", "communityFeesAccrued", "communityFeesAccruedByToken", "communityVault", "creatorFeesAccrued", "creatorOf", "creatorPayoutOf", "ctoActive", "ctoPolicyHash", "ctoRegistry", "ctoTreasuryOf", "curveOf", "factory", "feePolicyHash", "pendingCreatorPayoutOf", "proposeCreatorPayout", "protocolFeesAccrued", "protocolVersionHash", "totalCreatorFeesAccrued", "totalLiabilities", "traderRewardsFeesAccrued", "traderRewardsFeesAccruedByToken", "traderRewardsVault", "treasury"],
    events: ["CTOFeeRouteActivated", "CheckpointedCreatorFeesClaimed", "CreatorFeeCheckpointed", "CreatorFeesClaimed", "PendingCreatorPayoutInvalidated"],
  },
  CTORegistryV3: {
    artifact: "CTORegistryV3.sol/CTORegistryV3.json",
    functions: ["ACCEPTANCE_WINDOW", "CTO_DOMAIN", "CTO_POLICY_HASH", "EXECUTION_DELAY", "EXECUTION_GRACE_PERIOD", "MAX_METADATA_URI_LENGTH", "activeTreasury", "cancelCTO", "ctoPolicyHash", "currentProposalId", "executeCTO", "expireCTO", "feeManager", "isCanonicalTreasury", "predictTreasury", "proposal", "proposeCTO", "tokenNonce"],
    events: ["CTOAccepted", "CTOActivated", "CTOCancelled", "CTOExpired", "CTOProposed", "CTOReady", "CTOTreasuryDeployed"],
  },
  CTOTreasuryV3: {
    artifact: "CTOTreasuryV3.sol/CTOTreasuryV3.json",
    functions: ["CTO_POLICY_HASH", "acceptCTO", "canonicalUsdc", "controller", "ctoPolicyHash", "isSupportedAsset", "launchToken", "pullCurveCreatorFees", "pullLPCreatorFees", "registerSupportedAsset", "registry", "transferAsset"],
    events: ["CTOAcceptanceSubmitted", "CreatorFeesPulled", "SupportedAssetRegistered", "TreasuryAssetTransferred"],
  },
  PermanentLPCustodianV3: {
    artifact: "PermanentLPCustodianV3.sol/PermanentLPCustodianV3.json",
    functions: ["boundTokenId", "canonicalFactory", "canonicalUsdc", "collectFees", "feeVault", "graduationManager", "launchToken", "nonfungiblePositionManager", "positionRegistered", "positionTokenId", "protocolVersionHash"],
    events: ["PermanentFeesCollected", "PermanentPositionRegistered"],
  },
  PermanentLPFeeVaultV3: {
    artifact: "PermanentLPFeeVaultV3.sol/PermanentLPFeeVaultV3.json",
    functions: ["canonicalUsdc", "claimLPFees", "communityLPFeesAccrued", "communityVault", "creatorLPFeesAccrued", "factory", "feeManager", "feePolicyHash", "graduationManager", "permanentLPCustodianDeployer", "protocolLPFeesAccrued", "protocolVersionHash", "totalLPFeesAccrued", "traderRewardsLPFeesAccrued", "traderRewardsVault"],
    events: ["CreatorLPFeesClaimed", "PermanentLPFeesAccrued", "ProtocolLPFeesClaimed"],
  },
  PermanentLPCustodianDeployerV3: {
    artifact: "PermanentLPCustodianDeployerV3.sol/PermanentLPCustodianDeployerV3.json",
    functions: ["canonicalUsdc", "custodianOf", "factory", "feeVault", "graduationManager", "nonfungiblePositionManager", "protocolVersionHash", "settlementExecutor"],
    events: ["PermanentCustodianDeployed"],
  },
  GraduationSettlementExecutorV3: {
    artifact: "GraduationSettlementExecutorV3.sol/GraduationSettlementExecutorV3.json",
    functions: ["canonicalUsdc", "graduationManager", "nonfungiblePositionManager"],
    events: [],
  },
};

export const goContracts = ["CooketFactoryV3", "CooketCurveV3", "CooketTokenV3", "GraduationManagerV3", "FeeManagerV3", "CTORegistryV3", "CTOTreasuryV3"];
