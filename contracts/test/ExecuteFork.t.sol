// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseForkTest} from "./BaseForkTest.sol";
import {BaseSepolia} from "../src/config/BaseSepolia.sol";
import {LPPetition} from "../src/LPPetition.sol";
import {MockNVDA} from "../src/mocks/MockNVDA.sol";
import {MockAggregatorV3} from "../src/mocks/MockAggregatorV3.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @notice C5 — full execute() against real Base Sepolia Uniswap v4 + Permit2:
///         pool created, a full-range position minted to each deliverable signer,
///         insolvent signers skipped, single-exec guard. Skips without an RPC.
contract ExecuteForkTest is BaseForkTest {
    LPPetition internal petition;

    // Both are 18-decimal mock ERC20s. `weth` is priced by the REAL Chainlink
    // ETH/USD feed (mirrors production); `nvda` by a mock NVDA/USD aggregator.
    MockNVDA internal weth;
    MockNVDA internal nvda;
    MockAggregatorV3 internal nvdaFeed;

    address internal token0;
    address internal token1;

    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    IERC721 internal posm;
    uint48 internal exp;

    uint24 internal constant FEE = 3000;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    event SignerSkipped(uint256 indexed id, address indexed signer);

    function setUp() public override {
        super.setUp();
        if (!forked) return;

        petition = new LPPetition();
        posm = IERC721(address(petition.POSITION_MANAGER()));
        // forge-lint: disable-next-line(block-timestamp) -- test setup, fork block time
        exp = uint48(block.timestamp + 1 days);

        weth = new MockNVDA();
        nvda = new MockNVDA();
        nvdaFeed = new MockAggregatorV3(8, "NVDA/USD", 150e8);

        // Real ETH/USD feed; staleness disabled so testnet feed lag can't flake the test.
        petition.setPriceFeed(address(weth), AggregatorV3Interface(BaseSepolia.ETH_USD_FEED), 0);
        petition.setPriceFeed(address(nvda), nvdaFeed, 1 days);

        (token0, token1) =
            address(weth) < address(nvda) ? (address(weth), address(nvda)) : (address(nvda), address(weth));
    }

    /// Fund + grant ERC20->Permit2 and Permit2->petition (max) allowances on real Permit2.
    function _enable(address signer, uint256 a0, uint256 a1) internal {
        MockNVDA(token0).mint(signer, a0);
        MockNVDA(token1).mint(signer, a1);
        vm.startPrank(signer);
        MockNVDA(token0).approve(PERMIT2, type(uint256).max);
        MockNVDA(token1).approve(PERMIT2, type(uint256).max);
        IAllowanceTransfer(PERMIT2).approve(token0, address(petition), type(uint160).max, exp);
        IAllowanceTransfer(PERMIT2).approve(token1, address(petition), type(uint160).max, exp);
        vm.stopPrank();
    }

    function _sign(uint256 id, address signer, uint256 a0, uint256 a1) internal {
        vm.prank(signer);
        petition.sign(id, a0, a1);
    }

    function test_MintsFullRangePositionsToSigners() public onlyFork {
        uint256 id = petition.createPetition(token0, token1, FEE, 1e18); // tiny threshold
        _enable(alice, 10e18, 10e18);
        _enable(bob, 5e18, 5e18);
        _sign(id, alice, 10e18, 10e18);
        _sign(id, bob, 5e18, 5e18);

        petition.execute(id, new bytes[](0));

        assertEq(uint8(petition.getPetition(id).status), uint8(LPPetition.PetitionStatus.Executed));
        assertEq(posm.balanceOf(alice), 1, "alice owns a position");
        assertEq(posm.balanceOf(bob), 1, "bob owns a position");
    }

    function test_InsolventSignerGetsNoPosition() public onlyFork {
        uint256 id = petition.createPetition(token0, token1, FEE, 1e18);
        _enable(alice, 10e18, 10e18);
        _sign(id, alice, 10e18, 10e18);
        _sign(id, bob, 5e18, 5e18); // bob signs but is never funded/approved

        vm.expectEmit(true, true, false, false);
        emit SignerSkipped(id, bob);
        petition.execute(id, new bytes[](0));

        assertEq(posm.balanceOf(alice), 1, "alice owns a position");
        assertEq(posm.balanceOf(bob), 0, "bob skipped, no position");
    }

    function test_SingleExecutionGuard() public onlyFork {
        uint256 id = petition.createPetition(token0, token1, FEE, 1e18);
        _enable(alice, 10e18, 10e18);
        _sign(id, alice, 10e18, 10e18);

        petition.execute(id, new bytes[](0));
        vm.expectRevert(abi.encodeWithSelector(LPPetition.PetitionNotOpen.selector, id));
        petition.execute(id, new bytes[](0));
    }
}
