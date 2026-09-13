// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ICooketFactoryV4} from "../../src/v4/interfaces/ICooketFactoryV4.sol";
import {FeeManagerV4} from "../../src/v4/FeeManagerV4.sol";
import {CooketCurveV4} from "../../src/v4/CooketCurveV4.sol";
import {CooketFactoryV4} from "../../src/v4/CooketFactoryV4.sol";
import {CooketTokenV4} from "../../src/v4/CooketTokenV4.sol";
import {CooketV4TestBase} from "./helpers/CooketV4TestBase.sol";

contract CooketFactoryV4Test is CooketV4TestBase {
    function testAtomicLaunchRegistryAndCanonicalMetadata() public view {
        (address registeredCreator, address registeredCurve) = factory.tokenInfo(address(token));
        assertEq(registeredCreator, creator);
        assertEq(registeredCurve, address(curve));
        assertTrue(factory.isToken(address(token)));
        assertEq(factory.curveOf(address(token)), address(curve));
        assertEq(feeManager.curveOf(address(token)), address(curve));
        assertEq(feeManager.creatorOf(address(token)), creator);
        assertEq(feeManager.creatorPayoutOf(address(token)), creator);
        assertEq(factory.PROTOCOL_VERSION(), "endpoint-cp-v4");
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        assertEq(token.balanceOf(address(curve)), 1_000_000_000 ether);
    }

    function testCreatorIdentityIsCallerAndNoCreatorAllocation() public {
        address anotherCreator = makeAddr("anotherCreator");
        (CooketTokenV4 anotherToken, CooketCurveV4 anotherCurve) = _launch(anotherCreator, "Another Endpoint", "ANEP");
        assertEq(anotherToken.creator(), anotherCreator);
        assertEq(anotherCurve.creator(), anotherCreator);
        assertEq(anotherToken.balanceOf(anotherCreator), 0);
        assertEq(anotherToken.balanceOf(address(anotherCurve)), TOTAL_SUPPLY);
    }

    function testDuplicateDefinitionAndInvalidMetadataReject() public {
        vm.prank(creator);
        vm.expectRevert(ICooketFactoryV4.DuplicateToken.selector);
        factory.createToken("Endpoint Cooket", "EPZ", keccak256("duplicate"));
        vm.expectRevert(ICooketFactoryV4.InvalidTokenName.selector);
        factory.createToken("", "OK", keccak256("invalid-name"));
        vm.expectRevert(ICooketFactoryV4.InvalidTokenSymbol.selector);
        factory.createToken("Okay", "", keccak256("invalid-symbol"));
    }

    function testLaunchFailsUntilFactoryIsRegisteredInFeeManager() public {
        FeeManagerV4 freshFees = new FeeManagerV4(address(this), treasury);
        CooketFactoryV4 freshFactory = new CooketFactoryV4(address(freshFees), address(graduationManager));
        vm.expectRevert();
        freshFactory.createToken("Unregistered", "UNR", keccak256("unregistered"));
    }
}
