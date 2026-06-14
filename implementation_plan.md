# LP Petitions — Implementation Plan

> Single source of truth for the build. Concept lives in `README.md`; owner-specific execution notes live in `contract.md` and `fullstack.md`.

## 1. Concept

Users sign conditional LP commitments for a token pair. Each commitment:

- grants the petition contract a **Permit2 allowance** (tokens stay in the user's wallet and remain usable),
- specifies committed `amountA` / `amountB`.

When the aggregate **hypothetical TVL** clears a **shared threshold**, a single transaction pulls everyone's tokens and mints **full-range Uniswap v4 positions**, with **each position owned directly by the signer who committed it** (Option B). A signer becomes an LP only if the condition they agreed to is met, and they walk away holding an ordinary, independently-managed v4 position — no vault, no custody, no redemption step through our contract.

**Demo pair / chain:** **mock NVDA / WETH** on **Base Sepolia** (a single self-contained testnet — no mainnet fork). Mock `NVDA` is a hackathon stand-in for tokenized NVIDIA (`NVDAx`); WETH is the real Base Sepolia WETH so the ETH leg can be priced by a real Chainlink feed. `NVDAx` is a normal xStocks product visible on the xStocks products page; the real token is referenced for narrative/proof and for seeding the mock NVDA price, but the demo executes only against our Base Sepolia mock token.

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

1. **On-chain Chainlink read.** `execute()` reads `AggregatorV3Interface` for each leg, computes hypothetical TVL, and `require()`s it clears the shared threshold. The **WETH leg uses the real Chainlink ETH/USD Data Feed** (the load-bearing, track-qualifying read); the **NVDA leg uses a mock `AggregatorV3` aggregator** we deploy and seed off-chain from official xStocks/Backed NVDAx sources. We use the mock aggregator because the demo is on Base Sepolia and the tokenized-equity/Data Streams path is not a public Base Sepolia `AggregatorV3` feed. *The on-chain ETH/USD read gates the state change → Chainlink track eligibility.*
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
- **NVDA leg** uses a self-deployed mock `AggregatorV3` seeded off-chain from official xStocks/Backed NVDAx sources. The *qualifying* Chainlink read is the genuine ETH/USD feed; the mock prices only the synthetic testnet asset.
- **Chain note:** Base Sepolia chosen because classic Chainlink Data Feeds are deployed there; they are **not** available on Unichain Sepolia (only Unichain mainnet), which is why we did not use Unichain Sepolia.
- **No Automation / Functions** (deprecated per track note; use CRE if ever needed).
- **Stretch (bonus, multi-service):** **Proof of Reserves** to verify NVDAx backing (xStocks PoR is mainnet-only data; would be referenced, not read on testnet).

## 6. Demo Strategy

Single self-contained environment — **no mainnet fork**. The demo transactions *are* the submission proof.

- **Live, hosted, always-on (finalist requirement):** the site ships publicly — **all on Vercel (Pro): frontend + API + Cron + Vercel Postgres/KV**, no separate worker — so judges can use it on the spot. A fresh wallet can **mint mock NVDA + wrap faucet ETH into WETH → sign → watch it auto-execute** end to end. Contracts are already "live" on public Base Sepolia.
- **Everything on Base Sepolia:** deploy mock `NVDA` + the mock NVDA aggregator + `LPPetition`; pair against real Base Sepolia WETH; create our own v4 pool. Sign petitions from a few demo wallets, watch the live TVL bar fill; the worker **auto-executes** at threshold to form the pool — producing public, verifiable tx hashes.
- **Tokenized-stock wow factor (narrative only):** in the video, show the *real* `NVDAx` product on xStocks / supported venues for ~10s and explain that tokenized-stock liquidity bootstrapping is exactly the problem we solve. Feed the official xStocks/Backed NVDAx price path into the testnet TVL, with an explicit demo fallback if live quotes are closed. No fork, no allowlist override, no impersonation.

## 7. Reference Addresses & Endpoints

> Verify all against official sources during step 1 (these moved/conflicted across community lists).

### NVIDIA xStock (narrative + price seeding only — not used on-chain on testnet)
- Token `NVDAx` (xStocks / Backed), EVM token address from xStocks metadata: `0xc845b2894dbddd03858fd2d643b4ef725fe0849d` (enabled on Ethereum and several supported EVM networks; Base Sepolia demo uses our mock token).
- Used in the video to show the real pool, and to seed the mock NVDA aggregator with a genuine price.

### xStocks / Backed APIs (public, no auth)
- `GET https://api.backed.fi/api/v2/public/assets/NVDAx/price-data` — official public NVDAx price-data endpoint. Its `quote` may be `null` outside quoting windows.
- `GET https://api.xstocks.fi/api/v1/quotes/assets/NVDAx` — official xStocks quote metadata fallback. If `bid`/`ask` are present, interpret them as USD cents and use the midpoint.
- `GET /public/proof-of-reserves/NVDAx` — PoR (stretch; exact public path may need confirmation before implementation).

### Uniswap v4 — Base Sepolia (from official Uniswap docs + `sepolia.basescan.org`, 2026-06-14)
| Contract | Address |
|---|---|
| PoolManager | `0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408` |
| PositionManager | `0x4B2C77d209D3405F41a037Ec6c77F7F5b8e2ca80` |
| UniversalRouter | `0x492E6456D9528771018DeB9E87ef7750EF184104` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| StateView | `0x571291b572ed32ce6751a2cb2486ebee8defb9b4` |
| WETH9 | `0x4200000000000000000000000000000000000006` |

> Each address is cross-checked against the official Uniswap v4 deployments page and Base Sepolia BaseScan; these are Base **Sepolia** addresses — do not confuse with the Base **mainnet** v4 set (`0x498581ff…` PoolManager).

### Chainlink — Base Sepolia
- **ETH/USD Data Feed:** `0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1` (`EACAggregatorProxy`, verified on `sepolia.basescan.org` 2026-06-14, 8 decimals). Read via `AggregatorV3Interface.latestRoundData` (the load-bearing on-chain read).
- **Mock NVDA/USD aggregator:** self-deployed `AggregatorV3`-compatible contract, owner/keeper-updated from official xStocks/Backed price sources. Current primary public API path is Backed/xStocks `https://api.backed.fi/api/v2/public/assets/NVDAx/price-data`; quote can be `null` outside quoting windows, so the backend exposes source diagnostics and may use an explicit server-side `NVDA_USD_FALLBACK_PRICE` as a demo-only mock oracle seed. Do not silently fall back to unrelated market APIs.

## 8. Build Order

1. **Pin addresses.** Base Sepolia v4 set + Chainlink ETH/USD proxy address (verify on official docs).
2. **Mocks + harness.** Mock `NVDA` ERC-20, the mock NVDA/USD `AggregatorV3`, and a Foundry **Base Sepolia fork** test harness (tests run against the real v4 contracts + real ETH/USD feed). Pair against real Base Sepolia WETH.
3. **`LPPetition` core.** `createPetition` / `sign` (Permit2) / `hypotheticalTVL` (real ETH/USD feed + mock NVDA aggregator) / `execute` (guarded calldata exec: Permit2 → optional swap → mint full-range positions owned by each signer). Guard `execute` to whitelisted targets (Permit2, UniversalRouter, PositionManager). No `withdraw`/share-ledger needed under Option B.
4. **Fork tests.** Prove: on-chain price read → threshold crossed → real full-range v4 position minted and owned by each signer; insolvent-signer skip path.
5. **Auto-executor (Vercel-native).** Shared executor module; **reactive** trigger on commit via `after()`/`waitUntil` + **Vercel Cron** minute sweep; wire Swap API + LP API; idempotent (DB lock + contract single-exec).
6. **Frontend + faucet.** Next.js: sign petition, live TVL progress bar, faucet (mint NVDA + WETH), auto-executing → executed state with on-chain tx link.
7. **Deploy live (all Vercel, Pro).** Frontend + API + Cron + Vercel Postgres/KV; cron in `vercel.json`, bump `maxDuration`; all secrets in env. Public URL up and active for finalist judging.
8. **Stretch.** Concentrated ranges (aggressiveness → tick width); Proof of Reserves; per-user thresholds (sorted clearing algorithm); gas batching for >1-block scale.

## 9. Submission Checklist

- [ ] Real on-chain tx IDs (Base Sepolia `execute()`)
- [ ] **Live, publicly hosted, always-on site** (finalist judging) — NVDA faucet + WETH wrapping + auto-execute work for a fresh wallet
- [ ] Public GitHub repo + clear `README.md`
- [ ] Demo video ≤ 3 min (Base Sepolia mock NVDA/WETH, with a narrative reference to the real NVDAx pool)
- [ ] Uniswap Developer Feedback Form
- [ ] Chainlink used inside the contract for a state change (on-chain price read in `execute()`)
- [ ] Project description explains the Chainlink usage

## 10. Open Questions / Risks

- **Gas ceiling:** pull + optional swap + one full-range mint per signer must fit one block. Fine for demo (handful of signers); note as production constraint. Option B's per-signer mints add gas vs a pooled mint, but remove all share-accounting code.
- **v4 stays:** Uniswap track + tokenized-asset narrative target v4, and the Uniswap LP/Swap API speak v4. "Full-range vs concentrated" is only a position-width choice *within* v4.
- **Tokenized-equity feed nuance:** NVDA is public and `NVDAx` is a real xStocks product, but our Base Sepolia MVP prices the mock NVDA leg through a self-deployed `AggregatorV3` seeded from official xStocks/Backed sources. The *qualifying* Chainlink read is the real ETH/USD feed on the WETH leg. Keep the mock clearly labeled.
- **Chainlink Data Feeds ≠ Unichain Sepolia:** feeds are on Unichain *mainnet* only, which is why the chain is Base Sepolia. Verify the exact Base Sepolia ETH/USD proxy at build time.
- **Slippage between calldata build and execution:** handled by min-output limits in the Swap API calldata, not by block timing.
