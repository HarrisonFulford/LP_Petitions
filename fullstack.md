# Full-Stack Workstream — Owner: Ian

> Scope: Next.js frontend + backend/API, signature collection/storage, **Vercel-hosted auto-executor (reactive + cron)**, wallet UX, **live Vercel deployment**, demo/README polish.
> Source of truth: `implementation_plan.md` (reconciled decisions). This workstream file is a focused execution guide and must stay synced with the main plan.
> Counterpart workstream: `contract.md` (Harrison).

## Locked decisions (context)

Base Sepolia · Uniswap v4 · pair **mock NVDA / WETH** · **full-range** positions · **Option B** (each signer owns their own position NFT — the proof panel shows real positions, not vault shares) · **shared threshold** · **skip-insolvent** at execute · Chainlink **ETH/USD Data Feed** + **mock NVDA/USD aggregator** · backend is a trigger + calldata builder, never custodies funds.

**Must ship live for finalist judging:** publicly hosted site judges can use on the spot. **All-Vercel hosting (Vercel Pro):** Next.js frontend + API routes, **Vercel Postgres/KV** for storage (serverless filesystem is ephemeral), and **auto-execute without a separate worker** via (a) reactive execution on commit using `after()`/`waitUntil` and (b) a per-minute **Vercel Cron** sweep (Pro plan) as the safety net for price-driven crossings. Plus onboarding so an empty wallet can participate: mint mock NVDA, use a Base Sepolia ETH faucet for gas, and wrap test ETH into WETH.

## Shared / bottleneck tasks (ALSO in `contract.md` — do these first, together)

These block both workstreams. Settle before parallel work.

- **S0 — Lock the interface boundary (Phase 0, both present).** Freeze the `LPPetition` ABI (below), the Permit2 (AllowanceTransfer) `permit` typed-data shape — the only signed payload; there is no custom commitment EIP-712 — the event schema, and the runtime config (addresses + chainId). Both sides build against the frozen version; later changes require a sync. Mock the contract behind this ABI so frontend/backend aren't blocked on Harrison.
- **S1 — Pin addresses (Harrison leads; Ian records in app config).** Base Sepolia v4 set + Chainlink ETH/USD feed proxy → one `RuntimeConfig`.
- **S2 — Deploy to Base Sepolia + mint demo balances (Harrison runs; Ian consumes addresses).** Wire the app to the deployed `LPPetition`, mock NVDA, mock aggregator.
- **S3 — End-to-end integration + demo + submission (shared).** One real `execute()` on Base Sepolia; record tx hashes; finalize README, demo video, and Uniswap Developer Feedback Form.

## Owned tasks (Ian)

One commit per sub-task; `npm run typecheck` + browser smoke before each commit.

### F1 — App scaffold + runtime config
- Next.js full-stack (TS, viem/wagmi). `GET /api/config` returns addresses, chainId (Base Sepolia), explorer URLs, fee tier.

### F2 — Petition + commitment storage (Vercel-managed DB)
- **Vercel Postgres** (preferred — relational, easy ordering) or **Vercel KV** (Upstash Redis). No local file (serverless filesystem is ephemeral). Petition records + ordered commitment records; persist across refresh and deploys.
- Routes: `GET/POST /api/petitions`, `GET /api/petitions/:id`, `POST /api/petitions/:id/commitments`.

### F3 — Commitment signing (parity with contract)
- **No custom commitment schema.** `LPPetition.sign(id, amount0, amount1)` verifies no signature; the only typed data is the **standard Permit2 AllowanceTransfer** permit (`PermitBatch`/`PermitSingle`), domain `{name: "Permit2", chainId, verifyingContract: PERMIT2}` (no `version`).
- **`spender` MUST be the `LPPetition` address** — `execute` reads `PERMIT2.allowance(signer, token, address(this))` (the *stored* allowance), so the permit must be **registered on-chain via `PERMIT2.permit()`** before `execute`; a bare signature is not read by the contract. Per signer: ERC20 `approve(PERMIT2)` (one-time) → sign `PermitBatch` (gasless) → submit `PERMIT2.permit()` → call `sign()`.
- `amount0`/`amount1` map to the petition's **sorted** `token0`/`token1` (read via `getPetition`), not the display pair order.
- Server-side signature verification is optional/cosmetic (the contract relies on the stored Permit2 allowance, not a passed-in signature); F2 mirrors commitments from the on-chain `Signed` event.

### F4 — Price fetch (display + seed mock aggregator)
- Fetch ETH/USD (Chainlink) and NVDAx price. NVDA/USD must use official xStocks/Backed public sources only: Backed price-data (`https://api.backed.fi/api/v2/public/assets/NVDAx/price-data`) first, then xStocks quote metadata (`https://api.xstocks.fi/api/v1/quotes/assets/NVDAx`) if price-data is null/closed. For demo continuity, an explicit server-side `NVDA_USD_FALLBACK_PRICE` may seed the mock oracle, but it must be labeled as demo-only fallback — not live xStocks/Chainlink market data. Feed the NVDAx price to the keeper that updates the mock NVDA/USD aggregator. Never trust client-supplied prices.

