// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FeeManagerV3} from "../../src/v3/FeeManagerV3.sol";
import {GraduationManagerV3} from "../../src/v3/GraduationManagerV3.sol";
import {IGraduationSettlementExecutorV3} from "../../src/v3/interfaces/IGraduationSettlementExecutorV3.sol";
import {PermanentLPFeeVaultV3} from "../../src/v3/PermanentLPFeeVaultV3.sol";
import {PermanentResidualEscrowV3} from "../../src/v3/PermanentResidualEscrowV3.sol";
import {PermanentLPCustodianDeployerV3} from "../../src/v3/PermanentLPCustodianDeployerV3.sol";
import {PermanentLPCustodianV3} from "../../src/v3/PermanentLPCustodianV3.sol";
import {TokenCommunityVaultV3} from "../../src/v3/TokenCommunityVaultV3.sol";
import {TraderRewardsDistributorV3} from "../../src/v3/TraderRewardsDistributorV3.sol";
import {TraderRewardsVaultV3} from "../../src/v3/TraderRewardsVaultV3.sol";
import {CooketFactoryV3} from "../../src/v3/CooketFactoryV3.sol";
import {CooketCurveV3} from "../../src/v3/CooketCurveV3.sol";
import {IGraduationManagerV3} from "../../src/v3/interfaces/IGraduationManagerV3.sol";
import {EndpointConstantsV3} from "../../src/v3/libraries/EndpointConstantsV3.sol";
import {MockWETHV3, MockUniswapV3FactoryV3} from "./mocks/MockUniswapV3.sol";
import {MockNonfungiblePositionManagerV3} from "./mocks/MockNonfungiblePositionManagerV3.sol";

contract ForceEtherGraduationV3 {
    constructor() payable {}

    function force(address payable to) external {
        selfdestruct(to);
    }
}

contract RevertingCustodianDeployerV3 {
    fallback() external payable {
        revert("DEPLOY_REVERTED");
    }
}

