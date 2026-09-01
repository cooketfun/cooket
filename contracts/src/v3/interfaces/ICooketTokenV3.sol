// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICooketTokenV3 {
    error AlreadyInitialized();
    error InvalidCreator();
    error InvalidFactory();
    error InvalidInventoryOwner();
    error InvalidTokenName();
    error InvalidTokenSymbol();
    error OnlyFactory();

    function initialize(address inventoryOwner) external;
    function factory() external view returns (address);
    function creator() external view returns (address);
    function initialized() external view returns (bool);
}
