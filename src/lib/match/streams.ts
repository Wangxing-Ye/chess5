/**
 * Tracks open SSE connections. Public matches stream without a token, so
 * without a ceiling a single client could pin an unbounded number of timers.
 */

const globalStreams = globalThis as unknown as {
  __chess5Streams?: { perMatch: Map<string, number>; total: number };
};

function state(): { perMatch: Map<string, number>; total: number } {
  if (!globalStreams.__chess5Streams) {
    globalStreams.__chess5Streams = { perMatch: new Map(), total: 0 };
  }
  return globalStreams.__chess5Streams;
}

/** Both players plus a generous number of spectators. */
export const MAX_STREAMS_PER_MATCH = 50;
export const MAX_STREAMS_TOTAL = 500;

/**
 * @returns a release function, or null when the connection must be refused.
 * The release is idempotent because several teardown paths may call it.
 */
export function acquireStreamSlot(matchId: string): (() => void) | null {
  const s = state();
  const current = s.perMatch.get(matchId) ?? 0;
  if (current >= MAX_STREAMS_PER_MATCH || s.total >= MAX_STREAMS_TOTAL) {
    return null;
  }
  s.perMatch.set(matchId, current + 1);
  s.total += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const open = s.perMatch.get(matchId) ?? 1;
    if (open <= 1) s.perMatch.delete(matchId);
    else s.perMatch.set(matchId, open - 1);
    s.total = Math.max(0, s.total - 1);
  };
}
