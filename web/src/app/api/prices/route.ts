import { NextResponse } from "next/server";

import { getPrices } from "@/lib/prices/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const prices = await getPrices();
  return NextResponse.json(prices);
}
