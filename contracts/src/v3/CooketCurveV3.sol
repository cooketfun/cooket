// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {EndpointConstantsV3} from "./libraries/EndpointConstantsV3.sol";
import {IFeeManagerV3} from "./interfaces/IFeeManagerV3.sol";
import {IGraduationManagerV3} from "./interfaces/IGraduationManagerV3.sol";
import {ICooketCurveV3} from "./interfaces/ICooketCurveV3.sol";

/// @notice One-token endpoint-cp-v3 shifted constant-product curve.
/// @dev Buy token output and sell ETH output round down. The invariant's
/// post-trade virtual ETH coordinate rounds up with ceil(K / x).
contract CooketCurveV3 is ICooketCurveV3, ReentrancyGuard {
    using SafeERC20 for IERC20;

    string public constant PROTOCOL_VERSION = "endpoint-cp-v3";
    uint256 public constant TOTAL_SUPPLY = EndpointConstantsV3.TOTAL_SUPPLY;
    uint256 public constant CURVE_ALLOCATION = EndpointConstantsV3.CURVE_ALLOCATION;
    uint256 public constant LP_ALLOCATION = EndpointConstantsV3.LP_ALLOCATION;
    uint256 public constant VIRTUAL_TOKEN_RESERVE = EndpointConstantsV3.VIRTUAL_TOKEN_RESERVE;
    uint256 public constant VIRTUAL_ETH_RESERVE = EndpointConstantsV3.VIRTUAL_ETH_RESERVE;
    uint256 public constant GRADUATION_RESERVE = EndpointConstantsV3.GRADUATION_RESERVE;
    uint256 public constant K = EndpointConstantsV3.K;
    uint256 public constant FEE_DENOMINATOR = EndpointConstantsV3.FEE_DENOMINATOR;
    uint256 public constant TOTAL_FEE_BPS = EndpointConstantsV3.TOTAL_FEE_BPS;
    uint256 public constant INITIAL_PRICE = EndpointConstantsV3.INITIAL_PRICE;
    uint256 public constant TERMINAL_PRICE = EndpointConstantsV3.TERMINAL_PRICE;
    uint256 public constant EXACT_GRADUATION_GROSS = EndpointConstantsV3.EXACT_GRADUATION_GROSS;

    address public immutable factory;
    address public immutable token;
    address public immutable creator;
    IFeeManagerV3 public immutable feeManager;
    IGraduationManagerV3 public immutable graduationManager;

    uint256 public soldSupply;
    /// @notice Net ETH principal presently held for active curve redemptions.
    /// This becomes zero when graduation principal is forwarded atomically.
    uint256 public override activeEthReserve;
    /// @notice Final economic reserve coordinate retained for terminal pricing.
    /// This is not an assertion that the curve still holds the ETH.
    uint256 public override terminalGraduationReserve;
    /// @notice Native ETH principal actually forwarded to the manager.
    uint256 public override graduationEthForwarded;
    bool public graduated;

    constructor(address factory_, address token_, address creator_, address feeManager_, address graduationManager_) {
        if (factory_ == address(0) || factory_.code.length == 0) revert InvalidFactory();
        if (token_ == address(0) || token_.code.length == 0) revert TokenInvalid();
        if (creator_ == address(0)) revert InvalidRecipient();
        if (feeManager_ == address(0) || feeManager_.code.length == 0) revert InvalidFeeManager();
        if (graduationManager_ == address(0) || graduationManager_.code.length == 0) {
            revert GraduationManagerInvalid();
        }
        factory = factory_;
        token = token_;
        creator = creator_;
        feeManager = IFeeManagerV3(feeManager_);
        graduationManager = IGraduationManagerV3(graduationManager_);
    }

    function quoteBuy(uint256 grossInput) public view override returns (BuyQuote memory quote) {
        if (grossInput == 0) revert InvalidAmount();
        if (graduated) revert TradingClosed();

        uint256 netNeeded = GRADUATION_RESERVE - activeEthReserve;
        FeeSplit memory submittedFees = splitFee(grossInput);
        uint256 submittedNet = grossInput - submittedFees.totalFee;
        quote.submittedGross = grossInput;
        quote.acceptedGross = submittedNet >= netNeeded ? grossRequiredForNet(netNeeded) : grossInput;
        FeeSplit memory fees = splitFee(quote.acceptedGross);
        quote.totalFee = fees.totalFee;
        quote.creatorFee = fees.creatorFee;
        quote.protocolFee = fees.protocolFee;
        quote.communityFee = fees.communityFee;
        quote.traderRewardsFee = fees.traderRewardsFee;
        quote.netCurveInput = quote.acceptedGross - fees.totalFee;
        quote.refund = grossInput - quote.acceptedGross;

        uint256 postReserve = activeEthReserve + quote.netCurveInput;
        if (postReserve > GRADUATION_RESERVE) revert GraduationAccountingMismatch();
        quote.reachesGraduation = postReserve == GRADUATION_RESERVE;
        uint256 remainingInventory = CURVE_ALLOCATION - soldSupply;
        if (quote.reachesGraduation) {
            quote.tokensOut = remainingInventory;
        } else {
            uint256 postVirtualTokens = _ceilDiv(K, VIRTUAL_ETH_RESERVE + postReserve);
            quote.tokensOut = virtualTokenReserve() - postVirtualTokens;
        }
        if (quote.tokensOut == 0) revert DustTrade();
        if (quote.tokensOut > remainingInventory) revert InsufficientCurveInventory();
    }

    function quoteSell(uint256 tokensIn) public view override returns (SellQuote memory quote) {
        if (graduated) revert TradingClosed();
        if (tokensIn == 0 || tokensIn > soldSupply) revert InvalidAmount();

        uint256 postSold = soldSupply - tokensIn;
        uint256 postVirtualEth = _ceilDiv(K, VIRTUAL_TOKEN_RESERVE - postSold);
        quote.tokensIn = tokensIn;
        quote.grossCurveOutput = virtualEthReserve() - postVirtualEth;
        if (quote.grossCurveOutput == 0) revert DustTrade();
        if (quote.grossCurveOutput > activeEthReserve) revert InsufficientReserve();
        FeeSplit memory fees = splitFee(quote.grossCurveOutput);
        quote.totalFee = fees.totalFee;
        quote.creatorFee = fees.creatorFee;
        quote.protocolFee = fees.protocolFee;
        quote.communityFee = fees.communityFee;
        quote.traderRewardsFee = fees.traderRewardsFee;
        quote.netSellerOutput = quote.grossCurveOutput - fees.totalFee;
    }

    function buy(uint256 minTokensOut, uint256 deadline)
        external
        payable
        override
        nonReentrant
        returns (BuyQuote memory quote)
    {
        if (block.timestamp > deadline) revert DeadlineExpired();
        quote = quoteBuy(msg.value);
        if (quote.tokensOut < minTokensOut) revert SlippageExceeded();

        soldSupply += quote.tokensOut;
        activeEthReserve += quote.netCurveInput;
        if (soldSupply > CURVE_ALLOCATION || activeEthReserve > GRADUATION_RESERVE) {
            revert GraduationAccountingMismatch();
        }
        if (quote.reachesGraduation) graduated = true;

        IERC20(token).safeTransfer(msg.sender, quote.tokensOut);
        feeManager.depositFees{value: quote.totalFee}(
            token, quote.totalFee, quote.creatorFee, quote.protocolFee, quote.communityFee, quote.traderRewardsFee, true
        );

        if (quote.reachesGraduation) _graduate();
        if (quote.refund != 0) _sendNative(msg.sender, quote.refund);

        emit TokensBought(
            token,
            msg.sender,
            quote.submittedGross,
            quote.acceptedGross,
            quote.netCurveInput,
            quote.tokensOut,
            quote.totalFee,
            quote.creatorFee,
            quote.protocolFee,
            quote.communityFee,
            quote.traderRewardsFee,
            quote.refund
        );
    }

    function sell(uint256 tokensIn, uint256 minEthOut, uint256 deadline)
        external
        override
        nonReentrant
        returns (SellQuote memory quote)
    {
        if (block.timestamp > deadline) revert DeadlineExpired();
        quote = quoteSell(tokensIn);
        if (quote.netSellerOutput < minEthOut) revert SlippageExceeded();

        soldSupply -= tokensIn;
        activeEthReserve -= quote.grossCurveOutput;
        IERC20(token).safeTransferFrom(msg.sender, address(this), tokensIn);
        feeManager.depositFees{value: quote.totalFee}(
            token,
            quote.totalFee,
            quote.creatorFee,
            quote.protocolFee,
            quote.communityFee,
            quote.traderRewardsFee,
            false
        );
        _sendNative(msg.sender, quote.netSellerOutput);

        emit TokensSold(
            token,
            msg.sender,
            tokensIn,
            quote.grossCurveOutput,
            quote.netSellerOutput,
            quote.totalFee,
            quote.creatorFee,
            quote.protocolFee,
            quote.communityFee,
            quote.traderRewardsFee
        );
    }

    function spotPrice() public view override returns (uint256) {
        return Math.mulDiv(virtualEthReserve(), 1 ether, virtualTokenReserve(), Math.Rounding.Ceil);
    }

    function virtualTokenReserve() public view override returns (uint256) {
        return VIRTUAL_TOKEN_RESERVE - soldSupply;
    }

    function virtualEthReserve() public view override returns (uint256) {
        return VIRTUAL_ETH_RESERVE + reserveCoordinate();
    }

    /// @notice Economic reserve coordinate used for price reporting. Before
    /// graduation this is redeemable active reserve; afterwards it is the
    /// terminal coordinate whose ETH has already been forwarded.
    function reserveCoordinate() public view override returns (uint256) {
        return graduated ? terminalGraduationReserve : activeEthReserve;
    }

    /// @notice ETH present beyond the active redemption reserve, including
    /// forced ETH. It is excluded from all curve quotes and spot-price math.
    function unaccountedEth() public view override returns (uint256) {
        uint256 accounted = activeEthReserve;
        uint256 balance = address(this).balance;
        return balance > accounted ? balance - accounted : 0;
    }

    /// @notice O(1) inverse of net = gross - floor(gross / 100).
    function grossRequiredForNet(uint256 netAmount) public pure override returns (uint256 gross) {
        if (netAmount == 0) return 0;
        uint256 feeAdjustment = (netAmount - 1) / EndpointConstantsV3.NET_GROSS_ADJUSTMENT_DENOMINATOR;
        if (feeAdjustment > type(uint256).max - netAmount) revert InvalidAmount();
        gross = netAmount + feeAdjustment;
        FeeSplit memory fees = splitFee(gross);
        if (gross - fees.totalFee != netAmount) revert GraduationAccountingMismatch();
    }

    function feePolicyHash() external pure override returns (bytes32) {
        return EndpointConstantsV3.FEE_POLICY_HASH;
    }

    function splitFee(uint256 grossAmount) public pure override returns (FeeSplit memory fees) {
        fees.totalFee = Math.mulDiv(grossAmount, TOTAL_FEE_BPS, FEE_DENOMINATOR);
        fees.creatorFee = Math.mulDiv(
            fees.totalFee, EndpointConstantsV3.CREATOR_FEE_PERCENT, EndpointConstantsV3.FEE_SPLIT_DENOMINATOR
        );
        fees.communityFee = Math.mulDiv(
            fees.totalFee, EndpointConstantsV3.COMMUNITY_FEE_PERCENT, EndpointConstantsV3.FEE_SPLIT_DENOMINATOR
        );
        fees.traderRewardsFee = Math.mulDiv(
            fees.totalFee, EndpointConstantsV3.TRADER_REWARDS_FEE_PERCENT, EndpointConstantsV3.FEE_SPLIT_DENOMINATOR
        );
        fees.protocolFee = fees.totalFee - fees.creatorFee - fees.communityFee - fees.traderRewardsFee;
    }

    receive() external payable {
        revert UnexpectedEther();
    }

    function _graduate() private {
        if (
            soldSupply != CURVE_ALLOCATION || activeEthReserve != GRADUATION_RESERVE
                || IERC20(token).balanceOf(address(this)) != LP_ALLOCATION
        ) revert GraduationAccountingMismatch();

        uint256 reserveToForward = activeEthReserve;
        terminalGraduationReserve = reserveToForward;
        graduationEthForwarded = reserveToForward;
        activeEthReserve = 0;
        IERC20(token).safeTransfer(address(graduationManager), LP_ALLOCATION);
        graduationManager.graduate{value: reserveToForward}(token, creator, LP_ALLOCATION, reserveToForward);
        emit GraduationReserveForwarded(terminalGraduationReserve, reserveToForward);
        emit Graduated(token, address(graduationManager), LP_ALLOCATION, reserveToForward, soldSupply);
    }

    function _sendNative(address recipient, uint256 amount) private {
        if (recipient == address(0)) revert InvalidRecipient();
        (bool success,) = payable(recipient).call{value: amount}("");
        if (!success) revert NativeTransferFailed();
    }

    function _ceilDiv(uint256 numerator, uint256 denominator) private pure returns (uint256) {
        if (numerator == 0) return 0;
        return ((numerator - 1) / denominator) + 1;
    }
}
