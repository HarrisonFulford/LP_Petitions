import { NextResponse } from "next/server";

import { getPublicRuntimeConfig } from "@/lib/runtime-config";

export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(getPublicRuntimeConfig());
}
