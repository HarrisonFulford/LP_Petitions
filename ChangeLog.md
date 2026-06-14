# ChangeLog

## 01 — Phase/commit discipline planning

- Expanded `implementation_plan.md` with an agent-oriented phase plan, sub-phase checklists, verification gates, clean commit guidance, and parallelization rules.
- Removed stale references to the deleted `ianimplementation.md` from `contract.md` and `fullstack.md`.
- Removed the stale `TODO.md` reference from the implementation plan header.
- Clarified WETH onboarding language: users mint mock NVDA, get faucet ETH, and wrap ETH into real Base Sepolia WETH.
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
- **Mocks:** `MockNVDA` (ERC-20, 18 decimals, permissionless `mint` for the demo faucet) and `MockAggregatorV3` (`AggregatorV3Interface`, 8 decimals, owner/keeper-settable answer + timestamp, with `setRoundData` for staleness tests).
- **Fork harness:** `BaseForkTest` creates a Base Sepolia fork from `BASE_SEPOLIA_RPC_URL` and skips cleanly (not fails) when unset. `ForkSanity.t.sol` confirms all pinned contracts have code, the real v4 PoolManager responds, and the real ETH/USD feed reads (8 decimals, positive, in-band).
- **Status:** `forge build` + `forge test` green (9/9). Fork tests verified passing against live Base Sepolia via the public RPC.

## 05 — C2 Petition core

