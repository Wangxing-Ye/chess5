import { GAME_IDS, getEngine } from "@/lib/games";
import type { GameId, GameState } from "@/lib/games/types";

/**
 * Go size is not stored in SQLite. Recover the smallest standard board that
 * can host every recorded coordinate; fall back to 9 when there are no stones.
 */
export function inferGoSize(moves: string[]): number {
  const letters = "ABCDEFGHJKLMNOPQRST";
  let needed = 0;
  for (const san of moves) {
    if (/^pass$/i.test(san.trim())) continue;
    const m = san.trim().toUpperCase().match(/^([A-T])(\d{1,2})$/);
    if (!m) continue;
    needed = Math.max(needed, letters.indexOf(m[1]) + 1, parseInt(m[2], 10));
  }
  if (needed <= 0) return 9;
  for (const size of [9, 13, 19] as const) {
    if (needed <= size) return size;
  }
  return 19;
}

export function isReplayableGameId(id: string): id is GameId {
  return (GAME_IDS as string[]).includes(id);
}

/**
 * Rebuild the position after `ply` moves (0 = start). Stops early if a stored
 * SAN is no longer legal — better a truncated board than a thrown page.
 */
export function stateAtPly(
  gameId: GameId,
  moves: string[],
  ply: number,
): GameState {
  const engine = getEngine(gameId);
  const options =
    gameId === "go" ? { size: inferGoSize(moves) } : undefined;
  let state = engine.newGame(options);
  const limit = Math.max(0, Math.min(ply, moves.length));
  for (let i = 0; i < limit; i++) {
    try {
      state = engine.applyMove(state, moves[i]!);
    } catch {
      break;
    }
  }
  return state;
}
