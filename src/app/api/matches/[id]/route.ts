import { NextResponse } from "next/server";
import { getEngine } from "@/lib/games";
import type { PlayerColor } from "@/lib/games/types";
import type { ProviderId } from "@/lib/llm/providers";
import {
  canSpectate,
  extractPlayToken,
  extractSpectateToken,
  requirePlayToken,
  toClientMatch,
} from "@/lib/match/auth";
import {
  abort,
  applyPlayerMove,
  registerIllegal,
  registerLlmSoftFailure,
  resign,
} from "@/lib/match/engine";
import { sanitizeThinkMs, clipPersistedOutput } from "@/lib/match/moveHistory";
import { ensurePresenceScanner, touchHeartbeat } from "@/lib/match/presence";
import {
  canResignAtPly,
  MIN_RESIGN_PLIES,
} from "@/lib/match/resign";
import { matchNotFoundResponse } from "@/lib/match/notFound";
import { getMatch, saveMatch } from "@/lib/match/store";
import { updateMatchPlayers } from "@/lib/db/matches";
import { readJsonBody } from "@/lib/security/bodyLimit";
import { enforceRateLimitBy, tooManyRequests } from "@/lib/security/rateLimit";

export const runtime = "nodejs";

/**
 * Keyed on the match rather than the caller: a legitimate match has a bounded
 * call rate (heartbeats plus moves), and the id is authenticated by the play
 * token so it cannot be forged to widen the allowance.
 */
const PATCH_RULE = { limit: 120, windowMs: 60_000, globalLimit: 3000 };
/** Renaming writes to SQLite, so it gets a tighter budget of its own. */
const RENAME_RULE = { limit: 10, windowMs: 60_000 };
/** Reasoning models can legitimately return a few tens of KB of text. */
const MAX_BODY_BYTES = 64 * 1024;
/**
 * Everything in `llmLog` is replayed to every spectator in each SSE snapshot,
 * so model output is clipped before it is stored.
 */
const MAX_LOGGED_CHARS = 2000;

function clip(text: string): string {
  return text.length > MAX_LOGGED_CHARS
    ? `${text.slice(0, MAX_LOGGED_CHARS)}… [truncated]`
    : text;
}

/**
 * Display names are rendered next to opponents and in stats. React escapes
 * markup, but control and format characters (bidi overrides, zero-width
 * joiners) can still scramble surrounding text, so they are dropped.
 */
