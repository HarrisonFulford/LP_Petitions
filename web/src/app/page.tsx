import { CommitmentSignPanel } from "@/components/commitment-sign-panel";
import { runtimeConfig } from "@/lib/runtime-config";

function explorerAddressUrl(address: string) {
  return `${runtimeConfig.explorerUrl}/address/${address}`;
}

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

const uniswapContracts = Object.entries(runtimeConfig.contracts.uniswapV4).map(
  ([label, address]) => ({ label, address }),
);

const coreContracts = [
  { label: "Permit2", address: runtimeConfig.contracts.permit2 },
  { label: "WETH9", address: runtimeConfig.contracts.weth9 },
  {
    label: "Chainlink ETH/USD",
    address: runtimeConfig.contracts.chainlinkEthUsd,
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-6 py-10 sm:py-14">
      <section className="rounded-3xl border border-panel-border bg-panel p-7 shadow-sm sm:p-10">
        <p className="mb-4 text-sm font-semibold uppercase tracking-[0.22em] text-muted">
          Temporary scaffold
        </p>
        <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr] lg:items-end">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              LP Petitions Dev Shell
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted sm:text-lg">
              This disposable page proves the root Next.js app and API route are
              wired. It is intentionally not the product UI and should be
              deleted or replaced when the real demo flow is designed.
            </p>
          </div>
          <div className="rounded-2xl border border-panel-border bg-background p-5 font-mono text-sm">
            <div className="flex items-center justify-between gap-4 border-b border-panel-border pb-3">
              <span className="text-muted">GET</span>
              <a className="font-semibold underline" href="/api/config">
                /api/config
              </a>
            </div>
            <p className="pt-3 text-muted">
              Public-safe runtime config, no secrets or private RPC URLs.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <InfoCard label="Chain" value={runtimeConfig.chainName} />
        <InfoCard label="Chain ID" value={runtimeConfig.chainId.toString()} />
        <InfoCard label="Pair" value={runtimeConfig.pair.label} />
        <InfoCard
          label="Default fee tier"
          value={`${runtimeConfig.defaultFeeTier.label} (${runtimeConfig.defaultFeeTier.value})`}
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <AddressPanel title="Core contracts" rows={coreContracts} />
        <AddressPanel title="Uniswap v4 contracts" rows={uniswapContracts} />
      </section>

      <CommitmentSignPanel />

      <section className="rounded-3xl border border-panel-border bg-panel p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Runtime notes</h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-medium text-muted">Explorer</dt>
            <dd className="mt-1 break-all font-mono">
              <a className="underline" href={runtimeConfig.explorerUrl}>
                {runtimeConfig.explorerUrl}
              </a>
            </dd>
          </div>
          <div>
            <dt className="font-medium text-muted">RPC env var</dt>
            <dd className="mt-1 font-mono">{runtimeConfig.rpc.envVar}</dd>
          </div>
        </dl>
        <ul className="mt-5 list-disc space-y-2 pl-5 text-sm leading-6 text-muted">
          {runtimeConfig.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-panel-border bg-panel p-5 shadow-sm">
      <p className="text-sm font-medium text-muted">{label}</p>
      <p className="mt-2 font-mono text-lg font-semibold tracking-tight">
        {value}
      </p>
    </div>
  );
}

function AddressPanel({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; address: string }>;
}) {
  return (
    <div className="rounded-3xl border border-panel-border bg-panel p-6 shadow-sm">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-5 divide-y divide-panel-border">
        {rows.map(({ label, address }) => (
          <div
            className="grid gap-2 py-4 text-sm sm:grid-cols-[11rem_1fr] sm:items-center"
            key={label}
          >
            <span className="font-medium text-muted">{label}</span>
            <a
              className="break-all font-mono underline decoration-dotted underline-offset-4"
              href={explorerAddressUrl(address)}
            >
              <span className="sm:hidden">{truncateAddress(address)}</span>
              <span className="hidden sm:inline">{address}</span>
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
