import { NextResponse } from "next/server";
import { countMatchRecordsFresh } from "@/lib/db/matches";
import { enforceRateLimit, tooManyRequests } from "@/lib/security/rateLimit";

export const runtime = "nodejs";

/** Homepage live counter polls ~every 5s; keep headroom for a few tabs. */
const COUNT_RULE = { limit: 40, windowMs: 60_000 };

export async function GET(req: Request) {
  const limit = enforceRateLimit(req, "match-count", COUNT_RULE);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  try {
    return NextResponse.json({ count: countMatchRecordsFresh() });
  } catch (e) {
    console.error("GET /api/matches/count failed", e);
    return NextResponse.json(
      { error: "Failed to read match count" },
      { status: 500 },
    );
  }
}
