import { chainlinkAggregatorV3Abi } from "@/lib/contracts/chainlink-aggregator";
import { runtimeConfig } from "@/lib/runtime-config";
import { getBaseSepoliaPublicClient } from "@/lib/web3/public-client";
import { formatUsdFromE18, scaleIntegerPriceToE18 } from "./math";
import type { PriceQuote } from "./types";

export async function fetchEthUsdPrice(): Promise<PriceQuote> {
  const diagnostics: string[] = [];
  const feed = runtimeConfig.contracts.chainlinkEthUsd;
  const sourceUrl = `${runtimeConfig.explorerUrl}/address/${feed}`;

  try {
    const client = getBaseSepoliaPublicClient();
    const [decimals, roundData] = await Promise.all([
      client.readContract({ address: feed, abi: chainlinkAggregatorV3Abi, functionName: "decimals" }),
      client.readContract({ address: feed, abi: chainlinkAggregatorV3Abi, functionName: "latestRoundData" }),
    ]);

    const [roundId, answer, , updatedAt, answeredInRound] = roundData;
    if (answer <= BigInt(0)) diagnostics.push("Chainlink latest answer is non-positive.");
    if (updatedAt === BigInt(0)) diagnostics.push("Chainlink latest round has updatedAt=0.");
    if (answeredInRound < roundId) diagnostics.push("Chainlink answeredInRound is older than roundId.");

    if (diagnostics.length > 0) {
      return unavailableEth(sourceUrl, diagnostics);
    }

    const priceUsdE18 = scaleIntegerPriceToE18(answer, Number(decimals));
    return {
      symbol: "ETH",
      pair: "ETH/USD",
      status: "ok",
      source: "chainlink",
      sourceUrl,
      priceUsd: formatUsdFromE18(priceUsdE18),
      priceUsdE18,
      priceUsdE8: scaleIntegerPriceToE18(answer, Number(decimals) + 10),
      updatedAt: new Date(Number(updatedAt) * 1000).toISOString(),
      diagnostics,
    };
  } catch (error) {
    return unavailableEth(sourceUrl, [error instanceof Error ? error.message : "Unknown Chainlink read error"]);
  }
}

function unavailableEth(sourceUrl: string, diagnostics: string[]): PriceQuote {
  return {
    symbol: "ETH",
    pair: "ETH/USD",
    status: "unavailable",
    source: "unavailable",
    sourceUrl,
    priceUsd: null,
    priceUsdE18: null,
    priceUsdE8: null,
    updatedAt: null,
    diagnostics,
  };
}
