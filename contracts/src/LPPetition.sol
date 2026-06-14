// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

/// @title LPPetition
/// @notice Threshold-based liquidity commitments. Users sign conditional LP
///         commitments for a sorted token pair; once the aggregate hypothetical
///         TVL (Chainlink-priced) clears a shared threshold, `execute()` pulls
///         tokens and mints full-range Uniswap v4 positions owned by each signer.
/// @dev C4 scope: permissionless, single-exec `execute()` that values the
///      deliverable set with the on-chain Chainlink read, skips insolvent signers,
///      gates on the shared threshold, then pulls committed tokens via Permit2.
///      The v4 pool-create + mint-to-signers step (consuming `calls`) lands in C5;
///      until then pulled tokens are held by this contract.
contract LPPetition is Ownable {
    enum PetitionStatus {
        Open,
        Executed
    }

    struct Petition {
        address token0; // sorted (token0 < token1)
        address token1;
        uint24 fee; // v4 fee tier (full-range)
        uint256 thresholdUsdE18; // shared minimum TVL
        PetitionStatus status;
    }

    struct Commitment {
        uint256 amount0;
        uint256 amount1;
        bool exists;
    }

    /// @notice Canonical Permit2 (same address on every chain incl. Base Sepolia).
    IAllowanceTransfer public constant PERMIT2 = IAllowanceTransfer(0x000000000022D473030F116dDEE9F6B43aC78BA3);

    uint256 public petitionCount;

    mapping(uint256 id => Petition) private _petitions;
    mapping(uint256 id => address[]) private _signers;
    mapping(uint256 id => mapping(address signer => Commitment)) private _commitments;

    /// @notice token => USD Chainlink feed used to value commitments of that token.
    /// @dev WETH -> real ETH/USD feed; mock SPCX -> mock SPCX/USD aggregator.
    mapping(address token => AggregatorV3Interface) public priceFeed;

    /// @notice token => max allowed age (seconds) of its feed's latest answer.
    /// @dev A value of 0 disables the time-based staleness check for that feed
    ///      (positivity + round-completeness are always enforced). Useful on
    ///      testnet, where Data Feeds can update infrequently.
    mapping(address token => uint256) public priceStaleness;

    event PetitionCreated(uint256 indexed id, address token0, address token1, uint24 fee, uint256 thresholdUsdE18);
    event Signed(uint256 indexed id, address indexed signer, uint256 amount0, uint256 amount1);
    event PriceFeedSet(address indexed token, address indexed feed, uint256 maxStaleness);
    event SignerSkipped(uint256 indexed id, address indexed signer);
    event Executed(uint256 indexed id, uint256 totalUsdE18, bytes32 poolId);
    event PositionMinted(uint256 indexed id, address indexed signer, uint256 positionTokenId);

    error TokensNotSorted();
    error IdenticalTokens();
    error ZeroThreshold();
    error MissingPriceFeed(address token);
    error PetitionNotFound(uint256 id);
    error PetitionNotOpen(uint256 id);
    error EmptyCommitment();
    error InvalidPrice(address feed);
    error IncompleteRound(address feed);
    error StalePrice(address feed);
    error UnsupportedFeedDecimals(address feed);
    error BelowThreshold(uint256 deliverableUsdE18, uint256 thresholdUsdE18);

    constructor() Ownable(msg.sender) {}

    /// @notice Register the USD price feed for a token and its max answer age (keeper/owner only).
    /// @param maxStaleness Max age in seconds of the feed's latest answer; 0 disables the
    ///        time-based check (positivity + round-completeness still enforced).
    function setPriceFeed(address token, AggregatorV3Interface feed, uint256 maxStaleness) external onlyOwner {
        priceFeed[token] = feed;
        priceStaleness[token] = maxStaleness;
        emit PriceFeedSet(token, address(feed), maxStaleness);
    }

    /// @notice Create a petition for a sorted pair with a shared USD TVL threshold.
    /// @dev Both tokens must already have a registered price feed so TVL is computable.
    function createPetition(address token0, address token1, uint24 fee, uint256 thresholdUsdE18)
        external
        returns (uint256 id)
    {
        if (token0 == token1) revert IdenticalTokens();
        if (token0 >= token1) revert TokensNotSorted();
        if (thresholdUsdE18 == 0) revert ZeroThreshold();
        if (address(priceFeed[token0]) == address(0)) revert MissingPriceFeed(token0);
        if (address(priceFeed[token1]) == address(0)) revert MissingPriceFeed(token1);

        id = ++petitionCount;
        _petitions[id] = Petition({
            token0: token0,
            token1: token1,
            fee: fee,
            thresholdUsdE18: thresholdUsdE18,
            status: PetitionStatus.Open
        });

        emit PetitionCreated(id, token0, token1, fee, thresholdUsdE18);
    }

    /// @notice Record (or update) the caller's conditional commitment.
    /// @dev On-chain `sign` per the S0 decision. Assumes the signer has granted a
    ///      Permit2 allowance for the committed amounts; no funds move until execute.
    ///      Re-signing overwrites the prior commitment for the caller.
    function sign(uint256 id, uint256 amount0, uint256 amount1) external {
        Petition storage p = _petitions[id];
        if (p.token0 == address(0)) revert PetitionNotFound(id);
        if (p.status != PetitionStatus.Open) revert PetitionNotOpen(id);
        if (amount0 == 0 && amount1 == 0) revert EmptyCommitment();

        Commitment storage c = _commitments[id][msg.sender];
        if (!c.exists) {
            c.exists = true;
            _signers[id].push(msg.sender);
        }
        c.amount0 = amount0;
        c.amount1 = amount1;

        emit Signed(id, msg.sender, amount0, amount1);
    }

    /// @notice Aggregate Chainlink-priced USD value (1e18) of all current commitments.
    /// @dev Hypothetical: values every recorded commitment without checking live
    ///      balances/allowances (skip-insolvent happens at execute, C4).
    function hypotheticalTvlUsdE18(uint256 id) public view returns (uint256 total) {
        Petition storage p = _petitions[id];
        if (p.token0 == address(0)) revert PetitionNotFound(id);

        uint256 price0E18 = _priceUsdE18(priceFeed[p.token0], priceStaleness[p.token0]);
        uint256 price1E18 = _priceUsdE18(priceFeed[p.token1], priceStaleness[p.token1]);
        uint256 unit0 = 10 ** IERC20Metadata(p.token0).decimals();
        uint256 unit1 = 10 ** IERC20Metadata(p.token1).decimals();

        address[] storage s = _signers[id];
        uint256 len = s.length;
        for (uint256 i; i < len; ++i) {
            Commitment storage c = _commitments[id][s[i]];
            if (c.amount0 != 0) total += Math.mulDiv(c.amount0, price0E18, unit0);
            if (c.amount1 != 0) total += Math.mulDiv(c.amount1, price1E18, unit1);
        }
    }

    /// @notice Whether the petition's hypothetical TVL currently clears its threshold.
    function isThresholdMet(uint256 id) external view returns (bool) {
        return hypotheticalTvlUsdE18(id) >= _petitions[id].thresholdUsdE18;
    }

    function getPetition(uint256 id) external view returns (Petition memory) {
        Petition memory p = _petitions[id];
        if (p.token0 == address(0)) revert PetitionNotFound(id);
        return p;
    }

    function getCommitment(uint256 id, address signer) external view returns (uint256 amount0, uint256 amount1) {
        Commitment storage c = _commitments[id][signer];
        return (c.amount0, c.amount1);
    }

    /// @notice Number of distinct signers on a petition.
    function signerCount(uint256 id) external view returns (uint256) {
        return _signers[id].length;
    }

    /// @notice Signer address at an index (for off-chain enumeration parity).
    function signerAt(uint256 id, uint256 index) external view returns (address) {
        return _signers[id][index];
    }

    /// @dev Read a USD feed and normalize the answer to 1e18, validating the round:
    ///      - answer must be strictly positive,
    ///      - the round must be complete (updatedAt != 0),
    ///      - and, when `maxStaleness != 0`, the answer must be no older than that.
    ///      This is the load-bearing on-chain Chainlink read that gates `execute`.
    function _priceUsdE18(AggregatorV3Interface feed, uint256 maxStaleness) internal view returns (uint256) {
        (, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        if (answer <= 0) revert InvalidPrice(address(feed));
        if (updatedAt == 0) revert IncompleteRound(address(feed));
        // forge-lint: disable-next-line(block-timestamp) -- staleness window is hour-scale; second-level validator drift is irrelevant
        if (maxStaleness != 0 && block.timestamp - updatedAt > maxStaleness) revert StalePrice(address(feed));
        uint8 d = feed.decimals();
        if (d > 18) revert UnsupportedFeedDecimals(address(feed));
        // forge-lint: disable-next-line(unsafe-typecast) -- answer guaranteed > 0 above
        return uint256(answer) * (10 ** (18 - d));
    }

    /// @notice Permissionless, single-execution. Values the deliverable set with the
    ///         on-chain Chainlink read, skips insolvent signers, gates on the shared
    ///         threshold, then pulls committed tokens via Permit2.
    /// @dev C4: pulls into this contract. C5 will create the v4 pool and mint a
    ///      full-range position per signer using `calls`, then settle leftovers.
    ///      Reverts cleanly (leaving the petition Open) when the deliverable TVL is
    ///      below threshold, so an early/wrong executor attempt is a no-op.
    function execute(uint256 id, bytes[] calldata /* calls */ ) external {
        Petition storage p = _petitions[id];
        if (p.token0 == address(0)) revert PetitionNotFound(id);
        if (p.status != PetitionStatus.Open) revert PetitionNotOpen(id);

        // Single-exec guard set before any external transfer (reentrancy-safe).
        p.status = PetitionStatus.Executed;

        (bool[] memory deliverable, uint256 deliverableTvl) = _evaluateDeliverable(id, p);
        if (deliverableTvl < p.thresholdUsdE18) revert BelowThreshold(deliverableTvl, p.thresholdUsdE18);

        _pullDeliverable(id, p, deliverable);

        // poolId is zero until C5 creates the pool and mints positions to signers.
        emit Executed(id, deliverableTvl, bytes32(0));
    }

    /// @dev Pass 1 (views only): flag the deliverable signers and sum their priced TVL.
    function _evaluateDeliverable(uint256 id, Petition storage p)
        internal
        returns (bool[] memory deliverable, uint256 deliverableTvl)
    {
        uint256 price0E18 = _priceUsdE18(priceFeed[p.token0], priceStaleness[p.token0]);
        uint256 price1E18 = _priceUsdE18(priceFeed[p.token1], priceStaleness[p.token1]);
        uint256 unit0 = 10 ** IERC20Metadata(p.token0).decimals();
        uint256 unit1 = 10 ** IERC20Metadata(p.token1).decimals();

        address[] storage s = _signers[id];
        uint256 len = s.length;
        deliverable = new bool[](len);
        for (uint256 i; i < len; ++i) {
            address signer = s[i];
            Commitment storage c = _commitments[id][signer];
            if (_canDeliver(signer, p.token0, c.amount0) && _canDeliver(signer, p.token1, c.amount1)) {
                deliverable[i] = true;
                if (c.amount0 != 0) deliverableTvl += Math.mulDiv(c.amount0, price0E18, unit0);
                if (c.amount1 != 0) deliverableTvl += Math.mulDiv(c.amount1, price1E18, unit1);
            } else {
                emit SignerSkipped(id, signer);
            }
        }
    }

    /// @dev Pass 2: pull committed tokens from each flagged signer into this contract.
    function _pullDeliverable(uint256 id, Petition storage p, bool[] memory deliverable) internal {
        address[] storage s = _signers[id];
        uint256 len = s.length;
        for (uint256 i; i < len; ++i) {
            if (!deliverable[i]) continue;
            address signer = s[i];
            Commitment storage c = _commitments[id][signer];
            if (c.amount0 != 0) _pull(p.token0, signer, c.amount0);
            if (c.amount1 != 0) _pull(p.token1, signer, c.amount1);
        }
    }

    /// @dev A leg is deliverable if it is empty, or the signer currently holds the
    ///      amount and has both the ERC20->Permit2 approval and a live Permit2
    ///      allowance to this contract covering it.
    function _canDeliver(address signer, address token, uint256 amount) internal view returns (bool) {
        if (amount == 0) return true;
        if (IERC20(token).balanceOf(signer) < amount) return false;
        if (IERC20(token).allowance(signer, address(PERMIT2)) < amount) return false;
        (uint160 allowed, uint48 expiration,) = PERMIT2.allowance(signer, token, address(this));
        if (allowed < amount) return false;
        // forge-lint: disable-next-line(block-timestamp) -- Permit2 expirations are minute/hour-scale
        if (block.timestamp > expiration) return false;
        return true;
    }

    /// @dev Pull `amount` of `token` from `from` into this contract via Permit2.
    function _pull(address token, address from, uint256 amount) internal {
        PERMIT2.transferFrom(from, address(this), SafeCast.toUint160(amount), token);
    }
}
