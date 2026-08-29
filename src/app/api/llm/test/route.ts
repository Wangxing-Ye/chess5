import { NextResponse } from "next/server";
import { completeLLM, providerErrorCode } from "@/lib/llm/complete";
import { PROVIDERS, type ProviderId } from "@/lib/llm/providers";
import { readJsonBody } from "@/lib/security/bodyLimit";
import { enforceRateLimit, tooManyRequests } from "@/lib/security/rateLimit";

export const runtime = "nodejs";

/**
 * Credential check only: the prompt is fixed and the model output is never
 * returned, so this cannot be used to relay arbitrary completions.
 */
const TEST_PROMPT = 'Reply with JSON only: {"move":"ok","comment":"ping"}';
const TEST_RULE = { limit: 10, windowMs: 60_000, globalLimit: 60 };
const MAX_KEY_LENGTH = 512;
/** Only a provider id and a key. */
const MAX_BODY_BYTES = 2 * 1024;

type Body = { provider: ProviderId; apiKey: string };

export async function POST(req: Request) {
  try {
    const limit = enforceRateLimit(req, "llm-test", TEST_RULE);
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

    const parsed = await readJsonBody<Body>(req, MAX_BODY_BYTES);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;
    if (!body.provider || !body.apiKey) {
      return NextResponse.json(
        { error: "provider and apiKey are required" },
        { status: 400 },
      );
    }
    if (body.apiKey.length > MAX_KEY_LENGTH) {
      return NextResponse.json({ error: "apiKey too long" }, { status: 400 });
    }

    const provider = PROVIDERS.find((p) => p.id === body.provider);
    if (!provider) {
      return NextResponse.json({ error: "unknown provider" }, { status: 400 });
    }

    await completeLLM({
      provider: provider.id,
      model: provider.defaultModel,
      apiKey: body.apiKey,
      prompt: TEST_PROMPT,
    });
    return NextResponse.json({ ok: true, model: provider.defaultModel });
  } catch (e) {
    const message = e instanceof Error ? e.message : "LLM request failed";
    return NextResponse.json(
      { error: message, code: providerErrorCode(e) },
      { status: 502 },
    );
  }
}
