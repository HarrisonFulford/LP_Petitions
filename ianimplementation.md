# Ian Implementation Spec — LP Petitions MVP

> This is Ian's proposed implementation spec for the ETHGlobal NYC 2026 hackathon build. It is intentionally separate from Harrison's `implementation_plan.md`; do not edit, overwrite, or treat that file as superseded until both plans are committed, pushed, and compared together.

## 0. Executive Summary

LP Petitions coordinates liquidity formation for tokenized assets before a Uniswap pool has meaningful liquidity.

For the MVP, users join **SPCX / USDC** petitions on **Unichain Sepolia** by holding real mock `SPCX` and mock `USDC`, approving those tokens to Permit2, and signing a gasless commitment. The app stores commitments in first-in order. When the ordered commitments cross a Chainlink-priced target TVL, the petition freezes and a backend/demo executor submits one execution transaction. The smart contract independently verifies the Chainlink SPCX price, recomputes TVL, pulls tokens from contributors, creates the initial Uniswap v4 SPCX/USDC pool, mints a petition-owned LP position, and records internal pro-rata contributor shares.

Primary sponsor story:

- **Uniswap:** the project creates real Uniswap v4 liquidity for a tokenized asset market.
- **Chainlink:** Chainlink tokenized-asset pricing is used inside the smart contract to gate an onchain state change.
- **Product:** contributors only become LPs once enough other contributors are ready too.

## 1. Locked MVP Decisions

### 1.1 Chain / DEX / Assets

- Chain: **Unichain Sepolia**.
- DEX: **Uniswap v4**.
- Token pair: **mock SPCX / mock USDC**.
- SPCX is a hackathon demo token representing tokenized SpaceX exposure.
- Do not add TSLA, arbitrary assets, arbitrary token pairs, or multi-chain support in MVP.

### 1.2 Chainlink Use

- Chainlink is the source of truth for **SPCX/USD** valuation.
- Required MVP path: backend fetches an official Chainlink Data Streams / SmartData / DataLink signed report for SPCX/tSpaceX; the smart contract verifies that report onchain through the official Chainlink verifier and uses the decoded price in execution.
- Local tests may use a mock Chainlink-compatible verifier/oracle, but the demo/prize path must not silently fall back to a fake price.
- No Chainlink CRE requirement for MVP.
- No Chainlink Automation or Functions.
- Contract checks: correct feed id, positive price, non-expired report, acceptable timestamp freshness.

### 1.3 Petition Mechanics

- Multiple petitions are allowed, but all are SPCX/USDC.
- Each petition chooses:
  - target TVL in USD terms;
  - fee tier preset;
  - range preset.
- Fee tiers:
  - `0.05%` = `500` pips, standard tick spacing `10`;
  - `0.3%` = `3000` pips, standard tick spacing `60`; default;
  - `1%` = `10000` pips, standard tick spacing `200`.
- Range presets around Chainlink SPCX/USD price:
  - Aggressive: `±5%`;
  - Balanced: `±10%`; default;
  - Conservative: `±25%`.
- Users commit **both USDC and SPCX** together.
- Target TVL is a minimum threshold, not a hard cap.
- Overshoot is allowed; the commitment that crosses the threshold is included in full.
- Backend enforces first-in, first-executed ordering.
- Once threshold is crossed, the petition freezes; further contributions are blocked.
- No cancellation UI.
- No user-facing expiry/deadline feature. Permit2 may require technical deadlines; hide them from UX and set safe demo deadlines as implementation detail.

### 1.4 LP Ownership

- The petition contract owns the final Uniswap v4 LP position.
- MVP uses internal pro-rata share accounting only.
- No receipt ERC-20/ERC-721.
- No withdrawal or fee-claim UI for MVP.
- UI should show contributor shares after execution as proof of ownership accounting.

### 1.5 Team Delegation

