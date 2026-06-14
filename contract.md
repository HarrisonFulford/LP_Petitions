# Contracts Workstream — Owner: Harrison

> Scope: Solidity contracts, Permit2, on-chain Chainlink read, Uniswap v4 execution, Foundry tests, deploy scripts.
> Source of truth: `implementation_plan.md` (reconciled decisions). This workstream file is a focused execution guide and must stay synced with the main plan.
> Counterpart workstream: `fullstack.md` (Ian).

## Locked decisions (context)

Base Sepolia · Uniswap v4 · pair **mock NVDA / WETH** · **full-range** positions · **Option B** (each signer owns their own position NFT, no vault/shares/withdraw) · **shared threshold** · **skip-insolvent** at execute · Chainlink **ETH/USD Data Feed read on-chain** (load-bearing) + **mock NVDA/USD aggregator** · contract name **`LPPetition`**.

**Live-site implication:** the app ships live for finalist judging with a Vercel-hosted auto-executor (reactive + per-minute cron) that auto-calls `execute()`. So `execute()` must be **permissionless** (any caller) and **single-execution** (`Open → Executed` guard, revert/no-op on re-entry) so repeated/concurrent calls can't double-mint — and it should **revert cleanly when TVL is below threshold**, since the executor may attempt early. The contracts are "live" by virtue of being deployed on public Base Sepolia — no hosting needed on Harrison's side.

## Shared / bottleneck tasks (ALSO in `fullstack.md` — do these first, together)

These block both workstreams. Settle before parallel work.

- **S0 — Lock the interface boundary (Phase 0, both present).** Freeze the `LPPetition` ABI (below), the Permit2 (AllowanceTransfer) `permit` typed-data shape — the only signed payload; there is no custom commitment EIP-712 — the event schema, and the runtime config (addresses + chainId). Both sides build against the frozen version; later changes require a sync.
- **S1 — Pin addresses (Harrison leads; Ian records in app config).** Base Sepolia v4 set (PoolManager, PositionManager, UniversalRouter, StateView, Permit2, WETH9) + Chainlink ETH/USD feed proxy. Verify against official docs.
- **S2 — Deploy to Base Sepolia + mint demo balances (Harrison runs; Ian consumes addresses).** Mock NVDA, mock NVDA/USD aggregator, `LPPetition`; fund demo wallets with NVDA + WETH.
- **S3 — End-to-end integration + demo + submission (shared).** One real `execute()` on Base Sepolia; record tx hashes; finalize README, demo video, and Uniswap Developer Feedback Form.

## Owned tasks (Harrison)

One commit per sub-task; `forge test` green before each commit.

### C1 — Foundry scaffold + mocks
- `forge init`; install v4-core, v4-periphery, permit2, openzeppelin, chainlink contracts.
- `MockNVDA` ERC-20 (18 decimals, mintable); use real Base Sepolia WETH (`0x4200…0006`).
- `MockAggregatorV3` for NVDA/USD (8 decimals, owner/keeper-settable answer + timestamp).
- Base Sepolia fork test harness (tests run against real v4 contracts + real ETH/USD feed).

### C2 — Petition core
- `createPetition`, `sign` (records commitment; assumes Permit2 allowance/permit), `getPetition`, `getCommitment`.
- `hypotheticalTvlUsdE18(id)`: read ETH/USD (real feed) + NVDA/USD (mock), sum committed value, e18.
- Shared-threshold gating.

### C3 — Chainlink read + tests
- `AggregatorV3Interface.latestRoundData` with positivity + staleness checks.
- Tests: valid price; zero/negative rejected; stale rejected; below-threshold rejected; threshold-crossing accepted.

### C4 — Permit2 pull + skip-insolvent
- Batch `transferFrom` via Permit2; skip signers with insufficient balance/allowance; recompute TVL from the deliverable set.
- Tests: full pull; insolvent skipped; revert if deliverable TVL < threshold.

