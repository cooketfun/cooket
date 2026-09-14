// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {CTORegistryV4} from "../../src/v4/CTORegistryV4.sol";
import {CTOTreasuryV4} from "../../src/v4/CTOTreasuryV4.sol";
import {ICTORegistryV4} from "../../src/v4/interfaces/ICTORegistryV4.sol";
import {FeeManagerV4} from "../../src/v4/FeeManagerV4.sol";
import {IFeeManagerV4} from "../../src/v4/interfaces/IFeeManagerV4.sol";
import {CooketTokenV4} from "../../src/v4/CooketTokenV4.sol";
import {CooketFactoryV4} from "../../src/v4/CooketFactoryV4.sol";
import {CooketCurveV4} from "../../src/v4/CooketCurveV4.sol";
import {GraduationManagerV4} from "../../src/v4/GraduationManagerV4.sol";
import {PermanentLPFeeVaultV4} from "../../src/v4/PermanentLPFeeVaultV4.sol";
import {PermanentLPCustodianV4} from "../../src/v4/PermanentLPCustodianV4.sol";
import {PermanentLPCustodianDeployerV4} from "../../src/v4/PermanentLPCustodianDeployerV4.sol";
import {TokenCommunityVaultV4} from "../../src/v4/TokenCommunityVaultV4.sol";
import {TraderRewardsVaultV4} from "../../src/v4/TraderRewardsVaultV4.sol";
import {TraderRewardsDistributorV4} from "../../src/v4/TraderRewardsDistributorV4.sol";
import {IPermanentLPFeeVaultV4} from "../../src/v4/interfaces/IPermanentLPFeeVaultV4.sol";
import {EndpointConstantsV4} from "../../src/v4/libraries/EndpointConstantsV4.sol";
import {CooketV4TestBase} from "./helpers/CooketV4TestBase.sol";
import {MockCTOControllerV4} from "./mocks/MockCTOControllerV4.sol";
import {MockArcDualViewUsdcV4} from "./mocks/MockArcDualViewUsdcV4.sol";
import {MockNonfungiblePositionManagerV4} from "./mocks/MockNonfungiblePositionManagerV4.sol";
import {MockUniswapV3FactoryV4} from "./mocks/MockUniswapV3V4.sol";

