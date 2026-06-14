# LP Petitions — Implementation Plan

> Single source of truth for the build. Concept lives in `README.md`; current priorities in `TODO.md`.

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

- **Live, hosted, always-on (finalist requirement):** the site ships publicly — **all on Vercel (Pro): frontend + API + Cron + Vercel Postgres/KV**, no separate worker — so judges can use it on the spot. A fresh wallet can **mint test tokens (faucet) → sign → watch it auto-execute** end to end. Contracts are already "live" on public Base Sepolia.
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

## 8. Build Order

1. **Pin addresses.** Base Sepolia v4 set + Chainlink ETH/USD proxy address (verify on official docs).
2. **Mocks + harness.** Mock `SPCX` ERC-20, the mock SPCX/USD `AggregatorV3`, and a Foundry **Base Sepolia fork** test harness (tests run against the real v4 contracts + real ETH/USD feed). Pair against real Base Sepolia WETH.
3. **`LPPetition` core.** `createPetition` / `sign` (Permit2) / `hypotheticalTVL` (real ETH/USD feed + mock SPCX aggregator) / `execute` (guarded calldata exec: Permit2 → optional swap → mint full-range positions owned by each signer). Guard `execute` to whitelisted targets (Permit2, UniversalRouter, PositionManager). No `withdraw`/share-ledger needed under Option B.
4. **Fork tests.** Prove: on-chain price read → threshold crossed → real full-range v4 position minted and owned by each signer; insolvent-signer skip path.
5. **Auto-executor (Vercel-native).** Shared executor module; **reactive** trigger on commit via `after()`/`waitUntil` + **Vercel Cron** minute sweep; wire Swap API + LP API; idempotent (DB lock + contract single-exec).
6. **Frontend + faucet.** Next.js: sign petition, live TVL progress bar, faucet (mint SPCX + WETH), auto-executing → executed state with on-chain tx link.
7. **Deploy live (all Vercel, Pro).** Frontend + API + Cron + Vercel Postgres/KV; cron in `vercel.json`, bump `maxDuration`; all secrets in env. Public URL up and active for finalist judging.
8. **Stretch.** Concentrated ranges (aggressiveness → tick width); Proof of Reserves; per-user thresholds (sorted clearing algorithm); gas batching for >1-block scale.

## 9. Submission Checklist

- [ ] Real on-chain tx IDs (Base Sepolia `execute()`)
- [ ] **Live, publicly hosted, always-on site** (finalist judging) — faucet + auto-execute work for a fresh wallet
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
