// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseForkTest} from "./BaseForkTest.sol";
import {BaseSepolia} from "../src/config/BaseSepolia.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

/// @notice Proves the pinned Base Sepolia addresses (S1) are live and that the
///         harness can read the real Chainlink ETH/USD feed + reach real v4.
contract ForkSanityTest is BaseForkTest {
    function test_PinnedContractsHaveCode() public view onlyFork {
        assertGt(BaseSepolia.POOL_MANAGER.code.length, 0, "PoolManager");
        assertGt(BaseSepolia.POSITION_MANAGER.code.length, 0, "PositionManager");
        assertGt(BaseSepolia.UNIVERSAL_ROUTER.code.length, 0, "UniversalRouter");
        assertGt(BaseSepolia.STATE_VIEW.code.length, 0, "StateView");
        assertGt(BaseSepolia.PERMIT2.code.length, 0, "Permit2");
        assertGt(BaseSepolia.WETH9.code.length, 0, "WETH9");
        assertGt(BaseSepolia.ETH_USD_FEED.code.length, 0, "ETH/USD feed");
    }

    function test_RealPoolManagerResponds() public view onlyFork {
        // A successful view call confirms we're talking to the real v4 contract.
        IPoolManager(BaseSepolia.POOL_MANAGER).protocolFeeController();
    }

    function test_RealEthUsdFeedReadable() public view onlyFork {
        AggregatorV3Interface feed = AggregatorV3Interface(BaseSepolia.ETH_USD_FEED);
        assertEq(feed.decimals(), 8, "expected 8 decimals");
        (uint80 roundId, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        assertGt(roundId, 0, "roundId");
        assertGt(answer, 0, "answer should be positive");
        assertGt(updatedAt, 0, "updatedAt");
        // Loose sanity band so the test isn't brittle to ETH price moves.
        assertGt(answer, 100e8, "ETH/USD > $100");
        assertLt(answer, 100_000e8, "ETH/USD < $100k");
    }
}
