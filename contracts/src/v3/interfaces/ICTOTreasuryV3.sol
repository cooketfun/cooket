// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICTOTreasuryV3 {
    error CTOInactive();
    error InvalidAmount();
    error InvalidAsset();
    error InvalidController();
    error InvalidRecipient();
    error InvalidRegistry();
    error NativeTransferFailed();
    error NothingToPull();
    error ProtocolFeesMixed();
    error UnauthorizedController();
    error UnsupportedAsset();

    event CTOAcceptanceSubmitted(bytes32 indexed proposalId, address indexed controller, address indexed treasury);
    event SupportedAssetRegistered(address indexed asset, address indexed controller);
    event TreasuryAssetTransferred(
        address indexed asset, address indexed recipient, uint256 amount, address indexed controller
    );
    event CreatorFeesPulled(address indexed token, address indexed asset, uint256 amount, address indexed triggeredBy);

    function acceptCTO(bytes32 proposalId) external;
    function registerSupportedAsset(address asset) external;
    function transferAsset(address asset, address recipient, uint256 amount) external;
    function pullCurveCreatorFees() external returns (uint256 amount);
    function pullLPCreatorFees(address asset) external returns (uint256 amount);

    function ctoPolicyHash() external pure returns (bytes32);
    function registry() external view returns (address);
    function launchToken() external view returns (address);
    function controller() external view returns (address);
    function canonicalUsdc() external view returns (address);
    function isSupportedAsset(address asset) external view returns (bool);
}