- **Harrison:** Solidity contracts, Permit2, Chainlink verification, Uniswap v4 execution, Foundry tests, deployment scripts.
- **Ian:** Next.js frontend, backend/API routes, signature collection/storage, demo executor service, wallet UX, demo flow, README/demo polish.
- **Shared:** ABI boundaries, event schema, deployed addresses, demo script, final reconciliation of Ian/Harrison implementation specs.

## 2. System Architecture

```text
User wallet
  ├─ approves mock USDC -> Permit2
  ├─ approves mock SPCX -> Permit2
  └─ signs EIP-712/Permit2 commitment
        │
        ▼
Next.js app + API routes
  ├─ stores petition records
  ├─ stores ordered commitments
  ├─ fetches Chainlink SPCX report/price for display + execution payload
  ├─ computes estimated progress
  ├─ freezes petition when threshold is crossed
  └─ executor submits executePetition(...)
        │
        ▼
LPPetitionManager.sol
  ├─ verifies Chainlink SPCX report onchain
  ├─ recomputes TVL from submitted commitments
  ├─ verifies commitments / Permit2 permissions
  ├─ pulls contributor USDC + SPCX
  ├─ initializes Uniswap v4 SPCX/USDC pool if needed
  ├─ mints petition-owned LP position
  └─ records contributor shares + emits proof events
        │
        ▼
Unichain Sepolia explorer + Uniswap v4 contracts
```

## 3. Contract Interface Spec — Harrison-Owned

Contract name: `LPPetitionManager`.

### 3.1 Enums / Structs

```solidity
enum PetitionStatus {
    Open,
    Frozen,
    Executed,
    Failed
}

enum RangePreset {
    Aggressive,
    Balanced,
    Conservative
}

struct Petition {
    address creator;
    uint256 thresholdUsdE18;
    uint24 feeTier;
    int24 tickSpacing;
    RangePreset rangePreset;
    PetitionStatus status;
    uint256 totalUsdc;
    uint256 totalSpcx;
    uint256 totalUsdE18;
    bytes32 poolId;
    uint256 positionTokenId;
}

struct Commitment {
    uint256 petitionId;
    address contributor;
    uint256 usdcAmount;
    uint256 spcxAmount;
    uint256 nonce;
}

struct PermitPayload {
    bytes permitData;
    bytes signature;
}

struct UniswapV4ExecutionParams {
    uint160 sqrtPriceX96;
    int24 tickLower;
    int24 tickUpper;
    bytes positionManagerCalldata;
}
```

Implementation may refine struct layout for actual Permit2/v4 libraries, but the public semantics above must remain stable for frontend/backend integration.

### 3.2 Functions

```solidity
function createPetition(
    uint256 thresholdUsdE18,
    uint24 feeTier,
    RangePreset rangePreset
) external returns (uint256 petitionId);
```

Creates an onchain petition record used for final execution and event proof. The frontend/backend may create a matching offchain record for UI state.

```solidity
function executePetition(
    uint256 petitionId,
    Commitment[] calldata commitments,
    PermitPayload[] calldata permits,
    bytes calldata chainlinkReport,
    UniswapV4ExecutionParams calldata uniswapParams
) external;
```

Executes the frozen petition. Any caller may submit, but the demo backend is the normal caller. The caller is not trusted: the contract verifies Chainlink price, threshold, token pair, fee tier, range, signatures, and transfers.

Read functions:

```solidity
function getPetition(uint256 petitionId) external view returns (Petition memory);
function getContributorShare(uint256 petitionId, address contributor) external view returns (uint256 shareBps);
function getContributorAmounts(uint256 petitionId, address contributor) external view returns (uint256 usdcAmount, uint256 spcxAmount);
```

### 3.3 Events

