// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {CTOTreasuryV3} from "../../../src/v3/CTOTreasuryV3.sol";

contract MockCTOControllerV3 {
    function accept(CTOTreasuryV3 treasury, bytes32 proposalId) external {
        treasury.acceptCTO(proposalId);
    }

    function registerAsset(CTOTreasuryV3 treasury, address asset) external {
        treasury.registerSupportedAsset(asset);
    }

    function transferAsset(CTOTreasuryV3 treasury, address asset, address recipient, uint256 amount) external {
        treasury.transferAsset(asset, recipient, amount);
    }

    receive() external payable {}
}
