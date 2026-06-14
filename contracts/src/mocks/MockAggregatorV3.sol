// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockAggregatorV3
/// @notice Chainlink-compatible mock price feed for the NVDA/USD testnet leg.
///         The keeper (owner) seeds this mock off-chain from official xStocks/Backed
///         NVDAx sources because this MVP runs on Base Sepolia.
///         The *qualifying* Chainlink read in LPPetition is the genuine ETH/USD
///         feed; this mock only prices the synthetic asset.
/// @dev Defaults to 8 decimals to match standard USD feeds.
contract MockAggregatorV3 is AggregatorV3Interface, Ownable {
    uint8 private immutable _decimals;
    string private _description;
    uint256 private constant _VERSION = 1;

    uint80 private _roundId;
    int256 private _answer;
    uint256 private _startedAt;
    uint256 private _updatedAt;

    event AnswerUpdated(int256 indexed answer, uint80 indexed roundId, uint256 updatedAt);

    constructor(uint8 decimals_, string memory description_, int256 initialAnswer) Ownable(msg.sender) {
        _decimals = decimals_;
        _description = description_;
        _setAnswer(initialAnswer);
    }

    /// @notice Keeper updates the price; stamps the current block time and bumps the round.
    function setAnswer(int256 newAnswer) external onlyOwner {
        _setAnswer(newAnswer);
    }

    /// @notice Set price and an explicit timestamp (useful for staleness tests).
    function setRoundData(int256 newAnswer, uint256 updatedAt_) external onlyOwner {
        _roundId += 1;
        _answer = newAnswer;
        _startedAt = updatedAt_;
        _updatedAt = updatedAt_;
        emit AnswerUpdated(newAnswer, _roundId, updatedAt_);
    }

    function _setAnswer(int256 newAnswer) internal {
        _roundId += 1;
        _answer = newAnswer;
        _startedAt = block.timestamp;
        _updatedAt = block.timestamp;
        emit AnswerUpdated(newAnswer, _roundId, block.timestamp);
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function description() external view returns (string memory) {
        return _description;
    }

    function version() external pure returns (uint256) {
        return _VERSION;
    }

    function getRoundData(uint80)
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (_roundId, _answer, _startedAt, _updatedAt, _roundId);
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (_roundId, _answer, _startedAt, _updatedAt, _roundId);
    }
}
