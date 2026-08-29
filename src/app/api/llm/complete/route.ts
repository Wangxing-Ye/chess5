import { NextResponse } from "next/server";
import { completeLLM, providerErrorCode } from "@/lib/llm/complete";
import { PROVIDERS, type ProviderId } from "@/lib/llm/providers";
import { extractPlayToken, requirePlayToken } from "@/lib/match/auth";
import { getMatch } from "@/lib/match/store";
import { readJsonBody } from "@/lib/security/bodyLimit";
import {
  enforceRateLimit,
  enforceRateLimitBy,
  tooManyRequests,
} from "@/lib/security/rateLimit";

export const runtime = "nodejs";

const LLM_RULE = { limit: 600, windowMs: 60_000, globalLimit: 6000 };
/** Cap LLM proxy calls for a single match (keyed on authenticated matchId). */
const LLM_MATCH_RULE = { limit: 60, windowMs: 60_000 };
/** The largest real prompt (chess with a full legal-move list) is ~3 KB. */
const MAX_BODY_BYTES = 16 * 1024;

type Body = {
  provider: ProviderId;
  model?: string;
  apiKey: string;
  prompt: string;
  /** Required: the match this move is being generated for. */
  matchId?: string;
};

export async function POST(req: Request) {
  try {
    const limit = enforceRateLimit(req, "llm", LLM_RULE);
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

    const parsed = await readJsonBody<Body>(req, MAX_BODY_BYTES);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;
    if (!body.provider || !body.apiKey || !body.prompt) {
      return NextResponse.json(
        { error: "provider, apiKey, and prompt are required" },
        { status: 400 },
      );
    }

    // The proxy is only for moves in a match the caller is playing — without
    // this it would be an open relay to every provider.
    if (!body.matchId) {
      return NextResponse.json({ error: "matchId is required" }, { status: 400 });
    }
    const match = getMatch(body.matchId);
    if (!match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }
    if (!requirePlayToken(match, extractPlayToken(req))) {
      return NextResponse.json({ error: "Play token required" }, { status: 401 });
    }

    const matchLimit = enforceRateLimitBy(
      body.matchId,
      "llm-match",
      LLM_MATCH_RULE,
    );
    if (!matchLimit.allowed) {
      return tooManyRequests(matchLimit.retryAfterSeconds);
    }

    const provider = PROVIDERS.find((p) => p.id === body.provider);
    if (!provider) {
      return NextResponse.json({ error: "unknown provider" }, { status: 400 });
    }
    const model = body.model || provider.defaultModel;
    if (!provider.models.includes(model)) {
      return NextResponse.json({ error: "model not allowed" }, { status: 400 });
    }

    const result = await completeLLM({
      provider: body.provider,
      model,
      apiKey: body.apiKey,
      prompt: body.prompt,
      reasoningLevel: match.reasoningLevel,
    });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "LLM request failed";
    return NextResponse.json(
      { error: message, code: providerErrorCode(e) },
      { status: 502 },
    );
  }
}
