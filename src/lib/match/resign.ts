/** Minimum plies before a player may resign (anti early-resign noise). */
export const MIN_RESIGN_PLIES = 20;

export function canResignAtPly(plyCount: number): boolean {
  return plyCount >= MIN_RESIGN_PLIES;
}
