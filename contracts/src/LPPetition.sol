// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title LPPetition
/// @notice Threshold-based liquidity commitments. Users sign conditional LP
///         commitments for a sorted token pair; once the aggregate hypothetical
///         TVL (Chainlink-priced) clears a shared threshold, `execute()` pulls
///         tokens and mints full-range Uniswap v4 positions owned by each signer.
/// @dev C2 scope: petition lifecycle, on-chain commitment recording, and the
///      Chainlink-priced hypothetical TVL. Robust Chainlink reads (staleness) are
///      C3; Permit2 pull + skip-insolvent is C4; v4 execute/mint is C5. `execute`
///      is a guarded placeholder here so the frozen ABI stays complete.
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

    uint256 public petitionCount;

    mapping(uint256 id => Petition) private _petitions;
    mapping(uint256 id => address[]) private _signers;
    mapping(uint256 id => mapping(address signer => Commitment)) private _commitments;

    /// @notice token => USD Chainlink feed used to value commitments of that token.
    /// @dev WETH -> real ETH/USD feed; mock SPCX -> mock SPCX/USD aggregator.
    mapping(address token => AggregatorV3Interface) public priceFeed;

    event PetitionCreated(uint256 indexed id, address token0, address token1, uint24 fee, uint256 thresholdUsdE18);
    event Signed(uint256 indexed id, address indexed signer, uint256 amount0, uint256 amount1);
    event PriceFeedSet(address indexed token, address indexed feed);

    error TokensNotSorted();
    error IdenticalTokens();
    error ZeroThreshold();
    error MissingPriceFeed(address token);
    error PetitionNotFound(uint256 id);
    error PetitionNotOpen(uint256 id);
    error EmptyCommitment();
    error InvalidPrice(address feed);
    error UnsupportedFeedDecimals(address feed);
    error ExecuteNotImplemented();

    constructor() Ownable(msg.sender) {}

    /// @notice Register the USD price feed for a token (keeper/owner only).
    function setPriceFeed(address token, AggregatorV3Interface feed) external onlyOwner {
        priceFeed[token] = feed;
        emit PriceFeedSet(token, address(feed));
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

        uint256 price0E18 = _priceUsdE18(priceFeed[p.token0]);
        uint256 price1E18 = _priceUsdE18(priceFeed[p.token1]);
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

    /// @dev Read a USD feed and normalize the answer to 1e18. Basic positivity
    ///      guard only; full staleness/round checks land in C3.
    function _priceUsdE18(AggregatorV3Interface feed) internal view returns (uint256) {
        (, int256 answer,,,) = feed.latestRoundData();
        if (answer <= 0) revert InvalidPrice(address(feed));
        uint8 d = feed.decimals();
        if (d > 18) revert UnsupportedFeedDecimals(address(feed));
        // forge-lint: disable-next-line(unsafe-typecast) -- answer guaranteed > 0 above
        return uint256(answer) * (10 ** (18 - d));
    }

    /// @notice Atomic pull + (optional swap) + mint to signers. Implemented in C4/C5.
    function execute(uint256 id, bytes[] calldata /* calls */ ) external {
        if (_petitions[id].token0 == address(0)) revert PetitionNotFound(id);
        revert ExecuteNotImplemented();
    }
}
