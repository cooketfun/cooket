// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {CTORegistryV3} from "../../src/v3/CTORegistryV3.sol";
import {CTOTreasuryV3} from "../../src/v3/CTOTreasuryV3.sol";
import {ICTORegistryV3} from "../../src/v3/interfaces/ICTORegistryV3.sol";
import {FeeManagerV3} from "../../src/v3/FeeManagerV3.sol";
import {CooketTokenV3} from "../../src/v3/CooketTokenV3.sol";
import {CooketFactoryV3} from "../../src/v3/CooketFactoryV3.sol";
import {CooketCurveV3} from "../../src/v3/CooketCurveV3.sol";
import {GraduationManagerV3} from "../../src/v3/GraduationManagerV3.sol";
import {PermanentLPFeeVaultV3} from "../../src/v3/PermanentLPFeeVaultV3.sol";
import {PermanentLPCustodianV3} from "../../src/v3/PermanentLPCustodianV3.sol";
import {PermanentLPCustodianDeployerV3} from "../../src/v3/PermanentLPCustodianDeployerV3.sol";
import {TokenCommunityVaultV3} from "../../src/v3/TokenCommunityVaultV3.sol";
import {TraderRewardsVaultV3} from "../../src/v3/TraderRewardsVaultV3.sol";
import {TraderRewardsDistributorV3} from "../../src/v3/TraderRewardsDistributorV3.sol";
import {IPermanentLPFeeVaultV3} from "../../src/v3/interfaces/IPermanentLPFeeVaultV3.sol";
import {EndpointConstantsV3} from "../../src/v3/libraries/EndpointConstantsV3.sol";
import {ArcNativeUsdcV3} from "../../src/v3/libraries/ArcNativeUsdcV3.sol";
import {CooketV3TestBase} from "./helpers/CooketV3TestBase.sol";
import {MockCTOControllerV3} from "./mocks/MockCTOControllerV3.sol";
import {MockArcDualViewUsdcV3} from "./mocks/MockArcDualViewUsdcV3.sol";
import {MockNonfungiblePositionManagerV3} from "./mocks/MockNonfungiblePositionManagerV3.sol";
import {MockUniswapV3FactoryV3} from "./mocks/MockUniswapV3.sol";

