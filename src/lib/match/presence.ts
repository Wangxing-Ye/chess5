import { abort } from "./engine";
import { reapOrphanMatches } from "./orphans";
import { getMatch, listMatchIds, saveMatch } from "./store";
import type { Match } from "./types";

/** Client play pages should ping this often. */
export const HEARTBEAT_INTERVAL_MS = 10_000;
/** No play heartbeat for this long ⇒ treat as left page → abort. */
export const HEARTBEAT_STALE_MS = 60_000;
const PRESENCE_SCAN_MS = 5_000;

const globalPresence = globalThis as unknown as {
  __chess5PresenceScanner?: ReturnType<typeof setInterval>;
};

export function touchHeartbeat(match: Match): Match {
  match.lastHeartbeatAt = Date.now();
  return saveMatch(match);
}

function scanStaleMatches(): void {
  const now = Date.now();
  for (const id of listMatchIds()) {
    const match = getMatch(id);
    if (!match || match.status !== "playing") continue;
    const last = match.lastHeartbeatAt ?? match.createdAt;
    if (now - last > HEARTBEAT_STALE_MS) {
      abort(match);
    }
  }
  // Also close DB rows left open after memory loss (restart / HMR).
  reapOrphanMatches();
}

/** Start a process-wide scanner once (safe across Next.js HMR via globalThis). */
export function ensurePresenceScanner(): void {
  if (globalPresence.__chess5PresenceScanner) return;
  globalPresence.__chess5PresenceScanner = setInterval(
    scanStaleMatches,
    PRESENCE_SCAN_MS,
  );
  globalPresence.__chess5PresenceScanner.unref?.();
}
