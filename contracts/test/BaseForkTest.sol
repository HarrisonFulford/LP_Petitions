// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {BaseSepolia} from "../src/config/BaseSepolia.sol";

/// @title BaseForkTest
/// @notice Shared harness for tests that run against real Base Sepolia state
///         (Uniswap v4 contracts + the real Chainlink ETH/USD feed).
/// @dev If BASE_SEPOLIA_RPC_URL is unset, the fork is skipped and `forked`
///      stays false so suites can no-op cleanly (keeps CI green without an RPC).
abstract contract BaseForkTest is Test {
    bool internal forked;

    function setUp() public virtual {
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            emit log("BASE_SEPOLIA_RPC_URL unset - skipping fork tests");
            return;
        }
        vm.createSelectFork(rpc);
        require(block.chainid == BaseSepolia.CHAIN_ID, "RPC is not Base Sepolia");
        forked = true;
    }

    /// @dev Skip the body of a test when no fork is active.
    modifier onlyFork() {
        if (!forked) return;
        _;
    }
}