function sanitizeName(name: string): string {
  return name.replace(/[\p{Cc}\p{Cf}]/gu, "").trim();
}

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const match = getMatch(id);
  if (!match) return matchNotFoundResponse(id);

  const url = new URL(req.url);
  const token =
    extractSpectateToken(req, url) || extractPlayToken(req);
  if (!canSpectate(match, token)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ match: toClientMatch(match) });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const match = getMatch(id);
  if (!match) return matchNotFoundResponse(id);

  const playToken = extractPlayToken(req);
  if (!requirePlayToken(match, playToken)) {
    return NextResponse.json({ error: "Play token required" }, { status: 401 });
  }

  const limit = enforceRateLimitBy(id, "match-patch", PATCH_RULE);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  const parsedBody = await readJsonBody<{
    action:
      | "move"
      | "resign"
      | "abort"
      | "llm_result"
      | "set_auto"
      | "pass"
      | "set_human_name"
      | "heartbeat";
    move?: string;
    side?: PlayerColor;
    raw?: string;
    error?: string;
    parsedMove?: string;
    /**
     * When false, log the failure without counting an illegal strike
     * (provider refusal / safety block with no move).
     */
    countIllegal?: boolean;
    provider?: ProviderId;
    model?: string;
    autoPlay?: boolean;
    autoDelayMs?: number;
    name?: string;
    /** Client-measured LLM round-trip for a successful model move. */
    thinkMs?: number;
  }>(req, MAX_BODY_BYTES);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.data;

  try {
    if (body.action === "set_auto") {
      if (typeof body.autoPlay === "boolean") match.autoPlay = body.autoPlay;
      if (typeof body.autoDelayMs === "number") match.autoDelayMs = body.autoDelayMs;
      return NextResponse.json({ match: toClientMatch(saveMatch(match)) });
    }

    if (body.action === "heartbeat") {
      if (match.status !== "playing") {
        return NextResponse.json({ match: toClientMatch(match) });
      }
      ensurePresenceScanner();
      return NextResponse.json({
        match: toClientMatch(touchHeartbeat(match)),
      });
    }

    if (body.action === "set_human_name") {
      if (body.side !== "w" && body.side !== "b") {
        return NextResponse.json({ error: "side required" }, { status: 400 });
      }
      const player = match.players[body.side];
      if (player.kind !== "human") {
        return NextResponse.json(
          { error: "Not a human player" },
          { status: 400 },
        );
      }
      const raw = sanitizeName(typeof body.name === "string" ? body.name : "");
      if (raw.length > 20) {
        return NextResponse.json(
          { error: "Name must be at most 20 characters" },
          { status: 400 },
        );
      }
      // Renaming to the current value must not cost a write.
      if (raw === (player.name ?? "")) {
        return NextResponse.json({ match: toClientMatch(match) });
      }
      const renameLimit = enforceRateLimitBy(id, "match-rename", RENAME_RULE);
      if (!renameLimit.allowed) {
        return tooManyRequests(renameLimit.retryAfterSeconds);
      }
      if (raw) player.name = raw;
      else delete player.name;
      saveMatch(match);
      updateMatchPlayers(match);
      return NextResponse.json({ match: toClientMatch(match) });
    }

    if (body.action === "resign") {
      if (match.mode === "model_vs_model") {
        return NextResponse.json(
          { error: "Resign is not available in model vs model" },
          { status: 400 },
        );
      }
      if (!body.side) {
        return NextResponse.json({ error: "side required" }, { status: 400 });
      }
      if (!canResignAtPly(match.state.moveHistory.length)) {
        return NextResponse.json(
          {
            error: `Resign is available after ${MIN_RESIGN_PLIES} moves`,
            code: "resign_too_early",
          },
          { status: 400 },
        );
      }
      return NextResponse.json({ match: toClientMatch(resign(match, body.side)) });
    }

    if (body.action === "abort") {
      return NextResponse.json({
        match: toClientMatch(abort(match, "end-match")),
      });
    }

    if (body.action === "llm_result") {
      const side = body.side ?? match.state.turn;
      const raw = clip(body.raw ?? "");
      if (body.error || !body.parsedMove) {
        const err = clip(body.error ?? "unparsed move");
        if (body.countIllegal === false) {
          return NextResponse.json({
            match: toClientMatch(
              registerLlmSoftFailure(match, side, raw, err, {
                provider: body.provider,
                model: body.model,
              }),
            ),
          });
        }
        return NextResponse.json({
          match: toClientMatch(
            registerIllegal(match, side, raw, err, {
              provider: body.provider,
              model: body.model,
            }),
          ),
        });
      }
      const engine = getEngine(match.gameId);
      const parsed = engine.parseMove(body.parsedMove, match.state);
      if (!parsed) {
        return NextResponse.json({
          match: toClientMatch(
            registerIllegal(
              match,
              side,
              raw || clip(body.parsedMove),
              "illegal or unparsable move",
              { provider: body.provider, model: body.model },
            ),
          ),
        });
      }
      match.llmLog.push({
        at: Date.now(),
        side,
        provider: body.provider,
        model: body.model,
        raw,
        parsedMove: parsed.san,
      });
      const persistedRaw = clipPersistedOutput(body.raw ?? raw);
      if (persistedRaw) {
        match.moveOutputs.push({
          moveIndex: match.state.moveHistory.length,
          side,
          san: parsed.san,
          raw: persistedRaw,
        });
      }
      const thinkMs = sanitizeThinkMs(body.thinkMs);
      if (thinkMs !== null && body.provider && body.model) {
        match.thinkSamples.push({
          at: Date.now(),
          side,
          provider: body.provider,
          model: body.model,
          san: parsed.san,
          thinkMs,
          reasoningLevel: match.reasoningLevel,
        });
      }
      return NextResponse.json({
        match: toClientMatch(applyPlayerMove(match, parsed)),
      });
    }

    if (body.action === "move" || body.action === "pass") {
      if (!body.move && body.action !== "pass") {
        return NextResponse.json({ error: "move required" }, { status: 400 });
      }
      const move = body.action === "pass" ? "pass" : body.move!;
      return NextResponse.json({
        match: toClientMatch(applyPlayerMove(match, move)),
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    // Engine and driver messages can carry internals, so they stay server-side.
    console.error(`PATCH /api/matches/${id} failed`, e);
    return NextResponse.json({ error: "Action failed" }, { status: 400 });
  }
}
