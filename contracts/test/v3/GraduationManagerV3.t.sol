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
import {ArcNativeUsdcV3} from "../../src/v3/libraries/ArcNativeUsdcV3.sol";
import {MockUniswapV3FactoryV3} from "./mocks/MockUniswapV3.sol";
import {MockArcDualViewUsdcV3} from "./mocks/MockArcDualViewUsdcV3.sol";
import {MockNonfungiblePositionManagerV3} from "./mocks/MockNonfungiblePositionManagerV3.sol";

contract ForceNativeUsdcGraduationV3 {
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
    MockArcDualViewUsdcV3 internal canonicalUsdc;
    MockUniswapV3FactoryV3 internal uniswapFactory;
    MockNonfungiblePositionManagerV3 internal npm;
    PermanentLPFeeVaultV3 internal vault;
    TokenCommunityVaultV3 internal communityVault;
    TraderRewardsVaultV3 internal rewardsVault;
    PermanentLPCustodianDeployerV3 internal deployer;

    function setUp() public {
        MockArcDualViewUsdcV3 usdcImplementation = new MockArcDualViewUsdcV3();
        vm.etch(ArcNativeUsdcV3.CANONICAL_USDC, address(usdcImplementation).code);
        canonicalUsdc = MockArcDualViewUsdcV3(ArcNativeUsdcV3.CANONICAL_USDC);
        uniswapFactory = new MockUniswapV3FactoryV3();
        manager = new GraduationManagerV3(address(uniswapFactory), address(this));
        fees = new FeeManagerV3(address(this), treasury);
        factory = new CooketFactoryV3(address(fees), address(manager));
        fees.setFactoryOnce(address(factory));
        manager.setFactoryOnce(address(factory));
        (communityVault, rewardsVault) = _bindEcosystemVaults(fees);
        vault =
            new PermanentLPFeeVaultV3(address(manager), address(fees), address(communityVault), address(rewardsVault));
        communityVault.setPermanentLPFeeVaultOnce(address(vault));
        rewardsVault.setPermanentLPFeeVaultOnce(address(vault));
        npm = new MockNonfungiblePositionManagerV3(address(uniswapFactory));
        deployer = new PermanentLPCustodianDeployerV3(address(manager), address(vault), address(npm));
        manager.bindDependenciesOnce(address(vault), address(deployer), address(npm));
        vm.deal(buyer, 10_000 ether);
    }

    function testEndpointGraduationMintsAndBindsCanonicalPositionExactly() public {
        (address token, CooketCurveV3 curve) = _launch("success");
        ForceNativeUsdcGraduationV3 forced = new ForceNativeUsdcGraduationV3{value: 1 ether}();
        forced.force(payable(address(manager)));
        _graduate(curve);
        uint256 tokenId = 100;
        address canonical = deployer.custodianOf(token);
        PermanentLPCustodianV3 custodian = PermanentLPCustodianV3(canonical);
        assertEq(npm.ownerOf(tokenId), canonical);
        assertEq(custodian.boundTokenId(), tokenId);
        assertTrue(custodian.positionRegistered());
        assertEq(custodian.launchToken(), token);
        assertEq(custodian.canonicalUsdc(), address(canonicalUsdc));
        assertEq(custodian.graduationManager(), address(manager));
        assertEq(custodian.feeVault(), address(vault));
        assertEq(custodian.nonfungiblePositionManager(), address(npm));
        assertEq(custodian.EXPECTED_FEE(), 10_000);
        assertEq(custodian.FULL_RANGE_TICK_LOWER(), -887_200);
        assertEq(custodian.FULL_RANGE_TICK_UPPER(), 887_200);
        bool tokenIsToken0 = token < address(canonicalUsdc);
        uint256 expectedTokenUsed = EndpointConstantsV3.LP_ALLOCATION - 1e18;
        uint256 expectedUsdc6Used = 7_244_999_999;
        assertEq(IERC20(token).balanceOf(address(npm)), expectedTokenUsed);
        assertEq(canonicalUsdc.balanceOf(address(npm)), expectedUsdc6Used);
        _assertCanonicalPosition(
            tokenId, tokenIsToken0 ? token : address(canonicalUsdc), tokenIsToken0 ? address(canonicalUsdc) : token
        );
        PermanentResidualEscrowV3 residual = PermanentResidualEscrowV3(manager.residualEscrowOf(token));
        assertEq(residual.launchToken(), token);
        assertEq(residual.graduationManager(), address(manager));
        assertEq(residual.canonicalUsdc(), address(canonicalUsdc));
        assertEq(residual.depositedResidual(token), EndpointConstantsV3.LP_ALLOCATION - expectedTokenUsed);
        assertEq(residual.depositedResidual(address(canonicalUsdc)), 1);
        assertEq(IERC20(token).balanceOf(address(residual)), EndpointConstantsV3.LP_ALLOCATION - expectedTokenUsed);
        assertEq(canonicalUsdc.balanceOf(address(residual)), 1);
        assertEq(residual.depositedNativeUsdcDust18(), 0);
        assertEq(IERC20(token).balanceOf(address(manager)), 0);
        assertEq(address(manager).balance, 1 ether, "only documented forced native USDC remains");
        assertEq(IERC20(token).allowance(address(manager), address(npm)), 0);
        assertEq(canonicalUsdc.allowance(manager.settlementExecutor(), address(npm)), 0);
        assertEq(curve.activeNativeUsdcReserve(), 0);
        assertEq(curve.terminalGraduationReserve(), EndpointConstantsV3.GRADUATION_NATIVE_USDC_RESERVE);
        assertTrue(manager.settled(token));
        assertEq(IGraduationSettlementExecutorV3(manager.settlementExecutor()).graduationManager(), address(manager));
        assertEq(deployer.settlementExecutor(), manager.settlementExecutor());
        assertEq(
            IGraduationSettlementExecutorV3(manager.settlementExecutor()).nonfungiblePositionManager(), address(npm)
        );
        vm.prank(address(curve));
        vm.expectRevert(IGraduationManagerV3.AlreadyGraduated.selector);
        manager.graduate(
            token, creator, EndpointConstantsV3.LP_ALLOCATION, EndpointConstantsV3.GRADUATION_NATIVE_USDC_RESERVE
        );
    }

    function _assertCanonicalPosition(uint256 tokenId, address expectedToken0, address expectedToken1) private view {
        (bool ok, bytes memory result) = address(npm).staticcall(abi.encodeWithSignature("positions(uint256)", tokenId));
        assertTrue(ok);
        (,, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper,,,,,) = abi.decode(
            result,
            (uint96, address, address, address, uint24, int24, int24, uint128, uint256, uint256, uint128, uint128)
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

    function testCanonicalUsdcIsFixedAndNoWrapperSurfaceExists() public {
        assertEq(manager.canonicalUsdc(), ArcNativeUsdcV3.CANONICAL_USDC);
        assertEq(vault.canonicalUsdc(), ArcNativeUsdcV3.CANONICAL_USDC);
        assertEq(deployer.canonicalUsdc(), ArcNativeUsdcV3.CANONICAL_USDC);
        assertEq(
            IGraduationSettlementExecutorV3(manager.settlementExecutor()).canonicalUsdc(),
            ArcNativeUsdcV3.CANONICAL_USDC
        );

        (bool wethGetterOk,) = address(manager).staticcall(abi.encodeWithSignature("weth()"));
        (bool depositOk,) = manager.settlementExecutor().call(abi.encodeWithSignature("deposit()"));
        (bool withdrawOk,) = manager.settlementExecutor().call(abi.encodeWithSignature("withdraw(uint256)", 1));
        assertFalse(wethGetterOk);
        assertFalse(depositOk);
        assertFalse(withdrawOk);
    }

    function testRevertingCanonicalUsdcTransferRollsBackCompleteEndpointSettlement() public {
        canonicalUsdc.setRevertTransfers(true);
        _assertRollbackAfterFinalBuy();
    }

    function testBlocklistedCanonicalUsdcTransferRollsBackCompleteEndpointSettlement() public {
        canonicalUsdc.setBlocked(address(npm), true);
        _assertRollbackAfterFinalBuy();
    }

    function testPartialTokenConsumptionReportRollsBackCompleteEndpointSettlement() public {
        npm.setMintResponseMode(1);
        _assertRollbackAfterFinalBuy();
    }

    function testUsdc6ReportedUsageMismatchRollsBackCompleteEndpointSettlement() public {
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
        uint256 buyerNativeUsdc = buyer.balance;
        CooketCurveV3.BuyQuote memory q = curve.quoteBuy(EndpointConstantsV3.EXACT_GRADUATION_GROSS_NATIVE_USDC);
        vm.prank(buyer);
        vm.expectRevert();
        curve.buy{value: q.acceptedGross}(q.tokensOut, block.timestamp + 1);
        assertFalse(curve.graduated());
        assertFalse(manager.settled(token));
        assertEq(IERC20(token).balanceOf(address(curve)), curveToken);
        assertEq(buyer.balance, buyerNativeUsdc);
        assertEq(IERC20(token).balanceOf(address(manager)), 0);
        assertEq(address(manager).balance, 0);
        assertEq(IERC20(token).balanceOf(address(npm)), 0);
        assertEq(canonicalUsdc.balanceOf(address(npm)), 0);
        assertEq(vault.totalLPFeesAccrued(token), 0);
        assertEq(vault.totalLPFeesAccrued(address(canonicalUsdc)), 0);
    }

    function testUnauthorizedPrematureAndDuplicateGraduationRevert() public {
        (address token, CooketCurveV3 curve) = _launch("authorization");
        vm.expectRevert();
        manager.graduate(
            token, creator, EndpointConstantsV3.LP_ALLOCATION, EndpointConstantsV3.GRADUATION_NATIVE_USDC_RESERVE
        );
        vm.prank(address(curve));
        vm.expectRevert();
        manager.graduate(
            token, creator, EndpointConstantsV3.LP_ALLOCATION, EndpointConstantsV3.GRADUATION_NATIVE_USDC_RESERVE
        );
        _graduate(curve);
        vm.prank(address(curve));
        vm.expectRevert(IGraduationManagerV3.AlreadyGraduated.selector);
        manager.graduate(
            token, creator, EndpointConstantsV3.LP_ALLOCATION, EndpointConstantsV3.GRADUATION_NATIVE_USDC_RESERVE
        );
    }

    function testUnboundDependenciesRollBackEndpointGraduation() public {
        GraduationManagerV3 bare = new GraduationManagerV3(address(uniswapFactory), address(this));
        FeeManagerV3 bareFees = new FeeManagerV3(address(this), treasury);
        CooketFactoryV3 bareFactory = new CooketFactoryV3(address(bareFees), address(bare));
        bareFees.setFactoryOnce(address(bareFactory));
        bare.setFactoryOnce(address(bareFactory));
        vm.prank(creator);
        (address token, address curveAddress) = bareFactory.createToken("Bare", "BAR", keccak256("bare"));
        CooketCurveV3 curve = CooketCurveV3(payable(curveAddress));
        CooketCurveV3.BuyQuote memory q = curve.quoteBuy(EndpointConstantsV3.EXACT_GRADUATION_GROSS_NATIVE_USDC);
        vm.prank(buyer);
        vm.expectRevert(GraduationManagerV3.DependenciesNotBound.selector);
        curve.buy{value: q.acceptedGross}(q.tokensOut, block.timestamp + 1);
        assertFalse(curve.graduated());
        assertFalse(bare.settled(token));
        assertEq(IERC20(token).balanceOf(address(curve)), EndpointConstantsV3.TOTAL_SUPPLY);
    }

    function testDependencyBindingRejectsEoasMismatchesAndRepeat() public {
        GraduationManagerV3 fresh = new GraduationManagerV3(address(uniswapFactory), address(this));
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
        MockNonfungiblePositionManagerV3 wrongFactory = new MockNonfungiblePositionManagerV3(address(this));
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
        GraduationManagerV3 fresh = new GraduationManagerV3(address(uniswapFactory), address(this));
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
        uint256 curveNativeUsdc = address(curve).balance;
        uint256 managerToken = IERC20(token).balanceOf(address(manager));
        uint256 managerNativeUsdc = address(manager).balance;
        uint256 npmToken = IERC20(token).balanceOf(address(npm));
        CooketCurveV3.BuyQuote memory q = curve.quoteBuy(EndpointConstantsV3.EXACT_GRADUATION_GROSS_NATIVE_USDC);
        vm.prank(buyer);
        vm.expectRevert();
        curve.buy{value: q.acceptedGross}(q.tokensOut, block.timestamp + 1);
        assertFalse(curve.graduated());
        assertFalse(manager.settled(token));
        assertEq(curve.activeNativeUsdcReserve(), 0);
        assertEq(IERC20(token).balanceOf(address(curve)), curveToken);
        assertEq(address(curve).balance, curveNativeUsdc);
        assertEq(IERC20(token).balanceOf(address(manager)), managerToken);
        assertEq(address(manager).balance, managerNativeUsdc);
        assertEq(IERC20(token).balanceOf(address(npm)), npmToken);
        // The Arc dual-view mock uses vm.deal to model native balance movement.
        // Foundry does not roll cheatcode mutations back with the reverting EVM call,
        // so its synthetic NPM USDC view is excluded from this rollback assertion.
        assertEq(canonicalUsdc.allowance(manager.settlementExecutor(), address(npm)), 0);
        assertEq(manager.residualEscrowOf(token), address(0), "escrow creation/accounting rolls back");
        assertEq(deployer.custodianOf(token), address(0), "no partial custodian survives");
        (bool exists,) = address(npm).staticcall(abi.encodeWithSignature("ownerOf(uint256)", 100));
        assertFalse(exists, "no NFT survives");
        assertEq(vault.totalLPFeesAccrued(token), 0);
        assertEq(vault.totalLPFeesAccrued(address(canonicalUsdc)), 0);
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
        CooketCurveV3.BuyQuote memory q = curve.quoteBuy(EndpointConstantsV3.EXACT_GRADUATION_GROSS_NATIVE_USDC);
        vm.prank(buyer);
        curve.buy{value: q.acceptedGross}(q.tokensOut, block.timestamp + 1);
    }
}