contract CTORegistryV3Test is CooketV3TestBase {
    CTORegistryV3 internal registry;
    MockCTOControllerV3 internal controller;

    function setUp() public override {
        super.setUp();
        registry = CTORegistryV3(feeManager.ctoRegistry());
        controller = new MockCTOControllerV3();
    }

    function testOnlyOriginalCreatorCanProposeAndRelationshipsAreCanonical() public {
        vm.prank(buyer);
        vm.expectRevert(ICTORegistryV3.UnauthorizedCreator.selector);
        registry.proposeCTO(address(token), address(controller), bytes32(0), "");

        (bytes32 id, address treasury) = _propose(bytes32(0), "");
        ICTORegistryV3.Proposal memory details = registry.proposal(id);
        assertEq(details.creator, creator);
        assertEq(details.token, address(token));
        assertEq(details.controller, address(controller));
        assertEq(details.treasury, treasury);
        assertEq(details.previousRecipient, creator);
        assertEq(uint256(details.state), uint256(ICTORegistryV3.ProposalState.Proposed));
    }

    function testRejectsZeroEOAAndOneLiveProposal() public {
        vm.startPrank(creator);
        vm.expectRevert(ICTORegistryV3.InvalidController.selector);
        registry.proposeCTO(address(token), address(0), bytes32(0), "");
        vm.expectRevert(ICTORegistryV3.InvalidController.selector);
        registry.proposeCTO(address(token), buyer, bytes32(0), "");
        registry.proposeCTO(address(token), address(controller), bytes32(0), "");
        vm.expectRevert(ICTORegistryV3.LiveProposalExists.selector);
        registry.proposeCTO(address(token), address(controller), bytes32(0), "");
        vm.stopPrank();
    }

    function testCanonicalRelationshipMismatchesRejectProposal() public {
        _expectRelationshipMismatch(
            address(factory), abi.encodeWithSignature("isToken(address)", address(token)), abi.encode(false)
        );
        _expectRelationshipMismatch(
            address(factory), abi.encodeWithSignature("curveOf(address)", address(token)), abi.encode(buyer)
        );
        _expectRelationshipMismatch(address(token), abi.encodeWithSignature("creator()"), abi.encode(buyer));
        _expectRelationshipMismatch(address(token), abi.encodeWithSignature("factory()"), abi.encode(buyer));
        _expectRelationshipMismatch(address(token), abi.encodeWithSignature("initialized()"), abi.encode(false));
        _expectRelationshipMismatch(address(curve), abi.encodeWithSignature("creator()"), abi.encode(buyer));
        _expectRelationshipMismatch(address(curve), abi.encodeWithSignature("factory()"), abi.encode(buyer));
        _expectRelationshipMismatch(address(curve), abi.encodeWithSignature("token()"), abi.encode(buyer));
        _expectRelationshipMismatch(address(graduationManager), abi.encodeWithSignature("factory()"), abi.encode(buyer));
        _expectRelationshipMismatch(
            address(graduationManager),
            abi.encodeWithSignature("launchOf(address)", address(token)),
            abi.encode(address(curve), buyer, true, false)
        );
    }

    function testProposalRejectsCurveFeeManagerMismatch() public {
        _expectRelationshipMismatch(address(curve), abi.encodeWithSignature("feeManager()"), abi.encode(buyer));
    }

    function testProposalRejectsCurveGraduationManagerMismatch() public {
        _expectRelationshipMismatch(address(curve), abi.encodeWithSignature("graduationManager()"), abi.encode(buyer));
    }

    function testExecutionRejectsCurveFeeManagerMismatchAndRollsBack() public {
        _expectExecutionRelationshipMismatch(abi.encodeWithSignature("feeManager()"));
    }

    function testExecutionRejectsCurveGraduationManagerMismatchAndRollsBack() public {
        _expectExecutionRelationshipMismatch(abi.encodeWithSignature("graduationManager()"));
    }

    function testDeterministicTreasurySaltProposalIdAndNonceParity() public {
        address predicted = registry.predictTreasury(address(token), address(controller), 1);
        (bytes32 id, address treasury) = _propose(bytes32(0), "ipfs://agreement");
        assertEq(treasury, predicted);
        assertEq(registry.tokenNonce(address(token)), 1);
        bytes32 metadataHash = keccak256(bytes("ipfs://agreement"));
        bytes32 expectedId = keccak256(
            abi.encode(
                keccak256("COOKET_VOLUNTARY_CTO_V1"),
                block.chainid,
                address(registry),
                address(token),
                uint64(1),
                treasury,
                address(controller),
                metadataHash
            )
        );
        assertEq(id, expectedId);
    }

    function testMetadataHashingAndLengthBoundaries() public {
        bytes32 expected = keccak256(bytes("ipfs://agreement"));
        (bytes32 id,) = _propose(bytes32(0), "ipfs://agreement");
        assertEq(registry.proposal(id).metadataHash, expected);

        vm.prank(creator);
        registry.cancelCTO(id);
        vm.prank(creator);
        vm.expectRevert(ICTORegistryV3.InvalidMetadata.selector);
        registry.proposeCTO(address(token), address(controller), bytes32(uint256(1)), "ipfs://agreement");

        string memory maxUri = _repeat("a", 256);
        vm.prank(creator);
        registry.proposeCTO(address(token), address(controller), keccak256(bytes(maxUri)), maxUri);
    }

    function testMetadataOverMaximumRejected() public {
        string memory oversized = _repeat("a", 257);
        vm.prank(creator);
        vm.expectRevert(ICTORegistryV3.InvalidMetadata.selector);
        registry.proposeCTO(address(token), address(controller), bytes32(0), oversized);
    }

    function testAcceptanceDeadlineAndTimelockGraceBoundaries() public {
        (bytes32 id, address treasury) = _propose(bytes32(0), "");
        uint256 createdAt = block.timestamp;
        vm.warp(createdAt + 7 days);
        controller.accept(CTOTreasuryV3(payable(treasury)), id);
        uint256 acceptedAt = block.timestamp;

        vm.warp(acceptedAt + 72 hours - 1);
        vm.expectRevert(ICTORegistryV3.TimelockNotElapsed.selector);
        registry.executeCTO(id);
        vm.warp(acceptedAt + 72 hours);
        vm.prank(buyer);
        registry.executeCTO(id);
        assertTrue(feeManager.ctoActive(address(token)));
    }

    function testAcceptanceOneSecondAfterDeadlineRejectedAndPermissionlessExpiry() public {
        (bytes32 id, address treasury) = _propose(bytes32(0), "");
        vm.warp(block.timestamp + 7 days + 1);
        vm.expectRevert(ICTORegistryV3.AcceptanceWindowExpired.selector);
        controller.accept(CTOTreasuryV3(payable(treasury)), id);
        vm.prank(buyer);
        registry.expireCTO(id);
        assertEq(uint256(registry.proposal(id).state), uint256(ICTORegistryV3.ProposalState.Expired));
        vm.prank(creator);
        (bytes32 nextId,) = registry.proposeCTO(address(token), address(controller), bytes32(0), "");
        assertNotEq(nextId, id);
        assertEq(registry.tokenNonce(address(token)), 2);
    }

    function testAcceptanceCallbackRejectsEveryAddressExceptCanonicalTreasury() public {
        (bytes32 id,) = _propose(bytes32(0), "");
        vm.prank(address(controller));
        vm.expectRevert(ICTORegistryV3.UnauthorizedTreasury.selector);
        registry.acceptCTO(id);
    }

    function testExecutionAtGraceDeadlineAndOneSecondAfter() public {
        (bytes32 id, address treasury) = _propose(bytes32(0), "");
        controller.accept(CTOTreasuryV3(payable(treasury)), id);
        uint256 deadline = block.timestamp + 72 hours + 7 days;
        vm.warp(deadline);
        registry.executeCTO(id);
        assertTrue(feeManager.ctoActive(address(token)));

        (CooketTokenV3 tokenTwo,) = _launch(creator, "Second CTO", "CTO2");
        vm.prank(creator);
        (bytes32 secondId, address secondTreasury) =
            registry.proposeCTO(address(tokenTwo), address(controller), bytes32(0), "");
        controller.accept(CTOTreasuryV3(payable(secondTreasury)), secondId);
        vm.warp(block.timestamp + 72 hours + 7 days + 1);
        vm.expectRevert(ICTORegistryV3.ExecutionGraceExpired.selector);
        registry.executeCTO(secondId);
        registry.expireCTO(secondId);
    }

    function testCreatorCanCancelProposedOrAcceptedAndReproposalUsesNewNonce() public {
        (bytes32 firstId,) = _propose(bytes32(0), "");
        vm.prank(creator);
        registry.cancelCTO(firstId);
        assertEq(uint256(registry.proposal(firstId).state), uint256(ICTORegistryV3.ProposalState.Cancelled));

        (bytes32 secondId, address secondTreasury) = _propose(bytes32(0), "");
        assertEq(registry.tokenNonce(address(token)), 2);
        assertNotEq(firstId, secondId);
        controller.accept(CTOTreasuryV3(payable(secondTreasury)), secondId);
        vm.prank(creator);
        registry.cancelCTO(secondId);
    }

    function testStalePayoutRejectsExecutionAndPendingProposalIsInvalidated() public {
        (bytes32 staleId, address staleTreasury) = _propose(bytes32(0), "");
        controller.accept(CTOTreasuryV3(payable(staleTreasury)), staleId);
        vm.prank(creator);
        feeManager.proposeCreatorPayout(address(token), buyer);
        vm.prank(buyer);
        feeManager.acceptCreatorPayout(address(token));
        vm.warp(block.timestamp + 72 hours);
        vm.expectRevert(ICTORegistryV3.StaleCreatorPayout.selector);
        registry.executeCTO(staleId);

        vm.prank(creator);
        registry.cancelCTO(staleId);
        (bytes32 validId, address validTreasury) = _propose(bytes32(0), "");
        controller.accept(CTOTreasuryV3(payable(validTreasury)), validId);
        vm.prank(creator);
        feeManager.proposeCreatorPayout(address(token), creator);
        vm.warp(block.timestamp + 72 hours);
        registry.executeCTO(validId);
        assertEq(feeManager.pendingCreatorPayoutOf(address(token)), address(0));
    }

    function testAtomicPreGraduationCheckpointAndTerminalActivation() public {
        _buy(buyer, curve, 0.1 ether);
        uint256 oldAccrued = feeManager.creatorFeesAccrued(address(token));
        uint256 liabilities = feeManager.totalLiabilities();
        (bytes32 id, address treasury) = _propose(bytes32(0), "");
        controller.accept(CTOTreasuryV3(payable(treasury)), id);
        vm.warp(block.timestamp + 72 hours);
        vm.prank(buyer);
        registry.executeCTO(id);

        assertEq(feeManager.checkpointedCreatorFees(address(token), creator), oldAccrued);
        assertEq(feeManager.creatorFeesAccrued(address(token)), 0);
        assertEq(feeManager.totalLiabilities(), liabilities);
        assertEq(feeManager.creatorPayoutOf(address(token)), treasury);
        assertEq(registry.activeTreasury(address(token)), treasury);
        vm.expectRevert(ICTORegistryV3.InvalidProposalState.selector);
        registry.executeCTO(id);
        vm.prank(creator);
        vm.expectRevert(ICTORegistryV3.TokenAlreadyCTOActive.selector);
        registry.proposeCTO(address(token), address(controller), bytes32(0), "");
    }

    function _propose(bytes32 metadataHash, string memory metadataURI) private returns (bytes32 id, address treasury) {
        vm.prank(creator);
        return registry.proposeCTO(address(token), address(controller), metadataHash, metadataURI);
    }

    function _expectRelationshipMismatch(address target, bytes memory callData, bytes memory returnData) private {
        vm.mockCall(target, callData, returnData);
        vm.prank(creator);
        vm.expectRevert(ICTORegistryV3.InvalidCanonicalRelationship.selector);
        registry.proposeCTO(address(token), address(controller), bytes32(0), "");
        vm.clearMockedCalls();
    }

    function _expectExecutionRelationshipMismatch(bytes memory callData) private {
        (bytes32 id, address treasury) = _propose(bytes32(0), "");
        controller.accept(CTOTreasuryV3(payable(treasury)), id);
        vm.mockCall(address(curve), callData, abi.encode(buyer));
        vm.warp(block.timestamp + 72 hours);
        vm.expectRevert(ICTORegistryV3.InvalidCanonicalRelationship.selector);
        registry.executeCTO(id);
        vm.clearMockedCalls();
        assertFalse(feeManager.ctoActive(address(token)));
        assertEq(uint256(registry.proposal(id).state), uint256(ICTORegistryV3.ProposalState.Accepted));
        assertEq(registry.activeTreasury(address(token)), address(0));
    }

    function _repeat(string memory character, uint256 count) private pure returns (string memory) {
        bytes memory source = bytes(character);
        bytes memory result = new bytes(count);
        for (uint256 i; i < count; ++i) {
            result[i] = source[0];
        }
        return string(result);
    }
}

