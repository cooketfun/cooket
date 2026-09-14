// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FeeManagerV4} from "../../src/v4/FeeManagerV4.sol";
import {GraduationManagerV4} from "../../src/v4/GraduationManagerV4.sol";
import {IGraduationSettlementExecutorV4} from "../../src/v4/interfaces/IGraduationSettlementExecutorV4.sol";
import {PermanentLPFeeVaultV4} from "../../src/v4/PermanentLPFeeVaultV4.sol";
import {PermanentResidualEscrowV4} from "../../src/v4/PermanentResidualEscrowV4.sol";
import {PermanentLPCustodianDeployerV4} from "../../src/v4/PermanentLPCustodianDeployerV4.sol";
import {PermanentLPCustodianV4} from "../../src/v4/PermanentLPCustodianV4.sol";
import {TokenCommunityVaultV4} from "../../src/v4/TokenCommunityVaultV4.sol";
import {TraderRewardsDistributorV4} from "../../src/v4/TraderRewardsDistributorV4.sol";
import {TraderRewardsVaultV4} from "../../src/v4/TraderRewardsVaultV4.sol";
import {CooketFactoryV4} from "../../src/v4/CooketFactoryV4.sol";
import {CooketCurveV4} from "../../src/v4/CooketCurveV4.sol";
import {IGraduationManagerV4} from "../../src/v4/interfaces/IGraduationManagerV4.sol";
import {EndpointConstantsV4} from "../../src/v4/libraries/EndpointConstantsV4.sol";
import {ArcNativeUsdcV4} from "../../src/v4/libraries/ArcNativeUsdcV4.sol";
import {MockUniswapV3FactoryV4} from "./mocks/MockUniswapV3V4.sol";
import {MockArcDualViewUsdcV4} from "./mocks/MockArcDualViewUsdcV4.sol";
import {MockNonfungiblePositionManagerV4} from "./mocks/MockNonfungiblePositionManagerV4.sol";

contract ForceNativeUsdcGraduationV4 {
    constructor() payable {}

    function force(address payable to) external {
        selfdestruct(to);
    }
}

contract RevertingCustodianDeployerV4 {
    fallback() external payable {
        revert("DEPLOY_REVERTED");
    }
}

