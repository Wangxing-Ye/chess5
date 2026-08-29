import type { GameId } from "@/lib/games/types";
import type {
  MatchMode,
  MoveFailureSample,
  Participant,
  ThinkSample,
} from "@/lib/match/types";
import { decodeMoveHistory } from "@/lib/match/moveHistory";
import { PROVIDERS } from "@/lib/llm/providers";
import type Database from "better-sqlite3";

/** Lazy to avoid a circular import with `./index` → `ensureStatsAggregates`. */
function db(): Database.Database {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require("./index") as typeof import("./index")).db();
}

const REASONING_LEVELS = ["off", "low", "medium", "high"] as const;
type ReasoningKey = (typeof REASONING_LEVELS)[number];

/** Schema + one-time rebuild of aggregate tables from `matches`. */
export function ensureStatsAggregates(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stats_mode (
      mode TEXT PRIMARY KEY,
      total INTEGER NOT NULL DEFAULT 0,
      finished INTEGER NOT NULL DEFAULT 0,
      human_wins INTEGER NOT NULL DEFAULT 0,
      model_wins INTEGER NOT NULL DEFAULT 0,
      decided INTEGER NOT NULL DEFAULT 0,
      draws INTEGER NOT NULL DEFAULT 0,
      aborted INTEGER NOT NULL DEFAULT 0,
      in_progress INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS stats_by_game (
      mode TEXT NOT NULL,
      game_id TEXT NOT NULL,
      human_wins INTEGER NOT NULL DEFAULT 0,
      model_wins INTEGER NOT NULL DEFAULT 0,
      draws INTEGER NOT NULL DEFAULT 0,
      aborted INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (mode, game_id)
    );
    CREATE TABLE IF NOT EXISTS stats_models (
      mode TEXT NOT NULL,
      model TEXT NOT NULL,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      draws INTEGER NOT NULL DEFAULT 0,
      aborted INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (mode, model)
    );
    CREATE TABLE IF NOT EXISTS stats_players (
      name TEXT PRIMARY KEY,
      games INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      draws INTEGER NOT NULL DEFAULT 0,
      aborted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS stats_think (
      model TEXT NOT NULL,
      level TEXT NOT NULL,
      sum_ms INTEGER NOT NULL DEFAULT 0,
      n INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (model, level)
    );
    CREATE TABLE IF NOT EXISTS stats_failures (
      model TEXT PRIMARY KEY,
      failures INTEGER NOT NULL DEFAULT 0,
      illegal_off INTEGER NOT NULL DEFAULT 0,
      illegal_low INTEGER NOT NULL DEFAULT 0,
      illegal_medium INTEGER NOT NULL DEFAULT 0,
      illegal_high INTEGER NOT NULL DEFAULT 0,
      soft INTEGER NOT NULL DEFAULT 0
    );
  `);

  const flag = d
    .prepare(`SELECT value FROM app_meta WHERE key = 'stats_agg_v1'`)
    .get() as { value: string } | undefined;
  if (flag?.value === "1") return;

  rebuildStatsFromMatches(d);
  d.prepare(
    `INSERT INTO app_meta (key, value) VALUES ('stats_agg_v1', '1')
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run();
}

function clearAggTables(d: Database.Database): void {
  d.exec(`
    DELETE FROM stats_mode;
    DELETE FROM stats_by_game;
    DELETE FROM stats_models;
    DELETE FROM stats_players;
    DELETE FROM stats_think;
    DELETE FROM stats_failures;
  `);
}

/** Full rebuild (startup migration). Safe to re-run if flag is cleared. */
export function rebuildStatsFromMatches(d: Database.Database): void {
  clearAggTables(d);
  d.prepare(`UPDATE matches SET stats_applied = 0`).run();

  const rows = d
    .prepare(
      `SELECT id, game_id, mode, ended_at, winner, player_w, player_b, move_history, move_count
       FROM matches`,
    )
    .all() as AggMatchRow[];

  const applyOpen = d.transaction((row: AggMatchRow) => {
    bumpMatchStart(d, row.mode as MatchMode, row.game_id as GameId);
  });
  const applyClosed = d.transaction((row: AggMatchRow) => {
    bumpMatchStart(d, row.mode as MatchMode, row.game_id as GameId);
    applyMatchEndUnlocked(d, row);
  });

  for (const row of rows) {
    // Keep move_count in sync while we already decode history for think/fail.
    const { moves } = decodeMoveHistory(row.move_history);
    if (row.move_count !== moves.length) {
      d.prepare(`UPDATE matches SET move_count = ? WHERE id = ?`).run(
        moves.length,
        row.id,
      );
      row.move_count = moves.length;
    }
    if (row.ended_at == null) {
      applyOpen(row);
    } else {
      applyClosed(row);
    }
  }

  const count = (
    d.prepare(`SELECT COUNT(*) AS n FROM matches`).get() as { n: number }
  ).n;
  d.prepare(
    `INSERT INTO app_meta (key, value) VALUES ('matches_count', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(count));
}

export type AggMatchRow = {
  id: string;
  game_id: string;
  mode: string;
  ended_at: number | null;
  winner: string | null;
  player_w: string;
  player_b: string;
  move_history: string;
  move_count: number;
  stats_applied?: number;
};

function ensureModeRow(d: Database.Database, mode: string): void {
  d.prepare(
    `INSERT OR IGNORE INTO stats_mode
     (mode, total, finished, human_wins, model_wins, decided, draws, aborted, in_progress)
     VALUES (?, 0, 0, 0, 0, 0, 0, 0, 0)`,
  ).run(mode);
}

function ensureByGameRow(
  d: Database.Database,
  mode: string,
  gameId: string,
): void {
  d.prepare(
    `INSERT OR IGNORE INTO stats_by_game
     (mode, game_id, human_wins, model_wins, draws, aborted, total)
     VALUES (?, ?, 0, 0, 0, 0, 0)`,
  ).run(mode, gameId);
}

/** Called when a new match row is inserted (still in progress). */
export function bumpMatchStart(
  d: Database.Database,
  mode: MatchMode,
  gameId: GameId,
): void {
  if (mode !== "human_vs_model" && mode !== "model_vs_model") return;
  ensureModeRow(d, mode);
  d.prepare(
    `UPDATE stats_mode SET total = total + 1, in_progress = in_progress + 1 WHERE mode = ?`,
  ).run(mode);
  if (mode === "model_vs_model") {
    ensureByGameRow(d, mode, gameId);
    d.prepare(
      `UPDATE stats_by_game SET total = total + 1 WHERE mode = ? AND game_id = ?`,
    ).run(mode, gameId);
  }
}

function modelSideLabel(p: Extract<Participant, { kind: "model" }>): string {
  const head = p.name?.trim() || p.provider;
  return `${head} · ${p.model}`;
}

function humanName(p: Extract<Participant, { kind: "human" }>): string {
  return p.name?.trim() ?? "";
}

function thinkLabel(provider: string, model: string): string {
  const name =
    PROVIDERS.find((x) => x.id === provider)?.name ?? provider;
  return `${name} · ${model}`;
}

function failureLabel(sample: MoveFailureSample): string {
  if (!sample.model || !sample.provider) return "—";
  return thinkLabel(sample.provider, sample.model);
}

function bumpModelRecord(
  d: Database.Database,
  mode: string,
  label: string,
  outcome: "win" | "loss" | "draw" | "abort",
): void {
  d.prepare(
    `INSERT INTO stats_models (mode, model, wins, losses, draws, aborted)
     VALUES (?, ?, 0, 0, 0, 0)
     ON CONFLICT(mode, model) DO NOTHING`,
  ).run(mode, label);
  const col =
    outcome === "win"
      ? "wins"
      : outcome === "loss"
        ? "losses"
        : outcome === "draw"
          ? "draws"
          : "aborted";
  d.prepare(
    `UPDATE stats_models SET ${col} = ${col} + 1 WHERE mode = ? AND model = ?`,
  ).run(mode, label);
}

function bumpPlayerRecord(
  d: Database.Database,
  name: string,
  outcome: "win" | "loss" | "draw" | "abort",
): void {
  d.prepare(
    `INSERT INTO stats_players (name, games, wins, losses, draws, aborted)
     VALUES (?, 0, 0, 0, 0, 0)
     ON CONFLICT(name) DO NOTHING`,
  ).run(name);
  const col =
    outcome === "win"
      ? "wins"
      : outcome === "loss"
        ? "losses"
        : outcome === "draw"
          ? "draws"
          : "aborted";
  d.prepare(
    `UPDATE stats_players
     SET games = games + 1, ${col} = ${col} + 1
     WHERE name = ?`,
  ).run(name);
}

function applyThinkSamples(
  d: Database.Database,
  thinks: ThinkSample[],
): void {
  const upsert = d.prepare(
    `INSERT INTO stats_think (model, level, sum_ms, n)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(model, level) DO UPDATE SET
       sum_ms = sum_ms + excluded.sum_ms,
       n = n + 1`,
  );
  for (const sample of thinks) {
    const level = sample.reasoningLevel;
    if (!REASONING_LEVELS.includes(level as ReasoningKey)) continue;
    upsert.run(thinkLabel(sample.provider, sample.model), level, sample.thinkMs);
  }
}

function applyFailureSamples(
  d: Database.Database,
  failures: MoveFailureSample[],
): void {
  const ensure = d.prepare(
    `INSERT INTO stats_failures
     (model, failures, illegal_off, illegal_low, illegal_medium, illegal_high, soft)
     VALUES (?, 0, 0, 0, 0, 0, 0)
     ON CONFLICT(model) DO NOTHING`,
  );
  for (const sample of failures) {
    const label = failureLabel(sample);
    ensure.run(label);
    if (!sample.countedStrike) {
      d.prepare(
        `UPDATE stats_failures SET failures = failures + 1, soft = soft + 1 WHERE model = ?`,
      ).run(label);
    } else {
      const level = sample.reasoningLevel ?? "off";
      const col =
        level === "low"
          ? "illegal_low"
          : level === "medium"
            ? "illegal_medium"
            : level === "high"
              ? "illegal_high"
              : "illegal_off";
      d.prepare(
        `UPDATE stats_failures
         SET failures = failures + 1, ${col} = ${col} + 1
         WHERE model = ?`,
      ).run(label);
    }
  }
}

function outcomeForSide(
  winner: string | null,
  side: "w" | "b",
): "win" | "loss" | "draw" | "abort" {
  if (winner == null) return "abort";
  if (winner === "draw") return "draw";
  if (winner === side) return "win";
  return "loss";
}

/** Apply end-of-match aggregates. Idempotent via `stats_applied`. */
function applyMatchEndUnlocked(d: Database.Database, row: AggMatchRow): void {
  const applied = (
    d
      .prepare(`SELECT stats_applied AS n FROM matches WHERE id = ?`)
      .get(row.id) as { n: number } | undefined
  )?.n;
  if (applied === 1) return;

  const mode = row.mode as MatchMode;
  if (mode === "human_vs_model" || mode === "model_vs_model") {
    ensureModeRow(d, mode);
    d.prepare(
      `UPDATE stats_mode SET in_progress = MAX(0, in_progress - 1) WHERE mode = ?`,
    ).run(mode);

    const winner = row.winner;
    const playerW = JSON.parse(row.player_w) as Participant;
    const playerB = JSON.parse(row.player_b) as Participant;

    if (mode === "human_vs_model") {
      let humanWins = 0;
      let modelWins = 0;
      let draws = 0;
      let aborted = 0;
      let finished = 0;

      if (winner == null) {
        aborted = 1;
      } else if (winner === "draw") {
        draws = 1;
        finished = 1;
      } else {
        finished = 1;
        const winnerP = winner === "w" ? playerW : playerB;
        if (winnerP.kind === "human") humanWins = 1;
        else modelWins = 1;
      }

      d.prepare(
        `UPDATE stats_mode SET
           finished = finished + ?,
           human_wins = human_wins + ?,
           model_wins = model_wins + ?,
           draws = draws + ?,
           aborted = aborted + ?
         WHERE mode = ?`,
      ).run(finished, humanWins, modelWins, draws, aborted, mode);

      ensureByGameRow(d, mode, row.game_id);
      d.prepare(
        `UPDATE stats_by_game SET
           human_wins = human_wins + ?,
           model_wins = model_wins + ?,
           draws = draws + ?,
           aborted = aborted + ?
         WHERE mode = ? AND game_id = ?`,
      ).run(humanWins, modelWins, draws, aborted, mode, row.game_id);

      for (const [side, p] of [
        ["w", playerW],
        ["b", playerB],
      ] as const) {
        if (p.kind === "model") {
          bumpModelRecord(
            d,
            mode,
            modelSideLabel(p),
            outcomeForSide(winner, side),
          );
        } else {
          bumpPlayerRecord(d, humanName(p), outcomeForSide(winner, side));
        }
      }
    } else {
      // model_vs_model
      let decided = 0;
      let draws = 0;
      let aborted = 0;
      if (winner == null) aborted = 1;
      else if (winner === "draw") draws = 1;
      else decided = 1;

      d.prepare(
        `UPDATE stats_mode SET
           decided = decided + ?,
           draws = draws + ?,
           aborted = aborted + ?
         WHERE mode = ?`,
      ).run(decided, draws, aborted, mode);

      for (const [side, p] of [
        ["w", playerW],
        ["b", playerB],
      ] as const) {
        if (p.kind === "model") {
          bumpModelRecord(
            d,
            mode,
            modelSideLabel(p),
            outcomeForSide(winner, side),
          );
        }
      }
    }
  }

  const { thinks, failures } = decodeMoveHistory(row.move_history);
  applyThinkSamples(d, thinks);
  applyFailureSamples(d, failures);

  d.prepare(`UPDATE matches SET stats_applied = 1 WHERE id = ?`).run(row.id);
}

/** Apply aggregates for a finished/aborted match (no-op if already applied). */
export function applyMatchEndStats(row: AggMatchRow): void {
  const d = db();
  d.transaction(() => applyMatchEndUnlocked(d, row))();
}

export function readHvmFromAgg(): {
  total: number;
  finished: number;
  humanWins: number;
  modelWins: number;
  draws: number;
  aborted: number;
  inProgress: number;
  byGame: {
    gameId: string;
    humanWins: number;
    modelWins: number;
    draws: number;
    aborted: number;
  }[];
  models: {
    model: string;
    wins: number;
    losses: number;
    draws: number;
    aborted: number;
  }[];
} {
  const d = db();
  ensureModeRow(d, "human_vs_model");
  const totals = d
    .prepare(
      `SELECT total, finished, human_wins AS humanWins, model_wins AS modelWins,
              draws, aborted, in_progress AS inProgress
       FROM stats_mode WHERE mode = 'human_vs_model'`,
    )
    .get() as {
    total: number;
    finished: number;
    humanWins: number;
    modelWins: number;
    draws: number;
    aborted: number;
    inProgress: number;
  };

  const byGame = d
    .prepare(
      `SELECT game_id AS gameId, human_wins AS humanWins, model_wins AS modelWins,
              draws, aborted
       FROM stats_by_game
       WHERE mode = 'human_vs_model'
         AND (human_wins + model_wins + draws + aborted) > 0
       ORDER BY game_id`,
    )
    .all() as {
    gameId: string;
    humanWins: number;
    modelWins: number;
    draws: number;
    aborted: number;
  }[];

  const models = d
    .prepare(
      `SELECT model, wins, losses, draws, aborted
       FROM stats_models
       WHERE mode = 'human_vs_model'
       ORDER BY wins DESC`,
    )
    .all() as {
    model: string;
    wins: number;
    losses: number;
    draws: number;
    aborted: number;
  }[];

  return { ...totals, byGame, models };
}

export function readHvmPlayersFromAgg(): {
  name: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  aborted: number;
}[] {
  return db()
    .prepare(
      `SELECT name, games, wins, losses, draws, aborted
       FROM stats_players
       ORDER BY
         CASE WHEN name = '' THEN 1 ELSE 0 END,
         wins DESC,
         games DESC,
         name ASC`,
    )
    .all() as {
    name: string;
    games: number;
    wins: number;
    losses: number;
    draws: number;
    aborted: number;
  }[];
}

export function readMvmFromAgg(): {
  total: number;
  decided: number;
  draws: number;
  aborted: number;
  inProgress: number;
  byGame: Record<string, number>;
  models: {
    model: string;
    wins: number;
    losses: number;
    draws: number;
    aborted: number;
  }[];
} {
  const d = db();
  ensureModeRow(d, "model_vs_model");
  const totals = d
    .prepare(
      `SELECT total, decided, draws, aborted, in_progress AS inProgress
       FROM stats_mode WHERE mode = 'model_vs_model'`,
    )
    .get() as {
    total: number;
    decided: number;
    draws: number;
    aborted: number;
    inProgress: number;
  };

  const models = d
    .prepare(
      `SELECT model, wins, losses, draws, aborted
       FROM stats_models
       WHERE mode = 'model_vs_model'
       ORDER BY wins DESC`,
    )
    .all() as {
    model: string;
    wins: number;
    losses: number;
    draws: number;
    aborted: number;
  }[];

  const byGameRows = d
    .prepare(
      `SELECT game_id, total AS n FROM stats_by_game
       WHERE mode = 'model_vs_model' AND total > 0`,
    )
    .all() as { game_id: string; n: number }[];
  const byGame: Record<string, number> = {};
  for (const row of byGameRows) byGame[row.game_id] = row.n;

  return { ...totals, byGame, models };
}

export function readThinkFromAgg(): {
  model: string;
  off: { moves: number; avgMs: number | null };
  low: { moves: number; avgMs: number | null };
  medium: { moves: number; avgMs: number | null };
  high: { moves: number; avgMs: number | null };
}[] {
  const rows = db()
    .prepare(`SELECT model, level, sum_ms AS sumMs, n FROM stats_think`)
    .all() as { model: string; level: string; sumMs: number; n: number }[];

  const acc = new Map<
    string,
    Record<ReasoningKey, { sum: number; n: number }>
  >();
  for (const row of rows) {
    if (!REASONING_LEVELS.includes(row.level as ReasoningKey)) continue;
    const cur = acc.get(row.model) ?? {
      off: { sum: 0, n: 0 },
      low: { sum: 0, n: 0 },
      medium: { sum: 0, n: 0 },
      high: { sum: 0, n: 0 },
    };
    cur[row.level as ReasoningKey] = { sum: row.sumMs, n: row.n };
    acc.set(row.model, cur);
  }

  const bucket = (b: { sum: number; n: number }) => ({
    moves: b.n,
    avgMs: b.n > 0 ? Math.round(b.sum / b.n) : null,
  });

  return [...acc.entries()]
    .map(([model, buckets]) => ({
      model,
      off: bucket(buckets.off),
      low: bucket(buckets.low),
      medium: bucket(buckets.medium),
      high: bucket(buckets.high),
    }))
    .filter(
      (row) =>
        row.off.moves > 0 ||
        row.low.moves > 0 ||
        row.medium.moves > 0 ||
        row.high.moves > 0,
    )
    .sort((a, b) => {
      const pick = (r: (typeof a)) =>
        r.high.avgMs ?? r.medium.avgMs ?? r.low.avgMs ?? r.off.avgMs ?? 0;
      return pick(a) - pick(b);
    });
}

export function readFailuresFromAgg(): {
  model: string;
  failures: number;
  illegalOff: number;
  illegalLow: number;
  illegalMedium: number;
  illegalHigh: number;
  soft: number;
}[] {
  return db()
    .prepare(
      `SELECT model, failures,
              illegal_off AS illegalOff,
              illegal_low AS illegalLow,
              illegal_medium AS illegalMedium,
              illegal_high AS illegalHigh,
              soft
       FROM stats_failures
       WHERE failures > 0
       ORDER BY failures DESC`,
    )
    .all() as {
    model: string;
    failures: number;
    illegalOff: number;
    illegalLow: number;
    illegalMedium: number;
    illegalHigh: number;
    soft: number;
  }[];
}