contract GraduationManagerV3Test is Test {
    uint256 internal constant EIP170_LIMIT = 24_576;
    uint256 internal constant MIN_RUNTIME_MARGIN = 3_072;
    address internal creator = makeAddr("creator");
    address internal buyer = makeAddr("buyer");
    address internal treasury = makeAddr("treasury");
    FeeManagerV3 internal fees;
    GraduationManagerV3 internal manager;
    CooketFactoryV3 internal factory;
    MockWETHV3 internal weth;
    MockUniswapV3FactoryV3 internal uniswapFactory;
    MockNonfungiblePositionManagerV3 internal npm;
    PermanentLPFeeVaultV3 internal vault;
    TokenCommunityVaultV3 internal communityVault;
    TraderRewardsVaultV3 internal rewardsVault;
    PermanentLPCustodianDeployerV3 internal deployer;

    function setUp() public {
        weth = new MockWETHV3();
        uniswapFactory = new MockUniswapV3FactoryV3();
        manager = new GraduationManagerV3(address(uniswapFactory), address(weth));
        fees = new FeeManagerV3(address(this), treasury);
        factory = new CooketFactoryV3(address(fees), address(manager));
        fees.setFactoryOnce(address(factory));
        manager.setFactoryOnce(address(factory));
        (communityVault, rewardsVault) = _bindEcosystemVaults(fees);
        vault =
            new PermanentLPFeeVaultV3(address(manager), address(fees), address(communityVault), address(rewardsVault));
        communityVault.setPermanentLPFeeVaultOnce(address(vault));
        rewardsVault.setPermanentLPFeeVaultOnce(address(vault));
        npm = new MockNonfungiblePositionManagerV3(address(uniswapFactory), address(weth));
        deployer = new PermanentLPCustodianDeployerV3(address(manager), address(vault), address(npm));
        manager.bindDependenciesOnce(address(vault), address(deployer), address(npm));
        vm.deal(buyer, 10 ether);
    }

    function testEndpointGraduationMintsAndBindsCanonicalPositionExactly() public {
        (address token, CooketCurveV3 curve) = _launch("success");
        ForceEtherGraduationV3 forced = new ForceEtherGraduationV3{value: 1 ether}();
        forced.force(payable(address(manager)));
        _graduate(curve);
        uint256 tokenId = 100;
        address canonical = deployer.custodianOf(token);
        PermanentLPCustodianV3 custodian = PermanentLPCustodianV3(canonical);
        assertEq(npm.ownerOf(tokenId), canonical);
        assertEq(custodian.boundTokenId(), tokenId);
        assertTrue(custodian.positionRegistered());
        assertEq(custodian.launchToken(), token);
        assertEq(custodian.weth(), address(weth));
        assertEq(custodian.graduationManager(), address(manager));
        assertEq(custodian.feeVault(), address(vault));
        assertEq(custodian.nonfungiblePositionManager(), address(npm));
        assertEq(custodian.EXPECTED_FEE(), 10_000);
        assertEq(custodian.FULL_RANGE_TICK_LOWER(), -887_200);
        assertEq(custodian.FULL_RANGE_TICK_UPPER(), 887_200);
        bool tokenIsToken0 = token < address(weth);
        uint256 expectedTokenUsed = tokenIsToken0 ? 199_999_999_999_999_999_999_999_977 : 199_999_999_999_999_999_999_999_968;
        uint256 expectedWethUsed = 2_999_999_999_999_998_668;
        assertEq(IERC20(token).balanceOf(address(npm)), expectedTokenUsed);
        assertEq(weth.balanceOf(address(npm)), expectedWethUsed);
        _assertCanonicalPosition(tokenId, tokenIsToken0 ? token : address(weth), tokenIsToken0 ? address(weth) : token);
        PermanentResidualEscrowV3 residual = PermanentResidualEscrowV3(manager.residualEscrowOf(token));
        assertEq(residual.launchToken(), token);
        assertEq(residual.graduationManager(), address(manager));
        assertEq(residual.weth(), address(weth));
        assertEq(residual.depositedResidual(token), EndpointConstantsV3.LP_ALLOCATION - expectedTokenUsed);
        assertEq(residual.depositedResidual(address(weth)), 1_332);
        assertEq(IERC20(token).balanceOf(address(residual)), EndpointConstantsV3.LP_ALLOCATION - expectedTokenUsed);
        assertEq(weth.balanceOf(address(residual)), 1_332);
        assertEq(IERC20(token).balanceOf(address(manager)), 0);
        assertEq(weth.balanceOf(address(manager)), 0);
        assertEq(address(manager).balance, 1 ether, "only documented forced ETH remains");
        assertEq(IERC20(token).allowance(address(manager), address(npm)), 0);
        assertEq(weth.allowance(address(manager), address(npm)), 0);
        assertEq(curve.activeEthReserve(), 0);
        assertEq(curve.terminalGraduationReserve(), 3 ether);
        assertTrue(manager.settled(token));
        assertEq(IGraduationSettlementExecutorV3(manager.settlementExecutor()).graduationManager(), address(manager));
        assertEq(deployer.settlementExecutor(), manager.settlementExecutor());
        assertEq(
            IGraduationSettlementExecutorV3(manager.settlementExecutor()).nonfungiblePositionManager(), address(npm)
        );
        vm.prank(address(curve));
        vm.expectRevert(IGraduationManagerV3.AlreadyGraduated.selector);
        manager.graduate(token, creator, EndpointConstantsV3.LP_ALLOCATION, 3 ether);
    }

    function _assertCanonicalPosition(uint256 tokenId, address expectedToken0, address expectedToken1) private view {
        (bool ok, bytes memory result) = address(npm).staticcall(abi.encodeWithSignature("positions(uint256)", tokenId));
        assertTrue(ok);
        (, , address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper,,,,,) = abi.decode(
            result, (uint96, address, address, address, uint24, int24, int24, uint128, uint256, uint256, uint128, uint128)
        );
        assertEq(token0, expectedToken0);
        assertEq(token1, expectedToken1);
        assertEq(fee, 10_000);
        assertEq(tickLower, -887_200);
        assertEq(tickUpper, 887_200);
    }

    function testManagerRuntimeRetainsThreeKilobyteEip170Margin() public view {
        assertLe(address(manager).code.length, EIP170_LIMIT - MIN_RUNTIME_MARGIN);
    }

    function testNpmMintRevertRollsBackCompleteEndpointSettlement() public {
        npm.setRevertMint(true);
        _assertRollbackAfterFinalBuy();
    }

    function testPartialTokenConsumptionReportRollsBackCompleteEndpointSettlement() public {
        npm.setMintResponseMode(1);
        _assertRollbackAfterFinalBuy();
    }

    function testPartialWethConsumptionReportRollsBackCompleteEndpointSettlement() public {
        npm.setMintResponseMode(2);
        _assertRollbackAfterFinalBuy();
    }

    function testZeroLiquidityReportRollsBackCompleteEndpointSettlement() public {
        npm.setMintResponseMode(3);
        _assertRollbackAfterFinalBuy();
    }

    function testCustodianBindFailureRollsBackCompleteEndpointSettlement() public {
        npm.setMintResponseMode(4);
        _assertRollbackAfterFinalBuy();
    }

    function testCustodianDeploymentFailureRollsBackCompleteEndpointSettlement() public {
        RevertingCustodianDeployerV3 reverter = new RevertingCustodianDeployerV3();
        vm.etch(address(deployer), address(reverter).code);
        (address token, CooketCurveV3 curve) = _launch("deploy-failure");
        uint256 curveToken = IERC20(token).balanceOf(address(curve));
        uint256 buyerEth = buyer.balance;
        CooketCurveV3.BuyQuote memory q = curve.quoteBuy(EndpointConstantsV3.EXACT_GRADUATION_GROSS);
        vm.prank(buyer);
        vm.expectRevert();
        curve.buy{value: q.acceptedGross}(q.tokensOut, block.timestamp + 1);
        assertFalse(curve.graduated());
        assertFalse(manager.settled(token));
        assertEq(IERC20(token).balanceOf(address(curve)), curveToken);
        assertEq(buyer.balance, buyerEth);
        assertEq(IERC20(token).balanceOf(address(manager)), 0);
        assertEq(weth.balanceOf(address(manager)), 0);
        assertEq(address(manager).balance, 0);
        assertEq(IERC20(token).balanceOf(address(npm)), 0);
        assertEq(weth.balanceOf(address(npm)), 0);
        assertEq(vault.totalLPFeesAccrued(token), 0);
        assertEq(vault.totalLPFeesAccrued(address(weth)), 0);
    }

    function testUnauthorizedPrematureAndDuplicateGraduationRevert() public {
        (address token, CooketCurveV3 curve) = _launch("authorization");
        vm.expectRevert();
        manager.graduate(token, creator, EndpointConstantsV3.LP_ALLOCATION, 3 ether);
        vm.prank(address(curve));
        vm.expectRevert();
        manager.graduate(token, creator, EndpointConstantsV3.LP_ALLOCATION, 3 ether);
        _graduate(curve);
        vm.prank(address(curve));
        vm.expectRevert(IGraduationManagerV3.AlreadyGraduated.selector);
        manager.graduate(token, creator, EndpointConstantsV3.LP_ALLOCATION, 3 ether);
    }

    function testUnboundDependenciesRollBackEndpointGraduation() public {
        GraduationManagerV3 bare = new GraduationManagerV3(address(uniswapFactory), address(weth));
        FeeManagerV3 bareFees = new FeeManagerV3(address(this), treasury);
        CooketFactoryV3 bareFactory = new CooketFactoryV3(address(bareFees), address(bare));
        bareFees.setFactoryOnce(address(bareFactory));
        bare.setFactoryOnce(address(bareFactory));
        vm.prank(creator);
        (address token, address curveAddress) = bareFactory.createToken("Bare", "BAR", keccak256("bare"));
        CooketCurveV3 curve = CooketCurveV3(payable(curveAddress));
        CooketCurveV3.BuyQuote memory q = curve.quoteBuy(EndpointConstantsV3.EXACT_GRADUATION_GROSS);
        vm.prank(buyer);
        vm.expectRevert(GraduationManagerV3.DependenciesNotBound.selector);
        curve.buy{value: q.acceptedGross}(q.tokensOut, block.timestamp + 1);
        assertFalse(curve.graduated());
        assertFalse(bare.settled(token));
        assertEq(IERC20(token).balanceOf(address(curve)), EndpointConstantsV3.TOTAL_SUPPLY);
    }

    function testDependencyBindingRejectsEoasMismatchesAndRepeat() public {
        GraduationManagerV3 fresh = new GraduationManagerV3(address(uniswapFactory), address(weth));
        FeeManagerV3 freshFees = new FeeManagerV3(address(this), treasury);
        CooketFactoryV3 freshFactory = new CooketFactoryV3(address(freshFees), address(fresh));
        freshFees.setFactoryOnce(address(freshFactory));
        fresh.setFactoryOnce(address(freshFactory));
        vm.expectRevert(GraduationManagerV3.InvalidDependency.selector);
        fresh.bindDependenciesOnce(address(1), address(2), address(3));
        (TokenCommunityVaultV3 freshCommunity, TraderRewardsVaultV3 freshRewards) = _bindEcosystemVaults(freshFees);
        PermanentLPFeeVaultV3 freshVault = new PermanentLPFeeVaultV3(
            address(fresh), address(freshFees), address(freshCommunity), address(freshRewards)
        );
        MockNonfungiblePositionManagerV3 wrongFactory =
            new MockNonfungiblePositionManagerV3(address(this), address(weth));
        vm.expectRevert(GraduationManagerV3.InvalidDependency.selector);
        fresh.bindDependenciesOnce(address(freshVault), address(deployer), address(wrongFactory));
        vm.expectRevert(GraduationManagerV3.DependenciesAlreadyBound.selector);
        manager.bindDependenciesOnce(address(vault), address(deployer), address(npm));
    }

    function testVaultRejectsDirectEoaBootstrap() public {
        vm.expectRevert();
        vault.setPermanentLPCustodianDeployerOnce(address(deployer));
    }

    function testVaultBindingFailureRollsBackManagerBinding() public {
        GraduationManagerV3 fresh = new GraduationManagerV3(address(uniswapFactory), address(weth));
        FeeManagerV3 freshFees = new FeeManagerV3(address(this), treasury);
        CooketFactoryV3 freshFactory = new CooketFactoryV3(address(freshFees), address(fresh));
        freshFees.setFactoryOnce(address(freshFactory));
        fresh.setFactoryOnce(address(freshFactory));
        (TokenCommunityVaultV3 freshCommunity, TraderRewardsVaultV3 freshRewards) = _bindEcosystemVaults(freshFees);
        PermanentLPFeeVaultV3 freshVault = new PermanentLPFeeVaultV3(
            address(fresh), address(freshFees), address(freshCommunity), address(freshRewards)
        );
        freshCommunity.setPermanentLPFeeVaultOnce(address(freshVault));
        freshRewards.setPermanentLPFeeVaultOnce(address(freshVault));
        PermanentLPCustodianDeployerV3 freshDeployer =
            new PermanentLPCustodianDeployerV3(address(fresh), address(freshVault), address(npm));
        vm.prank(address(fresh));
        freshVault.setPermanentLPCustodianDeployerOnce(address(freshDeployer));
        vm.expectRevert(GraduationManagerV3.InvalidDependency.selector);
        fresh.bindDependenciesOnce(address(freshVault), address(freshDeployer), address(npm));
        assertEq(fresh.permanentLPFeeVault(), address(0));
        assertEq(fresh.permanentLPCustodianDeployer(), address(0));
        assertEq(fresh.settlementExecutor(), address(0));
    }

    function _assertRollbackAfterFinalBuy() private {
        (address token, CooketCurveV3 curve) = _launch("rollback");
        uint256 curveToken = IERC20(token).balanceOf(address(curve));
        uint256 curveEth = address(curve).balance;
        uint256 managerToken = IERC20(token).balanceOf(address(manager));
        uint256 managerEth = address(manager).balance;
        uint256 npmToken = IERC20(token).balanceOf(address(npm));
        uint256 npmWeth = weth.balanceOf(address(npm));
        CooketCurveV3.BuyQuote memory q = curve.quoteBuy(EndpointConstantsV3.EXACT_GRADUATION_GROSS);
        vm.prank(buyer);
        vm.expectRevert();
        curve.buy{value: q.acceptedGross}(q.tokensOut, block.timestamp + 1);
        assertFalse(curve.graduated());
        assertFalse(manager.settled(token));
        assertEq(curve.activeEthReserve(), 0);
        assertEq(IERC20(token).balanceOf(address(curve)), curveToken);
        assertEq(address(curve).balance, curveEth);
        assertEq(IERC20(token).balanceOf(address(manager)), managerToken);
        assertEq(address(manager).balance, managerEth);
        assertEq(weth.balanceOf(address(manager)), 0);
        assertEq(IERC20(token).balanceOf(address(npm)), npmToken);
        assertEq(weth.balanceOf(address(npm)), npmWeth);
        assertEq(manager.residualEscrowOf(token), address(0), "escrow creation/accounting rolls back");
        assertEq(deployer.custodianOf(token), address(0), "no partial custodian survives");
        (bool exists,) = address(npm).staticcall(abi.encodeWithSignature("ownerOf(uint256)", 100));
        assertFalse(exists, "no NFT survives");
        assertEq(vault.totalLPFeesAccrued(token), 0);
        assertEq(vault.totalLPFeesAccrued(address(weth)), 0);
    }

    function _launch(string memory label) private returns (address token, CooketCurveV3 curve) {
        vm.prank(creator);
        address curveAddress;
        (token, curveAddress) = factory.createToken(label, "Z", keccak256(bytes(label)));
        curve = CooketCurveV3(payable(curveAddress));
    }

    function _bindEcosystemVaults(FeeManagerV3 targetFees)
        private
        returns (TokenCommunityVaultV3 targetCommunity, TraderRewardsVaultV3 targetRewards)
    {
        targetCommunity = new TokenCommunityVaultV3(address(this), treasury, address(targetFees));
        targetRewards = new TraderRewardsVaultV3(address(this), address(targetFees));
        TraderRewardsDistributorV3 distributor = new TraderRewardsDistributorV3(address(this), address(targetRewards));
        targetRewards.setDistributorOnce(address(distributor));
        targetFees.bindEcosystemVaultsOnce(address(targetCommunity), address(targetRewards));
    }

    function _graduate(CooketCurveV3 curve) private {
        CooketCurveV3.BuyQuote memory q = curve.quoteBuy(EndpointConstantsV3.EXACT_GRADUATION_GROSS);
        vm.prank(buyer);
        curve.buy{value: q.acceptedGross}(q.tokensOut, block.timestamp + 1);
    }
}
