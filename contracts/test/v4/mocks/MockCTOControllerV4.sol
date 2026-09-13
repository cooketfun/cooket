// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {CTOTreasuryV4} from "../../../src/v4/CTOTreasuryV4.sol";

contract MockCTOControllerV4 {
    function accept(CTOTreasuryV4 treasury, bytes32 proposalId) external {
        treasury.confirmCTO(proposalId);
    }

    function registerAsset(CTOTreasuryV4 treasury, address asset) external {
        treasury.registerSupportedAsset(asset);
    }

    function transferAsset(CTOTreasuryV4 treasury, address asset, address recipient, uint256 amount) external {
        treasury.transferAsset(asset, recipient, amount);
    }

    receive() external payable {}
}
