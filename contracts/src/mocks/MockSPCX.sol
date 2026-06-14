// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockSPCX
/// @notice Hackathon stand-in for tokenized SpaceX (SPCXx) on Base Sepolia.
///         18 decimals, openly mintable so the demo faucet lets any fresh wallet
///         participate. This is a testnet mock with no value — minting is
///         intentionally permissionless.
contract MockSPCX is ERC20 {
    constructor() ERC20("Mock SpaceX", "SPCX") {}

    /// @notice Mint tokens to `to`. Permissionless by design (testnet faucet).
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
