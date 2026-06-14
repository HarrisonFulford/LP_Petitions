import { decimalUsdToE18, decimalUsdToE8 } from "./math";
import type { PriceQuote } from "./types";

const DEFAULT_PRICE_DATA_URL = "https://api.backed.fi/api/v2/public/assets/SPCXx/price-data";
const DEFAULT_QUOTES_ASSETS_URL = "https://api.xstocks.fi/api/v1/quotes/assets?pageSize=100";
const DEFAULT_COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=spacex-xstocks&vs_currencies=usd&include_last_updated_at=true";

function positiveNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function quoteFromDecimal({
  diagnostics,
  price,
  source,
  sourceUrl,
  updatedAt = null,
}: {
  diagnostics: string[];
  price: number;
  source: PriceQuote["source"];
  sourceUrl: string | null;
  updatedAt?: string | null;
}): PriceQuote {
  const priceText = price.toString();
  return {
    symbol: "SPCXx",
    pair: "SPCX/USD",
    status: "ok",
    source,
    sourceUrl,
    priceUsd: priceText,
    priceUsdE18: decimalUsdToE18(priceText),
    priceUsdE8: decimalUsdToE8(priceText),
    updatedAt,
    diagnostics,
  };
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { response, body };
}

async function tryBackedPriceData(diagnostics: string[]) {
  const sourceUrl = process.env.XSTOCKS_SPCX_PRICE_URL || DEFAULT_PRICE_DATA_URL;
  try {
    const { response, body } = await fetchJson(sourceUrl);
    if (!response.ok) {
      diagnostics.push(`Backed price-data returned HTTP ${response.status}.`);
      return null;
    }
    const quote = positiveNumber((body as { quote?: unknown } | null)?.quote);
    if (!quote) {
      diagnostics.push("Backed price-data returned no positive quote for SPCXx.");
      return null;
    }
    return quoteFromDecimal({ diagnostics, price: quote, source: "xstocks-price-data", sourceUrl });
  } catch (error) {
    diagnostics.push(`Backed price-data error: ${error instanceof Error ? error.message : "unknown error"}.`);
    return null;
  }
}

async function tryXstocksQuoteAssets(diagnostics: string[]) {
  const sourceUrl = process.env.XSTOCKS_QUOTES_ASSETS_URL || DEFAULT_QUOTES_ASSETS_URL;
  try {
    const { response, body } = await fetchJson(sourceUrl);
    if (!response.ok) {
      diagnostics.push(`xStocks quote-assets returned HTTP ${response.status}.`);
      return null;
    }
    const assets = (body as { assets?: Array<Record<string, unknown>> } | null)?.assets ?? [];
    const spcx = assets.find(
      (asset) => asset.symbol === "SPCXx" || asset.underlyingSymbol === "SPCX",
    );
    if (!spcx) {
      diagnostics.push("xStocks quote-assets did not include SPCXx/SPCX.");
      return null;
    }
    const bid = positiveNumber(spcx.bid);
    const ask = positiveNumber(spcx.ask);
    if (!bid || !ask) {
      diagnostics.push(
        `xStocks quote-assets found SPCXx but bid/ask unavailable (canQuote=${String(
          spcx.canQuote,
        )}, period=${String((spcx.limitsPerPeriod as { currentPeriod?: unknown } | undefined)?.currentPeriod)}).`,
      );
      return null;
    }
    return quoteFromDecimal({
      diagnostics,
      price: (bid + ask) / 2,
      source: "xstocks-quote-assets",
      sourceUrl,
    });
  } catch (error) {
    diagnostics.push(`xStocks quote-assets error: ${error instanceof Error ? error.message : "unknown error"}.`);
    return null;
  }
}

async function tryCoingecko(diagnostics: string[]) {
  const sourceUrl = process.env.COINGECKO_SPCX_PRICE_URL || DEFAULT_COINGECKO_URL;
  try {
    const { response, body } = await fetchJson(sourceUrl);
    if (!response.ok) {
      diagnostics.push(`CoinGecko fallback returned HTTP ${response.status}.`);
      return null;
    }
    const payload = body as { "spacex-xstocks"?: { usd?: unknown; last_updated_at?: unknown } } | null;
    const price = positiveNumber(payload?.["spacex-xstocks"]?.usd);
    if (!price) {
      diagnostics.push("CoinGecko fallback returned no positive SPCXx price.");
      return null;
    }
    const updatedAtRaw = payload?.["spacex-xstocks"]?.last_updated_at;
    const updatedAt =
      typeof updatedAtRaw === "number" ? new Date(updatedAtRaw * 1000).toISOString() : null;
    diagnostics.push("Using CoinGecko SPCXx fallback because xStocks quote is unavailable.");
    return quoteFromDecimal({ diagnostics, price, source: "coingecko", sourceUrl, updatedAt });
  } catch (error) {
    diagnostics.push(`CoinGecko fallback error: ${error instanceof Error ? error.message : "unknown error"}.`);
    return null;
  }
}

function tryEnvFallback(diagnostics: string[]) {
  const fallback = process.env.SPCX_USD_FALLBACK_PRICE;
  const price = positiveNumber(fallback ? Number(fallback) : null);
  if (!price) return null;
  diagnostics.push("Using server-configured SPCX_USD_FALLBACK_PRICE.");
  return quoteFromDecimal({
    diagnostics,
    price,
    source: "env-fallback",
    sourceUrl: null,
    updatedAt: new Date().toISOString(),
  });
}

export async function fetchSpcxUsdPrice(): Promise<PriceQuote> {
  const diagnostics: string[] = [];
  return (
    (await tryBackedPriceData(diagnostics)) ??
    (await tryXstocksQuoteAssets(diagnostics)) ??
    (await tryCoingecko(diagnostics)) ??
    tryEnvFallback(diagnostics) ??
    {
      symbol: "SPCXx",
      pair: "SPCX/USD",
      status: "unavailable",
      source: "unavailable",
      sourceUrl: null,
      priceUsd: null,
      priceUsdE18: null,
      priceUsdE8: null,
      updatedAt: null,
      diagnostics,
    }
  );
}