```solidity
event PetitionCreated(
    uint256 indexed petitionId,
    address indexed creator,
    uint256 thresholdUsdE18,
    uint24 feeTier,
    int24 tickSpacing,
    RangePreset rangePreset
);

event ChainlinkPriceVerified(
    uint256 indexed petitionId,
    bytes32 indexed feedId,
    uint256 priceE18,
    uint256 reportTimestamp
);

event ContributorRecorded(
    uint256 indexed petitionId,
    address indexed contributor,
    uint256 usdcAmount,
    uint256 spcxAmount,
    uint256 shareBps
);

event PetitionExecuted(
    uint256 indexed petitionId,
    uint256 totalUsdE18,
    uint256 totalUsdc,
    uint256 totalSpcx,
    bytes32 poolId,
    uint256 positionTokenId,
    bytes32 txProofHash
);
```

### 3.4 Contract Validation Rules

Execution must revert if:

- petition does not exist;
- petition has already executed;
- fee tier is not one of `500`, `3000`, `10000`;
- Chainlink report fails verifier check;
- Chainlink feed id is not the configured SPCX/tSpaceX feed id;
- Chainlink price is zero/negative;
- Chainlink report is expired or too stale;
- submitted commitments do not reach threshold;
- commitment contributor, amounts, petition id, nonce, chain id, or verifying contract do not match signed data;
- Permit2 token pull fails for any included contributor;
- Uniswap params use wrong tokens, wrong fee tier, wrong tick spacing, unsupported hook, or ticks inconsistent with selected range preset;
- v4 position would be owned by any address other than the petition contract.

For MVP, do not implement insolvent-signer skipping. If an included commitment cannot be pulled, revert the transaction. This is simpler and fairer for the ordered execution model.

## 4. Backend/API Spec — Ian-Owned

Recommended stack: **Next.js full-stack app** with TypeScript, viem/wagmi, and local SQLite via `better-sqlite3` or Prisma SQLite. If setup time is tight, JSON file storage is acceptable for the demo, but SQLite is preferred because ordered writes and refresh persistence matter.

### 4.1 Data Model

Petition record:

```ts
type PetitionRecord = {
  id: string;
  onchainPetitionId?: string;
  title: string;
  targetUsd: string;
  feeTier: 500 | 3000 | 10000;
  tickSpacing: 10 | 60 | 200;
  rangePreset: 'aggressive' | 'balanced' | 'conservative';
  status: 'open' | 'frozen' | 'executing' | 'executed' | 'failed';
  createdBy: `0x${string}`;
  createdAt: string;
  frozenAt?: string;
  executedAt?: string;
  executeTxHash?: `0x${string}`;
};
```

Commitment record:

```ts
type CommitmentRecord = {
  id: string;
  petitionId: string;
  sequence: number;
  contributor: `0x${string}`;
  usdcAmountRaw: string;
  spcxAmountRaw: string;
  estimatedUsdE18: string;
  typedData: unknown;
  signature: `0x${string}`;
  permitPayload?: unknown;
  createdAt: string;
  includedInExecution: boolean;
};
```

Config record:

```ts
type RuntimeConfig = {
  chainId: 1301;
  rpcUrl: string;
  explorerBaseUrl: string;
  mockUsdcAddress: `0x${string}`;
  mockSpcxAddress: `0x${string}`;
  permit2Address: `0x${string}`;
  petitionManagerAddress: `0x${string}`;
  uniswapPoolManagerAddress: `0x${string}`;
  uniswapPositionManagerAddress: `0x${string}`;
  chainlinkVerifierAddress: `0x${string}`;
  chainlinkSpcxFeedId: `0x${string}`;
};
```

### 4.2 API Routes

```http
GET /api/config
```
Returns runtime addresses, allowed fee tiers, range presets, chain id, and explorer URLs.

```http
GET /api/petitions
POST /api/petitions
```
Lists and creates petitions. Creation validates fee tier/range preset and creates the matching onchain petition if contract is deployed; otherwise local-only creation is allowed during frontend scaffolding, with integration phase replacing it.

```http
GET /api/petitions/:id
```
Returns petition details, commitments, progress, Chainlink price snapshot, and execution status.

```http
POST /api/petitions/:id/commitments
```
Validates connected-wallet signature, rejects closed/frozen petitions, assigns next sequence, stores the commitment, recomputes progress, and freezes if threshold crossed.

