"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Hex } from "viem";
import {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

import { lpPetitionAbi } from "@/lib/contracts/lp-petition";
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

export function CommitmentSignPanel() {
  const lpPetitionAddress = runtimeConfig.pendingContracts.lpPetition;
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectors, connect, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { writeContract, data: hash, isPending: isSigning, error: writeError } =
    useWriteContract();
  const { data: receipt, isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash,
  });

  const [backendPetitionId, setBackendPetitionId] = useState("");
  const [contractPetitionId, setContractPetitionId] = useState("1");
  const [amount0, setAmount0] = useState("1000000000000000000");
  const [amount1, setAmount1] = useState("1000000000000000000");
  const [formError, setFormError] = useState<string | null>(null);
  const [mirrorStatus, setMirrorStatus] = useState<string | null>(null);
  const mirroredHashRef = useRef<Hex | null>(null);

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

  function handleSign() {
    setFormError(null);
    setMirrorStatus(null);
    mirroredHashRef.current = null;

    if (!lpPetitionAddress) {
      setFormError("Set NEXT_PUBLIC_LP_PETITION_ADDRESS before signing.");
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
    if (BigInt(amount0) === BigInt(0) && BigInt(amount1) === BigInt(0)) {
      setFormError("At least one commitment amount must be nonzero.");
      return;
    }

    writeContract({
      address: lpPetitionAddress,
      abi: lpPetitionAbi,
      functionName: "sign",
      args: [BigInt(contractPetitionId), BigInt(amount0), BigInt(amount1)],
      chainId: runtimeConfig.chainId,
    });
  }

  useEffect(() => {
    const txHash = receipt?.transactionHash;
    if (!txHash || !address || mirroredHashRef.current === txHash) return;

    mirroredHashRef.current = txHash;

    fetch(`/api/petitions/${encodeURIComponent(backendPetitionId.trim())}/commitments/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contractPetitionId,
        signer: address,
        amount0,
        amount1,
        txHash,
      }),
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body?.error?.message || "Failed to mirror commitment");
        }
        setMirrorStatus(
          `Mirrored to backend. Commitments now stored: ${body.commitments?.length ?? "?"}.`,
        );
      })
      .catch((error: Error) => {
        setMirrorStatus(`Mirror failed: ${error.message}`);
      });
  }, [address, amount0, amount1, backendPetitionId, contractPetitionId, receipt]);

  return (
    <section className="rounded-3xl border border-panel-border bg-panel p-6 shadow-sm">
      <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted">F3a dev flow</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">Commitment signing</h2>
          <p className="mt-3 text-sm leading-6 text-muted">
            Temporary wallet panel for calling <span className="font-mono">LPPetition.sign(id, amount0, amount1)</span> on Base Sepolia, then verifying the emitted <span className="font-mono">Signed</span> event before mirroring it into the F2 API store.
          </p>
          <div className="mt-4 rounded-2xl border border-panel-border bg-background p-4 text-sm">
            <p className="font-medium">Contract</p>
            <p className="mt-1 break-all font-mono text-muted">
              {lpPetitionAddress || "Missing NEXT_PUBLIC_LP_PETITION_ADDRESS"}
            </p>
          </div>
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
            <Field label="amount0 raw units" onChange={setAmount0} value={amount0} />
            <Field label="amount1 raw units" onChange={setAmount1} value={amount1} />
          </div>

          <button
            className="w-full rounded-2xl bg-foreground px-5 py-3 font-semibold text-background disabled:cursor-not-allowed disabled:opacity-45"
            disabled={!canSign || isSigning || isConfirming}
            onClick={handleSign}
            type="button"
          >
            {isSigning ? "Confirm in wallet…" : isConfirming ? "Waiting for receipt…" : "Sign commitment on-chain"}
          </button>

          {formError ? <Status tone="bad">{formError}</Status> : null}
          {writeError ? <Status tone="bad">Wallet error: {writeError.message}</Status> : null}
          {hash ? (
            <Status>
              Tx submitted: <a className="underline" href={explorerTxUrl(hash)}>{shortAddress(hash)}</a>
            </Status>
          ) : null}
          {mirrorStatus ? <Status>{mirrorStatus}</Status> : null}
        </div>
      </div>
    </section>
  );
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
