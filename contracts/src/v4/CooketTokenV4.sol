// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {EndpointConstantsV4} from "./libraries/EndpointConstantsV4.sol";
import {ICooketTokenV4} from "./interfaces/ICooketTokenV4.sol";

/// @notice Fixed-supply endpoint-cp-v4 launch token with one factory-only mint.
contract CooketTokenV4 is ERC20, ICooketTokenV4 {
    bytes32 public constant PROTOCOL_VERSION_HASH = keccak256("endpoint-cp-v4");
    address public immutable override factory;
    address public immutable override creator;
    bool public override initialized;

    constructor(address factory_, address creator_, string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        if (factory_ == address(0)) revert InvalidFactory();
        if (creator_ == address(0)) revert InvalidCreator();
        if (bytes(name_).length == 0 || bytes(name_).length > EndpointConstantsV4.MAX_TOKEN_NAME_LENGTH) {
            revert InvalidTokenName();
        }
        if (bytes(symbol_).length == 0 || bytes(symbol_).length > EndpointConstantsV4.MAX_TOKEN_SYMBOL_LENGTH) {
            revert InvalidTokenSymbol();
        }
        factory = factory_;
        creator = creator_;
    }

    function protocolVersionHash() external pure override returns (bytes32) {
        return PROTOCOL_VERSION_HASH;
    }

    function initialize(address inventoryOwner) external override {
        if (msg.sender != factory) revert OnlyFactory();
        if (initialized) revert AlreadyInitialized();
        if (inventoryOwner == address(0)) revert InvalidInventoryOwner();
        initialized = true;
        _mint(inventoryOwner, EndpointConstantsV4.TOTAL_SUPPLY);
    }

    function decimals() public pure override returns (uint8) {
        return EndpointConstantsV4.TOKEN_DECIMALS;
    }
}
