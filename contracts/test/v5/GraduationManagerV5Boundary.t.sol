// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {CooketLaunchHookV5} from "../../src/v5/CooketLaunchHookV5.sol";
import {GraduationManagerV5Boundary} from "../../src/v5/GraduationManagerV5Boundary.sol";
import {IGraduationManagerV5Boundary} from "../../src/v5/interfaces/IGraduationManagerV5Boundary.sol";
import {
    BoundaryDeployerV5,
    Create2DeployerV5,
    DelegateProxyV5,
    MalformedBindingHookV5,
    MockBindingHookV5,
    MockFactoryLaunchGateV5,
    MockPoolManagerV5,
    RevertingBindingHookV5
} from "./mocks/MockV5Foundation.sol";

contract GraduationManagerV5BoundaryTest is Test {
    uint160 internal constant MASK = 0x3EA0;
    uint160 internal constant ALL_MASK = 0x3FFF;
    bytes32 internal constant VERSION = keccak256("endpoint-cp-v5");
    bytes32 internal constant POLICY = keccak256("cooket-v4-restrictive-launch-v1");

    MockPoolManagerV5 internal poolManager;
    Create2DeployerV5 internal create2Deployer;
    BoundaryDeployerV5 internal boundaryDeployer;

    function setUp() public {
        poolManager = new MockPoolManagerV5();
        create2Deployer = new Create2DeployerV5();
        boundaryDeployer = new BoundaryDeployerV5();
    }

    function testCanonicalBindingSucceedsExactlyOnceAndConsumesCapability() public {
        (GraduationManagerV5Boundary manager, CooketLaunchHookV5 hook) = _deployCanonicalPair();
        assertFalse(manager.hookBootstrapConsumed());
        assertEq(manager.launchHook(), address(0));
        manager.bindLaunchHook(address(hook));
        assertEq(manager.launchHook(), address(hook));
        assertTrue(manager.hookBootstrapConsumed());
        assertTrue(manager.isLaunchHookBound());
        assertEq(manager.hookBootstrapAuthority(), address(this));

        vm.expectRevert(IGraduationManagerV5Boundary.HookBootstrapConsumed.selector);
        manager.bindLaunchHook(address(hook));
    }

    function testUnauthorizedBindingFrontRunPreservesUnusedBootstrap() public {
        (GraduationManagerV5Boundary manager, CooketLaunchHookV5 hook) = _deployCanonicalPair();
        vm.prank(address(0xBAD));
        vm.expectRevert(IGraduationManagerV5Boundary.UnauthorizedHookBootstrap.selector);
        manager.bindLaunchHook(address(hook));
        assertFalse(manager.hookBootstrapConsumed());
        assertEq(manager.launchHook(), address(0));
        manager.bindLaunchHook(address(hook));
        assertTrue(manager.isLaunchHookBound());
    }

    function testFactoryAndLaunchGatesFailBeforeAndPassAfterBinding() public {
        (GraduationManagerV5Boundary manager, CooketLaunchHookV5 hook) = _deployCanonicalPair();
        MockFactoryLaunchGateV5 gate = new MockFactoryLaunchGateV5(manager);
        vm.expectRevert(IGraduationManagerV5Boundary.HookNotBound.selector);
        gate.bindFactory();
        vm.expectRevert(IGraduationManagerV5Boundary.HookNotBound.selector);
        gate.registerLaunch();

        manager.bindLaunchHook(address(hook));
        gate.bindFactory();
        gate.registerLaunch();
        assertEq(gate.launches(), 1);
    }

    function testZeroEoaProxyAndWrongRuntimeCodeRejectAndPreserveBootstrap() public {
        (GraduationManagerV5Boundary manager, CooketLaunchHookV5 hook) = _deployCanonicalPair();
        vm.expectRevert(IGraduationManagerV5Boundary.InvalidLaunchHook.selector);
        manager.bindLaunchHook(address(0));
        vm.expectRevert(IGraduationManagerV5Boundary.InvalidLaunchHook.selector);
        manager.bindLaunchHook(address(0xBEEF));

        DelegateProxyV5 proxy = new DelegateProxyV5(address(hook));
        vm.expectRevert(IGraduationManagerV5Boundary.LaunchHookCodeHashMismatch.selector);
        manager.bindLaunchHook(address(proxy));
        MockBindingHookV5 wrongCode =
            new MockBindingHookV5(address(poolManager), address(manager), VERSION, POLICY, MASK);
        vm.expectRevert(IGraduationManagerV5Boundary.LaunchHookCodeHashMismatch.selector);
        manager.bindLaunchHook(address(wrongCode));
        assertFalse(manager.hookBootstrapConsumed());
        assertEq(manager.launchHook(), address(0));
    }

    function testWrongPoolManagerRejects() public {
        address target = _maskedAddressForString("wrong-pool", MASK);
        uint256 nonce = vm.getNonce(address(this));
        address predictedManager = vm.computeCreateAddress(address(this), nonce + 1);
        MockBindingHookV5 template = new MockBindingHookV5(address(0xBAD), predictedManager, VERSION, POLICY, MASK);
        vm.etch(target, address(template).code);
        GraduationManagerV5Boundary manager =
            new GraduationManagerV5Boundary(address(poolManager), address(this), target.codehash);
        vm.expectRevert(IGraduationManagerV5Boundary.LaunchHookRelationshipMismatch.selector);
        manager.bindLaunchHook(target);
        _assertUnused(manager);
    }

    function testWrongManagerRejects() public {
        address target = _maskedAddressForString("wrong-manager", MASK);
        MockBindingHookV5 template = new MockBindingHookV5(address(poolManager), address(0xBAD), VERSION, POLICY, MASK);
        vm.etch(target, address(template).code);
        GraduationManagerV5Boundary manager =
            new GraduationManagerV5Boundary(address(poolManager), address(this), target.codehash);
        vm.expectRevert(IGraduationManagerV5Boundary.LaunchHookRelationshipMismatch.selector);
        manager.bindLaunchHook(target);
        _assertUnused(manager);
    }

    function testWrongVersionAndPolicyReject() public {
        _expectIdentityRejection(
            keccak256("wrong-version"), POLICY, IGraduationManagerV5Boundary.LaunchHookVersionMismatch.selector
        );
        _expectIdentityRejection(
            VERSION, keccak256("wrong-policy"), IGraduationManagerV5Boundary.LaunchHookPolicyMismatch.selector
        );
    }

    function testAddressMaskAndDeclaredPermissionMismatchReject() public {
        _expectPermissionRejection(MASK ^ (1 << 7), MASK, "wrong-address-mask");
        _expectPermissionRejection(MASK, MASK ^ (1 << 7), "wrong-declaration");
    }

    function testFuzzEveryDeclaredPermissionBitMismatchRejects(uint8 bit) public {
        bit = uint8(bound(bit, 0, 13));
        _expectPermissionRejection(MASK, MASK ^ (uint160(1) << bit), keccak256(abi.encode("permission-bit", bit)));
    }

    function testEveryUnexpectedReturnDeltaPermissionRejects() public {
        for (uint8 bit = 0; bit < 4; ++bit) {
            _expectPermissionRejection(MASK, MASK | (uint160(1) << bit), keccak256(abi.encode("delta-bit", bit)));
        }
    }

    function testMalformedAndRevertingHooksRejectWithoutConsumption() public {
        RevertingBindingHookV5 revertingTemplate = new RevertingBindingHookV5();
        address revertingTarget = _maskedAddressForString("reverting", MASK);
        vm.etch(revertingTarget, address(revertingTemplate).code);
        GraduationManagerV5Boundary revertingManager =
            new GraduationManagerV5Boundary(address(poolManager), address(this), revertingTarget.codehash);
        vm.expectRevert();
        revertingManager.bindLaunchHook(revertingTarget);
        _assertUnused(revertingManager);

        MalformedBindingHookV5 malformedTemplate = new MalformedBindingHookV5();
        address malformedTarget = _maskedAddressForString("malformed", MASK);
        vm.etch(malformedTarget, address(malformedTemplate).code);
        GraduationManagerV5Boundary malformedManager =
            new GraduationManagerV5Boundary(address(poolManager), address(this), malformedTarget.codehash);
        vm.expectRevert();
        malformedManager.bindLaunchHook(malformedTarget);
        _assertUnused(malformedManager);
    }

    function testConstructorsRejectInvalidBootstrapInputs() public {
        vm.expectRevert(IGraduationManagerV5Boundary.InvalidBootstrapAuthority.selector);
        new GraduationManagerV5Boundary(address(poolManager), address(0), bytes32(uint256(1)));
        vm.expectRevert(IGraduationManagerV5Boundary.InvalidExpectedHookCodeHash.selector);
        new GraduationManagerV5Boundary(address(poolManager), address(this), bytes32(0));
        vm.expectRevert(IGraduationManagerV5Boundary.InvalidLaunchHook.selector);
        new GraduationManagerV5Boundary(address(0xBEEF), address(this), bytes32(uint256(1)));
    }

    function _deployCanonicalPair()
        internal
        returns (GraduationManagerV5Boundary manager, CooketLaunchHookV5 canonicalHook)
    {
        uint256 managerNonce = vm.getNonce(address(boundaryDeployer));
        address predictedManager = vm.computeCreateAddress(address(boundaryDeployer), managerNonce);
        CooketLaunchHookV5 probe = _deployHook(predictedManager, 0);
        bytes32 expectedRuntimeCodeHash = address(probe).codehash;
        manager = boundaryDeployer.deploy(address(poolManager), address(this), expectedRuntimeCodeHash);
        assertEq(address(manager), predictedManager);
        canonicalHook = _deployHook(address(manager), 100_000);
        assertEq(address(canonicalHook).codehash, expectedRuntimeCodeHash);
        assertEq(uint160(address(canonicalHook)) & ALL_MASK, MASK);
    }

    function _deployHook(address manager, uint256 startingSalt) internal returns (CooketLaunchHookV5 deployed) {
        bytes memory creationCode =
            abi.encodePacked(type(CooketLaunchHookV5).creationCode, abi.encode(address(poolManager), manager));
        bytes32 initCodeHash = keccak256(creationCode);
        for (uint256 candidate = startingSalt; candidate < startingSalt + 100_000; ++candidate) {
            bytes32 salt = bytes32(candidate);
            address predicted = create2Deployer.compute(salt, initCodeHash);
            if (uint160(predicted) & ALL_MASK == MASK) {
                deployed = CooketLaunchHookV5(create2Deployer.deploy(salt, creationCode));
                return deployed;
            }
        }
        revert("MASK_NOT_FOUND");
    }

    function _expectIdentityRejection(bytes32 version, bytes32 policy, bytes4 expectedError) internal {
        bytes32 label = keccak256(abi.encode(version, policy));
        address target = _maskedAddress(label, MASK);
        uint256 nonce = vm.getNonce(address(this));
        address predictedManager = vm.computeCreateAddress(address(this), nonce + 1);
        MockBindingHookV5 template =
            new MockBindingHookV5(address(poolManager), predictedManager, version, policy, MASK);
        vm.etch(target, address(template).code);
        GraduationManagerV5Boundary manager =
            new GraduationManagerV5Boundary(address(poolManager), address(this), target.codehash);
        vm.expectRevert(expectedError);
        manager.bindLaunchHook(target);
        _assertUnused(manager);
    }

    function _expectPermissionRejection(uint160 addressMask, uint160 declaration, bytes32 label) internal {
        address target = _maskedAddress(label, addressMask);
        uint256 nonce = vm.getNonce(address(this));
        address predictedManager = vm.computeCreateAddress(address(this), nonce + 1);
        MockBindingHookV5 template =
            new MockBindingHookV5(address(poolManager), predictedManager, VERSION, POLICY, declaration);
        vm.etch(target, address(template).code);
        GraduationManagerV5Boundary manager =
            new GraduationManagerV5Boundary(address(poolManager), address(this), target.codehash);
        vm.expectRevert(IGraduationManagerV5Boundary.LaunchHookPermissionMismatch.selector);
        manager.bindLaunchHook(target);
        _assertUnused(manager);
    }

    function _maskedAddressForString(string memory label, uint160 lowBits) internal pure returns (address) {
        return _maskedAddress(keccak256(bytes(label)), lowBits);
    }

    function _maskedAddress(bytes32 label, uint160 lowBits) internal pure returns (address) {
        uint160 highBits = uint160(uint256(label)) & ~ALL_MASK;
        return address(highBits | (lowBits & ALL_MASK));
    }

    function _assertUnused(GraduationManagerV5Boundary manager) internal view {
        assertFalse(manager.hookBootstrapConsumed());
        assertEq(manager.launchHook(), address(0));
    }
}
