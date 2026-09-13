// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IGraduationManagerV4} from "../../src/v4/interfaces/IGraduationManagerV4.sol";
import {IFeeManagerV4} from "../../src/v4/interfaces/IFeeManagerV4.sol";
import {ICooketFactoryV4} from "../../src/v4/interfaces/ICooketFactoryV4.sol";
import {FeeManagerV4} from "../../src/v4/FeeManagerV4.sol";
import {CooketFactoryV4} from "../../src/v4/CooketFactoryV4.sol";
import {CooketTokenV4} from "../../src/v4/CooketTokenV4.sol";
import {TokenDeployerV4} from "../../src/v4/TokenDeployerV4.sol";
import {CooketV4TestBase} from "./helpers/CooketV4TestBase.sol";
import {MockGraduationManagerV4} from "./mocks/MockGraduationManagerV4.sol";

contract VersionHashStubV4 {
    function protocolVersionHash() external pure returns (bytes32) {
        return keccak256("endpoint-cp-v4");
    }
}

contract ForceEtherV4 {
    constructor() payable {}

    function force(address payable recipient) external {
        selfdestruct(recipient);
    }
}

contract GraduationBoundaryV4Test is CooketV4TestBase {
    function testAtomicLaunchRegistrationRecordsCanonicalRelationship() public view {
        (address registeredCurve, address registeredCreator, bool registered, bool hasGraduated) =
            graduationManager.launchOf(address(token));
        assertEq(registeredCurve, address(curve));
        assertEq(registeredCreator, creator);
        assertTrue(registered);
        assertFalse(hasGraduated);
        assertEq(graduationManager.registrationCalls(), 1);
    }

    function testRegistrationCallbackFailureRollsBackEntireLaunch() public {
        FeeManagerV4 fees = new FeeManagerV4(address(this), treasury);
        MockGraduationManagerV4 manager =
            new MockGraduationManagerV4(address(uniswapFactory), address(0x8000000000000000000000000000000000000001));
        CooketFactoryV4 launcher = new CooketFactoryV4(address(fees), address(manager));
        fees.setFactoryOnce(address(launcher));
        manager.setFactoryOnce(address(launcher));
        manager.configureRegistrationFailure(true);

        TokenDeployerV4 deployer = TokenDeployerV4(launcher.tokenDeployer());
        bytes32 userSalt = keccak256("rollback-salt");
        bytes32 launchSeed = deployer.computeLaunchSeed(creator, userSalt, "Rollback", "RBK");
        bytes32 candidateSalt = deployer.computeCandidateSalt(launchSeed, 0);
        address predictedToken = deployer.computeTokenAddress(creator, "Rollback", "RBK", candidateSalt);
        bytes32 definition = keccak256(abi.encode(creator, "Rollback", "RBK"));

        vm.prank(creator);
        vm.expectRevert(bytes("REGISTRATION_FAILED"));
        launcher.createToken("Rollback", "RBK", userSalt);

        assertEq(launcher.definitionToken(definition), address(0));
        assertEq(launcher.tokensByCreator(creator).length, 0);
        assertEq(fees.curveOf(predictedToken), address(0));
        (address registeredCurve,, bool registered,) = manager.launchOf(predictedToken);
        assertEq(registeredCurve, address(0));
        assertFalse(registered);
        assertEq(manager.registrationCalls(), 0);
        assertEq(predictedToken.code.length, 0);
        assertEq(uniswapFactory.getPool(predictedToken, address(canonicalUsdc), 10_000), address(0));
    }

    function testUnauthorizedAndDuplicateRegistrationReject() public {
        vm.prank(buyer);
        vm.expectRevert(IGraduationManagerV4.UnauthorizedFactory.selector);
        graduationManager.registerLaunch(address(token), address(curve), creator, bytes32(0), bytes32(0), 0);

        vm.prank(address(factory));
        vm.expectRevert(IGraduationManagerV4.LaunchAlreadyRegistered.selector);
        graduationManager.registerLaunch(address(token), address(curve), creator, bytes32(0), bytes32(0), 0);
    }

    function testWrongTokenCurveRelationshipRejects() public {
        CooketTokenV4 rogueToken = new CooketTokenV4(address(factory), creator, "Rogue", "ROG");
        vm.prank(address(factory));
        vm.expectRevert(IGraduationManagerV4.LaunchRelationshipMismatch.selector);
        graduationManager.registerLaunch(address(rogueToken), address(curve), creator, bytes32(0), bytes32(0), 0);
    }

    function testLaunchFailsClosedWithEitherUnboundDependency() public {
        FeeManagerV4 feesOne = new FeeManagerV4(address(this), treasury);
        MockGraduationManagerV4 managerOne =
            new MockGraduationManagerV4(address(uniswapFactory), address(0x8000000000000000000000000000000000000001));
        CooketFactoryV4 launcherOne = new CooketFactoryV4(address(feesOne), address(managerOne));
        feesOne.setFactoryOnce(address(launcherOne));
        vm.expectRevert(ICooketFactoryV4.DependencyFactoryMismatch.selector);
        launcherOne.createToken("Manager Unbound", "MUB", keccak256("manager-unbound"));

        FeeManagerV4 feesTwo = new FeeManagerV4(address(this), treasury);
        MockGraduationManagerV4 managerTwo =
            new MockGraduationManagerV4(address(uniswapFactory), address(0x8000000000000000000000000000000000000001));
        CooketFactoryV4 launcherTwo = new CooketFactoryV4(address(feesTwo), address(managerTwo));
        managerTwo.setFactoryOnce(address(launcherTwo));
        vm.expectRevert(ICooketFactoryV4.DependencyFactoryMismatch.selector);
        launcherTwo.createToken("Fees Unbound", "FUB", keccak256("fees-unbound"));
    }

    function testFactoryBindingIsAuthorizedNonzeroAndOneTime() public {
        FeeManagerV4 fees = new FeeManagerV4(address(this), treasury);
        MockGraduationManagerV4 manager =
            new MockGraduationManagerV4(address(uniswapFactory), address(0x8000000000000000000000000000000000000001));
        CooketFactoryV4 launcher = new CooketFactoryV4(address(fees), address(manager));

        vm.expectRevert(IFeeManagerV4.InvalidFactory.selector);
        fees.setFactoryOnce(address(0));
        vm.expectRevert(IGraduationManagerV4.InvalidFactory.selector);
        manager.setFactoryOnce(address(0));

        vm.prank(buyer);
        vm.expectRevert(IFeeManagerV4.UnauthorizedBootstrap.selector);
        fees.setFactoryOnce(address(launcher));
        vm.prank(buyer);
        vm.expectRevert(IGraduationManagerV4.UnauthorizedBootstrap.selector);
        manager.setFactoryOnce(address(launcher));

        fees.setFactoryOnce(address(launcher));
        manager.setFactoryOnce(address(launcher));
        assertEq(fees.factory(), address(launcher));
        assertEq(manager.factory(), address(launcher));
        assertEq(fees.factoryBootstrapAuthority(), address(0));
        assertEq(manager.factoryBootstrapAuthority(), address(0));

        vm.expectRevert(IFeeManagerV4.FactoryAlreadySet.selector);
        fees.setFactoryOnce(address(launcher));
        vm.expectRevert(IGraduationManagerV4.FactoryAlreadySet.selector);
        manager.setFactoryOnce(address(launcher));
    }

    function testFactoryRejectsManagerBoundToWrongCanonicalAddress() public {
        FeeManagerV4 fees = new FeeManagerV4(address(this), treasury);
        MockGraduationManagerV4 manager =
            new MockGraduationManagerV4(address(uniswapFactory), address(0x8000000000000000000000000000000000000001));
        VersionHashStubV4 wrongFactory = new VersionHashStubV4();
        manager.setFactoryOnce(address(wrongFactory));
        CooketFactoryV4 launcher = new CooketFactoryV4(address(fees), address(manager));
        fees.setFactoryOnce(address(launcher));

        vm.expectRevert(ICooketFactoryV4.DependencyFactoryMismatch.selector);
        launcher.createToken("Wrong Binding", "WRG", keccak256("wrong-binding"));
    }

    function testActiveTerminalAndForcedNativeUsdcReserveSemantics() public {
        uint256 initialSpot = curve.spotPrice();
        ForceEtherV4 forceSender = new ForceEtherV4{value: 1 ether}();
        forceSender.force(payable(address(curve)));
        assertEq(curve.activeNativeUsdcReserve(), 0);
        assertEq(curve.terminalGraduationReserve(), 0);
        assertEq(curve.unaccountedNativeUsdc(), 1 ether);
        assertEq(curve.spotPrice(), initialSpot);

        vm.prank(buyer);
        curve.buy{value: GRADUATION_GROSS}(0, block.timestamp);
        assertEq(curve.activeNativeUsdcReserve(), 0);
        assertEq(curve.terminalGraduationReserve(), GRADUATION_NATIVE_USDC_RESERVE);
        assertEq(curve.reserveCoordinate(), GRADUATION_NATIVE_USDC_RESERVE);
        assertEq(curve.graduationNativeUsdcForwarded(), GRADUATION_NATIVE_USDC_RESERVE);
        assertEq(address(graduationManager).balance, GRADUATION_NATIVE_USDC_RESERVE);
        assertEq(address(curve).balance, 1 ether);
        assertEq(curve.unaccountedNativeUsdc(), 1 ether);
        assertEq(curve.spotPrice(), 72_450_000_000_000);
    }

    function testFactoryRuntimeBytecodeRemainsUnderEip170Limit() public view {
        uint256 deployedSize = address(factory).code.length;
        assertLt(deployedSize, 24_576);
    }
}
