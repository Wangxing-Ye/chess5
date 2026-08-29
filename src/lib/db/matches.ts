import type { GameId } from "@/lib/games/types";
import type {
  Match,
  MatchMode,
  MoveFailureSample,
  MoveOutputSample,
  Participant,
} from "@/lib/match/types";
import {
  decodeMoveHistory,
  encodeMoveHistory,
} from "@/lib/match/moveHistory";
import { db } from "./index";
import { bumpMatchesCount, getMatchesCount } from "./appMeta";
import {
  applyMatchEndStats,
  bumpMatchStart,
  readFailuresFromAgg,
  readHvmFromAgg,
  readHvmPlayersFromAgg,
  readMvmFromAgg,
  readThinkFromAgg,
  type AggMatchRow,
} from "./statsAgg";

export type MatchRow = {
  id: string;
  /** Stable 1-based series number assigned at insert; never reused. */
  seq: number;
  game_id: GameId;
  mode: MatchMode;
  started_at: number;
  ended_at: number | null;
  winner: string | null;
  win_reason: string | null;
  player_w: string;
  player_b: string;
  move_history: string;
  move_count: number;
  stats_applied: number;
};

/** Columns needed for History list (no move_history blob). */
export type MatchListRow = {
  id: string;
  seq: number;
  game_id: GameId;
  mode: MatchMode;
  started_at: number;
  ended_at: number | null;
  winner: string | null;
  win_reason: string | null;
  player_w: string;
  player_b: string;
  move_count: number;
};

/**
 * Small TTL cache for stats aggregations so `/stats` never rescans the table
 * on every request under load. Busted on writes for freshness at low traffic.
 */
const STATS_CACHE_TTL_MS = 30_000;
const statsCache = new Map<string, { at: number; value: unknown }>();

function cached<T>(key: string, compute: () => T): T {
  const hit = statsCache.get(key);
  if (hit && Date.now() - hit.at < STATS_CACHE_TTL_MS) {
    return hit.value as T;
  }
  const value = compute();
  statsCache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * Pass the key prefixes a write actually affects so a burst of updates cannot
 * keep every aggregation permanently cold; with no arguments everything is
 * dropped.
 */
function bustStatsCache(...prefixes: string[]): void {
  if (prefixes.length === 0) {
    statsCache.clear();
    return;
  }
  for (const key of statsCache.keys()) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      statsCache.delete(key);
    }
  }
}

const LIST_COLS = `id, seq, game_id, mode, started_at, ended_at, winner, win_reason,
                   player_w, player_b, move_count`;

export function insertMatchRecord(match: Match): number {
  const d = db();
  const next = (
    d.prepare(`SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM matches`).get() as {
      n: number;
    }
  ).n;
  d.transaction(() => {
    d.prepare(
      `INSERT INTO matches
       (id, seq, game_id, mode, started_at, ended_at, winner, win_reason,
        player_w, player_b, move_history, move_count, stats_applied)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, '[]', 0, 0)`,
    ).run(
      match.id,
      next,
      match.gameId,
      match.mode,
      match.createdAt,
      JSON.stringify(match.players.w),
      JSON.stringify(match.players.b),
    );
    bumpMatchStart(d, match.mode, match.gameId);
    bumpMatchesCount(1);
  })();
  match.seq = next;
  bustStatsCache();
  return next;
}

/**
 * Close matches that still look open in SQLite but are not actively playing
 * in this process. Used after restarts / when the play client is gone.
 */
export function closeOrphanMatchRecords(
  isLivePlaying: (id: string) => boolean,
): number {
  const open = db()
    .prepare(`SELECT id FROM matches WHERE ended_at IS NULL`)
    .all() as { id: string }[];
  if (open.length === 0) return 0;

  const mark = db().prepare(
    `UPDATE matches
     SET ended_at = ?, winner = NULL, win_reason = 'aborted'
     WHERE id = ? AND ended_at IS NULL`,
  );
  const load = db().prepare(
    `SELECT id, game_id, mode, ended_at, winner, player_w, player_b,
            move_history, move_count, stats_applied
     FROM matches WHERE id = ?`,
  );
  const now = Date.now();
  let closed = 0;
  for (const { id } of open) {
    if (isLivePlaying(id)) continue;
    const result = mark.run(now, id);
    if (result.changes > 0) {
      const row = load.get(id) as AggMatchRow | undefined;
      if (row) applyMatchEndStats(row);
      closed += 1;
    }
  }
  if (closed > 0) bustStatsCache();
  return closed;
}

export function finishMatchRecord(match: Match): void {
  const history = encodeMoveHistory(match);
  const moveCount = match.state.moveHistory.length;
  db()
    .prepare(
      `UPDATE matches
       SET ended_at = ?, winner = ?, win_reason = ?, move_history = ?,
           move_count = ?, player_w = ?, player_b = ?
       WHERE id = ?`,
    )
    .run(
      Date.now(),
      match.result?.winner != null ? String(match.result.winner) : null,
      match.result?.reason ?? null,
      history,
      moveCount,
      JSON.stringify(match.players.w),
      JSON.stringify(match.players.b),
      match.id,
    );
  const row = db()
    .prepare(
      `SELECT id, game_id, mode, ended_at, winner, player_w, player_b,
              move_history, move_count, stats_applied
       FROM matches WHERE id = ?`,
    )
    .get(match.id) as AggMatchRow | undefined;
  if (row) applyMatchEndStats(row);
  bustStatsCache();
}

/** Persist renamed players while a match is still in progress. */
export function updateMatchPlayers(match: Match): void {
  db()
    .prepare(
      `UPDATE matches SET player_w = ?, player_b = ? WHERE id = ?`,
    )
    .run(
      JSON.stringify(match.players.w),
      JSON.stringify(match.players.b),
      match.id,
    );
  // Names feed the recent list; finished per-player/model rows are applied at end.
  bustStatsCache("recent:");
}

