# LP Petitions — Implementation Plan

> Single source of truth for the build. Concept lives in `README.md`; owner-specific execution notes live in `contract.md` and `fullstack.md`.

## 1. Concept

Users sign conditional LP commitments for a token pair. Each commitment:

- grants the petition contract a **Permit2 allowance** (tokens stay in the user's wallet and remain usable),
- specifies committed `amountA` / `amountB`.

When the aggregate **hypothetical TVL** clears a **shared threshold**, a single transaction pulls everyone's tokens and mints **full-range Uniswap v4 positions**, with **each position owned directly by the signer who committed it** (Option B). A signer becomes an LP only if the condition they agreed to is met, and they walk away holding an ordinary, independently-managed v4 position — no vault, no custody, no redemption step through our contract.

**Demo pair / chain:** **mock SPCX / WETH** on **Base Sepolia** (a single self-contained testnet — no mainnet fork). Mock `SPCX` is a hackathon stand-in for tokenized SpaceX (`SPCXx`); WETH is the real Base Sepolia WETH so the ETH leg can be priced by a real Chainlink feed. The real `SPCXx` token/pool is referenced only narratively (and for seeding the SPCX price), never executed against on testnet.

## 2. Core Properties

- **Atomic, single-block execution.** All liquidity is added inside one `execute()` transaction → one block. All signers become LPs together, or the whole thing reverts. No partial state.
- **Tokens usable until LP'd.** Signing is a Permit2 allowance, not a transfer/lock. Funds only move during `execute()`.
- **Solvency-check-and-skip.** At execution, each signer's live balance + allowance is checked; insolvent signers are skipped and TVL is recomputed from only deliverable commitments.
- **Signers own their positions directly (Option B).** Each v4 position NFT is minted with the signer's wallet as owner. The contract is a pass-through coordinator that holds no positions and needs no share-accounting or `withdraw()` subsystem — signers manage/withdraw via the standard Uniswap PositionManager.
- **Full-range MVP.** Positions span the full tick range (min→max), avoiding aggressiveness→tick math and per-range ratio balancing. Concentrated ranges are a stretch goal.

## 3. Architecture

```
┌────────────────────────────────────────────────────────────┐
│  LPPetition.sol  (Foundry / Solidity, Uniswap v4)           │
│  • createPetition(pair, threshold)                          │
│  • sign(id, amtA, amtB)                  ← Permit2 allowance │
│  • hypotheticalTVL(id) view              ← on-chain Chainlink │
│  • execute(id, calldata[])               ← atomic pull+mint  │
│        mints full-range positions owned by each signer       │
└────────────────────────────────────────────────────────────┘
        ▲ funds pulled through here    │ position NFTs → signers │
        │                              ▼
┌────────────────────────────────────────────────────────────┐
│  Auto-executor — all on Vercel (Pro)                       │
│  • Reactive on commit (after()/waitUntil) — instant         │
│  • Vercel Cron sweep every minute — price-driven crossings  │
│  • Builds Uniswap Swap API + LP API calldata                │
│  • AUTO-calls execute() at threshold (single-exec guard)    │
└────────────────────────────────────────────────────────────┘
        │
        ▼  Next.js on Vercel + Vercel Postgres/KV: sign, live TVL bar, faucet, tx link
```

## 4. Execution Flow (one atomic `execute()` tx = one block)

1. **On-chain Chainlink read.** `execute()` reads `AggregatorV3Interface` for each leg, computes hypothetical TVL, and `require()`s it clears the shared threshold. The **WETH leg uses the real Chainlink ETH/USD Data Feed** (the load-bearing, track-qualifying read); the **SPCX leg uses a mock `AggregatorV3` aggregator** we deploy and seed off-chain from the real xStocks SpaceX price (SpaceX is private — no real Chainlink feed exists anywhere). *The on-chain ETH/USD read gates the state change → Chainlink track eligibility.*
2. **Permit2 batch pull.** `transferFrom` each solvent signer's committed tokens into the contract (skip insolvent).
3. **Initialize + (optional) ratio balance.** Because we create our own pool, the initial price is set from the Chainlink-derived ratio, so deposits go in at that ratio — no swap needed in the common case. If committed amounts are lopsided, run Swap API-generated UniversalRouter calldata to balance to the pool ratio.
4. **Mint, owned by signers.** Run LP API-generated calldata: create the v4 pool if absent, then mint a **full-range position per signer with that signer's wallet set as the owner**.
5. **Done — no bookkeeping.** The contract holds no positions and keeps no share ledger. Each signer already owns their position NFT and manages/withdraws it via the standard Uniswap PositionManager.

> Off-chain and pre-block (no state change): Permit2 signing by users, and the backend's REST calls to the Swap/LP APIs to build calldata. All actual liquidity provision happens in the single `execute()` block.

## 5. Track Alignment

### Uniswap — aligned
- **Swap API** (`/quote`, `/swap`) + **LP API** (create pool + mint) with a valid Developer Platform API key, in the core `execute()` path.
- Real **Base Sepolia** `execute()` transaction IDs for submission.

### Chainlink — aligned via on-chain read
- **Real Chainlink ETH/USD Data Feed read on-chain inside `execute()`**, gating the mint = a real on-chain state change (satisfies "Chainlink inside your smart contracts is required"; a frontend-only read would not qualify).
- **SPCX leg** uses a self-deployed mock `AggregatorV3` (seeded off-chain from the real xStocks price) because SpaceX is private and has no Chainlink feed anywhere. The *qualifying* Chainlink read is the genuine ETH/USD feed; the mock prices only the synthetic asset.
- **Chain note:** Base Sepolia chosen because classic Chainlink Data Feeds are deployed there; they are **not** available on Unichain Sepolia (only Unichain mainnet), which is why we did not use Unichain Sepolia.
- **No Automation / Functions** (deprecated per track note; use CRE if ever needed).
- **Stretch (bonus, multi-service):** **Proof of Reserves** to verify SPCXx backing (xStocks PoR is mainnet-only data; would be referenced, not read on testnet).

## 6. Demo Strategy

Single self-contained environment — **no mainnet fork**. The demo transactions *are* the submission proof.

- **Live, hosted, always-on (finalist requirement):** the site ships publicly — **all on Vercel (Pro): frontend + API + Cron + Vercel Postgres/KV**, no separate worker — so judges can use it on the spot. A fresh wallet can **mint mock SPCX + wrap faucet ETH into WETH → sign → watch it auto-execute** end to end. Contracts are already "live" on public Base Sepolia.
- **Everything on Base Sepolia:** deploy mock `SPCX` + the mock SPCX aggregator + `LPPetition`; pair against real Base Sepolia WETH; create our own v4 pool. Sign petitions from a few demo wallets, watch the live TVL bar fill; the worker **auto-executes** at threshold to form the pool — producing public, verifiable tx hashes.
- **Tokenized-stock wow factor (narrative only):** in the video, show the *real* `SPCXx` token/pool in the Uniswap app for ~10s ("SpaceX went live on Uniswap 2026-06-12, the pool is tiny — exactly the bootstrapping problem we solve"), and feed the **real SpaceX price** (xStocks API) into the testnet TVL so the numbers are genuine. No fork, no allowlist override, no impersonation.

## 7. Reference Addresses & Endpoints

> Verify all against official sources during step 1 (these moved/conflicted across community lists).

### SpaceX tokenized stock (narrative + price seeding only — not used on-chain on testnet)
- Token `SPCXx` (xStocks / Backed), ERC-20 on Ethereum + Base mainnet: `0x68fa48b1c2fe52b3d776e1953e0e782b5044ce28`
- Used in the video to show the real pool, and to seed the mock SPCX aggregator with a genuine price.

### xStocks API (public, no auth) — `https://api.xstocks.fi/api/v2`
- `GET /public/assets/SPCX/price-data` — live indicative SpaceX price (seeds the mock SPCX aggregator + TVL display)
- `GET /public/proof-of-reserves/SPCX` — PoR (stretch)

### Uniswap v4 — Base Sepolia (verified on `sepolia.basescan.org`, 2026-06-14)
| Contract | Address |
|---|---|
| PoolManager | `0x7Da1D65F8B249183667cdE74C5CBD46dD38AA829` |
| PositionManager | `0xcDbe7b1ed817eF0005ECe6a3e576fbAE2EA5EAFE` |
| UniversalRouter | `0x95273d871c8156636e114b63797d78D7E1720d81` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| StateView | `0x571291b572ed32ce6751a2cb2486ebee8defb9b4` |
| WETH9 | `0x4200000000000000000000000000000000000006` |

> Each verified by contract name on Base Sepolia BaseScan; UniversalRouter's constructor args also reference the same PoolManager/PositionManager, cross-confirming the set. These are Base **Sepolia** addresses — do not confuse with the Base **mainnet** v4 set (`0x498581ff…` PoolManager).

### Chainlink — Base Sepolia
- **ETH/USD Data Feed:** `0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1` (`EACAggregatorProxy`, verified on `sepolia.basescan.org` 2026-06-14, 8 decimals). Read via `AggregatorV3Interface.latestRoundData` (the load-bearing on-chain read).
- **Mock SPCX/USD aggregator:** self-deployed `AggregatorV3`-compatible contract, owner/keeper-updated from the xStocks price.

## 8. Agent Build Plan + Commit Timeline

This section is the execution map for agents and humans. Work in order unless a shared blocker is explicitly resolved. Each sub-phase should normally become one clean commit. Do **not** batch unrelated contract, full-stack, deploy, and docs work into one large commit.

### Phase 0 — Shared interface freeze (Harrison + Ian together)

**Goal:** remove ambiguity before parallel work starts. This phase blocks both `contract.md` and `fullstack.md`.

- [ ] **P0.1 — Pin public addresses and env assumptions.** Verify the Base Sepolia Uniswap v4 addresses, Permit2, WETH9, StateView, UniversalRouter, and Chainlink ETH/USD proxy against official docs.
  - Commit: `docs: pin Base Sepolia integration addresses`
  - Review focus: no copied community addresses unless verified against official docs.
- [ ] **P0.2 — Freeze the contract/frontend boundary.** Finalize the `LPPetition` ABI, events, petition status model, token ordering rule, fee tier, and `execute(id, calls[])` call shape.
  - Commit: `docs: freeze LPPetition interface boundary`
  - Review focus: `implementation_plan.md`, `contract.md`, and `fullstack.md` agree exactly.
- [ ] **P0.3 — Decide and document the commitment model.** Settle on on-chain `sign()` vs off-chain EIP-712 + Permit2 payloads passed into `execute`. The gasless off-chain model is preferred, but both workstreams must agree before coding against it.
  - Commit: `docs: lock commitment signing model`
  - Review focus: no agent should implement both models or silently switch models mid-build.

### Phase 1 — Contract foundation (Harrison)

**Goal:** create the Foundry base, mocks, and test harness without touching frontend code.

- [ ] **P1.1 — Scaffold Foundry project.** Add Foundry layout, dependency setup, remappings, and a minimal passing test.
  - Commit: `contracts: scaffold foundry project`
  - Verify before commit: `forge test`
- [ ] **P1.2 — Add mock SPCX and mock SPCX/USD aggregator.** Add mintable mock SPCX and `AggregatorV3`-compatible SPCX/USD mock seeded by the keeper. Use real Base Sepolia WETH rather than mock WETH.
  - Commit: `contracts: add SPCX token and price mock`
  - Verify before commit: `forge test`
- [ ] **P1.3 — Add Base Sepolia fork harness.** Configure tests against Base Sepolia v4 contracts and real Chainlink ETH/USD feed.
  - Commit: `contracts: add Base Sepolia fork harness`
  - Verify before commit: `forge test --fork-url $BASE_SEPOLIA_RPC_URL`

### Phase 2 — Petition + Chainlink TVL core (Harrison)

**Goal:** prove that the contract can create petitions, read prices, and gate execution by deliverable TVL before adding Uniswap minting.

- [ ] **P2.1 — Implement petition storage and lifecycle.** Add `createPetition`, `getPetition`, status guard, token pair validation, and fee validation.
  - Commit: `contracts: add petition lifecycle`
  - Verify before commit: `forge test`
- [ ] **P2.2 — Implement commitment recording or payload verification.** Implement the signing model chosen in P0.3, plus `getCommitment` or equivalent read path.
  - Commit: `contracts: add commitment validation`
  - Verify before commit: `forge test`
- [ ] **P2.3 — Implement Chainlink-priced TVL.** Read real ETH/USD and mock SPCX/USD via `AggregatorV3Interface`, reject invalid/stale prices, and return `hypotheticalTvlUsdE18`.
  - Commit: `contracts: add Chainlink-priced TVL gate`
  - Verify before commit: `forge test`

### Phase 3 — Permit2 pull + insolvent-signer behavior (Harrison)

**Goal:** tokens still live in user wallets until `execute`, and insolvent signers do not break the whole petition unless deliverable TVL falls below threshold.

- [ ] **P3.1 — Add Permit2 transfer path.** Pull committed SPCX/WETH through Permit2 only during `execute`.
  - Commit: `contracts: pull commitments with Permit2`
  - Verify before commit: `forge test`
- [ ] **P3.2 — Add skip-insolvent recomputation.** Check signer balance/allowance, skip insolvent signers, recompute deliverable TVL, and revert if deliverable TVL is below threshold.
  - Commit: `contracts: skip insolvent commitments`
  - Verify before commit: `forge test`
- [ ] **P3.3 — Add single-execution guard.** Make `execute` permissionless but idempotent/safe against repeated reactive + cron calls.
  - Commit: `contracts: guard single petition execution`
  - Verify before commit: `forge test`

### Phase 4 — Uniswap v4 execution (Harrison + Ian integration support)

**Goal:** create the pool if needed and mint one full-range v4 position per solvent signer, owned directly by that signer.

- [ ] **P4.1 — Validate guarded calldata targets.** Restrict execution calls to Permit2, UniversalRouter, and PositionManager.
  - Commit: `contracts: whitelist execution targets`
  - Verify before commit: `forge test`
- [ ] **P4.2 — Create v4 pool from Chainlink-derived ratio.** Use ETH/USD and SPCX/USD to set initial pool price; no concentrated range math in MVP.
  - Commit: `contracts: initialize SPCX WETH v4 pool`
  - Verify before commit: `forge test --fork-url $BASE_SEPOLIA_RPC_URL`
- [ ] **P4.3 — Mint signer-owned full-range positions.** Use LP API/PositionManager calldata so every solvent signer receives their own full-range v4 position NFT.
  - Commit: `contracts: mint signer-owned v4 positions`
  - Verify before commit: `forge test --fork-url $BASE_SEPOLIA_RPC_URL`
- [ ] **P4.4 — Emit proof events.** Emit `Executed` and `PositionMinted` events sufficient for the frontend proof panel and README tx proof.
  - Commit: `contracts: emit execution proof events`
  - Verify before commit: `forge test`

### Phase 5 — Full-stack foundation (Ian)

**Goal:** build the Vercel-native app shell, persistent storage, and contract-compatible config before wallet UX.

- [ ] **P5.1 — Scaffold Next.js app.** Add TypeScript, viem/wagmi, basic app shell, and lint/typecheck scripts.
  - Commit: `fullstack: scaffold Next.js app`
  - Verify before commit: `npm run typecheck`
- [ ] **P5.2 — Add runtime config endpoint.** Serve Base Sepolia chain config, deployed addresses, fee tier, explorer URL, and API-visible constants.
  - Commit: `fullstack: add runtime config endpoint`
  - Verify before commit: `npm run typecheck`
- [ ] **P5.3 — Add persistent petition/commitment storage.** Use Vercel Postgres preferred, or Vercel KV if faster. Do not use local filesystem storage for the live app.
  - Commit: `fullstack: add petition storage`
  - Verify before commit: `npm run typecheck` plus route smoke test

### Phase 6 — Signing, pricing, and TVL UI (Ian)

**Goal:** users can create petitions, approve/sign commitments, and see live Chainlink-priced progress.

- [ ] **P6.1 — Add petition list/create/detail routes.** Include target TVL, SPCX/WETH pair, fee tier, status, and progress shell.
  - Commit: `fullstack: add petition screens`
  - Verify before commit: `npm run typecheck` + browser smoke
- [ ] **P6.2 — Add faucet flow.** Let a fresh wallet mint mock SPCX and obtain/wrap WETH for participation; link Base Sepolia ETH faucet for gas.
  - Commit: `fullstack: add demo faucet flow`
  - Verify before commit: `npm run typecheck` + browser smoke
- [ ] **P6.3 — Add Permit2 approve + commitment signing.** Match the P0.3 schema exactly and verify signatures server-side before storage.
  - Commit: `fullstack: add commitment signing flow`
  - Verify before commit: `npm run typecheck` + wallet smoke
- [ ] **P6.4 — Add price fetch + TVL progress.** Read ETH/USD, fetch xStocks SPCX price for display/aggregator seeding, compute hypothetical TVL, and show threshold progress.
  - Commit: `fullstack: add Chainlink-priced progress`
  - Verify before commit: `npm run typecheck` + route smoke

### Phase 7 — Auto-executor + live deployment (Ian)

**Goal:** the site auto-executes at threshold without a manual judge/operator click.

- [ ] **P7.1 — Build shared executor module.** Assemble commitment batch, Uniswap Swap/LP API calldata, and `execute()` transaction payload.
  - Commit: `fullstack: add execution coordinator`
  - Verify before commit: `npm run typecheck`
- [ ] **P7.2 — Add reactive execution trigger.** After commitment storage, use `after()`/`waitUntil` to trigger execution if TVL crossed threshold.
  - Commit: `fullstack: trigger execution after commits`
  - Verify before commit: `npm run typecheck` + API smoke
- [ ] **P7.3 — Add Vercel Cron sweep.** Add `GET /api/cron/sweep`, `vercel.json` schedule, idempotency lock, and status updates.
  - Commit: `fullstack: add cron execution sweep`
  - Verify before commit: `npm run typecheck` + local route smoke
- [ ] **P7.4 — Deploy live on Vercel.** Configure env vars, Vercel Postgres/KV, cron, function duration, and public URL.
  - Commit: `deploy: configure Vercel live app`
  - Verify before commit: live URL smoke test

### Phase 8 — End-to-end proof + submission polish (Shared)

**Goal:** produce the public proof judges need: live flow, tx hashes, README, and demo script.

- [ ] **P8.1 — Deploy contracts and hand off address book.** Harrison deploys mocks + `LPPetition`, mints demo balances, and gives Ian the address book.
  - Commit: `deploy: publish Base Sepolia addresses`
  - Verify before commit: explorer links open and addresses match config
- [ ] **P8.2 — Run first real execute.** Use the live app to mint/sign/auto-execute and record the Base Sepolia tx hash.
  - Commit: `demo: record first execution proof`
  - Verify before commit: explorer shows `execute` + v4 mint events
- [ ] **P8.3 — Update README and ChangeLog.** Document live URL, tx hashes, sponsor integrations, faucet steps, and demo-video script.
  - Commit: `docs: add demo proof and submission notes`
  - Verify before commit: `git diff --check`
- [ ] **P8.4 — Final holistic pass.** Remove stale docs, reduce duplicated/conflicting instructions, and make sure `README.md`, `implementation_plan.md`, `contract.md`, and `fullstack.md` agree.
  - Commit: `docs: reconcile final submission docs`
  - Verify before commit: `git diff --check` and manual doc review

### Commit discipline rules

- One sub-phase should normally equal one commit. If a sub-phase is still too large, split it by testable behavior rather than by random file groups.
- Do not commit unrelated work together. Contract changes, full-stack changes, deploy config, and docs should only share a commit during explicit integration phases.
- Keep generated files and lockfiles in the same commit as the dependency or build step that produced them.
- Before every commit, run the relevant verification listed above and paste failures into the handoff if unresolved.
- Use these prefixes consistently: `docs:`, `contracts:`, `fullstack:`, `deploy:`, `demo:`.
- Avoid 1000+ line feature commits unless the size is caused by generated dependency/lock output. If a commit exceeds that, explain why in the commit body or split it.
- Agents must not push directly unless Ian/Harrison explicitly authorize that push. Leave reviewable diffs when asked.

### Parallelization guidance

- Do Phase 0 together first; it prevents contract/frontend drift.
- After Phase 0, Harrison can work through Phases 1–4 while Ian works through Phases 5–7 using mocks for the frozen ABI.
- Phases 4, 7, and 8 are integration-heavy; sync before starting them.
- If the commitment model or ABI changes after Phase 0, stop both workstreams and update `implementation_plan.md`, `contract.md`, and `fullstack.md` in one docs commit before continuing.

### Stretch queue — only after Phase 8 works

- Concentrated ranges / aggressiveness → tick width.
- Proof of Reserves narrative or read path.
- Per-user thresholds / sorted clearing algorithm.
- Gas batching for signer sets too large for one block.

## 9. Submission Checklist

- [ ] Real on-chain tx IDs (Base Sepolia `execute()`)
- [ ] **Live, publicly hosted, always-on site** (finalist judging) — SPCX faucet + WETH wrapping + auto-execute work for a fresh wallet
- [ ] Public GitHub repo + clear `README.md`
- [ ] Demo video ≤ 3 min (Base Sepolia mock SPCX/WETH, with a narrative reference to the real SPCXx pool)
- [ ] Uniswap Developer Feedback Form
- [ ] Chainlink used inside the contract for a state change (on-chain price read in `execute()`)
- [ ] Project description explains the Chainlink usage

## 10. Open Questions / Risks

- **Gas ceiling:** pull + optional swap + one full-range mint per signer must fit one block. Fine for demo (handful of signers); note as production constraint. Option B's per-signer mints add gas vs a pooled mint, but remove all share-accounting code.
- **v4 stays:** Uniswap track + tokenized-asset narrative target v4, and the Uniswap LP/Swap API speak v4. "Full-range vs concentrated" is only a position-width choice *within* v4.
- **SpaceX has no Chainlink feed (private company):** the SPCX leg is priced by a self-deployed mock `AggregatorV3` seeded from the xStocks price; the *qualifying* Chainlink read is the real ETH/USD feed on the WETH leg. Keep the mock clearly labeled.
- **Chainlink Data Feeds ≠ Unichain Sepolia:** feeds are on Unichain *mainnet* only, which is why the chain is Base Sepolia. Verify the exact Base Sepolia ETH/USD proxy at build time.
- **Slippage between calldata build and execution:** handled by min-output limits in the Swap API calldata, not by block timing.
