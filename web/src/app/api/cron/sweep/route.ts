import { NextResponse } from "next/server";

import { runSweep } from "@/lib/executor/execute";
import { handleRouteError, jsonError } from "@/lib/petitions/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/// Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set.
/// If unset (local dev), the endpoint is open so it can be hit manually.
function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  try {
    if (!authorized(request)) return jsonError(401, "Unauthorized");
    const summary = await runSweep();
    return NextResponse.json(summary);
  } catch (error) {
    return handleRouteError(error);
  }
}
