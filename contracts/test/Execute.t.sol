// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {LPPetition} from "../src/LPPetition.sol";
import {MockSPCX} from "../src/mocks/MockSPCX.sol";
import {MockAggregatorV3} from "../src/mocks/MockAggregatorV3.sol";
import {MockPermit2} from "./mocks/MockPermit2.sol";

/// @notice C4 — Permit2 batch pull + skip-insolvent + threshold gating.
contract ExecuteTest is Test {
    address internal constant PERMIT2_ADDR = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    LPPetition internal petition;
    MockPermit2 internal permit2;

    MockSPCX internal t0;
    MockSPCX internal t1;
    address internal token0;
    address internal token1;
    int256 internal price0E8;
    int256 internal price1E8;

    uint24 internal constant FEE = 3000;
    int256 internal constant PRICE_A = 2000e8;
    int256 internal constant PRICE_B = 150e8;
    uint48 internal expiry;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        // Place the mock Permit2 at the canonical address LPPetition references.
        vm.etch(PERMIT2_ADDR, address(new MockPermit2()).code);
        permit2 = MockPermit2(PERMIT2_ADDR);

        petition = new LPPetition();

        MockSPCX tokenA = new MockSPCX();
        MockSPCX tokenB = new MockSPCX();
        MockAggregatorV3 feedA = new MockAggregatorV3(8, "A/USD", PRICE_A);
        MockAggregatorV3 feedB = new MockAggregatorV3(8, "B/USD", PRICE_B);
        petition.setPriceFeed(address(tokenA), feedA, 1 days);
        petition.setPriceFeed(address(tokenB), feedB, 1 days);

        if (address(tokenA) < address(tokenB)) {
            (t0, t1) = (tokenA, tokenB);
            (price0E8, price1E8) = (PRICE_A, PRICE_B);
        } else {
            (t0, t1) = (tokenB, tokenA);
            (price0E8, price1E8) = (PRICE_B, PRICE_A);
        }
        token0 = address(t0);
        token1 = address(t1);
        expiry = uint48(block.timestamp + 1 days);
    }

    function _usdE18(uint256 amount, int256 priceE8) internal pure returns (uint256) {
        // forge-lint: disable-next-line(unsafe-typecast) -- test prices are positive constants
        return amount * uint256(priceE8) / 1e8;
    }

    function _expected(uint256 a0, uint256 a1) internal view returns (uint256) {
        return _usdE18(a0, price0E8) + _usdE18(a1, price1E8);
    }

    /// Fund the signer and grant both ERC20->Permit2 and Permit2->petition allowances.
    function _fundAndApprove(address signer, uint256 a0, uint256 a1) internal {
        t0.mint(signer, a0);
        t1.mint(signer, a1);
        vm.startPrank(signer);
        t0.approve(PERMIT2_ADDR, type(uint256).max);
        t1.approve(PERMIT2_ADDR, type(uint256).max);
        vm.stopPrank();
        permit2.setAllowance(signer, token0, address(petition), a0, expiry);
        permit2.setAllowance(signer, token1, address(petition), a1, expiry);
    }

    function _sign(uint256 id, address signer, uint256 a0, uint256 a1) internal {
        vm.prank(signer);
        petition.sign(id, a0, a1);
    }

    // ----------------------------------------- insolvency detection (pre-mint)

    function test_PartialAllowanceTreatedAsInsolvent() public {
        uint256 amt = 5e18;
        uint256 id = petition.createPetition(token0, token1, FEE, _expected(amt, 0));

        // Funded + ERC20-approved, but Permit2 allowance to petition is short.
        t0.mint(alice, amt);
        vm.prank(alice);
        t0.approve(PERMIT2_ADDR, type(uint256).max);
        permit2.setAllowance(alice, token0, address(petition), amt - 1, expiry);
        _sign(id, alice, amt, 0);

        // Only signer is insolvent -> deliverable TVL 0 -> below threshold revert.
        vm.expectRevert(abi.encodeWithSelector(LPPetition.BelowThreshold.selector, 0, _expected(amt, 0)));
        petition.execute(id, new bytes[](0));
    }

    function test_ExpiredAllowanceTreatedAsInsolvent() public {
        uint256 amt = 5e18;
        uint256 id = petition.createPetition(token0, token1, FEE, _expected(amt, 0));
        _fundAndApprove(alice, amt, 0);
        // Expire the permit2 allowance.
        permit2.setAllowance(alice, token0, address(petition), amt, uint48(block.timestamp));
        _sign(id, alice, amt, 0);

        vm.warp(block.timestamp + 1);
        vm.expectRevert(abi.encodeWithSelector(LPPetition.BelowThreshold.selector, 0, _expected(amt, 0)));
        petition.execute(id, new bytes[](0));
    }

    // -------------------------------------------------------- threshold gating

    function test_RevertBelowThresholdAfterSkips() public {
        uint256 aliceA0 = 1e18; // $2000 deliverable
        uint256 bobA1 = 10e18; //  $1500 skipped
        uint256 threshold = _expected(aliceA0, 0) + _expected(0, bobA1); // needs both

        uint256 id = petition.createPetition(token0, token1, FEE, threshold);
        _fundAndApprove(alice, aliceA0, 0);
        _sign(id, alice, aliceA0, 0);
        _sign(id, bob, 0, bobA1); // insolvent

        vm.expectRevert(
            abi.encodeWithSelector(LPPetition.BelowThreshold.selector, _expected(aliceA0, 0), threshold)
        );
        petition.execute(id, new bytes[](0));

        // Stays Open and nothing moved -> early executor attempt is a clean no-op.
        assertEq(uint8(petition.getPetition(id).status), uint8(LPPetition.PetitionStatus.Open));
        assertEq(t0.balanceOf(address(petition)), 0);
        assertEq(t0.balanceOf(alice), aliceA0);
    }

    function test_RevertBelowThresholdNoSigners() public {
        uint256 id = petition.createPetition(token0, token1, FEE, 1e18);
        vm.expectRevert(abi.encodeWithSelector(LPPetition.BelowThreshold.selector, 0, 1e18));
        petition.execute(id, new bytes[](0));
        assertEq(uint8(petition.getPetition(id).status), uint8(LPPetition.PetitionStatus.Open));
    }

    function test_ExecuteRevertsUnknownPetition() public {
        vm.expectRevert(abi.encodeWithSelector(LPPetition.PetitionNotFound.selector, uint256(99)));
        petition.execute(99, new bytes[](0));
    }
}
