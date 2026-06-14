import { runtimeConfig } from "@/lib/runtime-config";
import { fetchEthUsdPrice } from "./chainlink";
import { fetchNvdaUsdPrice } from "./xstocks";
import type { PricesResponse } from "./types";

export async function getPrices(): Promise<PricesResponse> {
  const [ethUsd, nvdaUsd] = await Promise.all([fetchEthUsdPrice(), fetchNvdaUsdPrice()]);

  return {
    chainId: runtimeConfig.chainId,
    fetchedAt: new Date().toISOString(),
    ethUsd,
    nvdaUsd,
    notes: [
      "Prices are fetched server-side only; clients never submit trusted prices.",
      "ETH/USD comes from the Base Sepolia Chainlink feed configured in runtimeConfig.",
      "NVDA/USD uses official xStocks/Backed endpoints only; an explicit server-side demo fallback can seed the mock oracle when live xStocks quotes are null/closed.",
      "priceUsdE8 is ready to seed the mock AggregatorV3 answer once the mock aggregator deployment is available.",
    ],
  };
}
