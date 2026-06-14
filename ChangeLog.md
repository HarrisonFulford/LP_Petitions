# ChangeLog

> Changes to `implementation_plan.md` / `README.md` (and workstream docs) vs. the original plan.

## 2026-06-14

- **S0 decision settled — on-chain `sign()`.** Resolved the open interface question in `contract.md` + `fullstack.md`: commitments are recorded on-chain via `sign(id, amount0, amount1)` (Permit2 allowance granted gaslessly via `permit`); `execute(id, calls[])` keeps its frozen signature (no `Commitment[]`/`PermitPayload[]` arrays). Fully-gasless off-chain commitments deferred to a stretch goal.
- **S1 addresses verified.** Confirmed the Base Sepolia Uniswap v4 set (PoolManager, PositionManager, UniversalRouter, Permit2, StateView, WETH9) by contract name on `sepolia.basescan.org`; UniversalRouter constructor args cross-confirm PoolManager/PositionManager. Pinned the Chainlink ETH/USD proxy `0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1` (`EACAggregatorProxy`, 8 decimals) in `implementation_plan.md`, replacing the prior "to pin" placeholder.