### C5 — Uniswap v4 execute (mint to signers) — DONE
- **Contract-native mint (revised from "guarded calldata exec").** Because `execute` is permissionless, running caller-supplied mint calldata against the funded contract is exploitable, so the contract builds the pool + per-signer mints itself: set initial price from the Chainlink-derived ratio; create pool if absent; mint **full-range position per signer, `owner = signer`**. No caller-calldata trust.
- **`calls[]` = optional Uniswap Swap-API (UniversalRouter) calldata** for the pre-mint balancing swap, bounded by a Chainlink value-conservation guard (`maxSwapSlippageBps`). Empty `calls` = skip (common case). This is the Uniswap-API-in-core-path integration; Ian's F6 supplies this calldata.
- **v4 addresses:** `LPPetition` references the `BaseSepolia` library (single source of truth) for Permit2/PositionManager/UniversalRouter, so they can't drift from the deploy script / app config. Uses standard v4-periphery `Actions` (`SETTLE_PAIR = 0x0d`) against the canonical Base Sepolia PositionManager (`0x4B2C77d2…`).
- Fork tests (live Base Sepolia): pool created; each position owned by its signer; insolvent skipped; single-exec guard.

### C6 — Deploy scripts — DONE
- `script/Deploy.s.sol`: deploys `MockNVDA` + mock NVDA/USD aggregator (seed $150) + `LPPetition`; registers both feeds (WETH→real ETH/USD, NVDA→mock, 24h staleness); opens a demo petition (fee 3000, $5k threshold); mints 1,000 NVDA to the deployer + optional `DEMO_WALLETS`; prints an address book and writes `deployments/base-sepolia.json` for Ian. WETH is real (not minted) — wallets wrap testnet ETH via the faucet.
- Run: `forge script script/Deploy.s.sol:Deploy --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast` with `PRIVATE_KEY` set. Validated via simulation (dry-run).

### C6 — Deploy scripts
- `forge script` deploy + mint; broadcast to Base Sepolia; output an address book for Ian.

## Interface boundary (SHARED — keep stable; identical in `fullstack.md`)

```solidity
enum PetitionStatus { Open, Executed }

struct Petition {
    address token0;          // sorted (token0 < token1)
    address token1;
    uint24  fee;             // v4 fee tier (full-range)
    uint256 thresholdUsdE18; // shared minimum TVL
    PetitionStatus status;
}

function createPetition(address token0, address token1, uint24 fee, uint256 thresholdUsdE18) external returns (uint256 id);
function sign(uint256 id, uint256 amount0, uint256 amount1) external;          // requires Permit2 allowance/permit
function hypotheticalTvlUsdE18(uint256 id) external view returns (uint256);
function execute(uint256 id, bytes[] calldata calls) external;                 // pull -> (optional swap) -> mint to signers
function getPetition(uint256 id) external view returns (Petition memory);
function getCommitment(uint256 id, address signer) external view returns (uint256 amount0, uint256 amount1);

event PetitionCreated(uint256 indexed id, address token0, address token1, uint24 fee, uint256 thresholdUsdE18);
event Signed(uint256 indexed id, address indexed signer, uint256 amount0, uint256 amount1);
event Executed(uint256 indexed id, uint256 totalUsdE18, bytes32 poolId);
event PositionMinted(uint256 indexed id, address indexed signer, uint256 positionTokenId);
```

**S0 decision (SETTLED 2026-06-14): on-chain `sign()`.** Commitments are recorded in a tx via `sign(id, amount0, amount1)` exactly as in the ABI above; the Permit2 allowance is granted gaslessly via a Permit2 `permit` signature, so only the commitment record costs gas. `execute(id, calls[])` keeps its frozen signature (no `Commitment[]`/`PermitPayload[]` arrays). The off-chain signed-commitment model (fully gasless, arrays into `execute`) is deferred to a stretch goal.

## Definition of done (contracts)
- `forge test` green (incl. fork tests).
- `LPPetition` + mocks deployed on Base Sepolia; addresses handed to Ian.
- One real `execute()` mints signer-owned full-range v4 positions; tx hash recorded.

## Depends on / hands off
- **Hands to Ian:** frozen ABI, deployed addresses, typed-data schema, a working `execute()` to call.
- **Needs from Ian:** viem typed-data parity for commitments, and the executor service that submits `execute()`.
