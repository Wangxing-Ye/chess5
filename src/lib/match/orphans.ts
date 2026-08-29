import { closeOrphanMatchRecords } from "@/lib/db/matches";
import { getMatch } from "./store";

/**
 * DB rows with no ended_at that are no longer live in memory (process
 * restart, HMR, etc.) are closed as left-play-page aborts so stats do not
 * keep a permanent "In progress" pile.
 */
export function reapOrphanMatches(): number {
  return closeOrphanMatchRecords(
    (id) => getMatch(id)?.status === "playing",
  );
}
