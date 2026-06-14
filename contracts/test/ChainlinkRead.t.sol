// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {LPPetition} from "../src/LPPetition.sol";
import {MockNVDA} from "../src/mocks/MockNVDA.sol";
import {MockAggregatorV3} from "../src/mocks/MockAggregatorV3.sol";

/// @notice C3 — validates the on-chain Chainlink read that gates execution:
///         positivity, round completeness, and configurable staleness, plus the
///         below/at-threshold gating that consumes the priced TVL.
contract ChainlinkReadTest is Test {
    LPPetition internal petition;

    address internal token0;
    address internal token1;
    MockAggregatorV3 internal feed0; // token0's feed (read first by hypotheticalTvl)
    MockAggregatorV3 internal feed1;

    uint24 internal constant FEE = 3000;
    int256 internal constant PRICE0_E8 = 2000e8; // $2000
    int256 internal constant PRICE1_E8 = 150e8; //  $150
    uint256 internal constant STALENESS = 1 hours;

    address internal alice = makeAddr("alice");

    function setUp() public {
        petition = new LPPetition();

        MockNVDA tokenA = new MockNVDA();
        MockNVDA tokenB = new MockNVDA();
        (token0, token1) =
            address(tokenA) < address(tokenB) ? (address(tokenA), address(tokenB)) : (address(tokenB), address(tokenA));

        feed0 = new MockAggregatorV3(8, "T0/USD", PRICE0_E8);
        feed1 = new MockAggregatorV3(8, "T1/USD", PRICE1_E8);
        petition.setPriceFeed(token0, feed0, STALENESS);
        petition.setPriceFeed(token1, feed1, STALENESS);
    }

    function _createAndSign(uint256 thresholdUsdE18, uint256 amount0, uint256 amount1) internal returns (uint256 id) {
        id = petition.createPetition(token0, token1, FEE, thresholdUsdE18);
        vm.prank(alice);
        petition.sign(id, amount0, amount1);
    }

    function _usdE18(uint256 amount, int256 priceE8) internal pure returns (uint256) {
        // forge-lint: disable-next-line(unsafe-typecast) -- test prices are positive constants
        return amount * uint256(priceE8) / 1e8;
    }

    // ------------------------------------------------------------ valid read

    function test_ValidPriceAccepted() public {
        uint256 id = _createAndSign(1e18, 1e18, 1e18);
        uint256 expected = _usdE18(1e18, PRICE0_E8) + _usdE18(1e18, PRICE1_E8);
        assertEq(petition.hypotheticalTvlUsdE18(id), expected);
    }

    // ----------------------------------------------------------- positivity

    function test_ZeroPriceRejected() public {
        uint256 id = _createAndSign(1e18, 1e18, 1e18);
        feed0.setAnswer(0);
        vm.expectRevert(abi.encodeWithSelector(LPPetition.InvalidPrice.selector, address(feed0)));
        petition.hypotheticalTvlUsdE18(id);
    }

    function test_NegativePriceRejected() public {
        uint256 id = _createAndSign(1e18, 1e18, 1e18);
        feed0.setAnswer(-1);
        vm.expectRevert(abi.encodeWithSelector(LPPetition.InvalidPrice.selector, address(feed0)));
        petition.hypotheticalTvlUsdE18(id);
    }

    // --------------------------------------------------- round completeness

    function test_IncompleteRoundRejected() public {
        uint256 id = _createAndSign(1e18, 1e18, 1e18);
        feed0.setRoundData(PRICE0_E8, 0); // updatedAt == 0
        vm.expectRevert(abi.encodeWithSelector(LPPetition.IncompleteRound.selector, address(feed0)));
        petition.hypotheticalTvlUsdE18(id);
    }

    // ------------------------------------------------------------ staleness

    function test_StalePriceRejected() public {
        uint256 id = _createAndSign(1e18, 1e18, 1e18);
        vm.warp(100_000);
        // Keep feed1 fresh; age feed0 just past the staleness window.
        feed1.setAnswer(PRICE1_E8);
        feed0.setRoundData(PRICE0_E8, block.timestamp - STALENESS - 1);
        vm.expectRevert(abi.encodeWithSelector(LPPetition.StalePrice.selector, address(feed0)));
        petition.hypotheticalTvlUsdE18(id);
    }

    function test_FreshWithinStalenessAccepted() public {
        uint256 id = _createAndSign(1e18, 1e18, 1e18);
        vm.warp(100_000);
        // Exactly at the boundary (age == maxStaleness) is still acceptable.
        feed0.setRoundData(PRICE0_E8, block.timestamp - STALENESS);
        feed1.setRoundData(PRICE1_E8, block.timestamp - STALENESS);
        uint256 expected = _usdE18(1e18, PRICE0_E8) + _usdE18(1e18, PRICE1_E8);
        assertEq(petition.hypotheticalTvlUsdE18(id), expected);
    }

    function test_StalenessDisabledAllowsOldAnswer() public {
        // maxStaleness == 0 disables the time check (positivity/completeness remain).
        petition.setPriceFeed(token0, feed0, 0);
        petition.setPriceFeed(token1, feed1, 0);
        uint256 id = _createAndSign(1e18, 1e18, 1e18);

        vm.warp(100_000);
        feed0.setRoundData(PRICE0_E8, 1); // ancient, but staleness disabled
        feed1.setRoundData(PRICE1_E8, 1);
        uint256 expected = _usdE18(1e18, PRICE0_E8) + _usdE18(1e18, PRICE1_E8);
        assertEq(petition.hypotheticalTvlUsdE18(id), expected);
    }

    // -------------------------------------------------- threshold gating

    function test_BelowThresholdRejectedAtCrossingAccepted() public {
        uint256 oneEach = _usdE18(1e18, PRICE0_E8) + _usdE18(1e18, PRICE1_E8);

        uint256 below = petition.createPetition(token0, token1, FEE, oneEach + 1);
        uint256 atOrAbove = petition.createPetition(token0, token1, FEE, oneEach);
        vm.prank(alice);
        petition.sign(below, 1e18, 1e18);
        vm.prank(alice);
        petition.sign(atOrAbove, 1e18, 1e18);

        assertFalse(petition.isThresholdMet(below));
        assertTrue(petition.isThresholdMet(atOrAbove));
    }
}
