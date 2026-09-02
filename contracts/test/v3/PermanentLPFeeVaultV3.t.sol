// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IPermanentLPFeeVaultV3} from "../../src/v3/interfaces/IPermanentLPFeeVaultV3.sol";
import {PermanentLPCustodianDeployerV3} from "../../src/v3/PermanentLPCustodianDeployerV3.sol";
import {MockNonfungiblePositionManagerV3} from "./mocks/MockNonfungiblePositionManagerV3.sol";
import {CooketV3TestBase} from "./helpers/CooketV3TestBase.sol";

contract PermanentLPFeeVaultV3Test is CooketV3TestBase {
    MockNonfungiblePositionManagerV3 internal positions;
    PermanentLPCustodianDeployerV3 internal deployer;

    function setUp() public override {
        super.setUp();
        positions = new MockNonfungiblePositionManagerV3(address(uniswapFactory));
        deployer =
            new PermanentLPCustodianDeployerV3(address(graduationManager), address(lpFeeVault), address(positions));
    }

    function testVaultBindingIsAuthorizedValidatedAndConsumed() public {
        assertEq(lpFeeVault.protocolVersionHash(), keccak256("COOKET_ARC_V1_CUSTODY"));
        assertEq(lpFeeVault.feePolicyHash(), keccak256("cooket-fee-design-b-v3"));
        assertEq(lpFeeVault.communityVault(), address(communityVault));
        assertEq(lpFeeVault.traderRewardsVault(), address(rewardsVault));
        vm.expectRevert(IPermanentLPFeeVaultV3.UnauthorizedBootstrap.selector);
        lpFeeVault.setPermanentLPCustodianDeployerOnce(address(deployer));
        vm.prank(address(graduationManager));
        vm.expectRevert(IPermanentLPFeeVaultV3.InvalidCustodianDeployer.selector);
        lpFeeVault.setPermanentLPCustodianDeployerOnce(address(0));
        vm.prank(address(graduationManager));
        vm.expectRevert(IPermanentLPFeeVaultV3.InvalidCustodianDeployer.selector);
        lpFeeVault.setPermanentLPCustodianDeployerOnce(makeAddr("notAContract"));

        vm.prank(address(graduationManager));
        lpFeeVault.setPermanentLPCustodianDeployerOnce(address(deployer));
        assertEq(lpFeeVault.permanentLPCustodianDeployer(), address(deployer));
        assertEq(lpFeeVault.custodianDeployerBootstrapAuthority(), address(0));

        vm.prank(address(graduationManager));
        vm.expectRevert(IPermanentLPFeeVaultV3.CustodianDeployerAlreadySet.selector);
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
