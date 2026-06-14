import { decimalUsdToE18, decimalUsdToE8 } from "./math";
import type { PriceQuote } from "./types";

const DEFAULT_PRICE_DATA_URL = "https://api.backed.fi/api/v2/public/assets/NVDAx/price-data";
const DEFAULT_QUOTE_ASSET_URL = "https://api.xstocks.fi/api/v1/quotes/assets/NVDAx";
const XSTOCKS_USER_AGENT = "LP-Petitions-Hackathon/1.0 (+https://github.com/HarrisonFulford/LP_Petitions)";
const DEFAULT_FETCH_TIMEOUT_MS = 4_000;

function xstocksFetchTimeoutMs() {
  const configured = Number(process.env.XSTOCKS_FETCH_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured >= 500 && configured <= 15_000) return configured;
  return DEFAULT_FETCH_TIMEOUT_MS;
}

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
    symbol: "NVDAx",
    pair: "NVDA/USD",
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
    headers: {
      accept: "application/json",
      "user-agent": XSTOCKS_USER_AGENT,
    },
    signal: AbortSignal.timeout(xstocksFetchTimeoutMs()),
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
  const sourceUrl = process.env.XSTOCKS_NVDA_PRICE_URL || DEFAULT_PRICE_DATA_URL;
  try {
    const { response, body } = await fetchJson(sourceUrl);
    if (!response.ok) {
      diagnostics.push(`Backed/xStocks price-data returned HTTP ${response.status}.`);
      return null;
    }
    const quote = positiveNumber((body as { quote?: unknown } | null)?.quote);
    if (!quote) {
      diagnostics.push("Backed/xStocks price-data returned no positive quote for NVDAx.");
      return null;
    }
    return quoteFromDecimal({ diagnostics, price: quote, source: "xstocks-price-data", sourceUrl });
  } catch (error) {
    diagnostics.push(
      `Backed/xStocks price-data error: ${error instanceof Error ? error.message : "unknown error"}.`,
    );
    return null;
  }
}

function findNvdaQuoteAsset(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object") return null;

  const direct = body as Record<string, unknown>;
  if (direct.symbol === "NVDAx" || direct.underlyingSymbol === "NVDA") return direct;

  const assets = (direct.assets ?? direct.nodes) as unknown;
  if (!Array.isArray(assets)) return null;

  return (
    assets.find((asset) => {
      if (!asset || typeof asset !== "object") return false;
      const candidate = asset as Record<string, unknown>;
      return candidate.symbol === "NVDAx" || candidate.underlyingSymbol === "NVDA";
    }) ?? null
  );
}

async function tryXstocksQuoteAsset(diagnostics: string[]) {
  const sourceUrl = process.env.XSTOCKS_QUOTE_ASSET_URL || DEFAULT_QUOTE_ASSET_URL;
  try {
    const { response, body } = await fetchJson(sourceUrl);
    if (!response.ok) {
      diagnostics.push(`xStocks quote asset returned HTTP ${response.status}.`);
      return null;
    }
    const nvda = findNvdaQuoteAsset(body);
    if (!nvda) {
      diagnostics.push("xStocks quote asset response did not include NVDAx/NVDA.");
      return null;
    }
    const bidCents = positiveNumber(nvda.bid);
    const askCents = positiveNumber(nvda.ask);
    if (!bidCents || !askCents) {
      diagnostics.push(
        `xStocks quote asset found NVDAx but bid/ask unavailable (canQuote=${String(
          nvda.canQuote,
        )}, period=${String((nvda.limitsPerPeriod as { currentPeriod?: unknown } | undefined)?.currentPeriod)}).`,
      );
      return null;
    }

    diagnostics.push("Using xStocks quote asset midpoint; bid/ask values are interpreted as USD cents.");
    return quoteFromDecimal({
      diagnostics,
      price: (bidCents + askCents) / 200,
      source: "xstocks-quote-assets",
      sourceUrl,
    });
  } catch (error) {
    diagnostics.push(`xStocks quote asset error: ${error instanceof Error ? error.message : "unknown error"}.`);
    return null;
  }
}

function tryDemoFallback(diagnostics: string[]) {
  const fallback = process.env.NVDA_USD_FALLBACK_PRICE;
  const price = positiveNumber(fallback ? Number(fallback) : null);
  if (!price) return null;
  diagnostics.push(
    "Using server-configured NVDA_USD_FALLBACK_PRICE as a demo-only mock oracle seed because live xStocks public quotes are unavailable/closed.",
  );
  diagnostics.push(
    "This fallback is not client-supplied and must not be represented as live xStocks or Chainlink tokenized-equity market data.",
  );
  return quoteFromDecimal({
    diagnostics,
    price,
    source: "xstocks-demo-fallback",
    sourceUrl: null,
    updatedAt: new Date().toISOString(),
  });
}

export async function fetchNvdaUsdPrice(): Promise<PriceQuote> {
  const diagnostics: string[] = [];
  return (
    (await tryBackedPriceData(diagnostics)) ??
    (await tryXstocksQuoteAsset(diagnostics)) ??
    tryDemoFallback(diagnostics) ??
    {
      symbol: "NVDAx",
      pair: "NVDA/USD",
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
