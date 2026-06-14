const TEN = BigInt(10);

export function scaleIntegerPriceToE18(value: bigint, decimals: number) {
  if (decimals === 18) return value.toString();
  if (decimals < 18) return (value * TEN ** BigInt(18 - decimals)).toString();
  return (value / TEN ** BigInt(decimals - 18)).toString();
}

export function decimalUsdToScaled(value: string | number, scale: number) {
  const normalized = String(value).trim();
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(normalized)) {
    throw new Error(`Invalid decimal price: ${normalized}`);
  }
  const [whole, fraction = ""] = normalized.split(".");
  const paddedFraction = fraction.padEnd(scale, "0").slice(0, scale);
  return (BigInt(whole) * TEN ** BigInt(scale) + BigInt(paddedFraction || "0")).toString();
}

export function decimalUsdToE18(value: string | number) {
  return decimalUsdToScaled(value, 18);
}

export function decimalUsdToE8(value: string | number) {
  return decimalUsdToScaled(value, 8);
}

export function formatUsdFromE18(value: string | null) {
  if (!value) return null;
  const raw = BigInt(value);
  const whole = raw / TEN ** BigInt(18);
  const fraction = raw % TEN ** BigInt(18);
  const cents = (fraction / TEN ** BigInt(16)).toString().padStart(2, "0");
  return `${whole.toString()}.${cents}`;
}
