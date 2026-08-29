import { finishMatchRecord, updateMatchProgress } from "@/lib/db/matches";
import { getEngine } from "@/lib/games";
import type { Move, PlayerColor } from "@/lib/games/types";
import type { ProviderId } from "@/lib/llm/providers";
import { appendMoveFailure } from "./moveHistory";
import { saveMatch, scheduleEviction } from "./store";
import type { Match } from "./types";

const MAX_ILLEGAL = 3;

function finish(match: Match): void {
  match.status = "finished";
  finishMatchRecord(match);
  scheduleEviction(match.id);
}

export function applyPlayerMove(match: Match, move: Move | string): Match {
  if (match.status !== "playing") throw new Error("Match is not playing");
  const engine = getEngine(match.gameId);
  const nextState = engine.applyMove(match.state, move);
  match.state = nextState;
  const term = engine.isTerminal(nextState);
  if (term.over && term.result) {
    match.result = term.result;
    finish(match);
    return match;
  }
  saveMatch(match);
  updateMatchProgress(match);
  return match;
}

export function registerIllegal(
  match: Match,
  side: PlayerColor,
  raw: string,
  error: string,
  meta?: { provider?: ProviderId; model?: string },
): Match {
  match.illegalStrikes[side] += 1;
  match.llmLog.push({
    at: Date.now(),
    side,
    raw,
    error,
    provider: meta?.provider,
    model: meta?.model,
  });
  appendMoveFailure(match, {
    side,
    raw,
    error,
    provider: meta?.provider,
    model: meta?.model,
    countedStrike: true,
  });
  if (match.illegalStrikes[side] >= MAX_ILLEGAL) {
    match.result = {
      winner: side === "w" ? "b" : "w",
      reason: "illegal-moves",
    };
    finish(match);
  } else {
    saveMatch(match);
    updateMatchProgress(match);
  }
  return match;
}

/**
 * Log a model failure that is not an illegal SAN (e.g. provider refusal).
 * Does not increment illegal strikes or end the match.
 */
export function registerLlmSoftFailure(
  match: Match,
  side: PlayerColor,
  raw: string,
  error: string,
  meta?: { provider?: ProviderId; model?: string },
): Match {
  match.llmLog.push({
    at: Date.now(),
    side,
    raw,
    error,
    provider: meta?.provider,
    model: meta?.model,
  });
  appendMoveFailure(match, {
    side,
    raw,
    error,
    provider: meta?.provider,
    model: meta?.model,
    countedStrike: false,
  });
  saveMatch(match);
  updateMatchProgress(match);
  return match;
}

export function resign(match: Match, side: PlayerColor): Match {
  match.result = {
    winner: side === "w" ? "b" : "w",
    reason: "resign",
  };
  finish(match);
  return saveMatch(match);
}

/** End a match early with no winner on either side. */
export function abort(
  match: Match,
  reason: "aborted" | "end-match" = "aborted",
): Match {
  match.result = { winner: null, reason };
  finish(match);
  return saveMatch(match);
}
