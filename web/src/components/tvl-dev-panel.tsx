"use client";

import { useState } from "react";

import type { PetitionTvl } from "@/lib/tvl/types";

function formatBps(bps: number) {
  return `${(bps / 100).toFixed(2)}%`;
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function TvlDevPanel() {
  const [petitionId, setPetitionId] = useState("");
  const [tvl, setTvl] = useState<PetitionTvl | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadTvl() {
    setError(null);
    setTvl(null);
    const id = petitionId.trim();
    if (!id) {
      setError("Enter a backend petition id first.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/petitions/${encodeURIComponent(id)}/tvl`, {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.error?.message || "Failed to load TVL");
      }
      setTvl(body);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load TVL");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-3xl border border-panel-border bg-panel p-6 shadow-sm">
      <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted">F5a TVL mirror</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">Threshold progress</h2>
          <p className="mt-3 text-sm leading-6 text-muted">
            Temporary display that multiplies stored F2 commitments by F4 server-side prices.
            This is for UX and executor heuristics only; the contract remains final authority.
          </p>
        </div>

        <div className="space-y-4">
          <label className="block text-sm">
            <span className="font-medium text-muted">Backend petition id</span>
            <input
              className="mt-1 w-full rounded-xl border border-panel-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-foreground"
              onChange={(event) => setPetitionId(event.target.value)}
              placeholder="F2 UUID"
              value={petitionId}
            />
          </label>
          <button
            className="w-full rounded-2xl bg-foreground px-5 py-3 font-semibold text-background disabled:cursor-not-allowed disabled:opacity-45"
            disabled={loading}
            onClick={loadTvl}
            type="button"
          >
            {loading ? "Loading TVL…" : "Load TVL progress"}
          </button>
          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          ) : null}
        </div>
      </div>

      {tvl ? (
        <div className="mt-6 rounded-2xl border border-panel-border bg-background p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-mono text-sm text-muted">{tvl.pair}</p>
              <p className="mt-2 text-3xl font-semibold">${tvl.totalUsdFormatted}</p>
              <p className="mt-1 text-sm text-muted">
                {tvl.commitmentCount} commitment{tvl.commitmentCount === 1 ? "" : "s"} · threshold {tvl.isThresholdMet ? "met" : "not met"}
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                tvl.isThresholdMet
                  ? "bg-green-100 text-green-800"
                  : "border border-panel-border text-muted"
              }`}
            >
              {tvl.isThresholdMet ? "Ready" : "Open"}
            </span>
          </div>

          <div className="mt-5">
            <div className="mb-2 flex justify-between font-mono text-xs text-muted">
              <span>{formatBps(tvl.progressBps)}</span>
              <span>100.00%</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-panel-border">
              <div
                className="h-full rounded-full bg-foreground transition-all"
                style={{ width: `${Math.min(100, tvl.progressBps / 100)}%` }}
              />
            </div>
          </div>

          <div className="mt-5 grid gap-4 text-sm lg:grid-cols-2">
            <Metric label="Threshold e18" value={tvl.thresholdUsdE18} />
            <Metric label="Total e18" value={tvl.totalUsdE18} />
            <Metric label={`${tvl.token0Symbol} price source`} value={tvl.prices.token0.source} />
            <Metric label={`${tvl.token1Symbol} price source`} value={tvl.prices.token1.source} />
          </div>

          {tvl.commitments.length ? (
            <div className="mt-5 overflow-hidden rounded-2xl border border-panel-border">
              <div className="grid grid-cols-[1fr_1fr] gap-3 border-b border-panel-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted sm:grid-cols-[1fr_1fr_1fr]">
                <span>Signer</span>
                <span>Total USD e18</span>
                <span className="hidden sm:block">Order</span>
              </div>
              {tvl.commitments.map((commitment) => (
                <div
                  className="grid grid-cols-[1fr_1fr] gap-3 border-b border-panel-border px-4 py-3 font-mono text-xs last:border-b-0 sm:grid-cols-[1fr_1fr_1fr]"
                  key={`${commitment.signer}-${commitment.orderIndex}`}
                >
                  <span>{shortAddress(commitment.signer)}</span>
                  <span className="break-all">{commitment.totalUsdE18}</span>
                  <span className="hidden sm:block">{commitment.orderIndex}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-medium text-muted">{label}</p>
      <p className="mt-1 break-all font-mono">{value}</p>
    </div>
  );
}
