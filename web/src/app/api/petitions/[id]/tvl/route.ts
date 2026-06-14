import { NextResponse } from "next/server";

import { handleRouteError, jsonError } from "@/lib/petitions/http";
import { getPetitionStore } from "@/lib/petitions/store";
import { computePetitionTvl, TvlUnavailableError } from "@/lib/tvl/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const detail = await getPetitionStore().getPetition(id);
    if (!detail) return jsonError(404, "Petition not found");

    const tvl = await computePetitionTvl(detail);
    return NextResponse.json(tvl);
  } catch (error) {
    if (error instanceof TvlUnavailableError) {
      return jsonError(503, error.message, error.diagnostics);
    }
    return handleRouteError(error);
  }
}