contract CTORegistryGraduatedV3Test is Test {
    address internal creator = makeAddr("graduatedCreator");
    address internal buyer = makeAddr("graduatedBuyer");
    address internal protocolTreasury = makeAddr("graduatedProtocolTreasury");
    FeeManagerV3 internal fees;
    GraduationManagerV3 internal manager;
    CooketFactoryV3 internal factory;
    CooketTokenV3 internal token;
    CooketCurveV3 internal curve;
    MockArcDualViewUsdcV3 internal canonicalUsdc;
    MockNonfungiblePositionManagerV3 internal npm;
    PermanentLPFeeVaultV3 internal vault;
    PermanentLPCustodianDeployerV3 internal deployer;
    PermanentLPCustodianV3 internal custodian;
    CTORegistryV3 internal registry;
    MockCTOControllerV3 internal controller;

    function setUp() public {
        MockArcDualViewUsdcV3 usdcImplementation = new MockArcDualViewUsdcV3();
        vm.etch(ArcNativeUsdcV3.CANONICAL_USDC, address(usdcImplementation).code);
        canonicalUsdc = MockArcDualViewUsdcV3(ArcNativeUsdcV3.CANONICAL_USDC);
        MockUniswapV3FactoryV3 uniswapFactory = new MockUniswapV3FactoryV3();
        manager = new GraduationManagerV3(address(uniswapFactory));
        fees = new FeeManagerV3(address(this), protocolTreasury);
        factory = new CooketFactoryV3(address(fees), address(manager));
        fees.setFactoryOnce(address(factory));
        manager.setFactoryOnce(address(factory));
        TokenCommunityVaultV3 community = new TokenCommunityVaultV3(address(this), protocolTreasury, address(fees));
        TraderRewardsVaultV3 rewards = new TraderRewardsVaultV3(address(this), address(fees));
        TraderRewardsDistributorV3 distributor = new TraderRewardsDistributorV3(address(this), address(rewards));
        rewards.setDistributorOnce(address(distributor));
        fees.bindEcosystemVaultsOnce(address(community), address(rewards));
        vault = new PermanentLPFeeVaultV3(address(manager), address(fees), address(community), address(rewards));
        community.setPermanentLPFeeVaultOnce(address(vault));
        rewards.setPermanentLPFeeVaultOnce(address(vault));
        npm = new MockNonfungiblePositionManagerV3(address(uniswapFactory));
        deployer = new PermanentLPCustodianDeployerV3(address(manager), address(vault), address(npm));
        manager.bindDependenciesOnce(address(vault), address(deployer), address(npm));
        vm.prank(creator);
        (address tokenAddress, address curveAddress) =
            factory.createToken("Graduated CTO", "GCTO", keccak256("graduated-cto"));
        token = CooketTokenV3(tokenAddress);
        curve = CooketCurveV3(payable(curveAddress));
        vm.deal(buyer, 10_000 ether);
        CooketCurveV3.BuyQuote memory quote = curve.quoteBuy(EndpointConstantsV3.EXACT_GRADUATION_GROSS_NATIVE_USDC);
        vm.prank(buyer);
        curve.buy{value: quote.acceptedGross}(quote.tokensOut, block.timestamp + 1);
        custodian = PermanentLPCustodianV3(deployer.custodianOf(address(token)));
        registry = CTORegistryV3(fees.ctoRegistry());
        controller = new MockCTOControllerV3();
    }

    function testGraduatedCutoffAttributesCollectedFeesBeforeAndAfterRouteExactly() public {
        _fundCollectable(400 ether, 400_000_000);
        (bytes32 id, address treasury) = _proposeAndAccept();
        vm.warp(block.timestamp + 72 hours);
        registry.executeCTO(id);
        assertEq(vault.creatorLPFeesAccrued(creator, address(token)), 100 ether);
        assertEq(vault.creatorLPFeesAccrued(creator, address(canonicalUsdc)), 100_000_000);
        assertEq(vault.creatorLPFeesAccrued(treasury, address(token)), 0);

        _fundCollectable(200 ether, 200_000_000);
        custodian.collectFees();
        assertEq(vault.creatorLPFeesAccrued(treasury, address(token)), 50 ether);
        assertEq(vault.creatorLPFeesAccrued(treasury, address(canonicalUsdc)), 50_000_000);
        uint256 treasuryTokenBefore = token.balanceOf(treasury);
        vm.prank(buyer);
        uint256 pulled = CTOTreasuryV3(payable(treasury)).pullLPCreatorFees(address(token));
        assertEq(pulled, 50 ether);
        assertEq(token.balanceOf(treasury) - treasuryTokenBefore, 50 ether);
    }

    function testGraduatedCollectFailureRollsBackEntireActivation() public {
        _fundCollectable(400 ether, 400_000_000);
        (bytes32 id,) = _proposeAndAccept();
        npm.setRevertCollect(true);
        vm.warp(block.timestamp + 72 hours);
        vm.expectRevert(bytes("COLLECT_REVERTED"));
        registry.executeCTO(id);
        assertFalse(fees.ctoActive(address(token)));
        assertEq(uint256(registry.proposal(id).state), uint256(ICTORegistryV3.ProposalState.Accepted));
        assertEq(vault.creatorLPFeesAccrued(creator, address(token)), 0);
    }

    function testGraduatedNotificationFailureRollsBackEntireActivation() public {
        _fundCollectable(400 ether, 400_000_000);
        uint256 token0Before = npm.collectable0(100);
        uint256 token1Before = npm.collectable1(100);
        (bytes32 id,) = _proposeAndAccept();
        npm.setPositionsResponseMode(2);
        vm.warp(block.timestamp + 72 hours);
        vm.expectRevert(IPermanentLPFeeVaultV3.UnauthorizedPermanentCustodian.selector);
        registry.executeCTO(id);
        assertFalse(fees.ctoActive(address(token)));
        assertEq(npm.collectable0(100), token0Before);
        assertEq(npm.collectable1(100), token1Before);
        assertEq(vault.totalLPFeesAccrued(address(token)), 0);
    }

    function testMalformedGraduatedCustodianRelationshipRejectsAndRollsBack() public {
        (bytes32 id,) = _proposeAndAccept();
        vm.mockCall(
            address(manager), abi.encodeWithSignature("permanentLPCustodianDeployer()"), abi.encode(address(buyer))
        );
        vm.warp(block.timestamp + 72 hours);
        vm.expectRevert(ICTORegistryV3.InvalidCanonicalRelationship.selector);
        registry.executeCTO(id);
        vm.clearMockedCalls();
        assertFalse(fees.ctoActive(address(token)));
        assertEq(uint256(registry.proposal(id).state), uint256(ICTORegistryV3.ProposalState.Accepted));
    }

    function _proposeAndAccept() private returns (bytes32 id, address treasury) {
        vm.prank(creator);
        (id, treasury) = registry.proposeCTO(address(token), address(controller), bytes32(0), "");
        controller.accept(CTOTreasuryV3(payable(treasury)), id);
    }

    function _fundCollectable(uint256 launchAmount18, uint256 usdcAmount6) private {
        vm.prank(buyer);
        assertTrue(token.transfer(address(npm), launchAmount18));
        canonicalUsdc.mint(address(npm), usdcAmount6);
        bool launchIsToken0 = address(token) < address(canonicalUsdc);
        npm.setCollectableFees(
            100, launchIsToken0 ? launchAmount18 : usdcAmount6, launchIsToken0 ? usdcAmount6 : launchAmount18
        );
    }
}
