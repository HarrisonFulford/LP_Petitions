// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {BaseSepolia} from "../src/config/BaseSepolia.sol";
import {LPPetition} from "../src/LPPetition.sol";
import {MockSPCX} from "../src/mocks/MockSPCX.sol";
import {MockAggregatorV3} from "../src/mocks/MockAggregatorV3.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/// @notice C6 — deploy MockSPCX + mock SPCX/USD aggregator + LPPetition to Base
///         Sepolia, register both price feeds, open a demo petition, seed demo SPCX
///         balances, and emit an address book (console + deployments/base-sepolia.json)
///         for the full-stack workstream.
/// @dev Usage:
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast --verify
///   Requires PRIVATE_KEY in env. Optional DEMO_WALLETS=0xabc,0xdef to also seed SPCX.
///   WETH is the real Base Sepolia WETH9 (not mintable) — demo wallets wrap testnet ETH.
contract Deploy is Script {
    uint256 internal constant FEED_STALENESS = 24 hours;
    int256 internal constant SPCX_SEED_PRICE_E8 = 150e8; // $150; keeper refreshes from xStocks
    uint24 internal constant FEE = 3000; // 0.3% (tickSpacing 60)
    uint256 internal constant DEMO_THRESHOLD_USD_E18 = 5_000e18;
    uint256 internal constant DEMO_SPCX_MINT = 1_000e18;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);

        MockSPCX spcx = new MockSPCX();
        MockAggregatorV3 spcxFeed = new MockAggregatorV3(8, "SPCX / USD", SPCX_SEED_PRICE_E8);
        LPPetition petition = new LPPetition();

        // WETH leg -> real Chainlink ETH/USD; SPCX leg -> mock aggregator. 24h staleness
        // (testnet feeds lull; the guard still runs).
        petition.setPriceFeed(BaseSepolia.WETH9, AggregatorV3Interface(BaseSepolia.ETH_USD_FEED), FEED_STALENESS);
        petition.setPriceFeed(address(spcx), AggregatorV3Interface(address(spcxFeed)), FEED_STALENESS);

        // Demo petition on the sorted SPCX/WETH pair.
        (address token0, address token1) = address(spcx) < BaseSepolia.WETH9
            ? (address(spcx), BaseSepolia.WETH9)
            : (BaseSepolia.WETH9, address(spcx));
        uint256 demoId = petition.createPetition(token0, token1, FEE, DEMO_THRESHOLD_USD_E18);

        // Seed demo SPCX balances (mock token is mintable; WETH comes from the faucet).
        spcx.mint(deployer, DEMO_SPCX_MINT);
        address[] memory demos = vm.envOr("DEMO_WALLETS", ",", new address[](0));
        for (uint256 i; i < demos.length; ++i) {
            spcx.mint(demos[i], DEMO_SPCX_MINT);
        }

        vm.stopBroadcast();

        _printAndWrite(petition, spcx, spcxFeed, token0, token1, demoId);
    }

    function _printAndWrite(
        LPPetition petition,
        MockSPCX spcx,
        MockAggregatorV3 spcxFeed,
        address token0,
        address token1,
        uint256 demoId
    ) internal {
        console2.log("=================== LP Petitions address book ===================");
        console2.log("chainId             ", block.chainid);
        console2.log("LPPetition          ", address(petition));
        console2.log("MockSPCX            ", address(spcx));
        console2.log("MockSPCX/USD feed   ", address(spcxFeed));
        console2.log("WETH9 (real)        ", BaseSepolia.WETH9);
        console2.log("ETH/USD feed (real) ", BaseSepolia.ETH_USD_FEED);
        console2.log("PoolManager         ", BaseSepolia.POOL_MANAGER);
        console2.log("PositionManager     ", BaseSepolia.POSITION_MANAGER);
        console2.log("UniversalRouter     ", BaseSepolia.UNIVERSAL_ROUTER);
        console2.log("Permit2             ", BaseSepolia.PERMIT2);
        console2.log("StateView           ", BaseSepolia.STATE_VIEW);
        console2.log("demo petition token0", token0);
        console2.log("demo petition token1", token1);
        console2.log("demo petition id    ", demoId);
        console2.log("demo fee tier       ", FEE);
        console2.log("=================================================================");

        string memory o = "addressbook";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeAddress(o, "lpPetition", address(petition));
        vm.serializeAddress(o, "mockSPCX", address(spcx));
        vm.serializeAddress(o, "mockSPCXUsdFeed", address(spcxFeed));
        vm.serializeAddress(o, "weth9", BaseSepolia.WETH9);
        vm.serializeAddress(o, "ethUsdFeed", BaseSepolia.ETH_USD_FEED);
        vm.serializeAddress(o, "poolManager", BaseSepolia.POOL_MANAGER);
        vm.serializeAddress(o, "positionManager", BaseSepolia.POSITION_MANAGER);
        vm.serializeAddress(o, "universalRouter", BaseSepolia.UNIVERSAL_ROUTER);
        vm.serializeAddress(o, "permit2", BaseSepolia.PERMIT2);
        vm.serializeAddress(o, "stateView", BaseSepolia.STATE_VIEW);
        vm.serializeUint(o, "fee", uint256(FEE));
        vm.serializeAddress(o, "demoPetitionToken0", token0);
        vm.serializeAddress(o, "demoPetitionToken1", token1);
        string memory json = vm.serializeUint(o, "demoPetitionId", demoId);
        vm.writeJson(json, "deployments/base-sepolia.json");
        console2.log("Wrote deployments/base-sepolia.json");
    }
}
