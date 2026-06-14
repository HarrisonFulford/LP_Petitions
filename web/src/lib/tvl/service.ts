import type { CommitmentRecord, PetitionDetail } from "@/lib/petitions/types";
import { formatUsdFromE18 } from "@/lib/prices/math";
import { getPrices } from "@/lib/prices/service";
import type { PriceQuote } from "@/lib/prices/types";
import type { PetitionTvl, TvlCommitmentContribution } from "./types";

const TOKEN_UNIT_E18 = BigInt("1000000000000000000");

export class TvlUnavailableError extends Error {
  constructor(
    message: string,
    readonly diagnostics: string[],
  ) {
    super(message);
    this.name = "TvlUnavailableError";
  }
}

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase();
}

function priceForSymbol(symbol: string, prices: Awaited<ReturnType<typeof getPrices>>) {
  const normalized = normalizeSymbol(symbol);
  if (normalized === "WETH" || normalized === "ETH") return prices.ethUsd;
  if (normalized === "NVDA" || normalized === "NVDAX") {
    return prices.nvdaUsd;
  }
  throw new TvlUnavailableError(`No price mapping configured for ${symbol}`, [
    "F5a only supports the MVP NVDA/WETH pair.",
  ]);
}

function requirePrice(symbol: string, quote: PriceQuote) {
  if (quote.status !== "ok" || !quote.priceUsdE18) {
    throw new TvlUnavailableError(`${symbol} price is unavailable`, quote.diagnostics);
  }
}

function commitmentLegUsd(amount: string, priceUsdE18: string) {
  return ((BigInt(amount) * BigInt(priceUsdE18)) / TOKEN_UNIT_E18).toString();
}

function contributionForCommitment(
  commitment: CommitmentRecord,
  token0PriceUsdE18: string,
  token1PriceUsdE18: string,
): TvlCommitmentContribution {
  const token0UsdE18 = commitmentLegUsd(commitment.amount0, token0PriceUsdE18);
  const token1UsdE18 = commitmentLegUsd(commitment.amount1, token1PriceUsdE18);
  const totalUsdE18 = (BigInt(token0UsdE18) + BigInt(token1UsdE18)).toString();

  return {
    signer: commitment.signer,
    amount0: commitment.amount0,
    amount1: commitment.amount1,
    token0UsdE18,
    token1UsdE18,
    totalUsdE18,
    orderIndex: commitment.orderIndex,
  };
}

function progressBps(totalUsdE18: string, thresholdUsdE18: string) {
  const threshold = BigInt(thresholdUsdE18);
  if (threshold === BigInt(0)) return { raw: "0", capped: 0 };
  const raw = ((BigInt(totalUsdE18) * BigInt(10_000)) / threshold).toString();
  const capped = Number(BigInt(raw) > BigInt(10_000) ? BigInt(10_000) : BigInt(raw));
  return { raw, capped };
}

export async function computePetitionTvl(detail: PetitionDetail): Promise<PetitionTvl> {
  const { petition, commitments } = detail;
  const prices = await getPrices();
  const token0Price = priceForSymbol(petition.token0Symbol, prices);
  const token1Price = priceForSymbol(petition.token1Symbol, prices);

  requirePrice(petition.token0Symbol, token0Price);
  requirePrice(petition.token1Symbol, token1Price);

  const contributionRows = commitments.map((commitment) =>
    contributionForCommitment(commitment, token0Price.priceUsdE18!, token1Price.priceUsdE18!),
  );
  const totalUsdE18 = contributionRows
    .reduce((sum, row) => sum + BigInt(row.totalUsdE18), BigInt(0))
    .toString();
  const progress = progressBps(totalUsdE18, petition.thresholdUsdE18);

  return {
    petitionId: petition.id,
    contractPetitionId: petition.contractPetitionId,
    pair: `${petition.token0Symbol}/${petition.token1Symbol}`,
    token0Symbol: petition.token0Symbol,
    token1Symbol: petition.token1Symbol,
    tokenDecimals: {
      token0: 18,
      token1: 18,
    },
    thresholdUsdE18: petition.thresholdUsdE18,
    totalUsdE18,
    totalUsdFormatted: formatUsdFromE18(totalUsdE18) ?? "0.00",
    progressBps: progress.capped,
    rawProgressBps: progress.raw,
    isThresholdMet: BigInt(totalUsdE18) >= BigInt(petition.thresholdUsdE18),
    commitmentCount: commitments.length,
    prices: {
      token0: token0Price,
      token1: token1Price,
    },
    commitments: contributionRows,
    notes: [
      "F5a assumes both MVP tokens use 18 decimals: mock NVDA and WETH.",
      "This backend/UI TVL is a mirror for display and trigger heuristics; the contract remains the final authority.",
      "F6 can reuse this output to decide when to attempt execute(), but execute() must re-check TVL on-chain.",
    ],
  };
}
