// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockNVDA
/// @notice Hackathon stand-in for tokenized NVIDIA (NVDAx) on Base Sepolia.
///         18 decimals, openly mintable so the demo faucet lets any fresh wallet
///         participate. This is a testnet mock with no value — minting is
///         intentionally permissionless.
contract MockNVDA is ERC20 {
    constructor() ERC20("Mock NVIDIA", "NVDA") {}

    /// @notice Mint tokens to `to`. Permissionless by design (testnet faucet).
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
