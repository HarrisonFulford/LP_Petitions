import { NextResponse } from "next/server";

import { handleRouteError, jsonError, readJson } from "@/lib/petitions/http";
import { verifySignedEvent } from "@/lib/petitions/onchain";
import { getPetitionStore } from "@/lib/petitions/store";
import { parseConfirmCommitment } from "@/lib/petitions/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const input = parseConfirmCommitment(await readJson(request));
    const store = getPetitionStore();
    const existing = await store.getPetition(id);

    if (!existing) return jsonError(404, "Petition not found");
    if (
      existing.petition.contractPetitionId &&
      existing.petition.contractPetitionId !== input.contractPetitionId
    ) {
      return jsonError(400, "contractPetitionId does not match petition record");
    }

    const verification = await verifySignedEvent(input);
    const detail = await store.upsertCommitment(id, {
      signer: input.signer,
      amount0: input.amount0,
      amount1: input.amount1,
      txHash: input.txHash,
    });

    if (!detail) return jsonError(404, "Petition not found");
    return NextResponse.json({ ...detail, verification });
  } catch (error) {
    return handleRouteError(error);
  }
}
