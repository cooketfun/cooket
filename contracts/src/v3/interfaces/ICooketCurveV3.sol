// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IFeeManagerV3} from "./IFeeManagerV3.sol";
import {IGraduationManagerV3} from "./IGraduationManagerV3.sol";

interface ICooketCurveV3 {
    struct FeeSplit {
        uint256 totalFee;
        uint256 creatorFee;
        uint256 protocolFee;
        uint256 communityFee;
        uint256 traderRewardsFee;
    }

    struct BuyQuote {
        uint256 submittedGross;
        uint256 acceptedGross;
        uint256 totalFee;
        uint256 creatorFee;
        uint256 protocolFee;
        uint256 communityFee;
        uint256 traderRewardsFee;
        uint256 netCurveInput;
        uint256 refund;
        uint256 tokensOut;
        bool reachesGraduation;
    }

    struct SellQuote {
        uint256 tokensIn;
        uint256 grossCurveOutput;
        uint256 totalFee;
        uint256 creatorFee;
        uint256 protocolFee;
        uint256 communityFee;
        uint256 traderRewardsFee;
        uint256 netSellerOutput;
    }

    error AlreadyGraduated();
    error DeadlineExpired();
    error DustTrade();
    error GraduationAccountingMismatch();
    error GraduationManagerInvalid();
    error InsufficientCurveInventory();
    error InsufficientReserve();
    error InvalidAmount();
    error InvalidFactory();
    error InvalidFeeManager();
    error InvalidRecipient();
    error NativeTransferFailed();
    error SlippageExceeded();
    error TokenInvalid();
    error TokenTransferFailed();
    error TradingClosed();
    error UnexpectedNativeUsdc();

    event TokensBought(
        address indexed token,
        address indexed buyer,
        uint256 submittedGross,
        uint256 acceptedGross,
        uint256 netCurveInput,
        uint256 tokensOut,
        uint256 totalFee,
        uint256 creatorFee,
        uint256 protocolFee,
        uint256 communityFee,
        uint256 traderRewardsFee,
        uint256 refund
    );
    event TokensSold(
        address indexed token,
        address indexed seller,
        uint256 tokensIn,
        uint256 grossCurveOutput,
        uint256 netSellerOutput,
        uint256 totalFee,
        uint256 creatorFee,
        uint256 protocolFee,
        uint256 communityFee,
        uint256 traderRewardsFee
    );
    event Graduated(
        address indexed token,
        address indexed graduationManager,
        uint256 tokenAmount,
        uint256 nativeUsdcAmount,
        uint256 soldSupply
    );
    event GraduationReserveForwarded(uint256 terminalReserveCoordinate, uint256 nativeUsdcForwarded);

    function quoteBuy(uint256 grossInput) external view returns (BuyQuote memory quote);
    function quoteSell(uint256 tokensIn) external view returns (SellQuote memory quote);
    function buy(uint256 minTokensOut, uint256 deadline) external payable returns (BuyQuote memory quote);
    function sell(uint256 tokensIn, uint256 minNativeUsdcOut, uint256 deadline)
        external
        returns (SellQuote memory quote);

    function spotPrice() external view returns (uint256);
    function virtualTokenReserve() external view returns (uint256);
    function virtualNativeUsdcReserve() external view returns (uint256);
    function activeNativeUsdcReserve() external view returns (uint256);
    function terminalGraduationReserve() external view returns (uint256);
    function graduationNativeUsdcForwarded() external view returns (uint256);
    function reserveCoordinate() external view returns (uint256);
    function unaccountedNativeUsdc() external view returns (uint256);
    function factory() external view returns (address);
    function token() external view returns (address);
    function creator() external view returns (address);
    function feeManager() external view returns (IFeeManagerV3);
    function graduationManager() external view returns (IGraduationManagerV3);
    function feePolicyHash() external pure returns (bytes32);
    function grossRequiredForNet(uint256 netAmount) external pure returns (uint256);
    function splitFee(uint256 grossAmount) external pure returns (FeeSplit memory fees);
}
