import { ERROR_CODES, type ErrorCode } from "@/lib/api/errors";
import {
  classifyProviderError,
  minimaxBusinessFailed,
  tryParseJsonBody,
} from "@/lib/llm/classifyProviderError";
import {
  applyAnthropicReasoning,
  applyGeminiReasoning,
  applyOpenAiStyleReasoning,
  parseReasoningLevel,
  type ReasoningLevel,
} from "@/lib/llm/reasoning";
import { getProvider, type ProviderId } from "./providers";

export type CompleteRequest = {
  provider: ProviderId;
  model: string;
  apiKey: string;
  prompt: string;
  /** Arena Reasoning level (off / low / medium / high). */
  reasoningLevel?: ReasoningLevel;
  /** @deprecated Prefer reasoningLevel. true → high, false → off. */
  reasoning?: boolean;
};

export type CompleteResponse = {
  text: string;
  provider: ProviderId;
  model: string;
  /**
   * When extracted `text` is empty, a clipped JSON snapshot of the provider
   * response so Play UI / llmLog can show what came back.
   */
  providerRaw?: string;
};

const MAX_ERROR_CHARS = 300;
/** Keep in sync with match llmLog clip — shown in SSE snapshots. */
const MAX_PROVIDER_RAW_CHARS = 2000;

function clipProviderRaw(payload: unknown): string {
  try {
    const s = JSON.stringify(payload);
    if (s.length <= MAX_PROVIDER_RAW_CHARS) return s;
    return `${s.slice(0, MAX_PROVIDER_RAW_CHARS)}… [truncated]`;
  } catch {
    return "(unserializable provider payload)";
  }
}

function withExtractedText(
  text: string,
  provider: ProviderId,
  model: string,
  emptyPayload: unknown,
): CompleteResponse {
  const trimmed = text.trim();
  if (trimmed) {
    return { text: trimmed, provider, model };
  }
  return {
    text: "",
    provider,
    model,
    providerRaw: clipProviderRaw(emptyPayload),
  };
}

/** Providers echo the rejected key back in their error text. */
export class ProviderError extends Error {
  /** What the provider answered, which is not what we answer the client. */
  readonly status: number;
  /** Classified failure for Play / Keys UI. */
  readonly code: ErrorCode;

  constructor(
    name: string,
    status: number,
    body: string,
    apiKey: string,
    code: ErrorCode,
  ) {
    const safe = apiKey ? body.replaceAll(apiKey, "***") : body;
    super(`${name} error ${status}: ${safe.slice(0, MAX_ERROR_CHARS)}`);
    this.name = "ProviderError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Everything the proxy cannot complete comes back as a 502, so the reason has
 * to travel as a code: a bad key needs the user to go fix it, while an
 * overloaded provider just needs another attempt.
 */
export function providerErrorCode(e: unknown): ErrorCode {
  if (e instanceof ProviderError) return e.code;
  // fetch network failures and unknown throws → server_error (retryable).
  return ERROR_CODES.serverError;
}

function throwProviderFailure(
  providerId: ProviderId,
  name: string,
  httpStatus: number,
  rawBody: string,
  apiKey: string,
): never {
  const parsed = tryParseJsonBody(rawBody);
  const code = classifyProviderError(providerId, httpStatus, parsed ?? rawBody);
  throw new ProviderError(name, httpStatus, rawBody, apiKey, code);
}

function resolveLevel(req: CompleteRequest): ReasoningLevel {
  if (req.reasoningLevel !== undefined) return parseReasoningLevel(req.reasoningLevel);
  return parseReasoningLevel(req.reasoning);
}

export async function completeLLM(req: CompleteRequest): Promise<CompleteResponse> {
  const provider = getProvider(req.provider);
  const level = resolveLevel(req);

  if (provider.style === "openai") {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: [
        {
          role: "system",
          content:
            "You are a precise board-game move selector. Reply with JSON only.",
        },
        { role: "user", content: req.prompt },
      ],
    };
    // Leave temperature unset so each vendor uses its own default.
    applyOpenAiStyleReasoning(body, req.provider, level, req.model);

    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${req.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const rawText = await res.text();
    const parsed = tryParseJsonBody(rawText);

    if (!res.ok) {
      throwProviderFailure(
        req.provider,
        provider.name,
        res.status,
        rawText,
        req.apiKey,
      );
    }

    // MiniMax may return HTTP 200 with a non-zero base_resp.status_code.
    if (req.provider === "minimax" && minimaxBusinessFailed(parsed)) {
      throwProviderFailure(
        req.provider,
        provider.name,
        res.status,
        rawText,
        req.apiKey,
      );
    }

    const data = (parsed ?? {}) as {
      choices?: {
        message?: {
          content?: string | null;
          refusal?: string | null;
        };
        finish_reason?: string;
      }[];
    };
    const message = data.choices?.[0]?.message;
    const text = message?.content ?? "";
    return withExtractedText(text, req.provider, req.model, {
      finish_reason: data.choices?.[0]?.finish_reason,
      message: message ?? null,
    });
  }

  if (provider.style === "anthropic") {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: [{ role: "user", content: req.prompt }],
      system:
        "You are a precise board-game move selector. Reply with JSON only.",
    };
    applyAnthropicReasoning(body, level, req.model);

    const res = await fetch(`${provider.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": req.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      throwProviderFailure(
        req.provider,
        provider.name,
        res.status,
        err,
        req.apiKey,
      );
    }
    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
      stop_reason?: string;
    };
    const text =
      data.content
        ?.filter((c) => c.type === "text" && c.text)
        .map((c) => c.text!)
        .join("") ?? "";
    return withExtractedText(text, req.provider, req.model, {
      stop_reason: data.stop_reason,
      content: data.content ?? [],
    });
  }

  const generationConfig: Record<string, unknown> = {};
  applyGeminiReasoning(generationConfig, level);

  const url = `${provider.baseUrl}/models/${req.model}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": req.apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: req.prompt }] }],
      generationConfig,
      systemInstruction: {
        parts: [
          {
            text: "You are a precise board-game move selector. Reply with JSON only.",
          },
        ],
      },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throwProviderFailure(
      req.provider,
      provider.name,
      res.status,
      err,
      req.apiKey,
    );
  }
  const data = (await res.json()) as {
    candidates?: {
      content?: { parts?: { text?: string; thought?: boolean }[] };
      finishReason?: string;
    }[];
    promptFeedback?: unknown;
  };
  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const text =
    parts
      .filter((p) => !p.thought && p.text)
      .map((p) => p.text)
      .join("") ||
    parts.map((p) => p.text).filter(Boolean).join("") ||
    "";
  return withExtractedText(text, req.provider, req.model, {
    finishReason: candidate?.finishReason,
    parts,
    promptFeedback: data.promptFeedback ?? null,
  });
}
