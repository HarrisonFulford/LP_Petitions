# ChangeLog

## 01 — Phase/commit discipline planning

- Expanded `implementation_plan.md` with an agent-oriented phase plan, sub-phase checklists, verification gates, clean commit guidance, and parallelization rules.
- Removed stale references to the deleted `ianimplementation.md` from `contract.md` and `fullstack.md`.
- Removed the stale `TODO.md` reference from the implementation plan header.
- Clarified WETH onboarding language: users mint mock SPCX, get faucet ETH, and wrap ETH into real Base Sepolia WETH.
- No implementation code changes; docs are staged for Ian review before any commit/push.

> Changes to `implementation_plan.md` / `README.md` (and workstream docs) vs. the original plan.

## 02

- **S0 decision settled — on-chain `sign()`.** Resolved the open interface question in `contract.md` + `fullstack.md`: commitments are recorded on-chain via `sign(id, amount0, amount1)` (Permit2 allowance granted gaslessly via `permit`); `execute(id, calls[])` keeps its frozen signature (no `Commitment[]`/`PermitPayload[]` arrays). Fully-gasless off-chain commitments deferred to a stretch goal.
- **S1 addresses verified.** Confirmed the Base Sepolia Uniswap v4 set (PoolManager, PositionManager, UniversalRouter, Permit2, StateView, WETH9) by contract name on `sepolia.basescan.org`; UniversalRouter constructor args cross-confirm PoolManager/PositionManager. Pinned the Chainlink ETH/USD proxy `0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1` (`EACAggregatorProxy`, 8 decimals) in `implementation_plan.md`, replacing the prior "to pin" placeholder.

## 03

- Reverted `implementation_plan.md` changes from Phase/commit discipline planning regarding phase plans and commit rules
