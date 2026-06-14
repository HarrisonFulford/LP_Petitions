// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {LPPetition} from "../src/LPPetition.sol";
import {MockSPCX} from "../src/mocks/MockSPCX.sol";
import {MockAggregatorV3} from "../src/mocks/MockAggregatorV3.sol";

contract LPPetitionTest is Test {
    LPPetition internal petition;

    MockSPCX internal tokenA;
    MockSPCX internal tokenB;
    MockAggregatorV3 internal feedA;
    MockAggregatorV3 internal feedB;

    // Sorted pair derived from the two tokens.
    address internal token0;
    address internal token1;
    int256 internal price0E8;
    int256 internal price1E8;

    uint24 internal constant FEE = 3000;
    int256 internal constant PRICE_A = 2000e8; // $2000 (ETH-like)
    int256 internal constant PRICE_B = 150e8; //  $150  (SPCX-like)

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    event PetitionCreated(uint256 indexed id, address token0, address token1, uint24 fee, uint256 thresholdUsdE18);
    event Signed(uint256 indexed id, address indexed signer, uint256 amount0, uint256 amount1);

    function setUp() public {
        petition = new LPPetition();

        tokenA = new MockSPCX();
        tokenB = new MockSPCX();
        feedA = new MockAggregatorV3(8, "A/USD", PRICE_A);
        feedB = new MockAggregatorV3(8, "B/USD", PRICE_B);

        petition.setPriceFeed(address(tokenA), feedA, 1 days);
        petition.setPriceFeed(address(tokenB), feedB, 1 days);

        if (address(tokenA) < address(tokenB)) {
            (token0, token1) = (address(tokenA), address(tokenB));
            (price0E8, price1E8) = (PRICE_A, PRICE_B);
        } else {
            (token0, token1) = (address(tokenB), address(tokenA));
            (price0E8, price1E8) = (PRICE_B, PRICE_A);
        }
    }

    function _create(uint256 thresholdUsdE18) internal returns (uint256 id) {
        id = petition.createPetition(token0, token1, FEE, thresholdUsdE18);
    }

    /// 18-decimal tokens, 8-decimal feeds: value_e18 = amount * priceE8 / 1e8.
    function _usdE18(uint256 amount, int256 priceE8) internal pure returns (uint256) {
        // forge-lint: disable-next-line(unsafe-typecast) -- test prices are positive constants
        return amount * uint256(priceE8) / 1e8;
    }

    // ----------------------------------------------------------------- create

    function test_CreatePetition() public {
        vm.expectEmit(true, false, false, true);
        emit PetitionCreated(1, token0, token1, FEE, 10_000e18);
        uint256 id = _create(10_000e18);

        assertEq(id, 1);
        assertEq(petition.petitionCount(), 1);

        LPPetition.Petition memory p = petition.getPetition(id);
        assertEq(p.token0, token0);
        assertEq(p.token1, token1);
        assertEq(p.fee, FEE);
        assertEq(p.thresholdUsdE18, 10_000e18);
        assertEq(uint8(p.status), uint8(LPPetition.PetitionStatus.Open));
    }

    function test_CreateRevertsIdenticalTokens() public {
        vm.expectRevert(LPPetition.IdenticalTokens.selector);
        petition.createPetition(token0, token0, FEE, 1e18);
    }

    function test_CreateRevertsUnsorted() public {
        vm.expectRevert(LPPetition.TokensNotSorted.selector);
        petition.createPetition(token1, token0, FEE, 1e18);
    }

    function test_CreateRevertsZeroThreshold() public {
        vm.expectRevert(LPPetition.ZeroThreshold.selector);
        petition.createPetition(token0, token1, FEE, 0);
    }

    function test_CreateRevertsMissingFeed() public {
        MockSPCX orphan = new MockSPCX();
        (address t0, address t1) =
            address(orphan) < token0 ? (address(orphan), token0) : (token0, address(orphan));
        address missing = address(orphan);
        vm.expectRevert(abi.encodeWithSelector(LPPetition.MissingPriceFeed.selector, missing));
        petition.createPetition(t0, t1, FEE, 1e18);
    }

    function test_GetPetitionRevertsUnknown() public {
        vm.expectRevert(abi.encodeWithSelector(LPPetition.PetitionNotFound.selector, uint256(42)));
        petition.getPetition(42);
    }

    // ------------------------------------------------------------------- sign

    function test_SignRecordsCommitment() public {
        uint256 id = _create(10_000e18);

        vm.expectEmit(true, true, false, true);
        emit Signed(id, alice, 1e18, 5e18);
        vm.prank(alice);
        petition.sign(id, 1e18, 5e18);

        (uint256 a0, uint256 a1) = petition.getCommitment(id, alice);
        assertEq(a0, 1e18);
        assertEq(a1, 5e18);
        assertEq(petition.signerCount(id), 1);
        assertEq(petition.signerAt(id, 0), alice);
    }

    function test_ReSignUpdatesWithoutDuplicatingSigner() public {
        uint256 id = _create(10_000e18);
        vm.startPrank(alice);
        petition.sign(id, 1e18, 1e18);
        petition.sign(id, 3e18, 7e18);
        vm.stopPrank();

        (uint256 a0, uint256 a1) = petition.getCommitment(id, alice);
        assertEq(a0, 3e18);
        assertEq(a1, 7e18);
        assertEq(petition.signerCount(id), 1);
    }

    function test_SignRevertsUnknownPetition() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LPPetition.PetitionNotFound.selector, uint256(1)));
        petition.sign(1, 1e18, 1e18);
    }

    function test_SignRevertsEmptyCommitment() public {
        uint256 id = _create(10_000e18);
        vm.prank(alice);
        vm.expectRevert(LPPetition.EmptyCommitment.selector);
        petition.sign(id, 0, 0);
    }

    // -------------------------------------------------------------------- TVL

    function test_HypotheticalTvlSingleSigner() public {
        uint256 id = _create(10_000e18);
        vm.prank(alice);
        petition.sign(id, 2e18, 10e18);

        uint256 expected = _usdE18(2e18, price0E8) + _usdE18(10e18, price1E8);
        assertEq(petition.hypotheticalTvlUsdE18(id), expected);
    }

    function test_HypotheticalTvlMultipleSigners() public {
        uint256 id = _create(10_000e18);
        vm.prank(alice);
        petition.sign(id, 1e18, 0);
        vm.prank(bob);
        petition.sign(id, 0, 20e18);

        uint256 expected = _usdE18(1e18, price0E8) + _usdE18(20e18, price1E8);
        assertEq(petition.hypotheticalTvlUsdE18(id), expected);
    }

    function test_ThresholdMetCrossing() public {
        // One full token0 ($2000) + one full token1.
        uint256 oneEach = _usdE18(1e18, price0E8) + _usdE18(1e18, price1E8);

        uint256 below = _create(oneEach + 1);
        uint256 atOrAbove = _create(oneEach);

        vm.prank(alice);
        petition.sign(below, 1e18, 1e18);
        vm.prank(alice);
        petition.sign(atOrAbove, 1e18, 1e18);

        assertFalse(petition.isThresholdMet(below));
        assertTrue(petition.isThresholdMet(atOrAbove));
    }

    function test_TvlRevertsOnNonPositivePrice() public {
        uint256 id = _create(10_000e18);
        // Drive feedA's answer to zero; the TVL read must reject the non-positive price.
        feedA.setAnswer(0);
        vm.expectRevert(abi.encodeWithSelector(LPPetition.InvalidPrice.selector, address(feedA)));
        petition.hypotheticalTvlUsdE18(id);
    }

    // --------------------------------------------------------------- execute

    function test_ExecuteNotImplemented() public {
        uint256 id = _create(10_000e18);
        bytes[] memory calls = new bytes[](0);
        vm.expectRevert(LPPetition.ExecuteNotImplemented.selector);
        petition.execute(id, calls);
    }
}
