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

## 04 — C1 Foundry scaffold + mocks

- **Repo layout:** Solidity workstream lives in a new `contracts/` subdirectory (Foundry), keeping it separate from Ian's full-stack app. Deps installed as git submodules under `contracts/lib/`: forge-std, v4-core (v4.0.0), v4-periphery, permit2, openzeppelin-contracts (v5.6.1), chainlink-brownie-contracts (1.3.0). Toolchain: Foundry v1.7.1, solc 0.8.26, `evm_version = cancun` (required by v4).
- **Pinned addresses in code:** `contracts/src/config/BaseSepolia.sol` holds the S1-verified addresses as constants (StateView re-checksummed). Single source for the harness + future deploy scripts.
- **Mocks:** `MockSPCX` (ERC-20, 18 decimals, permissionless `mint` for the demo faucet) and `MockAggregatorV3` (`AggregatorV3Interface`, 8 decimals, owner/keeper-settable answer + timestamp, with `setRoundData` for staleness tests).
- **Fork harness:** `BaseForkTest` creates a Base Sepolia fork from `BASE_SEPOLIA_RPC_URL` and skips cleanly (not fails) when unset. `ForkSanity.t.sol` confirms all pinned contracts have code, the real v4 PoolManager responds, and the real ETH/USD feed reads (8 decimals, positive, in-band).
- **Status:** `forge build` + `forge test` green (9/9). Fork tests verified passing against live Base Sepolia via the public RPC.
