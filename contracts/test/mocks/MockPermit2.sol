// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Minimal Permit2 stand-in for unit tests: just the `allowance` getter and
///         the single `transferFrom` that LPPetition uses. Mirrors the real
///         AllowanceTransfer behaviour (expiration + amount checks, decrement,
///         pulls via the ERC20 approval the user gave to Permit2). The real Permit2
///         is exercised in fork tests; this avoids EIP-712 signing in unit tests.
contract MockPermit2 {
    struct PackedAllowance {
        uint160 amount;
        uint48 expiration;
        uint48 nonce;
    }

    // user => token => spender => allowance
    mapping(address => mapping(address => mapping(address => PackedAllowance))) public allowance;

    /// @notice Test helper to set a Permit2 allowance (stands in for `permit`).
    function setAllowance(address user, address token, address spender, uint256 amount, uint48 expiration) external {
        // forge-lint: disable-next-line(unsafe-typecast) -- test helper, amounts fit uint160
        allowance[user][token][spender] = PackedAllowance(uint160(amount), expiration, 0);
    }

    function transferFrom(address from, address to, uint160 amount, address token) external {
        PackedAllowance storage a = allowance[from][token][msg.sender];
        // forge-lint: disable-next-line(block-timestamp) -- mock mirrors Permit2 expiry semantics
        require(block.timestamp <= a.expiration, "permit2: expired");
        require(a.amount >= amount, "permit2: insufficient allowance");
        if (a.amount != type(uint160).max) a.amount -= amount;
        require(IERC20(token).transferFrom(from, to, amount), "permit2: erc20 transfer failed");
    }
}
