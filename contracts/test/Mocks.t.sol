// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockSPCX} from "../src/mocks/MockSPCX.sol";
import {MockAggregatorV3} from "../src/mocks/MockAggregatorV3.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract MockSPCXTest is Test {
    MockSPCX internal spcx;
    address internal alice = makeAddr("alice");

    function setUp() public {
        spcx = new MockSPCX();
    }

    function test_Metadata() public view {
        assertEq(spcx.name(), "Mock SpaceX");
        assertEq(spcx.symbol(), "SPCX");
        assertEq(spcx.decimals(), 18);
    }

    function test_PermissionlessMint() public {
        vm.prank(alice);
        spcx.mint(alice, 1_000e18);
        assertEq(spcx.balanceOf(alice), 1_000e18);
        assertEq(spcx.totalSupply(), 1_000e18);
    }
}

contract MockAggregatorV3Test is Test {
    MockAggregatorV3 internal feed;
    address internal keeper = address(this);
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        feed = new MockAggregatorV3(8, "SPCX / USD", 150e8);
    }

    function test_InitialState() public view {
        assertEq(feed.decimals(), 8);
        assertEq(feed.description(), "SPCX / USD");
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
