/**
 * Why a match ended. Engines and the match lifecycle both produce these, and
 * records store the English key so one row reads correctly in every locale —
 * translation happens at render time, against the `reasons` namespace.
 */
export const REASON_KEYS = [
  "checkmate",
  "draw",
  "stalemate",
  "five-in-a-row",
  "board-full",
  "king-captured",
  "no-legal-moves",
  "two-passes",
  "flag-captured",
  "no-moves",
  "disc-count",
  "resign",
  "illegal-moves",
  "aborted",
  "end-match",
] as const;

export type ReasonKey = (typeof REASON_KEYS)[number];

function isReasonKey(value: string): value is ReasonKey {
  return (REASON_KEYS as readonly string[]).includes(value);
}

/**
 * @returns the translated reason, or the raw value for rows written by an
 * older or newer build — showing `five-in-a-row` beats showing a message id.
 */
export function reasonLabel(
  reason: string | null | undefined,
  t: (key: ReasonKey) => string,
): string {
  if (!reason) return "";
  return isReasonKey(reason) ? t(reason) : reason;
}
