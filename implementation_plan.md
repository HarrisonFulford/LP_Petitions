# LP Petitions — Implementation Plan

> Single source of truth for the build. Concept lives in `README.md`; current priorities in `TODO.md`.

## 1. Concept

Users sign conditional LP commitments for a token pair. Each commitment:

- grants the petition contract a **Permit2 allowance** (tokens stay in the user's wallet and remain usable),
- specifies committed `amountA` / `amountB`,
- picks an **aggressiveness level** (maps to concentrated-liquidity range width around the current ratio).

When the aggregate **hypothetical TVL** clears a **shared threshold**, a single transaction pulls everyone's tokens and mints concentrated Uniswap v4 positions. A signer becomes an LP only if the condition they agreed to is met.

## 2. Core Properties

- **Atomic, single-block execution.** All liquidity is added inside one `execute()` transaction → one block. All signers become LPs together, or the whole thing reverts. No partial state.
- **Tokens usable until LP'd.** Signing is a Permit2 allowance, not a transfer/lock. Funds only move during `execute()`.
- **Solvency-check-and-skip.** At execution, each signer's live balance + allowance is checked; insolvent signers are skipped and TVL is recomputed from only deliverable commitments.

## 3. Architecture

```
┌────────────────────────────────────────────────────────────┐
│  LPPetition.sol  (Foundry / Solidity, Uniswap v4)           │
│  • createPetition(pair, threshold)                          │
│  • sign(id, amtA, amtB, aggressiveness)  ← Permit2 allowance │
│  • hypotheticalTVL(id) view              ← on-chain Chainlink │
│  • execute(id, calldata[])               ← atomic pull+mint  │
│  • withdraw(id)                          ← proportional      │
└────────────────────────────────────────────────────────────┘
        ▲ funds aggregated here        │ position NFTs held here
        │                              ▼
┌────────────────────────────────────────────────────────────┐
│  Backend orchestrator (Express/TS, ALMA-style)             │
│  • Watches petitions; estimates when threshold is met       │
│  • Builds calldata: Uniswap Swap API + LP API               │
│  • Calls execute() (single execution path, no Automation)   │
└────────────────────────────────────────────────────────────┘
        │
        ▼  Next.js frontend: sign petition, live TVL bar, tx link
```

## 4. Execution Flow (one atomic `execute()` tx = one block)

1. **On-chain Chainlink read.** `execute()` reads `AggregatorV3Interface` (ETH/USD feed for the ETH leg; xStocks on-chain oracle for the SpaceX leg), computes hypothetical TVL, and `require()`s it clears the shared threshold. *This on-chain read gates the state change → Chainlink track eligibility.*
2. **Permit2 batch pull.** `transferFrom` each solvent signer's committed tokens into the contract (skip insolvent).
3. **Ratio balance.** Run Swap API-generated UniversalRouter calldata to balance token ratios.
4. **Mint.** Run LP API-generated calldata: create the v4 pool if absent, mint **concentrated positions** — one per distinct aggressiveness bucket.
5. **Bookkeeping.** Contract holds the position NFTs and records each signer's share for `withdraw()`.

> Off-chain and pre-block (no state change): Permit2 signing by users, and the backend's REST calls to the Swap/LP APIs to build calldata. All actual liquidity provision happens in the single `execute()` block.

## 5. Track Alignment

### Uniswap — aligned
- **Swap API** (`/quote`, `/swap`) + **LP API** (create pool + mint) with a valid Developer Platform API key, in the core `execute()` path.
- Real **Base Sepolia** `execute()` transaction IDs for submission.

### Chainlink — aligned via on-chain read
- **Price Feeds read on-chain inside `execute()`**, gating the mint = a real on-chain state change (satisfies "Chainlink inside your smart contracts is required"; a frontend-only read would not qualify).
- **No Automation / Functions** (deprecated per track note; use CRE if ever needed).
- **Stretch (bonus, multi-service):** **Proof of Reserves** to verify SPCXx backing before forming the pool.

## 6. Demo Strategy

- **Video (≤ 3 min):** forked **Base mainnet** against the real **ETH / SPCXx** pool. Override the issuer allowlist on the fork (impersonate an allowlisted/admin address) so the full petition → execute → LP flow runs against the genuine pool with the real Uniswap API.
- **Submission tx IDs:** **Base Sepolia** with a mock SPCXx ERC-20 + a pool we create, fed the real SpaceX price. Produces public, verifiable transaction hashes.

## 7. Reference Addresses & Endpoints

> Verify all against official sources during step 1 (these moved/conflicted across community lists).

### SpaceX tokenized stock
- Token `SPCXx` (xStocks / Backed), ERC-20 on Ethereum + Base mainnet: `0x68fa48b1c2fe52b3d776e1953e0e782b5044ce28`
- **To pin:** the live v4 pool address (ETH or USDC pair) + its compliance-hook address (discover via Uniswap API/subgraph on the fork chain).

### xStocks API (public, no auth) — `https://api.xstocks.fi/api/v2`
- `GET /public/assets/SPCX/price-data` — live indicative SpaceX price (backend/TVL display)
- `GET /public/oracles/SPCX` — on-chain Chainlink-based oracle contract addresses per network (for the on-chain TVL read)
- `GET /public/proof-of-reserves/SPCX` — PoR (stretch)

### Uniswap v4 — Base Sepolia (official set; verify on `docs.uniswap.org/contracts/v4/deployments`)
| Contract | Address |
|---|---|
| PoolManager | `0x7Da1D65F8B249183667cdE74C5CBD46dD38AA829` |
| PositionManager | `0xcDbe7b1ed817eF0005ECe6a3e576fbAE2EA5EAFE` |
| UniversalRouter | `0x95273d871c8156636e114b63797d78D7E1720d81` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| StateView | `0x571291b572ed32ce6751a2cb2486ebee8defb9b4` |
| WETH9 | `0x4200000000000000000000000000000000000006` |

### Chainlink — Base Sepolia
- **Price Feeds:** read via `AggregatorV3Interface` at the per-pair proxy (ETH/USD etc.). **To pin:** exact Base Sepolia proxy address from `docs.chain.link`.

## 8. Build Order

1. **Pin addresses.** Base Sepolia v4 set, Chainlink ETH/USD proxy, xStocks oracle for SPCXx, and discover the live SPCXx pool + hook on the fork chain.
2. **Mocks + harness.** `MockERC20` ×2 (incl. mock SPCXx) and a Foundry fork-test harness (Base Sepolia + Base mainnet fork).
3. **`LPPetition` core.** `createPetition` / `sign` (Permit2) / `hypotheticalTVL` (on-chain Chainlink) / `execute` (guarded calldata exec: Permit2 → swap → mint) / `withdraw`. Guard `execute` to whitelisted targets (Permit2, UniversalRouter, PositionManager).
4. **Fork tests.** Prove: on-chain price read → threshold crossed → real v4 concentrated position minted; insolvent-signer skip path.
5. **Backend.** Wire Swap API + LP API; watch petitions; submit `execute()`.
6. **Frontend.** Next.js: sign petition, live TVL progress bar, executed-state with on-chain tx link.
7. **Stretch.** Proof of Reserves; per-user thresholds (sorted clearing algorithm); gas batching for >1-block scale.

## 9. Submission Checklist

- [ ] Real on-chain tx IDs (Base Sepolia `execute()`)
- [ ] Public GitHub repo + clear `README.md`
- [ ] Demo video ≤ 3 min (forked Base mainnet against real SPCXx pool)
- [ ] Uniswap Developer Feedback Form
- [ ] Chainlink used inside the contract for a state change (on-chain price read in `execute()`)
- [ ] Project description explains the Chainlink usage

## 10. Open Questions / Risks

- **Gas ceiling:** pull + swap + mint for N signers must fit one block. Fine for demo (handful of signers); note as production constraint.
- **Concentrated ranges complexity:** distinct aggressiveness levels → multiple mint calls per `execute()`. Biggest complexity adder of the chosen feature set.
- **Pool/hook discovery:** SPCXx pool launched 2026-06-12; may be thinly indexed. Confirm chain (lean Base) and liquidity before committing the fork target.
- **Slippage between calldata build and execution:** handled by min-output limits in the Swap API calldata, not by block timing.
