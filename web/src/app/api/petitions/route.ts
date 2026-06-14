import { NextResponse } from "next/server";

import { handleRouteError, readJson } from "@/lib/petitions/http";
import { getPetitionStore } from "@/lib/petitions/store";
import { parseCreatePetition } from "@/lib/petitions/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const petitions = await getPetitionStore().listPetitions();
    return NextResponse.json({ petitions });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = parseCreatePetition(await readJson(request));
    const petition = await getPetitionStore().createPetition(input);
    return NextResponse.json({ petition }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
