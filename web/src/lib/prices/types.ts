export type PriceStatus = "ok" | "unavailable";

export type PriceSource =
  | "chainlink"
  | "xstocks-price-data"
  | "xstocks-quote-assets"
  | "coingecko"
  | "env-fallback"
  | "unavailable";

export type PriceQuote = {
  symbol: string;
  pair: string;
  status: PriceStatus;
  source: PriceSource;
  sourceUrl: string | null;
  priceUsd: string | null;
  priceUsdE18: string | null;
  priceUsdE8: string | null;
  updatedAt: string | null;
  diagnostics: string[];
};

export type PricesResponse = {
  chainId: number;
  fetchedAt: string;
  ethUsd: PriceQuote;
  spcxUsd: PriceQuote;
  notes: string[];
};
