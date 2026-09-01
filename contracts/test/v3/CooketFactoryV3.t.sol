// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ICooketFactoryV3} from "../../src/v3/interfaces/ICooketFactoryV3.sol";
import {FeeManagerV3} from "../../src/v3/FeeManagerV3.sol";
import {CooketCurveV3} from "../../src/v3/CooketCurveV3.sol";
import {CooketFactoryV3} from "../../src/v3/CooketFactoryV3.sol";
import {CooketTokenV3} from "../../src/v3/CooketTokenV3.sol";
import {CooketV3TestBase} from "./helpers/CooketV3TestBase.sol";

contract CooketFactoryV3Test is CooketV3TestBase {
    function testAtomicLaunchRegistryAndCanonicalMetadata() public view {
        (address registeredCreator, address registeredCurve) = factory.tokenInfo(address(token));
        assertEq(registeredCreator, creator);
        assertEq(registeredCurve, address(curve));
        assertTrue(factory.isToken(address(token)));
        assertEq(factory.curveOf(address(token)), address(curve));
        assertEq(feeManager.curveOf(address(token)), address(curve));
        assertEq(feeManager.creatorOf(address(token)), creator);
        assertEq(feeManager.creatorPayoutOf(address(token)), creator);
        assertEq(factory.PROTOCOL_VERSION(), "endpoint-cp-v3");
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        assertEq(token.balanceOf(address(curve)), 1_000_000_000 ether);
    }

    function testCreatorIdentityIsCallerAndNoCreatorAllocation() public {
        address anotherCreator = makeAddr("anotherCreator");
        (CooketTokenV3 anotherToken, CooketCurveV3 anotherCurve) = _launch(anotherCreator, "Another Endpoint", "ANEP");
        assertEq(anotherToken.creator(), anotherCreator);
        assertEq(anotherCurve.creator(), anotherCreator);
        assertEq(anotherToken.balanceOf(anotherCreator), 0);
        assertEq(anotherToken.balanceOf(address(anotherCurve)), TOTAL_SUPPLY);
    }

    function testDuplicateDefinitionAndInvalidMetadataReject() public {
        vm.prank(creator);
        vm.expectRevert(ICooketFactoryV3.DuplicateToken.selector);
        factory.createToken("Endpoint Cooket", "EPZ", keccak256("duplicate"));
        vm.expectRevert(ICooketFactoryV3.InvalidTokenName.selector);
        factory.createToken("", "OK", keccak256("invalid-name"));
        vm.expectRevert(ICooketFactoryV3.InvalidTokenSymbol.selector);
        factory.createToken("Okay", "", keccak256("invalid-symbol"));
    }

    function testLaunchFailsUntilFactoryIsRegisteredInFeeManager() public {
        FeeManagerV3 freshFees = new FeeManagerV3(address(this), treasury);
        CooketFactoryV3 freshFactory = new CooketFactoryV3(address(freshFees), address(graduationManager));
        vm.expectRevert();
        freshFactory.createToken("Unregistered", "UNR", keccak256("unregistered"));
    }
}