```http
GET /api/chainlink/spcx-price
```
Fetches current Chainlink SPCX/tSpaceX report for display. Must expose source, timestamp, decoded price, and whether report is executable.

```http
POST /api/petitions/:id/execute
```
Executor-only route. Builds ordered execution batch, fetches current Chainlink report, prepares Uniswap v4 params, submits `executePetition`, stores tx hash, and updates status.

### 4.3 Backend Rules

- One active commitment per wallet per petition. Before freeze, a new commitment from the same wallet replaces the old one and keeps the original sequence if feasible; if not feasible, remove the old row and append the new row with a new sequence. The UI should discourage duplicate commits.
- Freeze uses ordered commitments from lowest sequence upward until threshold is crossed.
- If freeze happens, mark exactly those commitments as `includedInExecution = true`.
- Reject new commitments after freeze.
- Backend progress is only an estimate; contract is final authority.
- Executor private key must live only in server env vars, never frontend.
- API must never trust client-supplied TVL or Chainlink price.

## 5. Frontend Spec — Ian-Owned

### 5.1 Main Screens

1. **Petition list**
   - Shows all SPCX/USDC petitions.
   - Displays target liquidity, progress, status, fee tier, range preset.
   - CTA: create petition or open existing petition.

2. **Create petition**
   - Inputs: title, target TVL, fee tier, range preset.
   - Shows current Chainlink SPCX price.
   - Explains fee tier and range tradeoffs simply.

3. **Petition detail**
   - Shows progress bar toward target.
   - Shows ordered contributor list.
   - Shows Chainlink price card with timestamp/source.
   - Shows contribution form for USDC + SPCX.
   - Shows wallet approval/signing state.
   - Shows frozen/executing/executed state.

4. **Executed proof panel**
   - Shows execution tx link on Unichain explorer.
   - Shows final pool/position identifiers.
   - Shows contributor pro-rata shares.
   - Includes copy for sponsor story: Chainlink-gated TVL + Uniswap v4 liquidity creation.

### 5.2 Wallet Flow

- Connect wallet on Unichain Sepolia.
- If wrong network, prompt network switch.
- Check USDC allowance to Permit2.
- Check SPCX allowance to Permit2.
- If needed, user sends approval txs.
- User signs commitment typed data.
- Backend verifies and stores signature.
- UI refreshes progress.

For live demo speed, Ian/Harrison can pre-approve demo wallets and show only the signature path, but the UI should still support approval prompts.

### 5.3 UX Copy Rules

Use plain-language explanations:

- “Target Liquidity” instead of overloading “TVL” everywhere.
- “Chainlink SPCX price” with timestamp.
- “This petition launches once committed USDC + SPCX value reaches the target.”
- “SPCX is a hackathon demo token representing tokenized SpaceX exposure.”
- “The final LP position is held by the petition contract; contributors are tracked pro-rata.”

## 6. Phases, Sub-Phases, Owners, Commits

Every sub-phase below should be one intentional commit unless the diff is trivial enough to combine with an adjacent documentation-only commit. Avoid 1000+ LOC feature commits.

### Phase 0 — Branch + Planning Artifact

Owner: Ian.

Skills/tools:

- `superpowers:writing-plans`
- Git/GitHub local workflow

Tasks:

1. Checkout `jaja`.
2. Do not edit `implementation_plan.md`.
3. Create `ianimplementation.md`.
4. Commit and push only `ianimplementation.md`.
5. After push, compare Ian/Harrison plans separately.

Commit:

```bash
git add ianimplementation.md
git commit -m "docs: add Ian implementation spec"
git push origin jaja
```

### Phase 1 — Address + Sponsor Feasibility Pinning

Owner: Shared, Harrison leads Chainlink/Uniswap contract addresses; Ian records app config.

Skills/tools:

- Official Uniswap docs
- Official Chainlink docs
- ETHGlobal sponsor booth if docs are unclear

Tasks:

