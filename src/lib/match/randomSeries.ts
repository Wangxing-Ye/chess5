import { PROVIDERS, type ProviderId } from "@/lib/llm/providers";

export const RANDOM20_SERIES_ID = "random20";
export const RANDOM20_TOTAL = 20;
const STORAGE_KEY = "chess5.series.random20.v1";

export type SeriesModel = {
  provider: ProviderId;
  model: string;
};

export type Random20SeriesState = {
  id: typeof RANDOM20_SERIES_ID;
  total: number;
  /** Games fully finished so far (0 … total). */
  completed: number;
  /** Side A seed (game 1 white); colors swap each game. */
  modelA: SeriesModel;
  modelB: SeriesModel;
  gameId: "chess";
  reasoningLevel: "low";
};

export function listKeyedModels(): SeriesModel[] {
  const out: SeriesModel[] = [];
  for (const p of PROVIDERS) {
    for (const model of p.models) {
      out.push({ provider: p.id, model });
    }
  }
  return out;
}

/** Two distinct models, preferring those with a saved API key. */
export function pickRandomPair(
  hasKey: (provider: ProviderId) => boolean,
): SeriesModel[] | null {
  const keyed = listKeyedModels().filter((m) => hasKey(m.provider));
  const pool = keyed.length >= 2 ? keyed : listKeyedModels();
  if (pool.length < 2) return null;

  const i = Math.floor(Math.random() * pool.length);
  let j = Math.floor(Math.random() * (pool.length - 1));
  if (j >= i) j += 1;
  const a = pool[i]!;
  const b = pool[j]!;
  if (a.provider === b.provider && a.model === b.model) return null;
  return [a, b];
}

export function loadRandom20Series(): Random20SeriesState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Random20SeriesState;
    if (parsed?.id !== RANDOM20_SERIES_ID) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveRandom20Series(state: Random20SeriesState): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearRandom20Series(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

/** Players for game index `completed` (0-based next game). */
export function playersForNextGame(state: Random20SeriesState): {
  w: SeriesModel;
  b: SeriesModel;
} {
  const swap = state.completed % 2 === 1;
  return swap
    ? { w: state.modelB, b: state.modelA }
    : { w: state.modelA, b: state.modelB };
}

export function seriesMatchLabel(state: Random20SeriesState): string {
  return `${state.completed + 1} / ${state.total}`;
}
