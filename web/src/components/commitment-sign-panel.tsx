"use client";

import { useMemo, useState } from "react";
import { maxUint256, type Address, type Hex } from "viem";
import {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  usePublicClient,
  useSignTypedData,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import { erc20Abi } from "@/lib/contracts/erc20";
import { lpPetitionAbi } from "@/lib/contracts/lp-petition";
import {
  buildPermitBatch,
  permit2Abi,
  permit2Domain,
  permitBatchTypes,
} from "@/lib/contracts/permit2";
import { runtimeConfig } from "@/lib/runtime-config";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function isUintString(value: string) {
  return /^(0|[1-9]\d*)$/.test(value);
}

function explorerTxUrl(hash: string) {
  return `${runtimeConfig.explorerUrl}/tx/${hash}`;
}

type StepState = "pending" | "active" | "done" | "skipped";

const STEP_LABELS = {
  approve: "Approve tokens to Permit2",
  permit: "Register Permit2 allowance",
  sign: "Record commitment (sign)",
  mirror: "Mirror to backend",
} as const;

type StepKey = keyof typeof STEP_LABELS;

export function CommitmentSignPanel() {
  const lpPetitionAddress = runtimeConfig.pendingContracts.lpPetition;
  const permit2Address = runtimeConfig.contracts.permit2;

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { connectors, connect, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();

  const [backendPetitionId, setBackendPetitionId] = useState("");
  const [contractPetitionId, setContractPetitionId] = useState("1");
  const [amount0, setAmount0] = useState("0");
  const [amount1, setAmount1] = useState("1000000000000000000");
  const [formError, setFormError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [signHash, setSignHash] = useState<Hex | null>(null);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Record<StepKey, StepState>>({
    approve: "pending",
    permit: "pending",
    sign: "pending",
    mirror: "pending",
  });

  const wrongChain = isConnected && chainId !== runtimeConfig.chainId;
  const canSign = useMemo(() => {
    return Boolean(
      lpPetitionAddress &&
        isConnected &&
        !wrongChain &&
        backendPetitionId.trim() &&
        isUintString(contractPetitionId) &&
        isUintString(amount0) &&
        isUintString(amount1) &&
        (BigInt(amount0 || "0") > BigInt(0) || BigInt(amount1 || "0") > BigInt(0)),
    );
  }, [amount0, amount1, backendPetitionId, contractPetitionId, isConnected, lpPetitionAddress, wrongChain]);

  function setStep(key: StepKey, state: StepState) {
    setSteps((prev) => ({ ...prev, [key]: state }));
  }

  function resetSteps() {
    setSteps({ approve: "pending", permit: "pending", sign: "pending", mirror: "pending" });
  }

  async function handleSign() {
    setFormError(null);
    setStatusText(null);
    setSignHash(null);
    resetSteps();

    if (!lpPetitionAddress) {
      setFormError("Set NEXT_PUBLIC_LP_PETITION_ADDRESS before signing.");
      return;
    }
    if (!publicClient || !address) {
      setFormError("Wallet/public client not ready.");
      return;
    }
    if (!backendPetitionId.trim()) {
      setFormError("Backend petition id is required so the API can mirror the Signed event.");
      return;
    }
    if (!isUintString(contractPetitionId) || !isUintString(amount0) || !isUintString(amount1)) {
      setFormError("contractPetitionId, amount0, and amount1 must be uint strings.");
      return;
    }

    const id = BigInt(contractPetitionId);
    const a0 = BigInt(amount0);
    const a1 = BigInt(amount1);
    if (a0 === BigInt(0) && a1 === BigInt(0)) {
      setFormError("At least one commitment amount must be nonzero.");
      return;
    }

    setBusy(true);
    try {
      // Resolve the petition's sorted token order on-chain (amount0 -> token0, amount1 -> token1).
      const petition = await publicClient.readContract({
        address: lpPetitionAddress,
        abi: lpPetitionAbi,
        functionName: "getPetition",
        args: [id],
      });
      const token0 = petition.token0 as Address;
      const token1 = petition.token1 as Address;

      const legs: { token: Address; amount: bigint }[] = [];
      if (a0 > BigInt(0)) legs.push({ token: token0, amount: a0 });
      if (a1 > BigInt(0)) legs.push({ token: token1, amount: a1 });

      // 1) ERC20 -> Permit2 approval (one-time per token), only where missing.
      setStep("approve", "active");
      let approvedAny = false;
      for (const leg of legs) {
        const current = await publicClient.readContract({
          address: leg.token,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, permit2Address],
        });
        if (current < leg.amount) {
          approvedAny = true;
          setStatusText(`Approving ${shortAddress(leg.token)} to Permit2…`);
          const hash = await writeContractAsync({
            address: leg.token,
            abi: erc20Abi,
            functionName: "approve",
            args: [permit2Address, maxUint256],
            chainId: runtimeConfig.chainId,
          });
          await publicClient.waitForTransactionReceipt({ hash });
        }
      }
      setStep("approve", approvedAny ? "done" : "skipped");

      // 2) Read current Permit2 nonces, then sign + register the batch allowance.
      setStep("permit", "active");
      setStatusText("Reading Permit2 nonces…");
      const legsWithNonce = [];
      for (const leg of legs) {
        const [, , nonce] = await publicClient.readContract({
          address: permit2Address,
          abi: permit2Abi,
          functionName: "allowance",
          args: [address, leg.token, lpPetitionAddress],
        });
        legsWithNonce.push({ token: leg.token, amount: leg.amount, nonce });
      }

      const permitBatch = buildPermitBatch({ spender: lpPetitionAddress, legs: legsWithNonce });

      setStatusText("Sign the Permit2 allowance in your wallet…");
      const signature = await signTypedDataAsync({
        domain: permit2Domain,
        types: permitBatchTypes,
        primaryType: "PermitBatch",
        message: permitBatch,
      });

      setStatusText("Registering the Permit2 allowance on-chain…");
      const permitHash = await writeContractAsync({
        address: permit2Address,
        abi: permit2Abi,
        functionName: "permit",
        args: [address, permitBatch, signature],
        chainId: runtimeConfig.chainId,
      });
      await publicClient.waitForTransactionReceipt({ hash: permitHash });
      setStep("permit", "done");

      // 3) Record the commitment on the petition.
      setStep("sign", "active");
      setStatusText("Confirm the commitment (sign) in your wallet…");
      const hash = await writeContractAsync({
        address: lpPetitionAddress,
        abi: lpPetitionAbi,
        functionName: "sign",
        args: [id, a0, a1],
        chainId: runtimeConfig.chainId,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setSignHash(hash);
      setStep("sign", "done");

      // 4) Mirror the Signed event into the F2 store.
      setStep("mirror", "active");
      setStatusText("Mirroring commitment to backend…");
      const response = await fetch(
        `/api/petitions/${encodeURIComponent(backendPetitionId.trim())}/commitments/confirm`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contractPetitionId, signer: address, amount0, amount1, txHash: hash }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.error?.message || "Failed to mirror commitment");
      }
      setStep("mirror", "done");
      setStatusText(`Done. Commitment is on-chain and mirrored (stored: ${body.commitments?.length ?? "?"}).`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Commitment flow failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-panel-border bg-panel p-6 shadow-sm">
      <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted">F3 commitment flow</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">Commitment signing</h2>
          <p className="mt-3 text-sm leading-6 text-muted">
            Full Permit2 (AllowanceTransfer) flow: approve tokens to Permit2, sign + register the batch allowance with{" "}
            <span className="font-mono">LPPetition</span> as spender, then call{" "}
            <span className="font-mono">sign(id, amount0, amount1)</span> and mirror the{" "}
            <span className="font-mono">Signed</span> event into the F2 store. amount0/amount1 map to the petition&apos;s
            sorted token0/token1 (read on-chain).
          </p>
          <div className="mt-4 rounded-2xl border border-panel-border bg-background p-4 text-sm">
            <p className="font-medium">Contract</p>
            <p className="mt-1 break-all font-mono text-muted">
              {lpPetitionAddress || "Missing NEXT_PUBLIC_LP_PETITION_ADDRESS"}
            </p>
          </div>
          <ol className="mt-4 space-y-2">
            {(Object.keys(STEP_LABELS) as StepKey[]).map((key) => (
              <li className="flex items-center gap-2 text-sm" key={key}>
                <StepDot state={steps[key]} />
                <span className={steps[key] === "pending" ? "text-muted" : ""}>{STEP_LABELS[key]}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            {isConnected && address ? (
              <>
                <span className="rounded-full border border-panel-border bg-background px-3 py-2 font-mono text-sm">
                  {shortAddress(address)}
                </span>
                <button
                  className="rounded-full border border-panel-border px-4 py-2 text-sm font-semibold"
                  onClick={() => disconnect()}
                  type="button"
                >
                  Disconnect
                </button>
              </>
            ) : (
              connectors.map((connector) => (
                <button
                  className="rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background disabled:opacity-50"
                  disabled={isConnecting}
                  key={connector.uid}
                  onClick={() => connect({ connector })}
                  type="button"
                >
                  {isConnecting ? "Connecting…" : `Connect ${connector.name}`}
                </button>
              ))
            )}
            {wrongChain ? (
              <button
                className="rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background disabled:opacity-50"
                disabled={isSwitching}
                onClick={() => switchChain({ chainId: runtimeConfig.chainId })}
                type="button"
              >
                {isSwitching ? "Switching…" : "Switch to Base Sepolia"}
              </button>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Backend petition id"
              onChange={setBackendPetitionId}
              placeholder="F2 UUID"
              value={backendPetitionId}
            />
            <Field
              label="Contract petition id"
              onChange={setContractPetitionId}
              placeholder="1"
              value={contractPetitionId}
            />
            <Field label="amount0 raw units (token0)" onChange={setAmount0} value={amount0} />
            <Field label="amount1 raw units (token1)" onChange={setAmount1} value={amount1} />
          </div>

          <button
            className="w-full rounded-2xl bg-foreground px-5 py-3 font-semibold text-background disabled:cursor-not-allowed disabled:opacity-45"
            disabled={!canSign || busy}
            onClick={handleSign}
            type="button"
          >
            {busy ? "Working… see steps" : "Approve, permit & sign commitment"}
          </button>

          {formError ? <Status tone="bad">{formError}</Status> : null}
          {statusText ? <Status>{statusText}</Status> : null}
          {signHash ? (
            <Status>
              Commitment tx:{" "}
              <a className="underline" href={explorerTxUrl(signHash)}>
                {shortAddress(signHash)}
              </a>
            </Status>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function StepDot({ state }: { state: StepState }) {
  const cls =
    state === "done"
      ? "bg-green-500 border-green-500"
      : state === "active"
        ? "bg-amber-400 border-amber-400 animate-pulse"
        : state === "skipped"
          ? "bg-transparent border-muted"
          : "bg-transparent border-panel-border";
  return <span className={`inline-block h-2.5 w-2.5 rounded-full border ${cls}`} aria-hidden />;
}

function Field({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-muted">{label}</span>
      <input
        className="mt-1 w-full rounded-xl border border-panel-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-foreground"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}

function Status({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "bad" }) {
  return (
    <div
      className={`rounded-2xl border px-4 py-3 text-sm ${
        tone === "bad"
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-panel-border bg-background text-muted"
      }`}
    >
      {children}
    </div>
  );
}
