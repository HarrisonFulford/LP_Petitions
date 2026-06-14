"use client";

import { useEffect, useState } from "react";

import type { PricesResponse, PriceQuote } from "@/lib/prices/types";

export function PriceDevPanel() {
  const [prices, setPrices] = useState<PricesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/prices", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error?.message || "Failed to load prices");
        if (!cancelled) setPrices(body);
      })
      .catch((loadError: Error) => {
        if (!cancelled) setError(loadError.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="rounded-3xl border border-panel-border bg-panel p-6 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted">F4a price feed</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">Server-side prices</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            ETH/USD is read from Chainlink on Base Sepolia. NVDA/USD uses official xStocks/Backed
            sources only, with an explicit demo-only server fallback when live quote data is unavailable.
          </p>
        </div>
        <a className="font-mono text-sm underline" href="/api/prices">
          /api/prices
        </a>
      </div>

      {error ? <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p> : null}
      {!prices && !error ? <p className="mt-5 text-sm text-muted">Loading prices…</p> : null}
      {prices ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <PriceCard quote={prices.ethUsd} />
          <PriceCard quote={prices.nvdaUsd} />
        </div>
      ) : null}
    </section>
  );
}

function PriceCard({ quote }: { quote: PriceQuote }) {
  return (
    <div className="rounded-2xl border border-panel-border bg-background p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-sm text-muted">{quote.pair}</p>
          <p className="mt-2 text-2xl font-semibold">
            {quote.priceUsd ? `$${quote.priceUsd}` : "Unavailable"}
          </p>
        </div>
        <span className="rounded-full border border-panel-border px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted">
          {quote.source}
        </span>
      </div>
      <dl className="mt-4 space-y-2 text-sm">
        <div>
          <dt className="text-muted">Aggregator seed e8</dt>
          <dd className="break-all font-mono">{quote.priceUsdE8 ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted">Updated</dt>
          <dd className="font-mono">{quote.updatedAt ?? "—"}</dd>
        </div>
      </dl>
      {quote.diagnostics.length ? (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-xs leading-5 text-muted">
          {quote.diagnostics.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
