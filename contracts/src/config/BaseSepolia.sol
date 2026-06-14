// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title BaseSepolia
/// @notice Pinned, verified Base Sepolia addresses (S1). Each was confirmed by
///         contract name on sepolia.basescan.org on 2026-06-14. These are the
///         Base *Sepolia* deployments — not Base mainnet.
library BaseSepolia {
    uint256 internal constant CHAIN_ID = 84532;

    // Uniswap v4
    address internal constant POOL_MANAGER = 0x7Da1D65F8B249183667cdE74C5CBD46dD38AA829;
    address internal constant POSITION_MANAGER = 0xcDbe7b1ed817eF0005ECe6a3e576fbAE2EA5EAFE;
    address internal constant UNIVERSAL_ROUTER = 0x95273d871c8156636e114b63797d78D7E1720d81;
    address internal constant STATE_VIEW = 0x571291b572ed32ce6751a2Cb2486EbEe8DEfB9B4;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // Tokens
    address internal constant WETH9 = 0x4200000000000000000000000000000000000006;

    // Chainlink Data Feed (EACAggregatorProxy, 8 decimals)
    address internal constant ETH_USD_FEED = 0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1;
}