1. Pin Unichain Sepolia RPC/explorer.
2. Pin Uniswap v4 PoolManager, PositionManager, StateView, Permit2 addresses.
3. Pin Chainlink verifier address and SPCX/tSpaceX feed/report id.
4. Confirm Data Streams report can be verified from Unichain Sepolia.
5. Record all addresses in one runtime config file.

Commit examples:

```bash
git commit -m "docs: pin Unichain and oracle integration assumptions"
git commit -m "deploy: add runtime address config"
```

Stop condition:

- If official Chainlink SPCX/tSpaceX verification is not available on Unichain Sepolia, stop and ask Ian/Harrison. Do not replace it with a fake oracle for the main demo without explicit agreement.

### Phase 2 — Contract Scaffold + Mock Tokens

Owner: Harrison.

Skills/tools:

- `superpowers:test-driven-development`
- Foundry
- OpenZeppelin ERC20
- Uniswap v4 dependencies

Sub-phases / commits:

1. `contracts: scaffold foundry project`
2. `contracts: add mock USDC and SPCX tokens`
3. `contracts: add Unichain Sepolia deploy config`
4. `contracts: script demo token minting`

Acceptance:

- `forge test` exits 0.
- Mock USDC uses 6 decimals.
- Mock SPCX uses 18 decimals unless Chainlink/product docs require otherwise.
- Demo wallets can receive both tokens.

### Phase 3 — Petition Core + Chainlink TVL

Owner: Harrison.

Skills/tools:

- Chainlink Data Streams onchain verification docs
- Foundry tests
- `superpowers:test-driven-development`

Sub-phases / commits:

1. `contracts: add petition lifecycle model`
2. `contracts: verify Chainlink SPCX report`
3. `contracts: compute Chainlink-priced petition TVL`
4. `contracts: gate execution by target liquidity`

Acceptance:

- Tests pass for valid report.
- Tests reject wrong feed id.
- Tests reject expired/stale report.
- Tests reject zero/negative price.
- Tests reject below-threshold batch.
- Tests accept threshold-crossing batch.

### Phase 4 — Permit2 Commitments + Contributor Shares

Owner: Harrison, with Ian aligning typed-data payloads.

Skills/tools:

- Permit2 docs
- Foundry tests
- viem typed-data helpers for frontend parity

Sub-phases / commits:

1. `contracts: add commitment typed data schema`
2. `contracts: verify Permit2 contribution signatures`
3. `contracts: pull committed tokens at execution`
4. `contracts: record contributor shares`

Acceptance:

- Invalid signer rejected.
- Wrong petition id rejected.
- Wrong chain id / verifying contract rejected.
- Replayed nonce rejected if nonce tracking is implemented.
- Included contributor token pull succeeds.
- Failed token pull reverts whole execution.
- Shares are deterministic and visible via read functions/events.

### Phase 5 — Uniswap v4 Pool + LP Execution

Owner: Harrison, Ian supports with SDK/API param construction.

Skills/tools:

- Uniswap v4 PoolManager/PositionManager docs
- Uniswap API/SDK
- Foundry integration/fork tests

Sub-phases / commits:

1. `contracts: validate SPCX USDC v4 pool key`
2. `contracts: derive initial pool price from Chainlink`
3. `contracts: validate fee tier and tick spacing`
4. `contracts: validate range preset ticks`
5. `contracts: initialize v4 pool and mint LP position`
6. `contracts: emit execution proof events`

Acceptance:

- Pool key only allows mock SPCX/mock USDC.
- Fee tier only allows 500, 3000, 10000.
- Ticks round to valid tick spacing.
- Initial `sqrtPriceX96` is compatible with Chainlink-derived SPCX/USDC price.
- LP position owner is the petition contract.
- Execution emits Chainlink + contributor + Uniswap proof events.

### Phase 6 — Next.js Backend/API

Owner: Ian.

Skills/tools:

- `build-web-apps:frontend-app-builder`
- Next.js API routes
- SQLite or JSON-file fallback
- viem

Sub-phases / commits:

