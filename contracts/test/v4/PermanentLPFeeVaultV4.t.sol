// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IPermanentLPFeeVaultV4} from "../../src/v4/interfaces/IPermanentLPFeeVaultV4.sol";
import {PermanentLPCustodianDeployerV4} from "../../src/v4/PermanentLPCustodianDeployerV4.sol";
import {MockNonfungiblePositionManagerV4} from "./mocks/MockNonfungiblePositionManagerV4.sol";
import {CooketV4TestBase} from "./helpers/CooketV4TestBase.sol";

contract PermanentLPFeeVaultV4Test is CooketV4TestBase {
    MockNonfungiblePositionManagerV4 internal positions;
    PermanentLPCustodianDeployerV4 internal deployer;

    function setUp() public override {
        super.setUp();
        positions = new MockNonfungiblePositionManagerV4(address(uniswapFactory));
        deployer =
            new PermanentLPCustodianDeployerV4(address(graduationManager), address(lpFeeVault), address(positions));
    }

    function testVaultBindingIsAuthorizedValidatedAndConsumed() public {
        assertEq(lpFeeVault.protocolVersionHash(), keccak256("endpoint-cp-v4"));
        assertEq(lpFeeVault.feePolicyHash(), keccak256("cooket-fee-design-b-v3"));
        assertEq(lpFeeVault.communityVault(), address(communityVault));
        assertEq(lpFeeVault.traderRewardsVault(), address(rewardsVault));
        vm.expectRevert(IPermanentLPFeeVaultV4.UnauthorizedBootstrap.selector);
        lpFeeVault.setPermanentLPCustodianDeployerOnce(address(deployer));
        vm.prank(address(graduationManager));
        vm.expectRevert(IPermanentLPFeeVaultV4.InvalidCustodianDeployer.selector);
        lpFeeVault.setPermanentLPCustodianDeployerOnce(address(0));
        vm.prank(address(graduationManager));
        vm.expectRevert(IPermanentLPFeeVaultV4.InvalidCustodianDeployer.selector);
        lpFeeVault.setPermanentLPCustodianDeployerOnce(makeAddr("notAContract"));

        vm.prank(address(graduationManager));
        lpFeeVault.setPermanentLPCustodianDeployerOnce(address(deployer));
        assertEq(lpFeeVault.permanentLPCustodianDeployer(), address(deployer));
        assertEq(lpFeeVault.custodianDeployerBootstrapAuthority(), address(0));

        vm.prank(address(graduationManager));
        vm.expectRevert(IPermanentLPFeeVaultV4.CustodianDeployerAlreadySet.selector);
        lpFeeVault.setPermanentLPCustodianDeployerOnce(address(deployer));
    }

    function testFeeManagerNoLongerExposesLPFeeCustodySurface() public {
        (bool ok,) = address(feeManager).call(abi.encodeWithSignature("claimLPFees(address)", address(token)));
        assertFalse(ok);
        (ok,) = address(feeManager)
            .call(abi.encodeWithSignature("notifyPermanentLPFees(address,uint256,uint256)", address(token), 1, 0));
        assertFalse(ok);
    }
}
