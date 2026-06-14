// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {BaseSepolia} from "../src/config/BaseSepolia.sol";
import {LPPetition} from "../src/LPPetition.sol";
import {MockNVDA} from "../src/mocks/MockNVDA.sol";
import {MockAggregatorV3} from "../src/mocks/MockAggregatorV3.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/// @notice C6 — deploy MockNVDA + mock NVDA/USD aggregator + LPPetition to Base
///         Sepolia, register both price feeds, open a demo petition, seed demo NVDA
///         balances, and emit an address book (console + deployments/base-sepolia.json)
///         for the full-stack workstream.
/// @dev Usage:
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast --verify
///   Requires PRIVATE_KEY in env. Optional DEMO_WALLETS=0xabc,0xdef to also seed NVDA.
///   WETH is the real Base Sepolia WETH9 (not mintable) — demo wallets wrap testnet ETH.
contract Deploy is Script {
    uint256 internal constant FEED_STALENESS = 24 hours;
    int256 internal constant NVDA_SEED_PRICE_E8 = 150e8; // $150; keeper refreshes from xStocks
    uint24 internal constant FEE = 3000; // 0.3% (tickSpacing 60)
    uint256 internal constant DEMO_THRESHOLD_USD_E18 = 5_000e18;
    uint256 internal constant DEMO_NVDA_MINT = 1_000e18;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);

        MockNVDA nvda = new MockNVDA();
        MockAggregatorV3 nvdaFeed = new MockAggregatorV3(8, "NVDA / USD", NVDA_SEED_PRICE_E8);
        LPPetition petition = new LPPetition();

        // WETH leg -> real Chainlink ETH/USD; NVDA leg -> mock aggregator. 24h staleness
        // (testnet feeds lull; the guard still runs).
        petition.setPriceFeed(BaseSepolia.WETH9, AggregatorV3Interface(BaseSepolia.ETH_USD_FEED), FEED_STALENESS);
        petition.setPriceFeed(address(nvda), AggregatorV3Interface(address(nvdaFeed)), FEED_STALENESS);

        // Demo petition on the sorted NVDA/WETH pair.
        (address token0, address token1) = address(nvda) < BaseSepolia.WETH9
            ? (address(nvda), BaseSepolia.WETH9)
            : (BaseSepolia.WETH9, address(nvda));
        uint256 demoId = petition.createPetition(token0, token1, FEE, DEMO_THRESHOLD_USD_E18);

        // Seed demo NVDA balances (mock token is mintable; WETH comes from the faucet).
        nvda.mint(deployer, DEMO_NVDA_MINT);
        address[] memory demos = vm.envOr("DEMO_WALLETS", ",", new address[](0));
        for (uint256 i; i < demos.length; ++i) {
            nvda.mint(demos[i], DEMO_NVDA_MINT);
        }

        vm.stopBroadcast();

        _printAndWrite(petition, nvda, nvdaFeed, token0, token1, demoId);
    }

    function _printAndWrite(
        LPPetition petition,
        MockNVDA nvda,
        MockAggregatorV3 nvdaFeed,
        address token0,
        address token1,
        uint256 demoId
    ) internal {
        console2.log("=================== LP Petitions address book ===================");
        console2.log("chainId             ", block.chainid);
        console2.log("LPPetition          ", address(petition));
        console2.log("MockNVDA            ", address(nvda));
        console2.log("MockNVDA/USD feed   ", address(nvdaFeed));
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
        vm.serializeAddress(o, "mockNvda", address(nvda));
        vm.serializeAddress(o, "mockNvdaUsdFeed", address(nvdaFeed));
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
