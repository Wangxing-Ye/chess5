/** Browser-persisted display name for the local human player. */
const STORAGE_KEY = "chess5.humanName.v1";
export const HUMAN_NAME_MAX = 20;

export function loadStoredHumanName(): string {
  if (typeof window === "undefined") return "";
  try {
    return (localStorage.getItem(STORAGE_KEY) ?? "").slice(0, HUMAN_NAME_MAX);
  } catch {
    return "";
  }
}

export function saveStoredHumanName(name: string): void {
  if (typeof window === "undefined") return;
  const trimmed = name.trim().slice(0, HUMAN_NAME_MAX);
  try {
    if (trimmed) localStorage.setItem(STORAGE_KEY, trimmed);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode / quota */
  }
}

/** Attach the stored name when the human participant has none yet. */
export function withStoredHumanName<
  T extends { kind: string; name?: string },
>(player: T): T {
  if (player.kind !== "human") return player;
  if (player.name?.trim()) return player;
  const stored = loadStoredHumanName();
  if (!stored) return player;
  return { ...player, name: stored };
}