- **`contracts/src/LPPetition.sol`** implements the frozen boundary for the petition lifecycle: `createPetition` (sorted-pair + threshold validation), on-chain `sign` (records/updates the caller's commitment per the S0 decision; no funds move), `getPetition`, `getCommitment`, plus `hypotheticalTvlUsdE18` and an `isThresholdMet` helper. `PetitionCreated` / `Signed` events match `contract.md`.
- **TVL pricing:** `hypotheticalTvlUsdE18` values each commitment via a per-token Chainlink feed and normalizes to 1e18 using the token's own decimals (`amount * priceE18 / 10^tokenDecimals`). Basic positivity guard only; full staleness/round checks are deferred to C3.
- **Price-feed registry (addition beyond the cross-team ABI):** owner-set `setPriceFeed(token, feed)` mapping (WETH -> real ETH/USD; mock NVDA -> mock NVDA/USD). This is a deploy/admin concern and does not change Ian's integration surface; `createPetition` requires both tokens to have a feed registered. Deploy scripts (C6) must call `setPriceFeed` before `createPetition`.
- **`execute` is a guarded placeholder** (validates the id, then reverts `ExecuteNotImplemented`) so the ABI stays complete; real Permit2 pull + skip-insolvent (C4) and v4 mint-to-signers (C5) land next. One benign solc "can be restricted to view" warning is expected on this stub until C5.
- **Helpers for off-chain parity:** `petitionCount`, `signerCount`, `signerAt` for enumerating signers from the executor/frontend.
- **Status:** `forge build` + `forge test` green (24/24: 15 new `LPPetition.t.sol` covering create/sign/re-sign/getters/TVL/threshold-crossing/invalid-price/execute-stub).

## 06 — C3 Chainlink read hardening

- **Hardened `_priceUsdE18`** (the load-bearing on-chain Chainlink read that gates `execute`): now validates the round — strictly positive answer (`InvalidPrice`), complete round `updatedAt != 0` (`IncompleteRound`), and a configurable max-age staleness check (`StalePrice`).
- **Per-feed staleness config:** `setPriceFeed(token, feed, maxStaleness)` (signature extended; admin-only, not part of the cross-team ABI) + public `priceStaleness` mapping; `PriceFeedSet` now carries the staleness. `maxStaleness == 0` disables the time-based check (positivity + completeness still enforced) — an escape hatch for testnet feeds that update infrequently and for the keeper-driven mock NVDA aggregator. C6 deploy must pass a sensible staleness (or 0) per feed.
- **Tests:** new `test/ChainlinkRead.t.sol` (8) — valid read; zero & negative rejected; incomplete round rejected; stale rejected; fresh-within-window accepted; staleness-disabled allows old answers; below-threshold vs at-threshold gating via `isThresholdMet`.
- **Lint:** the `block.timestamp` staleness comparison is the intended pattern (hour-scale window >> validator drift); suppressed with a justified `forge-lint` disable.
- **Status:** `forge build` + `forge test` green (32/32). The only remaining warning is the intentional `execute` stub ("can be restricted to view"), gone once C5 lands.

## 07 — C4 Permit2 pull + skip-insolvent

- **`execute(id, calls)` implemented** as permissionless + single-execution. Flow: guard (`Open` only) -> set `Executed` before any transfer (reentrancy-safe) -> Chainlink-priced evaluation of the deliverable set -> threshold gate -> Permit2 batch pull into the contract -> emit `Executed`. Split into `_evaluateDeliverable` / `_pullDeliverable` helpers to stay under the stack limit.
- **Skip-insolvent:** `_canDeliver` checks, per non-empty leg, the signer's live balance, ERC20->Permit2 approval, and a live (amount + unexpired) Permit2 allowance to this contract. A signer is included only if BOTH legs are deliverable; skipped signers emit `SignerSkipped` and are excluded from the recomputed TVL.
- **Threshold semantics:** `execute` reverts `BelowThreshold(deliverable, threshold)` (leaving the petition `Open`, nothing pulled) so an early/insufficient executor attempt is a clean no-op — matching the live-executor requirement.
- **Permit2 wiring:** canonical `PERMIT2` constant (`0x0000...78BA3`, same on Base Sepolia); pulls via `transferFrom(from, this, uint160 amount, token)` with checked `SafeCast.toUint160`. Declared the frozen `Executed` + `PositionMinted` events (PositionMinted emitted in C5); removed the `ExecuteNotImplemented` stub.
- **Tests:** new `test/Execute.t.sol` (8) + `test/mocks/MockPermit2.sol` (etched at the canonical address via `vm.etch`): full pull to contract, insolvent skipped, partial/expired allowance treated as insolvent, below-threshold-after-skips revert (stays Open, no funds moved), no-signers revert, single-exec guard, permissionless caller, unknown-petition revert.
- **Note:** until C5 mints, pulled tokens are held by the contract; C5 inserts pool-create + mint-to-signers between the pull and `Executed` and sets the real `poolId`.
- **Status:** `forge build` + `forge test` green (39/39), zero warnings.

## 08 — C5 Uniswap v4 execute (mint to signers)

- **Architecture decision (S0-adjacent):** kept `execute` permissionless but made minting **contract-native** instead of running caller-supplied LP calldata. Rationale: with permissionless execute, arbitrary caller calldata against the funded contract (even whitelisted targets) lets an attacker mint positions to themselves / drain the pooled tokens. The contract now builds the pool + per-signer mints itself, so no caller-calldata trust. Recorded here as the resolution to `contract.md` C5's "guarded calldata exec" wording.
- **Uniswap API still in the core path:** `calls[]` is now the optional **Uniswap Swap-API (UniversalRouter) calldata** for the pre-mint balancing swap, executed in `_runGuardedSwaps` and bounded by a **Chainlink value-conservation guard** (`maxSwapSlippageBps`, owner-set, default 1%) — re-prices the contract's holdings before/after and reverts on erosion beyond the bound, so it's safe under a permissionless `execute`. (Empty `calls` skips it; the demo's pool is created at the Chainlink ratio so a swap is usually unneeded.)
- **Native mint:** create the pool if absent at the Chainlink-derived `sqrtPriceX96`, full-range ticks from `TickMath.minUsableTick/maxUsableTick`, liquidity from `LiquidityAmounts.getLiquidityForAmounts`, one `MINT_POSITION + SETTLE_PAIR` per deliverable signer with `owner = signer`. tickSpacing derived from fee (`createPetition` now rejects unsupported tiers early). Emits `PositionMinted` per signer and `Executed(id, tvl, poolId)`.
- **Version-skew fix (important for deploy):** the **deployed Base Sepolia PositionManager predates the `*_FROM_DELTAS` actions**, so it uses legacy action numbering where `SETTLE_PAIR = 0x11` (current v4-periphery renumbered it to `0x0d`). We hardcode `ACTION_MINT_POSITION=0x02` / `ACTION_SETTLE_PAIR=0x11` to match the on-chain contract; verified by fork test (mint with `0x0d` reverted `UnsupportedAction`). Do not "upgrade" these to the lib constants.
- **Tests:** new `test/ExecuteFork.t.sol` (3) against **live Base Sepolia** (real PoolManager/PositionManager/Permit2; one leg priced by the real ETH/USD feed): full-range positions minted + owned by each signer, insolvent signer skipped (no NFT), single-exec guard. The pre-mint revert paths stay in non-fork `Execute.t.sol`.
- **Known MVP limits:** one-sided commits yield 0 liquidity and are skipped (need the balancing swap); mint leftovers/dust remain in the contract; the swap path's end-to-end test with real Swap-API calldata is deferred to the executor (S3).
- **Status:** `forge build` zero warnings; `forge test` 39/39 green (incl. 6 fork tests verified against live Base Sepolia).

## 09 — C6 deploy scripts + v4 address root-cause fix

- **Root-cause fix (supersedes C5's `SETTLE_PAIR=0x11` workaround).** `BaseSepolia.sol` was corrected to the official Uniswap v4 set (PoolManager `0x05E73354…`, PositionManager `0x4B2C77d2…`, UniversalRouter `0x492E6456…`), but `LPPetition.sol` still hardcoded the *old* PositionManager (`0xcDbe7b1e…`) — a second, older v4 deployment that exists on Base Sepolia and uses legacy (gapped) action numbering. That mismatch, not v4-periphery itself, was why settle needed `0x11`. Fix: `LPPetition` now sources Permit2/PositionManager/UniversalRouter from the `BaseSepolia` library (single source of truth) and uses standard `Actions` (`SETTLE_PAIR=0x0d`). Both new-set addresses re-verified on BaseScan (PoolManager / "Uniswap v4 Positions NFT"); fork tests pass against the canonical PositionManager with `0x0d`.
- **C6 — `script/Deploy.s.sol`:** deploys `MockSPCX` + mock SPCX/USD aggregator (seed $150, 8 dec) + `LPPetition`; registers feeds (WETH→real ETH/USD, SPCX→mock, 24h staleness each); opens a demo petition (fee 3000, $5,000 threshold) on the sorted SPCX/WETH pair; mints 1,000 SPCX to the deployer + optional `DEMO_WALLETS`; prints an address book and writes `deployments/base-sepolia.json` (gitignored output dir kept via `.gitkeep`; `foundry.toml` grants write to `./deployments`). WETH is the real Base Sepolia WETH9 — not minted; demo wallets wrap testnet ETH via the app faucet.
- **Validated by simulation** (`forge script ... --rpc-url` without `--broadcast`, throwaway key): script body runs, address book is internally consistent (LPPetition uses the same v4 set it prints). Real broadcast (`--broadcast` + funded `PRIVATE_KEY`) is the operator's step.
- **Status:** `forge build` zero warnings; `forge test` 39/39 green (6 fork tests against live Base Sepolia).
