import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { ensureStatsAggregates } from "./statsAgg";

const globalDb = globalThis as unknown as {
  __chess5Db?: Database.Database;
};

/** Add stable match serials for History / Replay (#1, #2, …). */
function ensureMatchSeq(d: Database.Database): void {
  const cols = d.prepare(`PRAGMA table_info(matches)`).all() as {
    name: string;
  }[];
  if (!cols.some((c) => c.name === "seq")) {
    d.exec(`ALTER TABLE matches ADD COLUMN seq INTEGER`);
  }

  const missing = d
    .prepare(`SELECT COUNT(*) AS n FROM matches WHERE seq IS NULL`)
    .get() as { n: number };
  if (missing.n > 0) {
    const max = (
      d.prepare(`SELECT COALESCE(MAX(seq), 0) AS n FROM matches`).get() as {
        n: number;
      }
    ).n;
    const rows = d
      .prepare(
        `SELECT id FROM matches WHERE seq IS NULL ORDER BY started_at ASC, id ASC`,
      )
      .all() as { id: string }[];
    const update = d.prepare(`UPDATE matches SET seq = ? WHERE id = ?`);
    const backfill = d.transaction(() => {
      rows.forEach((row, i) => update.run(max + i + 1, row.id));
    });
    backfill();
  }

  d.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_seq ON matches(seq)`);
}

/** Lean History list column + idempotent stats apply flag. */
function ensureMatchListColumns(d: Database.Database): void {
  const cols = d.prepare(`PRAGMA table_info(matches)`).all() as {
    name: string;
  }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("move_count")) {
    d.exec(
      `ALTER TABLE matches ADD COLUMN move_count INTEGER NOT NULL DEFAULT 0`,
    );
  }
  if (!names.has("stats_applied")) {
    d.exec(
      `ALTER TABLE matches ADD COLUMN stats_applied INTEGER NOT NULL DEFAULT 0`,
    );
  }
}

export function db(): Database.Database {
  if (!globalDb.__chess5Db) {
    const dir = path.join(process.cwd(), "data");
    fs.mkdirSync(dir, { recursive: true });
    const d = new Database(path.join(dir, "chess5.db"));
    d.pragma("journal_mode = WAL");
    d.exec(`
      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        winner TEXT,
        win_reason TEXT,
        player_w TEXT NOT NULL,
        player_b TEXT NOT NULL,
        move_history TEXT NOT NULL DEFAULT '[]'
      );
      CREATE INDEX IF NOT EXISTS idx_matches_mode ON matches(mode);
      CREATE INDEX IF NOT EXISTS idx_matches_started ON matches(started_at);
      CREATE INDEX IF NOT EXISTS idx_matches_open ON matches(ended_at)
        WHERE ended_at IS NULL;
    `);
    ensureMatchSeq(d);
    ensureMatchListColumns(d);
    // Assign before aggregate backfill so statsAgg readers can call db().
    globalDb.__chess5Db = d;
    ensureStatsAggregates(d);
  }
  return globalDb.__chess5Db;
}
