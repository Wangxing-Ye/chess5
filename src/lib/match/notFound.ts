import { NextResponse } from "next/server";
import { ERROR_CODES } from "@/lib/api/errors";
import { getMatchRecord } from "@/lib/db/matches";

/**
 * Live matches live only in memory; finished ones are evicted after a short
 * retention window. When a play/spectate client asks for a missing id, check
 * SQLite so we can tell "ended — open Replay" apart from a true unknown id.
 */
export function matchNotFoundResponse(id: string): NextResponse {
  const row = getMatchRecord(id);
  if (row?.ended_at != null) {
    return NextResponse.json(
      { error: "Match finished", code: ERROR_CODES.matchFinished },
      { status: 404 },
    );
  }
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

/** Same distinction for the SSE route, which builds its own Response. */
export function matchNotFoundPayload(id: string): {
  status: 404;
  body: { error: string; code?: string };
} {
  const row = getMatchRecord(id);
  if (row?.ended_at != null) {
    return {
      status: 404,
      body: { error: "Match finished", code: ERROR_CODES.matchFinished },
    };
  }
  return { status: 404, body: { error: "Not found" } };
}
