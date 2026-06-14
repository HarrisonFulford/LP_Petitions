// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {BaseSepolia} from "./config/BaseSepolia.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// @title LPPetition
/// @notice Threshold-based liquidity commitments. Users sign conditional LP
///         commitments for a sorted token pair; once the aggregate hypothetical
///         TVL (Chainlink-priced) clears a shared threshold, `execute()` pulls
///         tokens and mints full-range Uniswap v4 positions owned by each signer.
/// @dev Permissionless, single-exec `execute()`: values the deliverable set with the
///      on-chain Chainlink read, skips insolvent signers, gates on the shared
///      threshold, pulls committed tokens via Permit2, optionally runs Uniswap
///      Swap-API calldata against the UniversalRouter (Chainlink value-guarded), then
///      creates the v4 pool (if absent) at the Chainlink price and mints a full-range
///      position per signer, each owned by that signer. Targets Base Sepolia v4.
contract LPPetition is Ownable {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

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

    /// @notice Permit2 + Uniswap v4 contracts on Base Sepolia. Single source of truth is
    ///         the `BaseSepolia` library, so addresses can't drift between here and the
    ///         deploy script / app config.
    IAllowanceTransfer public constant PERMIT2 = IAllowanceTransfer(BaseSepolia.PERMIT2);
    IPositionManager public constant POSITION_MANAGER = IPositionManager(BaseSepolia.POSITION_MANAGER);
    address public constant UNIVERSAL_ROUTER = BaseSepolia.UNIVERSAL_ROUTER;

    uint256 internal constant BPS = 10_000;

    /// @notice Max value the optional balancing swap may erode, vs the pulled TVL
    ///         (Chainlink-priced before/after). Bounds attacker-supplied swap calldata.
    uint256 public maxSwapSlippageBps = 100; // 1%

    uint256 public petitionCount;

    mapping(uint256 id => Petition) private _petitions;
    mapping(uint256 id => address[]) private _signers;
    mapping(uint256 id => mapping(address signer => Commitment)) private _commitments;

    /// @notice token => USD Chainlink feed used to value commitments of that token.
    /// @dev WETH -> real ETH/USD feed; mock NVDA -> mock NVDA/USD aggregator.
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
    event MaxSwapSlippageSet(uint256 bps);

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
    error UnsupportedFee(uint24 fee);
    error SwapCallFailed(uint256 index);
    error SwapValueLoss(uint256 valueAfterE18, uint256 minValueE18);
    error SlippageTooHigh();

    constructor() Ownable(msg.sender) {}

    /// @notice Register the USD price feed for a token and its max answer age (keeper/owner only).
    /// @param maxStaleness Max age in seconds of the feed's latest answer; 0 disables the
    ///        time-based check (positivity + round-completeness still enforced).
    function setPriceFeed(address token, AggregatorV3Interface feed, uint256 maxStaleness) external onlyOwner {
        priceFeed[token] = feed;
        priceStaleness[token] = maxStaleness;
        emit PriceFeedSet(token, address(feed), maxStaleness);
    }

    /// @notice Set the max value the optional balancing swap may erode (owner only).
    function setMaxSwapSlippageBps(uint256 bps) external onlyOwner {
        if (bps > BPS) revert SlippageTooHigh();
        maxSwapSlippageBps = bps;
        emit MaxSwapSlippageSet(bps);
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
        _tickSpacingForFee(fee); // revert early on an unsupported fee tier

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
    /// @param calls Optional Uniswap Swap API (UniversalRouter) calldata to balance the
    ///        pulled tokens toward the pool ratio before minting. Executed against the
    ///        UniversalRouter only and bounded by a Chainlink value-conservation check,
    ///        so it is safe even though `execute` is permissionless. Pass empty to skip.
    function execute(uint256 id, bytes[] calldata calls) external {
        Petition storage p = _petitions[id];
        if (p.token0 == address(0)) revert PetitionNotFound(id);
        if (p.status != PetitionStatus.Open) revert PetitionNotOpen(id);

        // Single-exec guard set before any external transfer (reentrancy-safe).
        p.status = PetitionStatus.Executed;

        (bool[] memory deliverable, uint256 deliverableTvl) = _evaluateDeliverable(id, p);
        if (deliverableTvl < p.thresholdUsdE18) revert BelowThreshold(deliverableTvl, p.thresholdUsdE18);

        _pullDeliverable(id, p, deliverable);

        // Optional balancing swap (Uniswap API calldata), Chainlink-guarded.
        if (calls.length != 0) _runGuardedSwaps(p, calls, deliverableTvl);

        // Create the v4 pool (if absent) at the Chainlink ratio and mint a full-range
        // position per deliverable signer, each owned by that signer.
        bytes32 poolId = _createPoolAndMint(id, p, deliverable);

        emit Executed(id, deliverableTvl, poolId);
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

    /// @dev Run Uniswap-API-built calldata against the UniversalRouter to balance the
    ///      pulled tokens, then require the Chainlink-priced holdings did not erode
    ///      beyond `maxSwapSlippageBps` vs `refValueE18`. This bounds value extraction
    ///      from attacker-supplied calldata (a worse swap simply reverts here).
    function _runGuardedSwaps(Petition storage p, bytes[] calldata calls, uint256 refValueE18) internal {
        _approvePermit2Spender(p.token0, UNIVERSAL_ROUTER);
        _approvePermit2Spender(p.token1, UNIVERSAL_ROUTER);

        for (uint256 i; i < calls.length; ++i) {
            (bool ok,) = UNIVERSAL_ROUTER.call(calls[i]);
            if (!ok) revert SwapCallFailed(i);
        }

        uint256 valueAfter = _holdingsValueE18(p);
        uint256 minValue = Math.mulDiv(refValueE18, BPS - maxSwapSlippageBps, BPS);
        if (valueAfter < minValue) revert SwapValueLoss(valueAfter, minValue);
    }

    /// @dev Create the pool (idempotent) at the Chainlink-derived price and mint a
    ///      full-range position per deliverable signer, owned by that signer.
    function _createPoolAndMint(uint256 id, Petition storage p, bool[] memory deliverable)
        internal
        returns (bytes32)
    {
        int24 tickSpacing = _tickSpacingForFee(p.fee);
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(p.token0),
            currency1: Currency.wrap(p.token1),
            fee: p.fee,
            tickSpacing: tickSpacing,
            hooks: IHooks(address(0))
        });

        POSITION_MANAGER.initializePool(key, _sqrtPriceX96(p)); // no-op if already initialized

        _approvePermit2Spender(p.token0, address(POSITION_MANAGER));
        _approvePermit2Spender(p.token1, address(POSITION_MANAGER));

        int24 tickLower = TickMath.minUsableTick(tickSpacing);
        int24 tickUpper = TickMath.maxUsableTick(tickSpacing);

        _mintAll(id, key, tickLower, tickUpper, deliverable);
        return PoolId.unwrap(key.toId());
    }

    /// @dev Loop deliverable signers and mint each a full-range position.
    function _mintAll(uint256 id, PoolKey memory key, int24 tickLower, int24 tickUpper, bool[] memory deliverable)
        internal
    {
        uint160 sqrtPriceX96 = _sqrtPriceX96(_petitions[id]);
        uint160 sqrtA = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtB = TickMath.getSqrtPriceAtTick(tickUpper);

        address[] storage s = _signers[id];
        uint256 len = s.length;
        for (uint256 i; i < len; ++i) {
            if (!deliverable[i]) continue;
            address signer = s[i];
            Commitment storage c = _commitments[id][signer];
            uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(sqrtPriceX96, sqrtA, sqrtB, c.amount0, c.amount1);
            if (liquidity == 0) continue; // one-sided commit without a balancing swap (MVP)
            uint256 tokenId = POSITION_MANAGER.nextTokenId();
            _mintFullRange(key, tickLower, tickUpper, liquidity, c.amount0, c.amount1, signer);
            emit PositionMinted(id, signer, tokenId);
        }
    }

    /// @dev Encode + submit a single MINT_POSITION + SETTLE_PAIR to the PositionManager.
    function _mintFullRange(
        PoolKey memory key,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        uint256 amount0Max,
        uint256 amount1Max,
        address owner
    ) internal {
        bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(
            key, tickLower, tickUpper, uint256(liquidity), SafeCast.toUint128(amount0Max), SafeCast.toUint128(amount1Max), owner, bytes("")
        );
        params[1] = abi.encode(key.currency0, key.currency1);
        // forge-lint: disable-next-line(block-timestamp) -- deadline is the current block
        POSITION_MANAGER.modifyLiquidities(abi.encode(actions, params), block.timestamp);
    }

    /// @dev sqrtPriceX96 for currency1/currency0 derived from the two USD feeds.
    function _sqrtPriceX96(Petition storage p) internal view returns (uint160) {
        uint256 price0 = _priceUsdE18(priceFeed[p.token0], priceStaleness[p.token0]);
        uint256 price1 = _priceUsdE18(priceFeed[p.token1], priceStaleness[p.token1]);
        uint256 num = price0 * (10 ** IERC20Metadata(p.token1).decimals());
        uint256 den = price1 * (10 ** IERC20Metadata(p.token0).decimals());
        uint256 ratioX192 = Math.mulDiv(num, 1 << 192, den);
        return SafeCast.toUint160(Math.sqrt(ratioX192));
    }

    /// @dev Chainlink-priced USD value (1e18) of this contract's token0/token1 balances.
    function _holdingsValueE18(Petition storage p) internal view returns (uint256) {
        uint256 price0 = _priceUsdE18(priceFeed[p.token0], priceStaleness[p.token0]);
        uint256 price1 = _priceUsdE18(priceFeed[p.token1], priceStaleness[p.token1]);
        uint256 v0 = Math.mulDiv(IERC20(p.token0).balanceOf(address(this)), price0, 10 ** IERC20Metadata(p.token0).decimals());
        uint256 v1 = Math.mulDiv(IERC20(p.token1).balanceOf(address(this)), price1, 10 ** IERC20Metadata(p.token1).decimals());
        return v0 + v1;
    }

    /// @dev Approve `spender` to pull this contract's `token` via Permit2.
    function _approvePermit2Spender(address token, address spender) internal {
        IERC20(token).forceApprove(address(PERMIT2), type(uint256).max);
        // forge-lint: disable-next-line(block-timestamp) -- short-lived same-tx approval window
        PERMIT2.approve(token, spender, type(uint160).max, uint48(block.timestamp + 1 hours));
    }

    /// @dev Canonical Uniswap fee -> tickSpacing mapping (full-range needs a spacing).
    function _tickSpacingForFee(uint24 fee) internal pure returns (int24) {
        if (fee == 100) return 1;
        if (fee == 500) return 10;
        if (fee == 3000) return 60;
        if (fee == 10000) return 200;
        revert UnsupportedFee(fee);
    }
}
