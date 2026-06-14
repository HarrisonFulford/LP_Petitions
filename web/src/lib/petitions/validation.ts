import { getAddress, isAddress, isHex } from "viem";

import { runtimeConfig } from "@/lib/runtime-config";
import type { CreatePetitionInput, UpsertCommitmentInput } from "./types";

const UINT_STRING = /^(0|[1-9]\d*)$/;
const UINT24_MAX = 16_777_215;

export class ValidationError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [message],
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export function isUintString(value: unknown): value is string {
  return typeof value === "string" && UINT_STRING.test(value);
}

function requiredUintString(value: unknown, field: string) {
  if (!isUintString(value)) {
    throw new ValidationError(`${field} must be a uint string`);
  }
  return value;
}

function optionalUintString(value: unknown, field: string) {
  if (value == null || value === "") return null;
  return requiredUintString(value, field);
}

function requiredUint24(value: unknown) {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (
    typeof numeric !== "number" ||
    !Number.isInteger(numeric) ||
    numeric < 0 ||
    numeric > UINT24_MAX
  ) {
    throw new ValidationError("fee must be a uint24");
  }
  return numeric;
}

function optionalAddress(value: unknown, field: string) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !isAddress(value)) {
    throw new ValidationError(`${field} must be a valid EVM address`);
  }
  return getAddress(value);
}

function requiredAddress(value: unknown, field: string) {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new ValidationError(`${field} must be a valid EVM address`);
  }
  return getAddress(value);
}

function optionalTxHash(value: unknown) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !isHex(value, { strict: true }) || value.length !== 66) {
    throw new ValidationError("txHash must be a 32-byte hex string");
  }
  return value;
}

export function parseJsonObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

export function parseCreatePetition(value: unknown): CreatePetitionInput {
  const body = parseJsonObject(value);
  const token0Symbol =
    typeof body.token0Symbol === "string" && body.token0Symbol.trim()
      ? body.token0Symbol.trim()
      : runtimeConfig.pair.token0Symbol;
  const token1Symbol =
    typeof body.token1Symbol === "string" && body.token1Symbol.trim()
      ? body.token1Symbol.trim()
      : runtimeConfig.pair.token1Symbol;

  return {
    contractPetitionId: optionalUintString(body.contractPetitionId, "contractPetitionId"),
    title:
      typeof body.title === "string" && body.title.trim()
        ? body.title.trim()
        : `${token0Symbol}/${token1Symbol} LP Petition`,
    token0Symbol,
    token1Symbol,
    token0Address: optionalAddress(body.token0Address, "token0Address"),
    token1Address: optionalAddress(body.token1Address, "token1Address"),
    fee: requiredUint24(body.fee ?? runtimeConfig.defaultFeeTier.value),
    thresholdUsdE18: requiredUintString(body.thresholdUsdE18, "thresholdUsdE18"),
  };
}

export function parseUpsertCommitment(value: unknown): UpsertCommitmentInput {
  const body = parseJsonObject(value);
  const amount0 = requiredUintString(body.amount0, "amount0");
  const amount1 = requiredUintString(body.amount1, "amount1");

  if (BigInt(amount0) === BigInt(0) && BigInt(amount1) === BigInt(0)) {
    throw new ValidationError("at least one commitment amount must be nonzero");
  }

  return {
    signer: requiredAddress(body.signer, "signer"),
    amount0,
    amount1,
    txHash: optionalTxHash(body.txHash),
  };
}
