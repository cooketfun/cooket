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
  CooketFactoryV4: {
    artifact: "CooketFactoryV4.sol/CooketFactoryV4.json",
    functions: ["CURVE_ALLOCATION", "LP_ALLOCATION", "PROTOCOL_VERSION", "PROTOCOL_VERSION_HASH", "TOTAL_SUPPLY", "createToken", "curveDeployer", "curveOf", "definitionToken", "feeManager", "graduationManager", "isToken", "protocolVersionHash", "tokenDeployer", "tokenInfo", "tokensByCreator"],
    events: ["TokenLaunchedV4"],
  },
  CooketCurveV4: {
    artifact: "CooketCurveV4.sol/CooketCurveV4.json",
    functions: ["CURVE_ALLOCATION", "EXACT_GRADUATION_GROSS_NATIVE_USDC", "FEE_DENOMINATOR", "GRADUATION_NATIVE_USDC_RESERVE", "INITIAL_NATIVE_USDC_PRICE", "K", "LP_ALLOCATION", "PROTOCOL_VERSION", "PROTOCOL_VERSION_HASH", "TERMINAL_NATIVE_USDC_PRICE", "TOTAL_FEE_BPS", "TOTAL_SUPPLY", "VIRTUAL_NATIVE_USDC_RESERVE", "VIRTUAL_TOKEN_RESERVE", "activeNativeUsdcReserve", "buy", "creator", "factory", "feeManager", "feePolicyHash", "graduated", "graduationManager", "graduationNativeUsdcForwarded", "grossRequiredForNet", "protocolVersionHash", "quoteBuy", "quoteSell", "reserveCoordinate", "sell", "soldSupply", "splitFee", "spotPrice", "terminalGraduationReserve", "token", "unaccountedNativeUsdc", "virtualNativeUsdcReserve", "virtualTokenReserve"],
    events: ["Graduated", "GraduationReserveForwarded", "TokensBought", "TokensSold"],
  },
  CooketTokenV4: {
    artifact: "CooketTokenV4.sol/CooketTokenV4.json",
    functions: ["PROTOCOL_VERSION_HASH", "allowance", "approve", "balanceOf", "creator", "decimals", "factory", "initialized", "name", "protocolVersionHash", "symbol", "totalSupply", "transfer", "transferFrom"],
    events: ["Approval", "Transfer"],
  },
  GraduationManagerV4: {
    artifact: "GraduationManagerV4.sol/GraduationManagerV4.json",
    functions: ["ARC_PROTOCOL_DOMAIN", "POOL_FEE", "POOL_TICK_SPACING", "PROTOCOL_VERSION_HASH", "canonicalPoolOf", "canonicalUsdc", "classifyPoolCandidate", "expectedSqrtPriceX96", "factory", "launchOf", "launchSelectionOf", "nonfungiblePositionManager", "permanentLPCustodianDeployer", "permanentLPFeeVault", "protocolVersionHash", "residualEscrowOf", "settled", "settlementExecutor", "uniswapV3Factory"],
    events: ["GraduatedV4", "LaunchRegistered"],
  },
  FeeManagerV4: {
    artifact: "FeeManagerV4.sol/FeeManagerV4.json",
    functions: ["CTO_POLICY_HASH", "PROTOCOL_VERSION_HASH", "acceptCreatorPayout", "activateCTO", "cancelCreatorPayout", "checkpointCreatorFeesForCTO", "checkpointedCreatorFees", "claimCheckpointedCreatorFees", "claimCreatorFees", "claimProtocolFees", "communityFeesAccrued", "communityFeesAccruedByToken", "communityVault", "creatorFeesAccrued", "creatorOf", "creatorPayoutOf", "ctoActive", "ctoPolicyHash", "ctoRegistry", "ctoTreasuryOf", "curveOf", "factory", "feePolicyHash", "pendingCreatorPayoutOf", "proposeCreatorPayout", "protocolFeesAccrued", "protocolVersionHash", "switchCreatorPayoutForCTO", "totalCreatorFeesAccrued", "totalLiabilities", "traderRewardsFeesAccrued", "traderRewardsFeesAccruedByToken", "traderRewardsVault", "treasury"],
    events: ["CTOFeeRouteActivated", "CheckpointedCreatorFeesClaimed", "CreatorFeeCheckpointed", "CreatorFeesClaimed", "PendingCreatorPayoutInvalidated"],
  },
  CTORegistryV4: {
    artifact: "CTORegistryV4.sol/CTORegistryV4.json",
    functions: ["ACCEPTANCE_WINDOW", "CTO_DOMAIN", "CTO_POLICY_HASH", "MAX_METADATA_URI_LENGTH", "PROTOCOL_VERSION_HASH", "activeTreasury", "cancelCTO", "confirmCTO", "ctoPolicyHash", "currentProposalId", "expireCTO", "feeManager", "isCanonicalTreasury", "predictTreasury", "proposal", "proposeCTO", "protocolVersionHash", "tokenNonce"],
    events: ["CTOActivated", "CTOCancelled", "CTOConfirmed", "CTOExpired", "CTOProposed", "CTOTreasuryDeployed"],
  },
  CTOTreasuryV4: {
    artifact: "CTOTreasuryV4.sol/CTOTreasuryV4.json",
    functions: ["CTO_POLICY_HASH", "PROTOCOL_VERSION_HASH", "canonicalUsdc", "confirmCTO", "controller", "ctoPolicyHash", "isSupportedAsset", "launchToken", "protocolVersionHash", "pullCurveCreatorFees", "pullLPCreatorFees", "registerSupportedAsset", "registry", "transferAsset"],
    events: ["CTOConfirmationSubmitted", "CreatorFeesPulled", "SupportedAssetRegistered", "TreasuryAssetTransferred"],
  },
  PermanentLPCustodianV4: {
    artifact: "PermanentLPCustodianV4.sol/PermanentLPCustodianV4.json",
    functions: ["boundTokenId", "canonicalFactory", "canonicalUsdc", "collectFees", "feeVault", "graduationManager", "launchToken", "nonfungiblePositionManager", "positionRegistered", "positionTokenId", "protocolVersionHash"],
    events: ["PermanentFeesCollected", "PermanentPositionRegistered"],
  },
  PermanentLPFeeVaultV4: {
    artifact: "PermanentLPFeeVaultV4.sol/PermanentLPFeeVaultV4.json",
    functions: ["canonicalUsdc", "claimLPFees", "communityLPFeesAccrued", "communityVault", "creatorLPFeesAccrued", "factory", "feeManager", "feePolicyHash", "graduationManager", "permanentLPCustodianDeployer", "protocolLPFeesAccrued", "protocolVersionHash", "totalLPFeesAccrued", "traderRewardsLPFeesAccrued", "traderRewardsVault"],
    events: ["CreatorLPFeesClaimed", "PermanentLPFeesAccrued", "ProtocolLPFeesClaimed"],
  },
  PermanentLPCustodianDeployerV4: {
    artifact: "PermanentLPCustodianDeployerV4.sol/PermanentLPCustodianDeployerV4.json",
    functions: ["canonicalUsdc", "custodianOf", "factory", "feeVault", "graduationManager", "nonfungiblePositionManager", "protocolVersionHash", "settlementExecutor"],
    events: ["PermanentCustodianDeployed"],
  },
  GraduationSettlementExecutorV4: {
    artifact: "GraduationSettlementExecutorV4.sol/GraduationSettlementExecutorV4.json",
    functions: ["PROTOCOL_VERSION_HASH", "canonicalUsdc", "graduationManager", "nonfungiblePositionManager", "protocolVersionHash"],
    events: [],
  },
};

export const goContracts = ["CooketFactoryV3", "CooketCurveV3", "CooketTokenV3", "GraduationManagerV3", "FeeManagerV3", "CTORegistryV3", "CTOTreasuryV3"];
