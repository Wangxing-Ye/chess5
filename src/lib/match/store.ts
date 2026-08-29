import { getMatchRecord, insertMatchRecord } from "@/lib/db/matches";
import { getEngine } from "@/lib/games";
import {
  parseReasoningLevel,
  supportsReasoningOff,
} from "@/lib/llm/reasoning";
import { newMatchId, newToken } from "./auth";
import type { CreateMatchInput, Match } from "./types";

const globalStore = globalThis as unknown as {
  __chess5Matches?: Map<string, Match>;
};

function matches(): Map<string, Match> {
  if (!globalStore.__chess5Matches) {
    globalStore.__chess5Matches = new Map();
  }
  return globalStore.__chess5Matches;
}

export function listMatchIds(): string[] {
  return [...matches().keys()];
}

export class MatchCreateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MatchCreateError";
  }
}

function assertReasoningOffModels(input: CreateMatchInput): void {
  const level = parseReasoningLevel(input.reasoningLevel ?? input.reasoning);
  if (level !== "off") return;
  for (const side of ["w", "b"] as const) {
    const p = input.players[side];
    if (p.kind !== "model" || !p.provider || !p.model) continue;
    if (!supportsReasoningOff(p.provider, p.model)) {
      throw new MatchCreateError(
        `Reasoning Off is not supported for ${p.provider} · ${p.model}`,
      );
    }
  }
}

export function createMatch(
  input: CreateMatchInput,
  opts?: { creatorIp?: string },
): Match {
  assertReasoningOffModels(input);
  const engine = getEngine(input.gameId);
  const options = input.gameId === "go" ? { size: input.goSize ?? 9 } : undefined;
  const now = Date.now();
  const match: Match = {
    id: newMatchId(),
    createdAt: now,
    updatedAt: now,
    gameId: input.gameId,
    mode: input.mode,
    status: "playing",
    players: input.players,
    state: engine.newGame(options),
    publicSpectate: input.publicSpectate ?? true,
    autoPlay: input.autoPlay ?? input.mode === "model_vs_model",
    autoDelayMs: input.autoDelayMs ?? 3000,
    reasoningLevel: parseReasoningLevel(
      input.reasoningLevel ?? input.reasoning,
    ),
    legalMovesProtection:
      input.gameId === "go" || input.gameId === "gomoku"
        ? false
        : (input.legalMovesProtection ?? true),
    tacticalGuidance: input.tacticalGuidance ?? true,
    lastHeartbeatAt: now,
    llmLog: [],
    thinkSamples: [],
    moveOutputs: [],
    moveFailures: [],
    illegalStrikes: { w: 0, b: 0 },
    playToken: newToken(),
    spectateToken: newToken(),
    creatorIp: opts?.creatorIp,
  };
  matches().set(match.id, match);
  insertMatchRecord(match);
  return match;
}

/** How many in-memory matches for this creator are still `playing`. */
export function countPlayingMatchesForIp(creatorIp: string): number {
  let n = 0;
  for (const m of matches().values()) {
    if (m.status === "playing" && m.creatorIp === creatorIp) n += 1;
  }
  return n;
}

export function getMatch(matchId: string): Match | undefined {
  const match = matches().get(matchId);
  if (match && match.seq == null) {
    const row = getMatchRecord(matchId);
    if (row) match.seq = row.seq;
  }
  return match;
}

export function saveMatch(match: Match): Match {
  match.updatedAt = Date.now();
  matches().set(match.id, match);
  return match;
}

/**
 * Keep finished matches in memory briefly so open play/spectate views can
 * receive the final state, then evict. The permanent record lives in SQLite.
 */
const FINISHED_RETENTION_MS = 5 * 60_000;

export function scheduleEviction(matchId: string): void {
  const timer = setTimeout(() => {
    matches().delete(matchId);
  }, FINISHED_RETENTION_MS);
  timer.unref?.();
}
