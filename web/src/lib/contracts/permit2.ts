import type { Address } from "viem";

import { runtimeConfig } from "@/lib/runtime-config";

/// Permit2 (AllowanceTransfer) ABI subset used by F3.
/// `LPPetition` pulls funds via `IAllowanceTransfer`, so commitments rely on the
/// *stored* Permit2 allowance (registered via `permit`), not a passthrough signature.
export const permit2Abi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
  },
  {
    type: "function",
    name: "permit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      {
        name: "permitBatch",
        type: "tuple",
        components: [
          {
            name: "details",
            type: "tuple[]",
            components: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint160" },
              { name: "expiration", type: "uint48" },
              { name: "nonce", type: "uint48" },
            ],
          },
          { name: "spender", type: "address" },
          { name: "sigDeadline", type: "uint256" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

/// EIP-712 domain for Permit2. Note: name + chainId + verifyingContract only — no `version`.
export const permit2Domain = {
  name: "Permit2",
  chainId: runtimeConfig.chainId,
  verifyingContract: runtimeConfig.contracts.permit2,
} as const;

/// EIP-712 types for the AllowanceTransfer batch permit (covers both legs in one signature).
export const permitBatchTypes = {
  PermitBatch: [
    { name: "details", type: "PermitDetails[]" },
    { name: "spender", type: "address" },
    { name: "sigDeadline", type: "uint256" },
  ],
  PermitDetails: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint160" },
    { name: "expiration", type: "uint48" },
    { name: "nonce", type: "uint48" },
  ],
} as const;

export type PermitDetails = {
  token: Address;
  amount: bigint;
  expiration: number;
  nonce: number;
};

export type PermitBatch = {
  details: PermitDetails[];
  spender: Address;
  sigDeadline: bigint;
};

/// uint160 max — the Permit2 amount ceiling.
export const MAX_UINT160 = (BigInt(1) << BigInt(160)) - BigInt(1);

/// Default windows (seconds): how long the granted allowance stays valid, and how long
/// the user's signature itself is accepted. Both must outlast when `execute()` runs.
export const DEFAULT_ALLOWANCE_EXPIRATION_SECONDS = 7 * 24 * 60 * 60; // 7 days
export const DEFAULT_SIG_DEADLINE_SECONDS = 30 * 60; // 30 minutes

/// Build the EIP-712 `PermitBatch` message for the given legs.
/// `spender` MUST be the LPPetition address (the contract reads
/// `PERMIT2.allowance(signer, token, address(this))`). Nonces are per (owner, token,
/// spender) and must be read on-chain via `permit2Abi.allowance` before calling this.
export function buildPermitBatch(params: {
  spender: Address;
  legs: { token: Address; amount: bigint; nonce: number }[];
  nowSeconds?: number;
  expirationSeconds?: number;
  sigDeadlineSeconds?: number;
}): PermitBatch {
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const expiration = now + (params.expirationSeconds ?? DEFAULT_ALLOWANCE_EXPIRATION_SECONDS);
  const sigDeadline = BigInt(now + (params.sigDeadlineSeconds ?? DEFAULT_SIG_DEADLINE_SECONDS));

  return {
    details: params.legs.map((leg) => ({
      token: leg.token,
      amount: leg.amount,
      expiration,
      nonce: leg.nonce,
    })),
    spender: params.spender,
    sigDeadline,
  };
}
