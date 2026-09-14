// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IPermanentLPCustodianV4} from "../../src/v4/interfaces/IPermanentLPCustodianV4.sol";
import {IPermanentLPCustodianDeployerV4} from "../../src/v4/interfaces/IPermanentLPCustodianDeployerV4.sol";
import {IPermanentLPFeeVaultV4} from "../../src/v4/interfaces/IPermanentLPFeeVaultV4.sol";
import {PermanentLPCustodianV4} from "../../src/v4/PermanentLPCustodianV4.sol";
import {PermanentLPCustodianDeployerV4} from "../../src/v4/PermanentLPCustodianDeployerV4.sol";
import {CooketCurveV4} from "../../src/v4/CooketCurveV4.sol";
import {CooketTokenV4} from "../../src/v4/CooketTokenV4.sol";
import {MockGraduationManagerV4} from "./mocks/MockGraduationManagerV4.sol";
import {MockNonfungiblePositionManagerV4} from "./mocks/MockNonfungiblePositionManagerV4.sol";
import {CooketV4TestBase} from "./helpers/CooketV4TestBase.sol";

contract ForceNativeUsdcCustodyV4 {
    constructor() payable {}

    function force(address payable recipient) external {
        selfdestruct(recipient);
    }
}

contract PermanentLPCustodianV4Test is CooketV4TestBase {
    MockNonfungiblePositionManagerV4 internal positions;
    PermanentLPCustodianDeployerV4 internal deployer;
    PermanentLPCustodianV4 internal custodian;

    function setUp() public override {
        super.setUp();
        positions = new MockNonfungiblePositionManagerV4(address(uniswapFactory));
        deployer =
            new PermanentLPCustodianDeployerV4(address(graduationManager), address(lpFeeVault), address(positions));
        vm.prank(address(graduationManager));
        lpFeeVault.setPermanentLPCustodianDeployerOnce(address(deployer));
        vm.prank(address(graduationManager));
        custodian = PermanentLPCustodianV4(deployer.deployCustodian(address(token)));
    }

    function testConstructionDependenciesAndVersion() public view {
        assertEq(custodian.launchToken(), address(token));
        assertEq(custodian.canonicalUsdc(), address(canonicalUsdc));
        assertEq(custodian.graduationManager(), address(graduationManager));
        assertEq(custodian.feeVault(), address(lpFeeVault));
        assertEq(custodian.nonfungiblePositionManager(), address(positions));
        assertEq(custodian.canonicalFactory(), address(factory));
        assertEq(custodian.protocolVersionHash(), keccak256("endpoint-cp-v4"));
        assertEq(custodian.FULL_RANGE_TICK_LOWER(), -887_200);
        assertEq(custodian.FULL_RANGE_TICK_UPPER(), 887_200);
    }

    function testZeroOrMismatchedDependenciesRevert() public {
        vm.expectRevert(IPermanentLPCustodianV4.InvalidDependency.selector);
        new PermanentLPCustodianV4(address(0), address(positions), address(graduationManager), address(feeManager));
        vm.expectRevert(IPermanentLPCustodianV4.InvalidDependency.selector);
        new PermanentLPCustodianV4(address(token), address(0), address(graduationManager), address(feeManager));
        vm.expectRevert(IPermanentLPCustodianV4.InvalidDependency.selector);
        new PermanentLPCustodianV4(address(token), address(positions), address(0), address(feeManager));
        vm.expectRevert(IPermanentLPCustodianV4.InvalidDependency.selector);
        new PermanentLPCustodianV4(address(token), address(positions), address(graduationManager), address(0));
        vm.expectRevert(IPermanentLPCustodianV4.InvalidDependency.selector);
        new PermanentLPCustodianV4(
            address(canonicalUsdc), address(positions), address(graduationManager), address(lpFeeVault)
        );
        MockNonfungiblePositionManagerV4 wrongFactoryPositions = new MockNonfungiblePositionManagerV4(address(this));
        vm.expectRevert(IPermanentLPCustodianV4.InvalidDependency.selector);
        new PermanentLPCustodianV4(
            address(token), address(wrongFactoryPositions), address(graduationManager), address(lpFeeVault)
        );
    }

    function testDeploymentAuthorizationUniquenessAndWrongManager() public {
        vm.expectRevert(IPermanentLPCustodianDeployerV4.UnauthorizedGraduationManager.selector);
        deployer.deployCustodian(address(token));
        vm.prank(address(graduationManager));
        vm.expectRevert(IPermanentLPCustodianDeployerV4.InvalidLaunchToken.selector);
        deployer.deployCustodian(address(0));
        vm.prank(address(graduationManager));
        vm.expectRevert(IPermanentLPCustodianDeployerV4.CustodianAlreadyDeployed.selector);
        deployer.deployCustodian(address(token));
        MockGraduationManagerV4 unbound =
            new MockGraduationManagerV4(address(uniswapFactory), address(0x8000000000000000000000000000000000000001));
        vm.expectRevert(IPermanentLPCustodianDeployerV4.InvalidDependency.selector);
        new PermanentLPCustodianDeployerV4(address(unbound), address(lpFeeVault), address(positions));
    }

    function testDeploymentFailureRollsBackRegistry() public {
        vm.prank(address(graduationManager));
        vm.expectRevert(IPermanentLPCustodianV4.InvalidDependency.selector);
        deployer.deployCustodian(address(canonicalUsdc));
        assertEq(deployer.custodianOf(address(canonicalUsdc)), address(0));
    }

    function testCanonicalOneTimeBindingAndOwner() public {
        _setCanonicalPosition(1, address(custodian));
        vm.prank(address(graduationManager));
        custodian.bindPosition(1);
        assertTrue(custodian.positionRegistered());
        assertEq(custodian.positionTokenId(), 1);
        assertEq(positions.ownerOf(1), address(custodian));
        vm.prank(address(graduationManager));
        vm.expectRevert(IPermanentLPCustodianV4.AlreadyRegistered.selector);
        custodian.bindPosition(1);
    }

    function testBindingRejectsUnauthorizedInvalidAndForgedMetadata() public {
        _setCanonicalPosition(1, address(custodian));
        vm.expectRevert(IPermanentLPCustodianV4.UnauthorizedGraduationManager.selector);
        custodian.bindPosition(1);
        vm.prank(address(graduationManager));
        vm.expectRevert(IPermanentLPCustodianV4.InvalidTokenId.selector);
        custodian.bindPosition(0);

        positions.setPosition(2, address(this), address(token), address(canonicalUsdc), 10_000, -887_200, 887_200);
        _expectInvalidPosition(2);
        positions.setPosition(
            3, address(custodian), address(canonicalUsdc), address(canonicalUsdc), 10_000, -887_200, 887_200
        );
        _expectInvalidPosition(3);
        positions.setPosition(4, address(custodian), address(token), address(canonicalUsdc), 3_000, -887_200, 887_200);
        _expectInvalidPosition(4);
        positions.setPosition(5, address(custodian), address(token), address(canonicalUsdc), 10_000, -887_000, 887_200);
        _expectInvalidPosition(5);
        vm.prank(address(graduationManager));
        vm.expectRevert();
        custodian.bindPosition(999);
    }

    function testBindingRejectsStrictMalformedPositionsResponses() public {
        _setCanonicalPosition(1, address(custodian));
        for (uint8 mode = 1; mode <= 3; ++mode) {
            positions.setPositionsResponseMode(mode);
            vm.prank(address(graduationManager));
            vm.expectRevert(IPermanentLPCustodianV4.InvalidPosition.selector);
            custodian.bindPosition(1);
        }
        positions.setPositionsResponseMode(4);
        positions.setMalformedPositionWords(
            uint256(uint160(address(token))) | (uint256(1) << 160),
            uint256(uint160(address(canonicalUsdc))),
            10_000,
            type(uint256).max,
            uint256(uint24(887_200))
        );
        vm.prank(address(graduationManager));
        vm.expectRevert(IPermanentLPCustodianV4.InvalidPosition.selector);
        custodian.bindPosition(1);
    }

    function testPermanentLockAndSelectorSurface() public {
        _setCanonicalPosition(1, address(custodian));
        vm.prank(address(graduationManager));
        custodian.bindPosition(1);
        vm.prank(address(curve));
        token.transfer(address(custodian), 1 ether);
        canonicalUsdc.mint(address(custodian), 1_000_000);
        ForceNativeUsdcCustodyV4 force = new ForceNativeUsdcCustodyV4{value: 1 ether}();
        force.force(payable(address(custodian)));
        assertEq(token.balanceOf(address(custodian)), 1 ether);
        assertEq(canonicalUsdc.balanceOf(address(custodian)), 2_000_000);
        assertEq(address(custodian).balance, 2 ether);
        assertEq(positions.ownerOf(1), address(custodian));

        _assertMissing("transferFrom(address,address,uint256)");
        _assertMissing("approve(address,uint256)");
        _assertMissing("setApprovalForAll(address,bool)");
        _assertMissing("decreaseLiquidity((uint256,uint128,uint256,uint256,uint256))");
        _assertMissing("burn(uint256)");
        _assertMissing("rescue(address,address,uint256)");
        _assertMissing("execute(address,bytes)");
        _assertMissing("upgradeToAndCall(address,bytes)");
        _assertMissing("onERC721Received(address,address,uint256,bytes)");
        (bool sent,) = address(custodian).call{value: 1}("");
        assertFalse(sent, "direct native USDC must revert");
    }

    function testPermissionlessCollectionCreditsFeeManagerAndNeverCaller() public {
        _bindCanonicalPosition();
        _setCanonicalPosition(2, buyer);
        assertEq(positions.ownerOf(2), buyer);
        _fundCollectableFees(10 ether, 9_000_000);
        uint256 callerTokenBefore = token.balanceOf(buyer);
        uint256 callerUsdc6Before = canonicalUsdc.balanceOf(buyer);
        vm.prank(buyer);
        (uint256 amount0, uint256 amount1) = custodian.collectFees();
        assertEq(amount0, address(token) < address(canonicalUsdc) ? 10 ether : 9_000_000);
        assertEq(amount1, address(token) < address(canonicalUsdc) ? 9_000_000 : 10 ether);
        assertEq(token.balanceOf(address(lpFeeVault)), 10 ether);
        assertEq(canonicalUsdc.balanceOf(address(lpFeeVault)), 9_000_000);
        assertEq(token.balanceOf(buyer), callerTokenBefore);
        assertEq(canonicalUsdc.balanceOf(buyer), callerUsdc6Before);
        assertEq(lpFeeVault.creatorLPFeesAccrued(creator, address(token)), 2.5 ether);
        assertEq(lpFeeVault.protocolLPFeesAccrued(treasury, address(token)), 3 ether);
        assertEq(lpFeeVault.communityLPFeesAccrued(address(token), address(token)), 3 ether);
        assertEq(lpFeeVault.traderRewardsLPFeesAccrued(address(token), address(token)), 1.5 ether);
        assertEq(lpFeeVault.creatorLPFeesAccrued(creator, address(canonicalUsdc)), 2_250_000);
        assertEq(lpFeeVault.protocolLPFeesAccrued(treasury, address(canonicalUsdc)), 2_700_000);
        assertEq(lpFeeVault.communityLPFeesAccrued(address(token), address(canonicalUsdc)), 2_700_000);
        assertEq(lpFeeVault.traderRewardsLPFeesAccrued(address(token), address(canonicalUsdc)), 1_350_000);
        assertEq(positions.ownerOf(1), address(custodian));
        assertEq(positions.ownerOf(2), buyer);
        assertEq(positions.getApproved(1), address(0));
        assertFalse(positions.isApprovedForAll(address(custodian), buyer));
    }

    function testCollectionBeforeBindingAndFakeNotificationRevert() public {
        vm.expectRevert(IPermanentLPCustodianV4.PositionNotRegistered.selector);
        custodian.collectFees();
        vm.expectRevert(IPermanentLPFeeVaultV4.UnauthorizedPermanentCustodian.selector);
        lpFeeVault.notifyPermanentLPFees(address(token), 1, 1);
    }

    function testOddRemainderZeroAndRepeatedCollectionAreSafe() public {
        _bindCanonicalPosition();
        _fundCollectableFees(101, 1);
        custodian.collectFees();
        assertEq(lpFeeVault.creatorLPFeesAccrued(creator, address(token)), 25);
        assertEq(lpFeeVault.communityLPFeesAccrued(address(token), address(token)), 30);
        assertEq(lpFeeVault.traderRewardsLPFeesAccrued(address(token), address(token)), 15);
        assertEq(lpFeeVault.protocolLPFeesAccrued(treasury, address(token)), 31);
        assertEq(lpFeeVault.creatorLPFeesAccrued(creator, address(canonicalUsdc)), 0);
        assertEq(lpFeeVault.communityLPFeesAccrued(address(token), address(canonicalUsdc)), 0);
        assertEq(lpFeeVault.traderRewardsLPFeesAccrued(address(token), address(canonicalUsdc)), 0);
        assertEq(lpFeeVault.protocolLPFeesAccrued(treasury, address(canonicalUsdc)), 1);
        custodian.collectFees();
        assertEq(lpFeeVault.totalLPFeesAccrued(address(token)), 101);
    }

    function testCollectReentrancyIsRejectedAndOuterCollectionSettlesOnce() public {
        _bindCanonicalPosition();
        _fundCollectableFees(10 ether, 9_000_000);
        positions.setCollectReentry(address(custodian), abi.encodeCall(PermanentLPCustodianV4.collectFees, ()));

        custodian.collectFees();

        assertFalse(positions.collectReentrySucceeded());
        bytes memory result = positions.collectReentryResult();
        assertGe(result.length, 4);
        bytes4 selector;
        assembly ("memory-safe") {
            selector := mload(add(result, 32))
        }
        assertEq(selector, bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        assertEq(positions.collectable0(1), 0);
        assertEq(positions.collectable1(1), 0);
        assertEq(lpFeeVault.totalLPFeesAccrued(address(token)), 10 ether);
        assertEq(lpFeeVault.totalLPFeesAccrued(address(canonicalUsdc)), 9_000_000);
        assertEq(positions.ownerOf(1), address(custodian));
    }

    function testLPWithdrawalsAreRecipientAndAssetIsolated() public {
        _bindCanonicalPosition();
        _fundCollectableFees(10 ether, 8_000_000);
        custodian.collectFees();
        vm.prank(buyer);
        vm.expectRevert(IPermanentLPFeeVaultV4.NothingToClaimLPFees.selector);
        lpFeeVault.claimLPFees(address(token));
        uint256 creatorBefore = creator.balance;
        vm.prank(creator);
        lpFeeVault.claimLPFees(address(token));
        assertEq(token.balanceOf(creator), 2.5 ether);
        assertEq(lpFeeVault.creatorLPFeesAccrued(creator, address(canonicalUsdc)), 2_000_000);
        vm.prank(treasury);
        lpFeeVault.claimLPFees(address(canonicalUsdc));
        assertEq(canonicalUsdc.balanceOf(treasury), 2_400_000);
        assertEq(lpFeeVault.protocolLPFeesAccrued(treasury, address(token)), 3 ether);
        creatorBefore;
    }

    function testCollectionRollbackAndRecipientRotation() public {
        _bindCanonicalPosition();
        _fundCollectableFees(2 ether, 0);
        positions.setRevertCollect(true);
        vm.expectRevert(bytes("COLLECT_REVERTED"));
        custodian.collectFees();
        assertEq(positions.collectable0(1) + positions.collectable1(1), 2 ether);
        positions.setRevertCollect(false);
        custodian.collectFees();
        address newRecipient = makeAddr("newCreatorRecipient");
        vm.prank(creator);
        feeManager.proposeCreatorPayout(address(token), newRecipient);
        vm.prank(newRecipient);
        feeManager.acceptCreatorPayout(address(token));
        _fundCollectableFees(2 ether, 0);
        custodian.collectFees();
        assertEq(lpFeeVault.creatorLPFeesAccrued(creator, address(token)), 0.5 ether);
        assertEq(lpFeeVault.creatorLPFeesAccrued(newRecipient, address(token)), 0.5 ether);
    }

    function testCommunityAndRewardsLPFeesForwardOnlyToCanonicalVaults() public {
        _bindCanonicalPosition();
        _fundCollectableFees(10 ether, 8_000_000);
        custodian.collectFees();

        vm.prank(buyer);
        lpFeeVault.fundCommunityVault(address(token), address(token));
        vm.prank(buyer);
        lpFeeVault.fundCommunityVault(address(token), address(canonicalUsdc));
        vm.prank(buyer);
        lpFeeVault.fundTraderRewardsVault(address(token), address(token));
        vm.prank(buyer);
        lpFeeVault.fundTraderRewardsVault(address(token), address(canonicalUsdc));

        assertEq(communityVault.accrued(address(token), address(token)), 3 ether);
        assertEq(communityVault.accrued(address(token), address(canonicalUsdc)), 2_400_000);
        assertEq(rewardsVault.accrued(address(token), address(token)), 1.5 ether);
        assertEq(rewardsVault.accrued(address(token), address(canonicalUsdc)), 1_200_000);
        assertEq(token.balanceOf(address(communityVault)), 3 ether);
        assertEq(canonicalUsdc.balanceOf(address(communityVault)), 2_400_000);
        assertEq(token.balanceOf(address(rewardsVault)), 1.5 ether);
        assertEq(canonicalUsdc.balanceOf(address(rewardsVault)), 1_200_000);
        assertEq(lpFeeVault.totalLPFeesAccrued(address(token)), 5.5 ether);
        assertEq(lpFeeVault.totalLPFeesAccrued(address(canonicalUsdc)), 4_400_000);
        assertEq(token.balanceOf(address(lpFeeVault)), 5.5 ether);
        assertEq(canonicalUsdc.balanceOf(address(lpFeeVault)), 4_400_000);

        vm.expectRevert(IPermanentLPFeeVaultV4.NothingToClaimLPFees.selector);
        lpFeeVault.fundCommunityVault(address(token), address(token));
        vm.expectRevert(IPermanentLPFeeVaultV4.NothingToClaimLPFees.selector);
        lpFeeVault.fundTraderRewardsVault(address(token), address(token));

        vm.prank(creator);
        lpFeeVault.claimLPFees(address(token));
        vm.prank(treasury);
        lpFeeVault.claimLPFees(address(token));
        assertEq(lpFeeVault.totalLPFeesAccrued(address(token)), 0);
        assertEq(token.balanceOf(address(lpFeeVault)), 0);
    }

    function testMultipleLaunchTokensAndAssetsRemainIsolated() public {
        _bindCanonicalPosition();
        _fundCollectableFees(100, 200);
        custodian.collectFees();

        (CooketTokenV4 tokenTwo, CooketCurveV4 curveTwo) = _launch(makeAddr("secondCreator"), "Second", "TWO");
        vm.prank(address(graduationManager));
        PermanentLPCustodianV4 custodianTwo = PermanentLPCustodianV4(deployer.deployCustodian(address(tokenTwo)));
        (address token0, address token1) = address(tokenTwo) < address(canonicalUsdc)
            ? (address(tokenTwo), address(canonicalUsdc))
            : (address(canonicalUsdc), address(tokenTwo));
        positions.setPosition(2, address(custodianTwo), token0, token1, 10_000, -887_200, 887_200);
        vm.prank(address(graduationManager));
        custodianTwo.bindPosition(2);
        vm.prank(address(curveTwo));
        assertTrue(tokenTwo.transfer(address(positions), 400));
        canonicalUsdc.mint(address(positions), 300);
        positions.setCollectableFees(
            2, token0 == address(tokenTwo) ? 400 : 300, token0 == address(tokenTwo) ? 300 : 400
        );
        custodianTwo.collectFees();

        assertEq(lpFeeVault.communityLPFeesAccrued(address(token), address(token)), 30);
        assertEq(lpFeeVault.communityLPFeesAccrued(address(token), address(canonicalUsdc)), 60);
        assertEq(lpFeeVault.communityLPFeesAccrued(address(tokenTwo), address(tokenTwo)), 120);
        assertEq(lpFeeVault.communityLPFeesAccrued(address(tokenTwo), address(canonicalUsdc)), 90);
        assertEq(lpFeeVault.traderRewardsLPFeesAccrued(address(token), address(token)), 15);
        assertEq(lpFeeVault.traderRewardsLPFeesAccrued(address(tokenTwo), address(tokenTwo)), 60);
        assertEq(lpFeeVault.totalLPFeesAccrued(address(canonicalUsdc)), 500);
        assertEq(lpFeeVault.totalLPFeesAccrued(address(token)), 100);
        assertEq(lpFeeVault.totalLPFeesAccrued(address(tokenTwo)), 400);
    }

    function testFuzzLPFeeBucketsAlwaysReconcileWithProtocolRemainder(uint128 rawAmount) public {
        uint256 amount = bound(uint256(rawAmount), 1, 1_000_000_000 ether);
        _bindCanonicalPosition();
        _fundCollectableFees(amount, 0);
        custodian.collectFees();

        uint256 creatorAmount = lpFeeVault.creatorLPFeesAccrued(creator, address(token));
        uint256 protocolAmount = lpFeeVault.protocolLPFeesAccrued(treasury, address(token));
        uint256 communityAmount = lpFeeVault.communityLPFeesAccrued(address(token), address(token));
        uint256 rewardsAmount = lpFeeVault.traderRewardsLPFeesAccrued(address(token), address(token));
        assertEq(creatorAmount, amount * 25 / 100);
        assertEq(communityAmount, amount * 30 / 100);
        assertEq(rewardsAmount, amount * 15 / 100);
        assertEq(creatorAmount + protocolAmount + communityAmount + rewardsAmount, amount);
        assertEq(lpFeeVault.totalLPFeesAccrued(address(token)), amount);
        assertEq(token.balanceOf(address(lpFeeVault)), amount);
    }

    function testVaultNotificationFailureRollsBackCollectedTransfers() public {
        _bindCanonicalPosition();
        _fundCollectableFees(2 ether, 1_000_000);
        uint256 collectable0Before = positions.collectable0(1);
        uint256 collectable1Before = positions.collectable1(1);
        positions.setPositionsResponseMode(2);
        vm.expectRevert(IPermanentLPFeeVaultV4.UnauthorizedPermanentCustodian.selector);
        custodian.collectFees();
        assertEq(positions.collectable0(1), collectable0Before);
        assertEq(positions.collectable1(1), collectable1Before);
        assertEq(token.balanceOf(address(lpFeeVault)), 0);
        // MockArcDualViewUsdcV4 emulates Arc's native/ERC-20 linkage with vm.deal.
        // Foundry does not roll that cheatcode mutation back with the outer call;
        // the unchanged NPM accounting and zero vault liabilities are the local rollback proof.
        assertEq(lpFeeVault.totalLPFeesAccrued(address(token)), 0);
        assertEq(lpFeeVault.totalLPFeesAccrued(address(canonicalUsdc)), 0);
    }

    function _setCanonicalPosition(uint256 tokenId, address owner) private {
        (address token0, address token1) = address(token) < address(canonicalUsdc)
            ? (address(token), address(canonicalUsdc))
            : (address(canonicalUsdc), address(token));
        positions.setPosition(tokenId, owner, token0, token1, 10_000, -887_200, 887_200);
    }

    function _bindCanonicalPosition() private {
        _setCanonicalPosition(1, address(custodian));
        vm.prank(address(graduationManager));
        custodian.bindPosition(1);
    }

    function _fundCollectableFees(uint256 launchAmount18, uint256 usdcAmount6) private {
        vm.prank(address(curve));
        token.transfer(address(positions), launchAmount18);
        canonicalUsdc.mint(address(positions), usdcAmount6);
        (address token0,) = address(token) < address(canonicalUsdc)
            ? (address(token), address(canonicalUsdc))
            : (address(canonicalUsdc), address(token));
        positions.setCollectableFees(
            1,
            token0 == address(token) ? launchAmount18 : usdcAmount6,
            token0 == address(token) ? usdcAmount6 : launchAmount18
        );
    }

    function _expectInvalidPosition(uint256 tokenId) private {
        vm.prank(address(graduationManager));
        vm.expectRevert(IPermanentLPCustodianV4.InvalidPosition.selector);
        custodian.bindPosition(tokenId);
    }

    function _assertMissing(string memory signature) private {
        (bool ok,) = address(custodian).call(abi.encodeWithSignature(signature));
        assertFalse(ok, signature);
    }
}
