import { NextResponse } from "next/server";

import { handleRouteError, jsonError } from "@/lib/petitions/http";
import { getPetitionStore } from "@/lib/petitions/store";

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
    return NextResponse.json(detail);
  } catch (error) {
    return handleRouteError(error);
  }
}
