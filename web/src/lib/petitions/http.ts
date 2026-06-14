import { NextResponse } from "next/server";

import { ValidationError } from "./validation";

export function jsonError(status: number, message: string, issues?: string[]) {
  return NextResponse.json({ error: { message, issues: issues ?? [message] } }, { status });
}

export function handleRouteError(error: unknown) {
  if (error instanceof ValidationError) {
    return jsonError(400, error.message, error.issues);
  }
  console.error(error);
  return jsonError(500, "Internal server error");
}

export async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new ValidationError("request body must be valid JSON");
  }
}
