import { NextResponse } from "next/server";

import { maybeExecutePetition } from "@/lib/executor/execute";
import { handleRouteError, jsonError } from "@/lib/petitions/http";
import { getPetitionStore } from "@/lib/petitions/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ id: string }>;
};

/// Manual demo fallback for `execute()` (the reactive path + cron normally fire it).
export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const detail = await getPetitionStore().getPetition(id);
    if (!detail) return jsonError(404, "Petition not found");
    const outcome = await maybeExecutePetition(detail);
    return NextResponse.json(outcome);
  } catch (error) {
    return handleRouteError(error);
  }
}