1. `app: scaffold Next.js project`
2. `backend: add runtime config endpoint`
3. `backend: add petition storage`
4. `backend: add ordered commitment storage`
5. `backend: verify commitment signatures`
6. `backend: add Chainlink price/report fetcher`
7. `backend: freeze petitions at target liquidity`
8. `backend: add executor route`

Acceptance:

- App starts locally.
- API can create/list petitions.
- Commitments persist across refresh/restart.
- Commitment ordering is stable.
- Backend rejects commitments after freeze.
- Executor route submits or simulates payload in local dev.
- No executor private key is exposed client-side.

### Phase 7 — Frontend UX

Owner: Ian.

Skills/tools:

- `build-web-apps:frontend-testing-debugging`
- Browser plugin for local verification
- wagmi/viem
- optional design skills only when polishing UI

Sub-phases / commits:

1. `frontend: add app shell and petition list`
2. `frontend: add create petition form`
3. `frontend: add fee tier selector`
4. `frontend: add range preset selector`
5. `frontend: add Chainlink price card`
6. `frontend: add wallet connection and network guard`
7. `frontend: add token approval flow`
8. `frontend: add commitment signing flow`
9. `frontend: add progress and freeze states`
10. `frontend: add execution proof panel`

Acceptance:

- User can create a petition.
- User can select 0.05%, 0.3%, or 1% fee tier.
- User can select Aggressive/Balanced/Conservative range.
- User can connect wallet, approve tokens, sign commitment.
- Progress updates after commitment.
- Frozen state blocks further contribution.
- Executed state links to explorer and shows shares.

### Phase 8 — End-to-End Integration + Demo

Owner: Shared.

Skills/tools:

- `superpowers:verification-before-completion`
- Foundry scripts
- Browser plugin
- Unichain explorer

Sub-phases / commits:

1. `deploy: deploy mock tokens and petition contract`
2. `deploy: mint demo balances`
3. `integration: connect app to deployed contracts`
4. `integration: execute SPCX USDC petition end to end`
5. `demo: add walkthrough and submission notes`
6. `docs: update README with sponsor integrations and tx links`

Acceptance:

- Real Unichain Sepolia contract addresses are recorded.
- Demo wallets hold real mock USDC/SPCX.
- At least one real commitment signature is stored.
- At least one real execution tx creates or attempts the Uniswap v4 LP path.
- README includes tx hash, Chainlink usage, Uniswap usage, and 3-minute demo instructions.

## 7. Commit Discipline

- One sub-phase equals one commit by default.
- Do not mix Harrison contract work and Ian frontend/backend work in one commit unless it is an integration commit.
- Do not stage unrelated files.
- Prefer explicit `git add <file>` over `git add -A`.
- Commit prefixes:
  - `docs:`
  - `contracts:`
  - `backend:`
  - `frontend:`
  - `integration:`
  - `deploy:`
  - `demo:`
- Run the relevant check before each commit:
  - contracts: `forge test`;
  - backend/frontend: `npm run typecheck` and targeted tests if present;
  - UI changes: browser smoke test;
  - docs-only: inspect `git diff --check` and the rendered Markdown if possible.
- Keep diffs reviewable. Avoid 1000+ LOC feature commits unless lockfiles or generated ABI artifacts force it.
- Pull/rebase from `jaja` frequently during the hackathon.

## 8. Testing Matrix

### Contract Tests

- create petition with each supported fee tier;
- reject unsupported fee tier;
- create petition with each range preset;
- verify valid Chainlink report;
- reject wrong feed id;
- reject expired/stale report;
- reject zero/negative price;
- compute TVL using USDC + SPCX price;
- reject below-threshold execution;
- accept threshold-crossing execution;
- include overshoot fully;
- reject invalid commitment signature;
- reject wrong petition id;
- reject wrong verifying contract/chain id;
- pull USDC and SPCX through Permit2;
- create/initialize v4 pool;
- mint LP position owned by petition contract;
- record contributor shares;
- emit proof events.

### Backend Tests