contract CTORegistryV4Test is CooketV4TestBase {
    CTORegistryV4 internal registry;
    MockCTOControllerV4 internal controller;

    function setUp() public override {
        super.setUp();
        registry = CTORegistryV4(feeManager.ctoRegistry());
        controller = new MockCTOControllerV4();
    }

    function testOnlyOriginalCreatorCanProposeAndRelationshipsAreCanonical() public {
        vm.prank(buyer);
        vm.expectRevert(ICTORegistryV4.UnauthorizedCreator.selector);
        registry.proposeCTO(address(token), address(controller), bytes32(0), "");

        (bytes32 id, address treasury) = _propose(bytes32(0), "");
        ICTORegistryV4.Proposal memory details = registry.proposal(id);
        assertEq(details.creator, creator);
        assertEq(details.token, address(token));
        assertEq(details.controller, address(controller));
        assertEq(details.treasury, treasury);
        assertEq(details.previousRecipient, creator);
        assertEq(uint256(details.state), uint256(ICTORegistryV4.ProposalState.Proposed));
    }

    function testRejectsZeroEOAAndOneLiveProposal() public {
        vm.startPrank(creator);
        vm.expectRevert(ICTORegistryV4.InvalidController.selector);
        registry.proposeCTO(address(token), address(0), bytes32(0), "");
        vm.expectRevert(ICTORegistryV4.InvalidController.selector);
        registry.proposeCTO(address(token), buyer, bytes32(0), "");
        registry.proposeCTO(address(token), address(controller), bytes32(0), "");
        vm.expectRevert(ICTORegistryV4.LiveProposalExists.selector);
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
                keccak256("COOKET_VOLUNTARY_CTO_V2"),
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
        vm.expectRevert(ICTORegistryV4.InvalidMetadata.selector);
        registry.proposeCTO(address(token), address(controller), bytes32(uint256(1)), "ipfs://agreement");

        string memory maxUri = _repeat("a", 256);
        vm.prank(creator);
        registry.proposeCTO(address(token), address(controller), keccak256(bytes(maxUri)), maxUri);
    }

    function testMetadataOverMaximumRejected() public {
        string memory oversized = _repeat("a", 257);
        vm.prank(creator);
        vm.expectRevert(ICTORegistryV4.InvalidMetadata.selector);
        registry.proposeCTO(address(token), address(controller), bytes32(0), oversized);
    }

    function testConfirmationAtDeadlineActivatesImmediatelyWithoutExecute() public {
        (bytes32 id, address treasury) = _propose(bytes32(0), "");
        uint256 createdAt = block.timestamp;
        vm.warp(createdAt + 7 days);
        controller.accept(CTOTreasuryV4(payable(treasury)), id);
        assertTrue(feeManager.ctoActive(address(token)));
        assertEq(uint256(registry.proposal(id).state), uint256(ICTORegistryV4.ProposalState.Active));
        (bool success,) = address(registry).call(abi.encodeWithSignature("executeCTO(bytes32)", id));
        assertFalse(success);
    }

    function testConfirmationOneSecondAfterDeadlineRejectedAndPermissionlessExpiry() public {
        (bytes32 id, address treasury) = _propose(bytes32(0), "");
        vm.warp(block.timestamp + 7 days + 1);
        vm.expectRevert(ICTORegistryV4.AcceptanceWindowExpired.selector);
        controller.accept(CTOTreasuryV4(payable(treasury)), id);
        vm.prank(buyer);
        registry.expireCTO(id);
        assertEq(uint256(registry.proposal(id).state), uint256(ICTORegistryV4.ProposalState.Expired));
        vm.prank(creator);
        (bytes32 nextId,) = registry.proposeCTO(address(token), address(controller), bytes32(0), "");
        assertNotEq(nextId, id);
        assertEq(registry.tokenNonce(address(token)), 2);
    }

    function testConfirmationCallbackRejectsEveryAddressExceptCanonicalTreasury() public {
        (bytes32 id,) = _propose(bytes32(0), "");
        vm.prank(address(controller));
        vm.expectRevert(ICTORegistryV4.UnauthorizedTreasury.selector);
        registry.confirmCTO(id);
    }

    function testReplayedConfirmationAndLaterProposalFailAfterActivation() public {
        (bytes32 id, address treasury) = _propose(bytes32(0), "");
        controller.accept(CTOTreasuryV4(payable(treasury)), id);
        assertTrue(feeManager.ctoActive(address(token)));
        vm.expectRevert(ICTORegistryV4.InvalidProposalState.selector);
        controller.accept(CTOTreasuryV4(payable(treasury)), id);
        vm.prank(creator);
        vm.expectRevert(ICTORegistryV4.TokenAlreadyCTOActive.selector);
        registry.proposeCTO(address(token), address(controller), bytes32(0), "");
    }

    function testCreatorCanCancelOnlyProposedAndReproposalUsesNewNonce() public {
        (bytes32 firstId,) = _propose(bytes32(0), "");
        vm.prank(creator);
        registry.cancelCTO(firstId);
        assertEq(uint256(registry.proposal(firstId).state), uint256(ICTORegistryV4.ProposalState.Cancelled));

        (bytes32 secondId, address secondTreasury) = _propose(bytes32(0), "");
        assertEq(registry.tokenNonce(address(token)), 2);
        assertNotEq(firstId, secondId);
        controller.accept(CTOTreasuryV4(payable(secondTreasury)), secondId);
        vm.prank(creator);
        vm.expectRevert(ICTORegistryV4.InvalidProposalState.selector);
        registry.cancelCTO(secondId);
    }

    function testStalePayoutRejectsExecutionAndPendingProposalIsInvalidated() public {
        (bytes32 staleId, address staleTreasury) = _propose(bytes32(0), "");
        vm.prank(creator);
        feeManager.proposeCreatorPayout(address(token), buyer);
        vm.prank(buyer);
        feeManager.acceptCreatorPayout(address(token));
        vm.expectRevert(ICTORegistryV4.StaleCreatorPayout.selector);
        controller.accept(CTOTreasuryV4(payable(staleTreasury)), staleId);

        vm.prank(creator);
        registry.cancelCTO(staleId);
        (bytes32 validId, address validTreasury) = _propose(bytes32(0), "");
        vm.prank(creator);
        feeManager.proposeCreatorPayout(address(token), creator);
        controller.accept(CTOTreasuryV4(payable(validTreasury)), validId);
        assertEq(feeManager.pendingCreatorPayoutOf(address(token)), address(0));
    }

    function testAtomicPreGraduationCheckpointAndTerminalActivation() public {
        _buy(buyer, curve, 0.1 ether);
        uint256 oldAccrued = feeManager.creatorFeesAccrued(address(token));
        uint256 liabilities = feeManager.totalLiabilities();
        (bytes32 id, address treasury) = _propose(bytes32(0), "");
        controller.accept(CTOTreasuryV4(payable(treasury)), id);

        assertEq(feeManager.checkpointedCreatorFees(address(token), creator), oldAccrued);
        assertEq(feeManager.creatorFeesAccrued(address(token)), 0);
        assertEq(feeManager.totalLiabilities(), liabilities);
        assertEq(feeManager.creatorPayoutOf(address(token)), treasury);
        assertEq(registry.activeTreasury(address(token)), treasury);
        vm.expectRevert(ICTORegistryV4.InvalidProposalState.selector);
        controller.accept(CTOTreasuryV4(payable(treasury)), id);
        vm.prank(creator);
        vm.expectRevert(ICTORegistryV4.TokenAlreadyCTOActive.selector);
        registry.proposeCTO(address(token), address(controller), bytes32(0), "");
    }

    function testConfirmationEventOrderAndIndexedFieldsAreDeterministic() public {
        _buy(buyer, curve, 0.1 ether);
        (bytes32 id, address treasury) = _propose(bytes32(0), "");
        vm.recordLogs();
        controller.accept(CTOTreasuryV4(payable(treasury)), id);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 confirmedTopic = keccak256("CTOConfirmed(bytes32,address,address,address,uint64)");
        bytes32 checkpointTopic = keccak256("CreatorFeeCheckpointed(address,address,uint256)");
        bytes32 routeTopic = keccak256("CTOFeeRouteActivated(address,address,address)");
        bytes32 activatedTopic = keccak256("CTOActivated(bytes32,address,address,address,address,address)");
        bytes32 submittedTopic = keccak256("CTOConfirmationSubmitted(bytes32,address,address)");
        uint256 confirmed = _logIndex(logs, confirmedTopic);
        uint256 checkpoint = _logIndex(logs, checkpointTopic);
        uint256 route = _logIndex(logs, routeTopic);
        uint256 activated = _logIndex(logs, activatedTopic);
        uint256 submitted = _logIndex(logs, submittedTopic);
        assertLt(confirmed, checkpoint);
        assertLt(checkpoint, route);
        assertLt(route, activated);
        assertLt(activated, submitted);
        assertEq(logs[confirmed].topics[1], id);
        assertEq(address(uint160(uint256(logs[confirmed].topics[2]))), address(token));
        assertEq(address(uint160(uint256(logs[confirmed].topics[3]))), treasury);
    }

    function testFeeManagerActivationFailureRollsBackCompleteConfirmation() public {
        _buy(buyer, curve, 0.1 ether);
        uint256 creatorFeesBefore = feeManager.creatorFeesAccrued(address(token));
        (bytes32 id, address treasury) = _propose(bytes32(0), "");
        vm.mockCallRevert(
            address(feeManager),
            abi.encodeWithSelector(IFeeManagerV4.activateCTO.selector, address(token), treasury),
            bytes("ACTIVATION_FAILED")
        );
        vm.expectRevert(bytes("ACTIVATION_FAILED"));
        controller.accept(CTOTreasuryV4(payable(treasury)), id);
        vm.clearMockedCalls();
        assertFalse(feeManager.ctoActive(address(token)));
        assertEq(feeManager.checkpointedCreatorFees(address(token), creator), 0);
        assertEq(feeManager.creatorFeesAccrued(address(token)), creatorFeesBefore);
        assertEq(feeManager.creatorPayoutOf(address(token)), creator);
        assertEq(feeManager.ctoTreasuryOf(address(token)), address(0));
        assertEq(registry.activeTreasury(address(token)), address(0));
        assertEq(uint256(registry.proposal(id).state), uint256(ICTORegistryV4.ProposalState.Proposed));
    }

    function testFeeManagerRecipientSwitchFailureRollsBackCompleteConfirmation() public {
        _buy(buyer, curve, 0.1 ether);
        uint256 creatorFeesBefore = feeManager.creatorFeesAccrued(address(token));
        (bytes32 id, address treasury) = _propose(bytes32(0), "");
        vm.mockCallRevert(
            address(feeManager),
            abi.encodeWithSelector(IFeeManagerV4.switchCreatorPayoutForCTO.selector, address(token), treasury),
            bytes("ROUTE_SWITCH_FAILED")
        );
        vm.expectRevert(bytes("ROUTE_SWITCH_FAILED"));
        controller.accept(CTOTreasuryV4(payable(treasury)), id);
        vm.clearMockedCalls();
        assertFalse(feeManager.ctoActive(address(token)));
        assertEq(feeManager.checkpointedCreatorFees(address(token), creator), 0);
        assertEq(feeManager.creatorFeesAccrued(address(token)), creatorFeesBefore);
        assertEq(feeManager.creatorPayoutOf(address(token)), creator);
        assertEq(feeManager.ctoTreasuryOf(address(token)), address(0));
        assertEq(registry.activeTreasury(address(token)), address(0));
        assertEq(uint256(registry.proposal(id).state), uint256(ICTORegistryV4.ProposalState.Proposed));
    }

    function testControllerRevertAfterConfirmationRollsBackEveryEffect() public {
        _buy(buyer, curve, 0.1 ether);
        uint256 creatorFeesBefore = feeManager.creatorFeesAccrued(address(token));
        (bytes32 id, address treasury) = _propose(bytes32(0), "");
        vm.expectRevert(bytes("CONTROLLER_REVERTED"));
        controller.acceptThenRevert(CTOTreasuryV4(payable(treasury)), id);
        assertFalse(feeManager.ctoActive(address(token)));
        assertEq(feeManager.checkpointedCreatorFees(address(token), creator), 0);
        assertEq(feeManager.creatorFeesAccrued(address(token)), creatorFeesBefore);
        assertEq(feeManager.creatorPayoutOf(address(token)), creator);
        assertEq(feeManager.ctoTreasuryOf(address(token)), address(0));
        assertEq(registry.activeTreasury(address(token)), address(0));
        assertEq(uint256(registry.proposal(id).state), uint256(ICTORegistryV4.ProposalState.Proposed));
    }

    function testFeeManagerCheckpointFailureRollsBackCompleteConfirmation() public {
        (bytes32 id, address treasury) = _propose(bytes32(0), "");
        vm.mockCallRevert(
            address(feeManager),
            abi.encodeWithSelector(IFeeManagerV4.checkpointCreatorFeesForCTO.selector, address(token), treasury),
            bytes("CHECKPOINT_FAILED")
        );
        vm.expectRevert(bytes("CHECKPOINT_FAILED"));
        controller.accept(CTOTreasuryV4(payable(treasury)), id);
        vm.clearMockedCalls();
        assertFalse(feeManager.ctoActive(address(token)));
        assertEq(registry.activeTreasury(address(token)), address(0));
        assertEq(uint256(registry.proposal(id).state), uint256(ICTORegistryV4.ProposalState.Proposed));
    }

    function _propose(bytes32 metadataHash, string memory metadataURI) private returns (bytes32 id, address treasury) {
        vm.prank(creator);
        return registry.proposeCTO(address(token), address(controller), metadataHash, metadataURI);
    }

    function _expectRelationshipMismatch(address target, bytes memory callData, bytes memory returnData) private {
        vm.mockCall(target, callData, returnData);
        vm.prank(creator);
        vm.expectRevert(ICTORegistryV4.InvalidCanonicalRelationship.selector);
        registry.proposeCTO(address(token), address(controller), bytes32(0), "");
        vm.clearMockedCalls();
    }

    function _expectExecutionRelationshipMismatch(bytes memory callData) private {
        (bytes32 id, address treasury) = _propose(bytes32(0), "");
        vm.mockCall(address(curve), callData, abi.encode(buyer));
        vm.expectRevert(ICTORegistryV4.InvalidCanonicalRelationship.selector);
        controller.accept(CTOTreasuryV4(payable(treasury)), id);
        vm.clearMockedCalls();
        assertFalse(feeManager.ctoActive(address(token)));
        assertEq(uint256(registry.proposal(id).state), uint256(ICTORegistryV4.ProposalState.Proposed));
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

    function _logIndex(Vm.Log[] memory logs, bytes32 topic) private pure returns (uint256 index) {
        for (; index < logs.length; ++index) {
            if (logs[index].topics.length != 0 && logs[index].topics[0] == topic) return index;
        }
        revert("EVENT_NOT_FOUND");
    }
}

contract CTORegistryGraduatedV4Test is Test {
    address internal creator = makeAddr("graduatedCreator");
    address internal buyer = makeAddr("graduatedBuyer");
    address internal protocolTreasury = makeAddr("graduatedProtocolTreasury");
    FeeManagerV4 internal fees;
    GraduationManagerV4 internal manager;
    CooketFactoryV4 internal factory;
    CooketTokenV4 internal token;
    CooketCurveV4 internal curve;
    MockArcDualViewUsdcV4 internal canonicalUsdc;
    MockNonfungiblePositionManagerV4 internal npm;
    PermanentLPFeeVaultV4 internal vault;
    PermanentLPCustodianDeployerV4 internal deployer;
    PermanentLPCustodianV4 internal custodian;
    CTORegistryV4 internal registry;
    MockCTOControllerV4 internal controller;

    function setUp() public {
        MockArcDualViewUsdcV4 usdcImplementation = new MockArcDualViewUsdcV4();
        vm.etch(address(0x8000000000000000000000000000000000000001), address(usdcImplementation).code);
        canonicalUsdc = MockArcDualViewUsdcV4(address(0x8000000000000000000000000000000000000001));
        MockUniswapV3FactoryV4 uniswapFactory = new MockUniswapV3FactoryV4();
        manager = new GraduationManagerV4(address(uniswapFactory), address(canonicalUsdc), address(this));
        fees = new FeeManagerV4(address(this), protocolTreasury);
        factory = new CooketFactoryV4(address(fees), address(manager));
        fees.setFactoryOnce(address(factory));
        manager.setFactoryOnce(address(factory));
        TokenCommunityVaultV4 community = new TokenCommunityVaultV4(address(this), protocolTreasury, address(fees));
        TraderRewardsVaultV4 rewards = new TraderRewardsVaultV4(address(this), address(fees));
        TraderRewardsDistributorV4 distributor = new TraderRewardsDistributorV4(address(this), address(rewards));
        rewards.setDistributorOnce(address(distributor));
        fees.bindEcosystemVaultsOnce(address(community), address(rewards));
        vault = new PermanentLPFeeVaultV4(
            address(manager), address(fees), address(community), address(rewards), address(canonicalUsdc)
        );
        community.setPermanentLPFeeVaultOnce(address(vault));
        rewards.setPermanentLPFeeVaultOnce(address(vault));
        npm = new MockNonfungiblePositionManagerV4(address(uniswapFactory));
        deployer = new PermanentLPCustodianDeployerV4(address(manager), address(vault), address(npm));
        manager.bindDependenciesOnce(address(vault), address(deployer), address(npm));
        vm.prank(creator);
        (address tokenAddress, address curveAddress) =
            factory.createToken("Graduated CTO", "GCTO", keccak256("graduated-cto"));
        token = CooketTokenV4(tokenAddress);
        curve = CooketCurveV4(payable(curveAddress));
        vm.deal(buyer, 20_000 ether);
        CooketCurveV4.BuyQuote memory quote = curve.quoteBuy(EndpointConstantsV4.EXACT_GRADUATION_GROSS_NATIVE_USDC);
        vm.prank(buyer);
        curve.buy{value: quote.acceptedGross}(quote.tokensOut, block.timestamp + 1);
        custodian = PermanentLPCustodianV4(deployer.custodianOf(address(token)));
        registry = CTORegistryV4(fees.ctoRegistry());
        controller = new MockCTOControllerV4();
    }

    function testGraduatedCutoffAttributesCollectedFeesBeforeAndAfterRouteExactly() public {
        _fundCollectable(400 ether, 400_000_000);
        (bytes32 id, address treasury) = _proposeGraduated();
        controller.accept(CTOTreasuryV4(payable(treasury)), id);
        assertEq(vault.creatorLPFeesAccrued(creator, address(token)), 100 ether);
        assertEq(vault.creatorLPFeesAccrued(creator, address(canonicalUsdc)), 100_000_000);
        assertEq(vault.creatorLPFeesAccrued(treasury, address(token)), 0);

        _fundCollectable(200 ether, 200_000_000);
        custodian.collectFees();
        assertEq(vault.creatorLPFeesAccrued(treasury, address(token)), 50 ether);
        assertEq(vault.creatorLPFeesAccrued(treasury, address(canonicalUsdc)), 50_000_000);
        uint256 treasuryTokenBefore = token.balanceOf(treasury);
        vm.prank(buyer);
        uint256 pulled = CTOTreasuryV4(payable(treasury)).pullLPCreatorFees(address(token));
        assertEq(pulled, 50 ether);
        assertEq(token.balanceOf(treasury) - treasuryTokenBefore, 50 ether);
    }

    function testGraduatedConfirmationCheckpointsBeforeLPCollectionAndActivatesAfter() public {
        _fundCollectable(400 ether, 400_000_000);
        _buyCurveFeeBeforeConfirmation();
        (bytes32 id, address treasury) = _proposeGraduated();
        vm.recordLogs();
        controller.accept(CTOTreasuryV4(payable(treasury)), id);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 checkpoint = _logIndex(logs, keccak256("CreatorFeeCheckpointed(address,address,uint256)"));
        uint256 collected = _logIndex(logs, keccak256("PermanentFeesCollected(uint256,uint256,uint256)"));
        uint256 route = _logIndex(logs, keccak256("CTOFeeRouteActivated(address,address,address)"));
        uint256 activated = _logIndex(logs, keccak256("CTOActivated(bytes32,address,address,address,address,address)"));
        assertLt(checkpoint, collected);
        assertLt(collected, route);
        assertLt(route, activated);
    }

    function testGraduatedCollectFailureRollsBackEntireActivation() public {
        _fundCollectable(400 ether, 400_000_000);
        _buyCurveFeeBeforeConfirmation();
        uint256 token0Before = npm.collectable0(100);
        uint256 token1Before = npm.collectable1(100);
        uint256 creatorFeesBefore = fees.creatorFeesAccrued(address(token));
        (bytes32 id, address treasury) = _proposeGraduated();
        npm.setRevertCollect(true);
        vm.expectRevert(bytes("COLLECT_REVERTED"));
        controller.accept(CTOTreasuryV4(payable(treasury)), id);
        _assertGraduatedRollback(id, token0Before, token1Before, creatorFeesBefore);
    }

    function testGraduatedNotificationFailureRollsBackEntireActivation() public {
        _fundCollectable(400 ether, 400_000_000);
        _buyCurveFeeBeforeConfirmation();
        uint256 token0Before = npm.collectable0(100);
        uint256 token1Before = npm.collectable1(100);
        uint256 creatorFeesBefore = fees.creatorFeesAccrued(address(token));
        (bytes32 id, address treasury) = _proposeGraduated();
        npm.setPositionsResponseMode(2);
        vm.expectRevert(IPermanentLPFeeVaultV4.UnauthorizedPermanentCustodian.selector);
        controller.accept(CTOTreasuryV4(payable(treasury)), id);
        _assertGraduatedRollback(id, token0Before, token1Before, creatorFeesBefore);
    }

    function testGraduatedCheckpointFailureRollsBackEveryAtomicEffect() public {
        _fundCollectable(400 ether, 400_000_000);
        _buyCurveFeeBeforeConfirmation();
        uint256 token0Before = npm.collectable0(100);
        uint256 token1Before = npm.collectable1(100);
        uint256 creatorFeesBefore = fees.creatorFeesAccrued(address(token));
        (bytes32 id, address treasury) = _proposeGraduated();
        vm.mockCallRevert(
            address(fees),
            abi.encodeWithSelector(IFeeManagerV4.checkpointCreatorFeesForCTO.selector, address(token), treasury),
            bytes("CHECKPOINT_FAILED")
        );
        vm.expectRevert(bytes("CHECKPOINT_FAILED"));
        controller.accept(CTOTreasuryV4(payable(treasury)), id);
        vm.clearMockedCalls();
        _assertGraduatedRollback(id, token0Before, token1Before, creatorFeesBefore);
    }

    function testGraduatedRecipientSwitchFailureRollsBackEveryAtomicEffect() public {
        _fundCollectable(400 ether, 400_000_000);
        _buyCurveFeeBeforeConfirmation();
        uint256 token0Before = npm.collectable0(100);
        uint256 token1Before = npm.collectable1(100);
        uint256 creatorFeesBefore = fees.creatorFeesAccrued(address(token));
        (bytes32 id, address treasury) = _proposeGraduated();
        vm.mockCallRevert(
            address(fees),
            abi.encodeWithSelector(IFeeManagerV4.switchCreatorPayoutForCTO.selector, address(token), treasury),
            bytes("ROUTE_SWITCH_FAILED")
        );
        vm.expectRevert(bytes("ROUTE_SWITCH_FAILED"));
        controller.accept(CTOTreasuryV4(payable(treasury)), id);
        vm.clearMockedCalls();
        _assertGraduatedRollback(id, token0Before, token1Before, creatorFeesBefore);
    }

    function testGraduatedActivationFailureRollsBackEveryAtomicEffect() public {
        _fundCollectable(400 ether, 400_000_000);
        _buyCurveFeeBeforeConfirmation();
        uint256 token0Before = npm.collectable0(100);
        uint256 token1Before = npm.collectable1(100);
        uint256 creatorFeesBefore = fees.creatorFeesAccrued(address(token));
        (bytes32 id, address treasury) = _proposeGraduated();
        vm.mockCallRevert(
            address(fees),
            abi.encodeWithSelector(IFeeManagerV4.activateCTO.selector, address(token), treasury),
            bytes("ACTIVATION_FAILED")
        );
        vm.expectRevert(bytes("ACTIVATION_FAILED"));
        controller.accept(CTOTreasuryV4(payable(treasury)), id);
        vm.clearMockedCalls();
        _assertGraduatedRollback(id, token0Before, token1Before, creatorFeesBefore);
    }

    function testGraduatedControllerPostConfirmationRevertRollsBackEveryAtomicEffect() public {
        _fundCollectable(400 ether, 400_000_000);
        _buyCurveFeeBeforeConfirmation();
        uint256 token0Before = npm.collectable0(100);
        uint256 token1Before = npm.collectable1(100);
        uint256 creatorFeesBefore = fees.creatorFeesAccrued(address(token));
        (bytes32 id, address treasury) = _proposeGraduated();
        vm.expectRevert(bytes("CONTROLLER_REVERTED"));
        controller.acceptThenRevert(CTOTreasuryV4(payable(treasury)), id);
        _assertGraduatedRollback(id, token0Before, token1Before, creatorFeesBefore);
    }

    function testGraduatedCollectionCannotReenterConfirmation() public {
        _fundCollectable(400 ether, 400_000_000);
        (bytes32 id, address treasury) = _proposeGraduated();
        npm.setCollectReentry(address(registry), abi.encodeCall(ICTORegistryV4.confirmCTO, (id)));
        controller.accept(CTOTreasuryV4(payable(treasury)), id);
        assertFalse(npm.collectReentrySucceeded());
        bytes memory result = npm.collectReentryResult();
        assertGe(result.length, 4);
        bytes4 selector;
        assembly ("memory-safe") {
            selector := mload(add(result, 32))
        }
        assertEq(selector, bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        assertTrue(fees.ctoActive(address(token)));
    }

    function testMalformedGraduatedCustodianRelationshipRejectsAndRollsBack() public {
        (bytes32 id, address treasury) = _proposeGraduated();
        vm.mockCall(
            address(manager), abi.encodeWithSignature("permanentLPCustodianDeployer()"), abi.encode(address(buyer))
        );
        vm.expectRevert(ICTORegistryV4.InvalidCanonicalRelationship.selector);
        controller.accept(CTOTreasuryV4(payable(treasury)), id);
        vm.clearMockedCalls();
        assertFalse(fees.ctoActive(address(token)));
        assertEq(uint256(registry.proposal(id).state), uint256(ICTORegistryV4.ProposalState.Proposed));
    }

    function _proposeGraduated() private returns (bytes32 id, address treasury) {
        vm.prank(creator);
        (id, treasury) = registry.proposeCTO(address(token), address(controller), bytes32(0), "");
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

    function _buyCurveFeeBeforeConfirmation() private {
        // The token is already graduated in this fixture, so seed the canonical
        // pre-CTO curve-fee bucket directly from its registered curve.
        vm.deal(address(curve), 1 ether);
        vm.prank(address(curve));
        fees.depositFees{value: 1 ether}(address(token), 1 ether, 0.35 ether, 0.3 ether, 0.2 ether, 0.15 ether, true);
    }

    function _assertGraduatedRollback(bytes32 id, uint256 token0Before, uint256 token1Before, uint256 creatorFeesBefore)
        private
        view
    {
        assertFalse(fees.ctoActive(address(token)));
        assertEq(fees.creatorPayoutOf(address(token)), creator);
        assertEq(fees.ctoTreasuryOf(address(token)), address(0));
        assertEq(fees.checkpointedCreatorFees(address(token), creator), 0);
        assertEq(fees.creatorFeesAccrued(address(token)), creatorFeesBefore);
        assertEq(registry.activeTreasury(address(token)), address(0));
        assertEq(uint256(registry.proposal(id).state), uint256(ICTORegistryV4.ProposalState.Proposed));
        assertEq(npm.collectable0(100), token0Before);
        assertEq(npm.collectable1(100), token1Before);
        assertEq(vault.totalLPFeesAccrued(address(token)), 0);
        assertEq(vault.totalLPFeesAccrued(address(canonicalUsdc)), 0);
    }

    function _logIndex(Vm.Log[] memory logs, bytes32 topic) private pure returns (uint256 index) {
        for (; index < logs.length; ++index) {
            if (logs[index].topics.length != 0 && logs[index].topics[0] == topic) return index;
        }
        revert("EVENT_NOT_FOUND");
    }
}