/** Persist move history while a match is still in progress. */
export function updateMatchProgress(match: Match): void {
  db()
    .prepare(
      `UPDATE matches SET move_history = ?, move_count = ? WHERE id = ?`,
    )
    .run(
      encodeMoveHistory(match),
      match.state.moveHistory.length,
      match.id,
    );
  // List move counts change; think/fail aggregates apply only when the match ends.
  bustStatsCache("recent:");
}

export function countMatchRecords(): number {
  return cached("recent:count", () => getMatchesCount());
}

/** Uncached total for the homepage live counter. */
export function countMatchRecordsFresh(): number {
  return getMatchesCount();
}

/**
 * History list via keyset on dense `seq` (no OFFSET, no move_history).
 * Page 1 = highest seqs; page N uses `seq <= maxSeq - (N-1)*limit`.
 */
export function listMatchRecords(limit = 50, offset = 0): MatchListRow[] {
  const safeLimit = Math.max(1, Math.min(limit, 500));
  const safeOffset = Math.max(0, offset);
  return cached(`recent:${safeLimit}:${safeOffset}`, () => {
    const maxSeq = (
      db()
        .prepare(`SELECT COALESCE(MAX(seq), 0) AS n FROM matches`)
        .get() as { n: number }
    ).n;
    if (maxSeq <= 0) return [];
    const beforeInclusive = maxSeq - safeOffset;
    if (beforeInclusive < 1) return [];
    return db()
      .prepare(
        `SELECT ${LIST_COLS}
         FROM matches
         WHERE seq <= ?
         ORDER BY seq DESC
         LIMIT ?`,
      )
      .all(beforeInclusive, safeLimit) as MatchListRow[];
  });
}

export function getMatchRecord(id: string): MatchRow | null {
  const row = db()
    .prepare(`SELECT * FROM matches WHERE id = ?`)
    .get(id) as MatchRow | undefined;
  return row ?? null;
}

export type ParsedMatchRow = Omit<
  MatchRow,
  "player_w" | "player_b" | "move_history" | "move_count" | "stats_applied"
> & {
  playerW: Participant;
  playerB: Participant;
  moveCount: number;
  moves: string[];
  outputs: MoveOutputSample[];
  failures: MoveFailureSample[];
};

export function parseRow(row: MatchRow): ParsedMatchRow {
  const { player_w, player_b, move_history, move_count, stats_applied, ...rest } =
    row;
  void move_count;
  void stats_applied;
  const { moves, outputs, failures } = decodeMoveHistory(move_history);
  return {
    ...rest,
    playerW: JSON.parse(player_w) as Participant,
    playerB: JSON.parse(player_b) as Participant,
    moveCount: moves.length,
    moves,
    outputs,
    failures,
  };
}

export type ParsedMatchListRow = Omit<
  MatchListRow,
  "player_w" | "player_b" | "move_count"
> & {
  playerW: Participant;
  playerB: Participant;
  moveCount: number;
};

export function parseListRow(row: MatchListRow): ParsedMatchListRow {
  const { player_w, player_b, move_count, ...rest } = row;
  return {
    ...rest,
    playerW: JSON.parse(player_w) as Participant,
    playerB: JSON.parse(player_b) as Participant,
    moveCount: move_count,
  };
}

export type MvmModelRecord = {
  model: string;
  wins: number;
  losses: number;
  draws: number;
  aborted: number;
};

export type HvmByGameRecord = {
  gameId: string;
  humanWins: number;
  modelWins: number;
  draws: number;
  aborted: number;
};

export type HvmSummary = {
  total: number;
  finished: number;
  humanWins: number;
  modelWins: number;
  draws: number;
  aborted: number;
  inProgress: number;
  byGame: HvmByGameRecord[];
  /** Model-side W/L/D/A in finished Human vs Model matches. */
  models: MvmModelRecord[];
};

export type MvmSummary = {
  total: number;
  /** Matches with a side that won (winner is w or b). */
  decided: number;
  draws: number;
  aborted: number;
  inProgress: number;
  byGame: Record<string, number>;
  models: MvmModelRecord[];
};

export function hvmSummary(): HvmSummary {
  return cached("hvm", () => readHvmFromAgg());
}

export type HvmPlayerRecord = {
  /** Empty string = unnamed humans aggregated into one row. */
  name: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  aborted: number;
};

/** Per human display-name W/L/D/A for finished Human vs Model matches. */
export function hvmPlayerSummary(): HvmPlayerRecord[] {
  return cached("hvm:players", () => readHvmPlayersFromAgg());
}

export function mvmSummary(): MvmSummary {
  return cached("mvm", () => readMvmFromAgg());
}

export type ModelThinkBucket = {
  moves: number;
  avgMs: number | null;
};

export type ModelThinkRecord = {
  model: string;
  off: ModelThinkBucket;
  low: ModelThinkBucket;
  medium: ModelThinkBucket;
  high: ModelThinkBucket;
};

/** Average LLM round-trip time per model, split by Arena reasoning level. */
export function modelThinkSummary(): ModelThinkRecord[] {
  return cached("think:avg", () => readThinkFromAgg());
}

export type ModelFailureRecord = {
  model: string;
  failures: number;
  illegalOff: number;
  illegalLow: number;
  illegalMedium: number;
  illegalHigh: number;
  soft: number;
};

/** Aggregated failed model outputs per model label. */
export function modelFailureSummary(): ModelFailureRecord[] {
  return cached("fail:sum", () => readFailuresFromAgg());
}