- create petition;
- list petitions;
- get petition detail;
- insert commitments in order;
- reject commitment after freeze;
- replace duplicate wallet commitment before freeze according to backend rule;
- compute progress from latest Chainlink price;
- freeze when threshold crossed;
- select ordered execution batch including overshoot;
- executor route records tx hash/status;
- executor route never accepts client-supplied price as authority.

### Frontend / Manual Tests

- wrong network prompt;
- wallet connect;
- token balances visible;
- USDC approval;
- SPCX approval;
- commitment signature;
- progress update;
- frozen state;
- executed state;
- explorer link opens;
- refresh preserves state;
- 3-minute demo path can be completed without explaining hidden internals.

## 9. Demo Script Skeleton

Target length: 3 minutes.

1. Problem: tokenized assets need liquidity, but early LPs do not want to commit alone.
2. Create SPCX/USDC petition with target liquidity, fee tier, and range preset.
3. Show Chainlink SPCX price powering the target liquidity calculation.
4. Wallet signs a commitment after token approvals.
5. Progress crosses target; petition freezes.
6. Executor submits execution.
7. Contract verifies Chainlink price, pulls tokens, creates Uniswap v4 pool/position.
8. Show explorer tx and contributor share panel.
9. Close: Chainlink prices tokenized assets; Uniswap creates liquidity; LP Petitions coordinates capital formation.

## 10. External Source Anchors

Use these as implementation references, not copied code:

- Uniswap Unichain overview: `https://developers.uniswap.org/docs/unichain`
- Uniswap Unichain contract addresses: `https://developers.uniswap.org/docs/unichain/technical-information/contract-addresses`
- Uniswap v4 deployments: `https://developers.uniswap.org/docs/protocols/v4/deployments`
- Uniswap create pool on Unichain: `https://developers.uniswap.org/docs/unichain/guides/create-a-pool`
- Chainlink Data Streams: `https://docs.chain.link/data-streams`
- Chainlink onchain report verification: `https://docs.chain.link/data-streams/tutorials/evm-onchain-report-verification`
- Chainlink SmartData: `https://docs.chain.link/data-feeds/smartdata`
- ETHGlobal Chainlink prize requirements: `https://ethglobal.com/events/newyork2026/prizes#chainlink`

## 11. Known Risks / Stop Conditions

1. **Chainlink feed availability on Unichain Sepolia**
   - Risk: official SPCX/tSpaceX report verification may not be directly available on Unichain Sepolia.
   - Rule: stop and ask Ian/Harrison/sponsor before changing network or using mock oracle for demo.

2. **Uniswap v4 integration complexity**
   - Risk: PositionManager calldata construction may take longer than expected.
   - Rule: keep contract adapter isolated so SDK/API-generated params can evolve without changing petition/accounting logic.

3. **Permit2 schema complexity**
   - Risk: exact Permit2 payload may require deadlines/nonces despite no UX expiry feature.
   - Rule: include technical deadline/nonce if required, but do not expose cancellation/deadline UX.

4. **Gas limits for large signer sets**
   - Risk: one tx with many commitments may be too expensive.
   - Rule: MVP targets small demo batches; production batching is future work.

5. **Fairness trust boundary**
   - Risk: backend ordering is not fully trustless.
   - Rule: for MVP, backend first-in ordering is accepted; contract remains the fund/threshold trust boundary.

## 12. Definition of Done

The MVP is done when:

- `jaja` contains Ian's spec and Harrison's plan separately;
- mock USDC and SPCX are deployed/mintable on Unichain Sepolia;
- Chainlink SPCX price/report is used in the contract execution path;
- users can approve tokens and sign commitments from the app;
- backend stores ordered commitments and freezes at threshold;
- execution transaction pulls real mock tokens and creates/mints Uniswap v4 liquidity;
- frontend shows progress, execution proof, tx link, and contributor shares;
- README explains Uniswap and Chainlink integrations clearly;
- demo video path can be completed within 3 minutes;
- commits are small, named, and grouped by sub-phase.
