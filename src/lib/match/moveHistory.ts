import type { PlayerColor } from "@/lib/games/types";
import type { ProviderId } from "@/lib/llm/providers";
import {
  isReasoningLevel,
  parseReasoningLevel,
  type ReasoningLevel,
} from "@/lib/llm/reasoning";
import type {
  Match,
  MoveFailureSample,
  MoveOutputSample,
  ThinkSample,
} from "@/lib/match/types";

const MAX_THINK_MS = 60 * 60 * 1000;
/** Persisted Replay snippets stay small; full reasoning stays out of SQLite. */
export const MAX_PERSISTED_OUTPUT_CHARS = 500;

export type MoveHistoryBlobV2 = {
  v: 2;
  moves: string[];
  thinks: ThinkSample[];
};

export type MoveHistoryBlobV3 = {
  v: 3;
  moves: string[];
  thinks: ThinkSample[];
  outputs: MoveOutputSample[];
};

export type MoveHistoryBlobV4 = {
  v: 4;
  moves: string[];
  thinks: ThinkSample[];
  outputs: MoveOutputSample[];
  failures: MoveFailureSample[];
};

export function sanitizeThinkMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > MAX_THINK_MS) return null;
  return Math.round(value);
}

/**
 * Prefer a compact JSON object from the model reply; otherwise hard-clip.
 * Keeps Replay useful without storing long reasoning traces.
 */
export function clipPersistedOutput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  const candidate =
    start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
  if (candidate.length <= MAX_PERSISTED_OUTPUT_CHARS) return candidate;
  return `${candidate.slice(0, MAX_PERSISTED_OUTPUT_CHARS)}… [truncated]`;
}

function clipFailureRaw(raw: string): string {
  const clipped = clipPersistedOutput(raw);
  if (clipped) return clipped;
  if (raw.length <= MAX_PERSISTED_OUTPUT_CHARS) return raw;
  return `${raw.slice(0, MAX_PERSISTED_OUTPUT_CHARS)}… [truncated]`;
}

/** Append a failed model attempt to the in-memory match (persisted on next DB write). */
export function appendMoveFailure(
  match: Match,
  input: {
    side: PlayerColor;
    error: string;
    raw: string;
    provider?: ProviderId;
    model?: string;
    countedStrike: boolean;
  },
): void {
  match.moveFailures.push({
    at: Date.now(),
    moveIndex: match.state.moveHistory.length,
    side: input.side,
    error: input.error,
    raw: clipFailureRaw(input.raw),
    provider: input.provider,
    model: input.model,
    countedStrike: input.countedStrike,
    reasoningLevel: match.reasoningLevel,
  });
}

export function encodeMoveHistory(match: Match): string {
  const moves = match.state.moveHistory;
  const thinks = match.thinkSamples;
  const outputs = match.moveOutputs;
  const failures = match.moveFailures;
  if (!thinks.length && !outputs.length && !failures.length) {
    return JSON.stringify(moves);
  }
  const blob: MoveHistoryBlobV4 = { v: 4, moves, thinks, outputs, failures };
  return JSON.stringify(blob);
}

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && value.length > 0 && value.length < 32;
}

function parseThinkSample(value: unknown): ThinkSample | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const thinkMs = sanitizeThinkMs(o.thinkMs);
  if (thinkMs === null) return null;
  if (!isProviderId(o.provider) || typeof o.model !== "string" || !o.model) {
    return null;
  }
  if (o.side !== "w" && o.side !== "b") return null;
  if (typeof o.san !== "string" || !o.san) return null;
  const at = typeof o.at === "number" && Number.isFinite(o.at) ? o.at : 0;
  let reasoningLevel: ReasoningLevel;
  if (isReasoningLevel(o.reasoningLevel)) {
    reasoningLevel = o.reasoningLevel;
  } else {
    // Legacy thinks used boolean `reasoning`.
    reasoningLevel = parseReasoningLevel(o.reasoning);
  }
  return {
    at,
    side: o.side as PlayerColor,
    provider: o.provider,
    model: o.model,
    san: o.san,
    thinkMs,
    reasoningLevel,
  };
}

function parseMoveOutput(value: unknown): MoveOutputSample | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  if (
    typeof o.moveIndex !== "number" ||
    !Number.isInteger(o.moveIndex) ||
    o.moveIndex < 0
  ) {
    return null;
  }
  if (o.side !== "w" && o.side !== "b") return null;
  if (typeof o.san !== "string" || !o.san) return null;
  if (typeof o.raw !== "string") return null;
  return {
    moveIndex: o.moveIndex,
    side: o.side,
    san: o.san,
    raw: o.raw.length > MAX_PERSISTED_OUTPUT_CHARS
      ? `${o.raw.slice(0, MAX_PERSISTED_OUTPUT_CHARS)}… [truncated]`
      : o.raw,
  };
}

function parseMoveFailure(value: unknown): MoveFailureSample | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  if (
    typeof o.moveIndex !== "number" ||
    !Number.isInteger(o.moveIndex) ||
    o.moveIndex < 0
  ) {
    return null;
  }
  if (o.side !== "w" && o.side !== "b") return null;
  if (typeof o.error !== "string" || !o.error) return null;
  if (typeof o.raw !== "string") return null;
  const at = typeof o.at === "number" && Number.isFinite(o.at) ? o.at : 0;
  const provider = isProviderId(o.provider) ? o.provider : undefined;
  const model = typeof o.model === "string" && o.model ? o.model : undefined;
  return {
    at,
    moveIndex: o.moveIndex,
    side: o.side,
    error: o.error,
    raw:
      o.raw.length > MAX_PERSISTED_OUTPUT_CHARS
        ? `${o.raw.slice(0, MAX_PERSISTED_OUTPUT_CHARS)}… [truncated]`
        : o.raw,
    provider,
    model,
    countedStrike: o.countedStrike === true,
    // Records written before reasoningLevel was persisted were all from Off.
    reasoningLevel: isReasoningLevel(o.reasoningLevel)
      ? o.reasoningLevel
      : "off",
  };
}

export function decodeMoveHistory(raw: string): {
  moves: string[];
  thinks: ThinkSample[];
  outputs: MoveOutputSample[];
  failures: MoveFailureSample[];
} {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return {
        moves: parsed.filter((m): m is string => typeof m === "string"),
        thinks: [],
        outputs: [],
        failures: [],
      };
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { moves?: unknown }).moves)
    ) {
      const blob = parsed as Partial<MoveHistoryBlobV4>;
      const moves = (blob.moves ?? []).filter(
        (m): m is string => typeof m === "string",
      );
      const thinks = Array.isArray(blob.thinks)
        ? blob.thinks
            .map(parseThinkSample)
            .filter((t): t is ThinkSample => t !== null)
        : [];
      const outputs = Array.isArray(blob.outputs)
        ? blob.outputs
            .map(parseMoveOutput)
            .filter((o): o is MoveOutputSample => o !== null)
        : [];
      const failures = Array.isArray(blob.failures)
        ? blob.failures
            .map(parseMoveFailure)
            .filter((f): f is MoveFailureSample => f !== null)
        : [];
      return { moves, thinks, outputs, failures };
    }
  } catch {
    /* ignore */
  }
  return { moves: [], thinks: [], outputs: [], failures: [] };
}
