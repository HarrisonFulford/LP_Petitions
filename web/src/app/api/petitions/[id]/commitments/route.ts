import { NextResponse } from "next/server";

import { handleRouteError, jsonError, readJson } from "@/lib/petitions/http";
import { getPetitionStore } from "@/lib/petitions/store";
import { parseUpsertCommitment } from "@/lib/petitions/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const input = parseUpsertCommitment(await readJson(request));
    const detail = await getPetitionStore().upsertCommitment(id, input);
    if (!detail) return jsonError(404, "Petition not found");
    return NextResponse.json(detail);
  } catch (error) {
    return handleRouteError(error);
  }
}
