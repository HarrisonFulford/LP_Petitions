# Full-Stack Workstream — Owner: Ian

> Scope: Next.js frontend + backend/API, signature collection/storage, **Vercel-hosted auto-executor (reactive + cron)**, wallet UX, **live Vercel deployment**, demo/README polish.
> Source of truth: `implementation_plan.md` (reconciled decisions). Where `ianimplementation.md` differs, this + `implementation_plan.md` take precedence.
> Counterpart workstream: `contract.md` (Harrison).

## Locked decisions (context)

Base Sepolia · Uniswap v4 · pair **mock SPCX / WETH** · **full-range** positions · **Option B** (each signer owns their own position NFT — the proof panel shows real positions, not vault shares) · **shared threshold** · **skip-insolvent** at execute · Chainlink **ETH/USD Data Feed** + **mock SPCX/USD aggregator** · backend is a trigger + calldata builder, never custodies funds.

**Must ship live for finalist judging:** publicly hosted site judges can use on the spot. **All-Vercel hosting (Vercel Pro):** Next.js frontend + API routes, **Vercel Postgres/KV** for storage (serverless filesystem is ephemeral), and **auto-execute without a separate worker** via (a) reactive execution on commit using `after()`/`waitUntil` and (b) a per-minute **Vercel Cron** sweep (Pro plan) as the safety net for price-driven crossings. Plus a faucet so an empty wallet can participate (mocks make this trivial — no KYC/allowlist).

## Shared / bottleneck tasks (ALSO in `contract.md` — do these first, together)

These block both workstreams. Settle before parallel work.

- **S0 — Lock the interface boundary (Phase 0, both present).** Freeze the `LPPetition` ABI (below), the commitment EIP-712 typed-data + Permit2 permit shape, the event schema, and the runtime config (addresses + chainId). Both sides build against the frozen version; later changes require a sync. Mock the contract behind this ABI so frontend/backend aren't blocked on Harrison.
- **S1 — Pin addresses (Harrison leads; Ian records in app config).** Base Sepolia v4 set + Chainlink ETH/USD feed proxy → one `RuntimeConfig`.
- **S2 — Deploy to Base Sepolia + mint demo balances (Harrison runs; Ian consumes addresses).** Wire the app to the deployed `LPPetition`, mock SPCX, mock aggregator.
- **S3 — End-to-end integration + demo + submission (shared).** One real `execute()` on Base Sepolia; record tx hashes; finalize README, demo video, and Uniswap Developer Feedback Form.

## Owned tasks (Ian)

One commit per sub-task; `npm run typecheck` + browser smoke before each commit.

### F1 — App scaffold + runtime config
- Next.js full-stack (TS, viem/wagmi). `GET /api/config` returns addresses, chainId (Base Sepolia), explorer URLs, fee tier.

### F2 — Petition + commitment storage (Vercel-managed DB)
- **Vercel Postgres** (preferred — relational, easy ordering) or **Vercel KV** (Upstash Redis). No local file (serverless filesystem is ephemeral). Petition records + ordered commitment records; persist across refresh and deploys.
- Routes: `GET/POST /api/petitions`, `GET /api/petitions/:id`, `POST /api/petitions/:id/commitments`.

### F3 — Commitment signing (parity with contract)
- Build the EIP-712 commitment typed data + Permit2 permit to match Harrison's schema exactly (S0). Verify the connected-wallet signature server-side before storing.

### F4 — Price fetch (display + seed mock aggregator)
- Fetch ETH/USD (Chainlink) and SpaceX price (`xstocks.fi /public/assets/SPCX/price-data`). Feed the SpaceX price to the keeper that updates the mock SPCX/USD aggregator. Never trust client-supplied prices.

### F5 — TVL progress + threshold
- Compute live "hypothetical TVL" from stored commitments × prices; render the progress bar; mark when the shared threshold is crossed. (Contract is the final authority.)

### F6 — Auto-executor (Vercel-native: reactive + cron)
- **Shared executor module** that, for a petition it believes crossed threshold, assembles the commitment/permit batch, builds Uniswap **Swap API + LP API** calldata, submits `execute()`, and stores tx hash + status. (The contract re-verifies TVL on-chain and has a single-exec guard, so an early/wrong attempt simply reverts — the executor can be dumb and safe.)
- **Reactive trigger (instant, primary path):** in `POST /commitments`, after storing, recompute TVL; if crossed, fire the executor via `after()`/`waitUntil` so the HTTP response returns fast while the tx sends in the background.
- **Cron sweep (safety net):** `GET /api/cron/sweep` on a **Vercel Cron** every minute (Pro) — re-checks all open petitions and executes any crossed, covering **price-driven** crossings the reactive path misses.
- **Idempotency:** a DB status lock (`executing`) + the contract's single-exec guard so reactive + cron can't double-fire.
- Keep `POST /api/petitions/:id/execute` as a manual demo fallback. Executor private key only in Vercel env.

### F7 — Frontend screens
1. **List** — petitions with target, progress, status.
2. **Create** — pair (SPCX/WETH), target TVL, fee tier.
3. **Detail** — Chainlink price card, contribution form (SPCX + WETH), Permit2 approval/sign state, live progress, **auto-executing** → executed states (no user button needed; it fires itself).
4. **Executed proof** — explorer tx link + **each signer's own v4 position** (Option B), and a one-line Chainlink/Uniswap sponsor summary.

### F8 — Judge onboarding / faucet
- Visible **"mint SPCX + WETH"** button so an empty wallet can participate on the spot (mocks make this safe — no KYC/allowlist). Link a Base Sepolia ETH faucet for gas.

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

**Open decision to settle in S0:** on-chain `sign()` vs off-chain signed commitment (EIP-712 + Permit2 permit stored by backend, passed as arrays into `execute`). The off-chain model is gasless and is what F3/F6 assume; confirm with Harrison.

## Definition of done (full-stack)
- **Live public URL** (Vercel) is up and active for finalist judging, backed by a hosted DB.
- Create/list petitions; commitments persist + stay ordered across refresh and deploys.
- Wallet connect → faucet mint → Permit2 approve → sign commitment works on Base Sepolia.
- Progress bar reflects Chainlink-priced TVL; **auto-execute (reactive + Vercel Cron) fires at threshold** with no manual click; proof panel shows the explorer link + each signer's position.
- A fresh wallet can complete the full flow on the live site unaided.
- No executor key exposed client-side; all secrets in hosted env.

## Depends on / hands off
- **Needs from Harrison:** frozen ABI, deployed addresses, typed-data schema, a working `execute()`.
- **Hands to Harrison:** viem typed-data parity for commitments + the executor that calls `execute()`.