contract GraduationManagerV4Test is Test {
    uint256 internal constant EIP170_LIMIT = 24_576;
    uint256 internal constant MIN_RUNTIME_MARGIN = 3_072;
    address internal creator = makeAddr("creator");
    address internal buyer = makeAddr("buyer");
    address internal treasury = makeAddr("treasury");
    FeeManagerV4 internal fees;
    GraduationManagerV4 internal manager;
    CooketFactoryV4 internal factory;
    MockArcDualViewUsdcV4 internal canonicalUsdc;
    MockUniswapV3FactoryV4 internal uniswapFactory;
    MockNonfungiblePositionManagerV4 internal npm;
    PermanentLPFeeVaultV4 internal vault;
    TokenCommunityVaultV4 internal communityVault;
    TraderRewardsVaultV4 internal rewardsVault;
    PermanentLPCustodianDeployerV4 internal deployer;

    function setUp() public {
        MockArcDualViewUsdcV4 usdcImplementation = new MockArcDualViewUsdcV4();
        vm.etch(address(0x8000000000000000000000000000000000000001), address(usdcImplementation).code);
        canonicalUsdc = MockArcDualViewUsdcV4(address(0x8000000000000000000000000000000000000001));
        uniswapFactory = new MockUniswapV3FactoryV4();
        manager = new GraduationManagerV4(address(uniswapFactory), address(canonicalUsdc), address(this));
        fees = new FeeManagerV4(address(this), treasury);
        factory = new CooketFactoryV4(address(fees), address(manager));
        fees.setFactoryOnce(address(factory));
        manager.setFactoryOnce(address(factory));
        (communityVault, rewardsVault) = _bindEcosystemVaults(fees);
        vault = new PermanentLPFeeVaultV4(
            address(manager), address(fees), address(communityVault), address(rewardsVault), address(canonicalUsdc)
        );
        communityVault.setPermanentLPFeeVaultOnce(address(vault));
        rewardsVault.setPermanentLPFeeVaultOnce(address(vault));
        npm = new MockNonfungiblePositionManagerV4(address(uniswapFactory));
        deployer = new PermanentLPCustodianDeployerV4(address(manager), address(vault), address(npm));
        manager.bindDependenciesOnce(address(vault), address(deployer), address(npm));
        vm.deal(buyer, 20_000 ether);
    }

    function testEndpointGraduationMintsAndBindsCanonicalPositionExactly() public {
        (address token, CooketCurveV4 curve) = _launch("success");
        ForceNativeUsdcGraduationV4 forced = new ForceNativeUsdcGraduationV4{value: 1 ether}();
        forced.force(payable(address(manager)));
        _graduate(curve);
        uint256 tokenId = 100;
        address canonical = deployer.custodianOf(token);
        PermanentLPCustodianV4 custodian = PermanentLPCustodianV4(canonical);
        assertEq(npm.ownerOf(tokenId), canonical);
        assertEq(custodian.boundTokenId(), tokenId);
        assertTrue(custodian.positionRegistered());
        assertEq(custodian.launchToken(), token);
        assertEq(custodian.canonicalUsdc(), address(canonicalUsdc));
        assertEq(custodian.graduationManager(), address(manager));
        assertEq(custodian.feeVault(), address(vault));
        assertEq(custodian.nonfungiblePositionManager(), address(npm));
        assertEq(
            IGraduationSettlementExecutorV4(manager.settlementExecutor()).protocolVersionHash(),
            keccak256("endpoint-cp-v4")
        );
        assertEq(custodian.EXPECTED_FEE(), 10_000);
        assertEq(custodian.FULL_RANGE_TICK_LOWER(), -887_200);
        assertEq(custodian.FULL_RANGE_TICK_UPPER(), 887_200);
        bool tokenIsToken0 = token < address(canonicalUsdc);
        uint256 expectedTokenUsed = EndpointConstantsV4.LP_ALLOCATION - 1e18;
        uint256 expectedUsdc6Used = 14_489_999_999;
        assertEq(IERC20(token).balanceOf(address(npm)), expectedTokenUsed);
        assertEq(canonicalUsdc.balanceOf(address(npm)), expectedUsdc6Used);
        _assertCanonicalPosition(
            tokenId, tokenIsToken0 ? token : address(canonicalUsdc), tokenIsToken0 ? address(canonicalUsdc) : token
        );
        PermanentResidualEscrowV4 residual = PermanentResidualEscrowV4(manager.residualEscrowOf(token));
        assertEq(residual.launchToken(), token);
        assertEq(residual.graduationManager(), address(manager));
        assertEq(residual.canonicalUsdc(), address(canonicalUsdc));
        assertEq(residual.depositedResidual(token), EndpointConstantsV4.LP_ALLOCATION - expectedTokenUsed);
        assertEq(residual.depositedResidual(address(canonicalUsdc)), 1);
        assertEq(IERC20(token).balanceOf(address(residual)), EndpointConstantsV4.LP_ALLOCATION - expectedTokenUsed);
        assertEq(canonicalUsdc.balanceOf(address(residual)), 1);
        assertEq(residual.depositedNativeUsdcDust18(), 0);
        assertEq(IERC20(token).balanceOf(address(manager)), 0);
        assertEq(address(manager).balance, 1 ether, "only documented forced native USDC remains");
        assertEq(IERC20(token).allowance(address(manager), address(npm)), 0);
        assertEq(canonicalUsdc.allowance(manager.settlementExecutor(), address(npm)), 0);
        assertEq(curve.activeNativeUsdcReserve(), 0);
        assertEq(curve.terminalGraduationReserve(), EndpointConstantsV4.GRADUATION_NATIVE_USDC_RESERVE);
        assertTrue(manager.settled(token));
        assertEq(IGraduationSettlementExecutorV4(manager.settlementExecutor()).graduationManager(), address(manager));
        assertEq(deployer.settlementExecutor(), manager.settlementExecutor());
        assertEq(
            IGraduationSettlementExecutorV4(manager.settlementExecutor()).nonfungiblePositionManager(), address(npm)
        );
        vm.prank(address(curve));
        vm.expectRevert(IGraduationManagerV4.AlreadyGraduated.selector);
        manager.graduate(
            token, creator, EndpointConstantsV4.LP_ALLOCATION, EndpointConstantsV4.GRADUATION_NATIVE_USDC_RESERVE
        );
    }

    function testInitialLPIsBalancedAtExactlyTwentyEightThousandNineHundredEightyUsdc() public pure {
        uint256 launchTokenValue =
            EndpointConstantsV4.LP_ALLOCATION * EndpointConstantsV4.TERMINAL_NATIVE_USDC_PRICE / 1e18;
        assertEq(launchTokenValue, 14_490 ether);
        assertEq(launchTokenValue + EndpointConstantsV4.GRADUATION_NATIVE_USDC_RESERVE, 28_980 ether);
        assertEq(
            ArcNativeUsdcV4.nativeUsdcToUsdc6Exact(EndpointConstantsV4.GRADUATION_NATIVE_USDC_RESERVE), 14_490_000_000
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

    function testManipulatedCanonicalPoolPriceFailsClosedAndRollsBackFinalBuy() public {
        (address token, CooketCurveV4 curve) = _launch("manipulated-price");
        address pool = manager.canonicalPoolOf(token);
        vm.mockCall(
            pool,
            abi.encodeWithSignature("slot0()"),
            abi.encode(uint160(1), int24(0), uint16(0), uint16(0), uint16(0), uint8(0), true)
        );
        _assertFinalBuyRollback(token, curve);
        vm.clearMockedCalls();
    }

    function testCanonicalUsdcIsFixedAndNoWrapperSurfaceExists() public {
        assertEq(manager.canonicalUsdc(), address(0x8000000000000000000000000000000000000001));
        assertEq(vault.canonicalUsdc(), address(0x8000000000000000000000000000000000000001));
        assertEq(deployer.canonicalUsdc(), address(0x8000000000000000000000000000000000000001));
        assertEq(
            IGraduationSettlementExecutorV4(manager.settlementExecutor()).canonicalUsdc(),
            address(0x8000000000000000000000000000000000000001)
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
        RevertingCustodianDeployerV4 reverter = new RevertingCustodianDeployerV4();
        vm.etch(address(deployer), address(reverter).code);
        (address token, CooketCurveV4 curve) = _launch("deploy-failure");
        uint256 curveToken = IERC20(token).balanceOf(address(curve));
        uint256 buyerNativeUsdc = buyer.balance;
        CooketCurveV4.BuyQuote memory q = curve.quoteBuy(EndpointConstantsV4.EXACT_GRADUATION_GROSS_NATIVE_USDC);
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
        (address token, CooketCurveV4 curve) = _launch("authorization");
        vm.expectRevert();
        manager.graduate(
            token, creator, EndpointConstantsV4.LP_ALLOCATION, EndpointConstantsV4.GRADUATION_NATIVE_USDC_RESERVE
        );
        vm.prank(address(curve));
        vm.expectRevert();
        manager.graduate(
            token, creator, EndpointConstantsV4.LP_ALLOCATION, EndpointConstantsV4.GRADUATION_NATIVE_USDC_RESERVE
        );
        _graduate(curve);
        vm.prank(address(curve));
        vm.expectRevert(IGraduationManagerV4.AlreadyGraduated.selector);
        manager.graduate(
            token, creator, EndpointConstantsV4.LP_ALLOCATION, EndpointConstantsV4.GRADUATION_NATIVE_USDC_RESERVE
        );
    }

    function testUnboundDependenciesRollBackEndpointGraduation() public {
        GraduationManagerV4 bare =
            new GraduationManagerV4(address(uniswapFactory), address(canonicalUsdc), address(this));
        FeeManagerV4 bareFees = new FeeManagerV4(address(this), treasury);
        CooketFactoryV4 bareFactory = new CooketFactoryV4(address(bareFees), address(bare));
        bareFees.setFactoryOnce(address(bareFactory));
        bare.setFactoryOnce(address(bareFactory));
        vm.prank(creator);
        (address token, address curveAddress) = bareFactory.createToken("Bare", "BAR", keccak256("bare"));
        CooketCurveV4 curve = CooketCurveV4(payable(curveAddress));
        CooketCurveV4.BuyQuote memory q = curve.quoteBuy(EndpointConstantsV4.EXACT_GRADUATION_GROSS_NATIVE_USDC);
        vm.prank(buyer);
        vm.expectRevert(GraduationManagerV4.DependenciesNotBound.selector);
        curve.buy{value: q.acceptedGross}(q.tokensOut, block.timestamp + 1);
        assertFalse(curve.graduated());
        assertFalse(bare.settled(token));
        assertEq(IERC20(token).balanceOf(address(curve)), EndpointConstantsV4.TOTAL_SUPPLY);
    }

    function testDependencyBindingRejectsEoasMismatchesAndRepeat() public {
        GraduationManagerV4 fresh =
            new GraduationManagerV4(address(uniswapFactory), address(canonicalUsdc), address(this));
        FeeManagerV4 freshFees = new FeeManagerV4(address(this), treasury);
        CooketFactoryV4 freshFactory = new CooketFactoryV4(address(freshFees), address(fresh));
        freshFees.setFactoryOnce(address(freshFactory));
        fresh.setFactoryOnce(address(freshFactory));
        vm.expectRevert(GraduationManagerV4.InvalidDependency.selector);
        fresh.bindDependenciesOnce(address(1), address(2), address(3));
        (TokenCommunityVaultV4 freshCommunity, TraderRewardsVaultV4 freshRewards) = _bindEcosystemVaults(freshFees);
        PermanentLPFeeVaultV4 freshVault = new PermanentLPFeeVaultV4(
            address(fresh), address(freshFees), address(freshCommunity), address(freshRewards), address(canonicalUsdc)
        );
        MockNonfungiblePositionManagerV4 wrongFactory = new MockNonfungiblePositionManagerV4(address(this));
        vm.expectRevert(GraduationManagerV4.InvalidDependency.selector);
        fresh.bindDependenciesOnce(address(freshVault), address(deployer), address(wrongFactory));
        vm.expectRevert(GraduationManagerV4.DependenciesAlreadyBound.selector);
        manager.bindDependenciesOnce(address(vault), address(deployer), address(npm));
    }

    function testVaultRejectsDirectEoaBootstrap() public {
        vm.expectRevert();
        vault.setPermanentLPCustodianDeployerOnce(address(deployer));
    }

    function testVaultBindingFailureRollsBackManagerBinding() public {
        GraduationManagerV4 fresh =
            new GraduationManagerV4(address(uniswapFactory), address(canonicalUsdc), address(this));
        FeeManagerV4 freshFees = new FeeManagerV4(address(this), treasury);
        CooketFactoryV4 freshFactory = new CooketFactoryV4(address(freshFees), address(fresh));
        freshFees.setFactoryOnce(address(freshFactory));
        fresh.setFactoryOnce(address(freshFactory));
        (TokenCommunityVaultV4 freshCommunity, TraderRewardsVaultV4 freshRewards) = _bindEcosystemVaults(freshFees);
        PermanentLPFeeVaultV4 freshVault = new PermanentLPFeeVaultV4(
            address(fresh), address(freshFees), address(freshCommunity), address(freshRewards), address(canonicalUsdc)
        );
        freshCommunity.setPermanentLPFeeVaultOnce(address(freshVault));
        freshRewards.setPermanentLPFeeVaultOnce(address(freshVault));
        PermanentLPCustodianDeployerV4 freshDeployer =
            new PermanentLPCustodianDeployerV4(address(fresh), address(freshVault), address(npm));
        vm.prank(address(fresh));
        freshVault.setPermanentLPCustodianDeployerOnce(address(freshDeployer));
        vm.expectRevert(GraduationManagerV4.InvalidDependency.selector);
        fresh.bindDependenciesOnce(address(freshVault), address(freshDeployer), address(npm));
        assertEq(fresh.permanentLPFeeVault(), address(0));
        assertEq(fresh.permanentLPCustodianDeployer(), address(0));
        assertEq(fresh.settlementExecutor(), address(0));
    }

    function _assertRollbackAfterFinalBuy() private {
        (address token, CooketCurveV4 curve) = _launch("rollback");
        _assertFinalBuyRollback(token, curve);
    }

    function _assertFinalBuyRollback(address token, CooketCurveV4 curve) private {
        uint256 curveToken = IERC20(token).balanceOf(address(curve));
        uint256 curveNativeUsdc = address(curve).balance;
        uint256 managerToken = IERC20(token).balanceOf(address(manager));
        uint256 managerNativeUsdc = address(manager).balance;
        uint256 npmToken = IERC20(token).balanceOf(address(npm));
        CooketCurveV4.BuyQuote memory q = curve.quoteBuy(EndpointConstantsV4.EXACT_GRADUATION_GROSS_NATIVE_USDC);
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

    function _launch(string memory label) private returns (address token, CooketCurveV4 curve) {
        vm.prank(creator);
        address curveAddress;
        (token, curveAddress) = factory.createToken(label, "Z", keccak256(bytes(label)));
        curve = CooketCurveV4(payable(curveAddress));
    }

    function _bindEcosystemVaults(FeeManagerV4 targetFees)
        private
        returns (TokenCommunityVaultV4 targetCommunity, TraderRewardsVaultV4 targetRewards)
    {
        targetCommunity = new TokenCommunityVaultV4(address(this), treasury, address(targetFees));
        targetRewards = new TraderRewardsVaultV4(address(this), address(targetFees));
        TraderRewardsDistributorV4 distributor = new TraderRewardsDistributorV4(address(this), address(targetRewards));
        targetRewards.setDistributorOnce(address(distributor));
        targetFees.bindEcosystemVaultsOnce(address(targetCommunity), address(targetRewards));
    }

    function _graduate(CooketCurveV4 curve) private {
        CooketCurveV4.BuyQuote memory q = curve.quoteBuy(EndpointConstantsV4.EXACT_GRADUATION_GROSS_NATIVE_USDC);
        vm.prank(buyer);
        curve.buy{value: q.acceptedGross}(q.tokensOut, block.timestamp + 1);
    }
}
