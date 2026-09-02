// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IGraduationManagerV3} from "../../src/v3/interfaces/IGraduationManagerV3.sol";
import {IFeeManagerV3} from "../../src/v3/interfaces/IFeeManagerV3.sol";
import {ICooketFactoryV3} from "../../src/v3/interfaces/ICooketFactoryV3.sol";
import {FeeManagerV3} from "../../src/v3/FeeManagerV3.sol";
import {CooketFactoryV3} from "../../src/v3/CooketFactoryV3.sol";
import {CooketTokenV3} from "../../src/v3/CooketTokenV3.sol";
import {TokenDeployerV3} from "../../src/v3/TokenDeployerV3.sol";
import {CooketV3TestBase} from "./helpers/CooketV3TestBase.sol";
import {MockGraduationManagerV3} from "./mocks/MockGraduationManagerV3.sol";

contract VersionHashStubV3 {
    function protocolVersionHash() external pure returns (bytes32) {
        return keccak256("endpoint-cp-v3");
    }
}

contract ForceEtherV3 {
    constructor() payable {}

    function force(address payable recipient) external {
        selfdestruct(recipient);
    }
}

contract GraduationBoundaryV3Test is CooketV3TestBase {
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
        FeeManagerV3 fees = new FeeManagerV3(address(this), treasury);
        MockGraduationManagerV3 manager = new MockGraduationManagerV3(address(uniswapFactory));
        CooketFactoryV3 launcher = new CooketFactoryV3(address(fees), address(manager));
        fees.setFactoryOnce(address(launcher));
        manager.setFactoryOnce(address(launcher));
        manager.configureRegistrationFailure(true);

        TokenDeployerV3 deployer = TokenDeployerV3(launcher.tokenDeployer());
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
        vm.expectRevert(IGraduationManagerV3.UnauthorizedFactory.selector);
        graduationManager.registerLaunch(address(token), address(curve), creator, bytes32(0), bytes32(0), 0);

        vm.prank(address(factory));
        vm.expectRevert(IGraduationManagerV3.LaunchAlreadyRegistered.selector);
        graduationManager.registerLaunch(address(token), address(curve), creator, bytes32(0), bytes32(0), 0);
    }

    function testWrongTokenCurveRelationshipRejects() public {
        CooketTokenV3 rogueToken = new CooketTokenV3(address(factory), creator, "Rogue", "ROG");
        vm.prank(address(factory));
        vm.expectRevert(IGraduationManagerV3.LaunchRelationshipMismatch.selector);
        graduationManager.registerLaunch(address(rogueToken), address(curve), creator, bytes32(0), bytes32(0), 0);
    }

    function testLaunchFailsClosedWithEitherUnboundDependency() public {
        FeeManagerV3 feesOne = new FeeManagerV3(address(this), treasury);
        MockGraduationManagerV3 managerOne = new MockGraduationManagerV3(address(uniswapFactory));
        CooketFactoryV3 launcherOne = new CooketFactoryV3(address(feesOne), address(managerOne));
        feesOne.setFactoryOnce(address(launcherOne));
        vm.expectRevert(ICooketFactoryV3.DependencyFactoryMismatch.selector);
        launcherOne.createToken("Manager Unbound", "MUB", keccak256("manager-unbound"));

        FeeManagerV3 feesTwo = new FeeManagerV3(address(this), treasury);
        MockGraduationManagerV3 managerTwo = new MockGraduationManagerV3(address(uniswapFactory));
        CooketFactoryV3 launcherTwo = new CooketFactoryV3(address(feesTwo), address(managerTwo));
        managerTwo.setFactoryOnce(address(launcherTwo));
        vm.expectRevert(ICooketFactoryV3.DependencyFactoryMismatch.selector);
        launcherTwo.createToken("Fees Unbound", "FUB", keccak256("fees-unbound"));
    }

    function testFactoryBindingIsAuthorizedNonzeroAndOneTime() public {
        FeeManagerV3 fees = new FeeManagerV3(address(this), treasury);
        MockGraduationManagerV3 manager = new MockGraduationManagerV3(address(uniswapFactory));
        CooketFactoryV3 launcher = new CooketFactoryV3(address(fees), address(manager));

        vm.expectRevert(IFeeManagerV3.InvalidFactory.selector);
        fees.setFactoryOnce(address(0));
        vm.expectRevert(IGraduationManagerV3.InvalidFactory.selector);
        manager.setFactoryOnce(address(0));

        vm.prank(buyer);
        vm.expectRevert(IFeeManagerV3.UnauthorizedBootstrap.selector);
        fees.setFactoryOnce(address(launcher));
        vm.prank(buyer);
        vm.expectRevert(IGraduationManagerV3.UnauthorizedBootstrap.selector);
        manager.setFactoryOnce(address(launcher));

        fees.setFactoryOnce(address(launcher));
        manager.setFactoryOnce(address(launcher));
        assertEq(fees.factory(), address(launcher));
        assertEq(manager.factory(), address(launcher));
        assertEq(fees.factoryBootstrapAuthority(), address(0));
        assertEq(manager.factoryBootstrapAuthority(), address(0));

        vm.expectRevert(IFeeManagerV3.FactoryAlreadySet.selector);
        fees.setFactoryOnce(address(launcher));
        vm.expectRevert(IGraduationManagerV3.FactoryAlreadySet.selector);
        manager.setFactoryOnce(address(launcher));
    }

    function testFactoryRejectsManagerBoundToWrongCanonicalAddress() public {
        FeeManagerV3 fees = new FeeManagerV3(address(this), treasury);
        MockGraduationManagerV3 manager = new MockGraduationManagerV3(address(uniswapFactory));
        VersionHashStubV3 wrongFactory = new VersionHashStubV3();
        manager.setFactoryOnce(address(wrongFactory));
        CooketFactoryV3 launcher = new CooketFactoryV3(address(fees), address(manager));
        fees.setFactoryOnce(address(launcher));

        vm.expectRevert(ICooketFactoryV3.DependencyFactoryMismatch.selector);
        launcher.createToken("Wrong Binding", "WRG", keccak256("wrong-binding"));
    }

    function testActiveTerminalAndForcedNativeUsdcReserveSemantics() public {
        uint256 initialSpot = curve.spotPrice();
        ForceEtherV3 forceSender = new ForceEtherV3{value: 1 ether}();
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
        assertEq(curve.spotPrice(), 36_225_000_000_000);
    }

    function testFactoryRuntimeBytecodeRemainsUnderEip170Limit() public view {
        uint256 deployedSize = address(factory).code.length;
        assertLt(deployedSize, 24_576);
    }
}
