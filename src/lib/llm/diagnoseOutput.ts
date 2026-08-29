/**
 * When a model reply has no usable `move`, classify provider terminal
 * reasons vs leftover content for Play UI / illegal-strike decisions.
 */

import { extractMoveFromModelText } from "@/lib/games/extractMove";

const MAX_DETAIL_CHARS = 500;

/** Values that mean the provider blocked / refused rather than a bad SAN. */
const REFUSAL_LIKE = new Set([
  "refusal",
  "content_filter",
  "safety",
  "prohibited_content",
  "recitation",
  "spii",
  "blocklist",
  "blocked",
  "other",
]);

export type LlmFailureDiagnosis = {
  /** Log / UI detail (field=value, content snippet, or generic parse miss). */
  detail: string;
  /** Do not increment illegal strikes or auto-retry as an illegal move. */
  skipIllegalStrike: boolean;
};

function clip(text: string): string {
  const t = text.trim();
  if (t.length <= MAX_DETAIL_CHARS) return t;
  return `${t.slice(0, MAX_DETAIL_CHARS)}… [truncated]`;
}

function tryParseObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidates = [trimmed];
  const embedded = trimmed.match(/\{[\s\S]*\}/);
  if (embedded && embedded[0] !== trimmed) candidates.push(embedded[0]);
  for (const c of candidates) {
    try {
      const v = JSON.parse(c) as unknown;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        return v as Record<string, unknown>;
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

function asNonEmptyString(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

/** True when the payload is move-shaped JSON with a non-empty move field. */
export function hasMoveField(raw: string): boolean {
  return Boolean(extractMoveFromModelText(raw));
}

function readTerminalReason(
  obj: Record<string, unknown>,
): { field: string; value: string } | null {
  const stop = asNonEmptyString(obj.stop_reason);
  if (stop) return { field: "stop_reason", value: stop };

  const finish = asNonEmptyString(obj.finish_reason);
  if (finish) return { field: "finish_reason", value: finish };

  const choice0 = Array.isArray(obj.choices) ? obj.choices[0] : null;
  if (choice0 && typeof choice0 === "object") {
    const fr = asNonEmptyString(
      (choice0 as { finish_reason?: unknown }).finish_reason,
    );
    if (fr) return { field: "finish_reason", value: fr };
  }

  const finishReason = asNonEmptyString(obj.finishReason);
  if (finishReason) return { field: "finishReason", value: finishReason };

  const cand0 = Array.isArray(obj.candidates) ? obj.candidates[0] : null;
  if (cand0 && typeof cand0 === "object") {
    const fr = asNonEmptyString(
      (cand0 as { finishReason?: unknown }).finishReason,
    );
    if (fr) return { field: "finishReason", value: fr };
  }

  const feedback = obj.promptFeedback;
  if (feedback && typeof feedback === "object") {
    const block = asNonEmptyString(
      (feedback as { blockReason?: unknown }).blockReason,
    );
    if (block) return { field: "promptFeedback.blockReason", value: block };
  }

  return null;
}

function extractContentBlob(obj: Record<string, unknown>): string | null {
  const message = obj.message;
  if (message && typeof message === "object") {
    const m = message as { content?: unknown; refusal?: unknown };
    const refusal = asNonEmptyString(m.refusal);
    if (refusal) return refusal;
    const c = asNonEmptyString(m.content);
    if (c) return c;
  }

  const topRefusal = asNonEmptyString(obj.refusal);
  if (topRefusal) return topRefusal;

  const content = obj.content;
  if (typeof content === "string" && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const texts = content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          return asNonEmptyString((part as { text?: unknown }).text) ?? "";
        }
        return "";
      })
      .filter(Boolean);
    if (texts.length) return texts.join("");
  }

  const parts = obj.parts;
  if (Array.isArray(parts)) {
    const texts = parts
      .map((p) =>
        p && typeof p === "object"
          ? asNonEmptyString((p as { text?: unknown }).text) ?? ""
          : "",
      )
      .filter(Boolean);
    if (texts.length) return texts.join("");
  }

  return null;
}

function isRefusalLike(value: string): boolean {
  return REFUSAL_LIKE.has(value.trim().toLowerCase());
}

/**
 * Prefer `modelText`; if empty, use `providerRaw` (clipped provider snapshot).
 */
export function diagnoseLlmFailure(
  modelText: string,
  providerRaw?: string,
): LlmFailureDiagnosis {
  const primary = modelText.trim();
  const fallback = (providerRaw ?? "").trim();
  const raw = primary || fallback;

  if (hasMoveField(raw)) {
    return {
      detail: "illegal or unparsable move",
      skipIllegalStrike: false,
    };
  }

  const obj = tryParseObject(raw);
  if (obj) {
    const terminal = readTerminalReason(obj);
    if (terminal) {
      const detail = `${terminal.field}: ${terminal.value}`;
      return {
        detail,
        skipIllegalStrike: isRefusalLike(terminal.value),
      };
    }

    // OpenAI-style refusal string without a terminal finish_reason we care about
    const content = extractContentBlob(obj);
    if (content) {
      const msgRefusal =
        obj.message && typeof obj.message === "object"
          ? asNonEmptyString((obj.message as { refusal?: unknown }).refusal)
          : null;
      const fromRefusalField = Boolean(
        asNonEmptyString(obj.refusal) || msgRefusal,
      );
      return {
        detail: clip(content),
        skipIllegalStrike: fromRefusalField,
      };
    }
  }

  if (raw) {
    return { detail: clip(raw), skipIllegalStrike: false };
  }

  return {
    detail: "illegal or unparsable move",
    skipIllegalStrike: false,
  };
}
