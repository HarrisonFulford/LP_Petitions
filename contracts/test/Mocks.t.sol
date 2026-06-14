// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockNVDA} from "../src/mocks/MockNVDA.sol";
import {MockAggregatorV3} from "../src/mocks/MockAggregatorV3.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract MockNVDATest is Test {
    MockNVDA internal nvda;
    address internal alice = makeAddr("alice");

    function setUp() public {
        nvda = new MockNVDA();
    }

    function test_Metadata() public view {
        assertEq(nvda.name(), "Mock NVIDIA");
        assertEq(nvda.symbol(), "NVDA");
        assertEq(nvda.decimals(), 18);
    }

    function test_PermissionlessMint() public {
        vm.prank(alice);
        nvda.mint(alice, 1_000e18);
        assertEq(nvda.balanceOf(alice), 1_000e18);
        assertEq(nvda.totalSupply(), 1_000e18);
    }
}

contract MockAggregatorV3Test is Test {
    MockAggregatorV3 internal feed;
    address internal keeper = address(this);
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        feed = new MockAggregatorV3(8, "NVDA / USD", 150e8);
    }

    function test_InitialState() public view {
        assertEq(feed.decimals(), 8);
        assertEq(feed.description(), "NVDA / USD");
        assertEq(feed.version(), 1);
        (uint80 roundId, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        assertEq(roundId, 1);
        assertEq(answer, 150e8);
        assertEq(updatedAt, block.timestamp);
    }

    function test_SetAnswerBumpsRoundAndTimestamp() public {
        skip(60);
        feed.setAnswer(175e8);
        (uint80 roundId, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        assertEq(roundId, 2);
        assertEq(answer, 175e8);
        assertEq(updatedAt, block.timestamp);
    }

    function test_SetRoundDataAllowsExplicitTimestamp() public {
        feed.setRoundData(200e8, 12345);
        (, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        assertEq(answer, 200e8);
        assertEq(updatedAt, 12345);
    }

    function test_OnlyOwnerCanSet() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        feed.setAnswer(1e8);
    }
}