### F5 — TVL progress + threshold
- Compute live "hypothetical TVL" from stored commitments × prices; render the progress bar; mark when the shared threshold is crossed. (Contract is the final authority.)

### F6 — Auto-executor (Vercel-native: reactive + cron)
- **Shared executor module** that, for a petition it believes crossed threshold, assembles the commitment/permit batch, builds Uniswap **Swap API + LP API** calldata, submits `execute()`, and stores tx hash + status. (The contract re-verifies TVL on-chain and has a single-exec guard, so an early/wrong attempt simply reverts — the executor can be dumb and safe.)
- **Reactive trigger (instant, primary path):** in `POST /commitments`, after storing, recompute TVL; if crossed, fire the executor via `after()`/`waitUntil` so the HTTP response returns fast while the tx sends in the background.
- **Cron sweep (safety net):** `GET /api/cron/sweep` on a **Vercel Cron** every minute (Pro) — re-checks all open petitions and executes any crossed, covering **price-driven** crossings the reactive path misses.
- **Idempotency:** a DB status lock (`executing`) + the contract's single-exec guard so reactive + cron can't double-fire.
- Keep `POST /api/petitions/:id/execute` as a manual demo fallback. Executor private key only in Vercel env.
- **Status (implemented):** shared `lib/executor/execute.ts` (`maybeExecutePetition` + `runSweep`), reactive `after()` trigger in the commitments confirm route, `GET /api/cron/sweep` (+ `vercel.json` minute cron, `CRON_SECRET`-gated), manual `POST /api/petitions/[id]/execute`, server-only `EXECUTOR_PRIVATE_KEY` signer. Idempotency = in-process lock + contract single-exec guard. **Open gap:** the Uniswap Swap-API calldata path is scaffolded but disabled (`buildBalancingSwapCalls` returns `[]`; contract mints at the Chainlink ratio), so the Uniswap API key is not yet exercised in the execute path — finish before relying on it for the Uniswap track.

### F7 — Frontend screens
1. **List** — petitions with target, progress, status.
2. **Create** — pair (NVDA/WETH), target TVL, fee tier.
3. **Detail** — Chainlink price card, contribution form (NVDA + WETH), Permit2 approval/sign state, live progress, **auto-executing** → executed states (no user button needed; it fires itself).
4. **Executed proof** — explorer tx link + **each signer's own v4 position** (Option B), and a one-line Chainlink/Uniswap sponsor summary.

### F8 — Judge onboarding / faucet
- Visible onboarding controls so an empty wallet can mint mock NVDA, open a Base Sepolia ETH faucet for gas, and wrap test ETH into WETH.

### F9 — Deploy & make live (finalist requirement) — all on Vercel
- **One platform: Vercel (Pro).** Frontend + API routes + Vercel Cron + Vercel Postgres/KV. No separate worker host.
- Configure the cron schedule (`*/1 * * * *`) in `vercel.json`; bump the relevant function `maxDuration` so `execute()` calldata-build + send fits the timeout (send the tx, don't await deep confirmation; let `after()` poll the receipt).
- All secrets (executor key, Uniswap API key, DB URL, RPC) in Vercel env; nothing client-side.
- Public URL up, auto-execute running, and a fresh wallet can mint → sign → watch it auto-execute end to end.

## Interface boundary (SHARED — keep stable; identical in `contract.md`)

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

**S0 decision (SETTLED 2026-06-14): on-chain `sign()`.** The contract keeps the frozen ABI: users call `sign(id, amount0, amount1)` (a tx) after granting a Permit2 allowance. `execute(id, calls[])` stays as-is (no commitment/permit arrays). F3 builds the **standard Permit2 AllowanceTransfer** `permit` (there is no custom commitment EIP-712 — `sign()` checks no signature); the allowance must be **registered on-chain via `PERMIT2.permit()`** before `execute`, since the contract reads the stored `PERMIT2.allowance(...)`. Commitments live on-chain — F2 storage mirrors them from `Signed` events / reads rather than holding signed payloads. The fully-gasless off-chain model is a stretch goal.

## Definition of done (full-stack)
- **Live public URL** (Vercel) is up and active for finalist judging, backed by a hosted DB.
- Create/list petitions; commitments persist + stay ordered across refresh and deploys.
- Wallet connect → mint mock NVDA → wrap faucet ETH into WETH → Permit2 approve → sign commitment works on Base Sepolia.
- Progress bar reflects Chainlink-priced TVL; **auto-execute (reactive + Vercel Cron) fires at threshold** with no manual click; proof panel shows the explorer link + each signer's position.
- A fresh wallet can complete the full flow on the live site unaided.
- No executor key exposed client-side; all secrets in hosted env.

## Depends on / hands off
- **Needs from Harrison:** frozen ABI, deployed addresses, typed-data schema, a working `execute()`.
- **Hands to Harrison:** viem typed-data parity for commitments + the executor that calls `execute()`.
