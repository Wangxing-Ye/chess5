import { NextResponse } from "next/server";
import { toClientMatch } from "@/lib/match/auth";
import { ensurePresenceScanner } from "@/lib/match/presence";
import {
  countPlayingMatchesForIp,
  createMatch,
  MatchCreateError,
} from "@/lib/match/store";
import type { CreateMatchInput } from "@/lib/match/types";
import { readJsonBody } from "@/lib/security/bodyLimit";
import {
  clientIp,
  enforceRateLimit,
  tooManyRequests,
} from "@/lib/security/rateLimit";

export const runtime = "nodejs";

/** Each match costs a DB row and a live in-memory entry, so cap creation. */
const CREATE_RULE = { limit: 60, windowMs: 60_000, globalLimit: 600 };
/** Concurrent in-memory `playing` matches attributed to one client IP. */
const MAX_LIVE_PER_IP = 100;
/** A fixed set of match options. */
const MAX_BODY_BYTES = 4 * 1024;

export async function POST(req: Request) {
  try {
    const limit = enforceRateLimit(req, "match-create", CREATE_RULE);
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

    const ip = clientIp(req);
    if (countPlayingMatchesForIp(ip) >= MAX_LIVE_PER_IP) {
      return tooManyRequests(60);
    }

    const parsed = await readJsonBody<CreateMatchInput>(req, MAX_BODY_BYTES);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;
    if (!body.gameId || !body.mode || !body.players?.w || !body.players?.b) {
      return NextResponse.json({ error: "Invalid match payload" }, { status: 400 });
    }
    const match = createMatch(body, { creatorIp: ip });
    ensurePresenceScanner();
    return NextResponse.json({
      match: toClientMatch(match),
      playToken: match.playToken,
      spectateToken: match.spectateToken,
    });
  } catch (e) {
    if (e instanceof MatchCreateError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("POST /api/matches failed", e);
    return NextResponse.json(
      { error: "Failed to create match" },
      { status: 500 },
    );
  }
}
