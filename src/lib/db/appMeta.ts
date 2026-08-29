import { db } from "./index";

/** O(1) total match counter in `app_meta` (fallback: COUNT then seed). */
export function getMatchesCount(): number {
  const row = db()
    .prepare(`SELECT value FROM app_meta WHERE key = 'matches_count'`)
    .get() as { value: string } | undefined;
  if (row) return Number.parseInt(row.value, 10) || 0;
  const n = (
    db().prepare(`SELECT COUNT(*) AS n FROM matches`).get() as { n: number }
  ).n;
  db()
    .prepare(
      `INSERT INTO app_meta (key, value) VALUES ('matches_count', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(String(n));
  return n;
}

export function bumpMatchesCount(delta: number): void {
  db()
    .prepare(
      `INSERT INTO app_meta (key, value) VALUES ('matches_count', ?)
       ON CONFLICT(key) DO UPDATE SET
         value = CAST(MAX(0, CAST(value AS INTEGER) + ?) AS TEXT)`,
    )
    .run(String(Math.max(0, delta)), delta);
}
