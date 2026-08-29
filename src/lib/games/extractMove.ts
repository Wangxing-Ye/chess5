/**
 * Pull the move string from model output. When the model emits multiple
 * JSON objects (self-corrections), use the last one with a non-empty `move`.
 * A single clean JSON object is unchanged (it is the last = only match).
 */
export function extractMoveFromModelText(text: string): string | null {
  let last: string | null = null;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    const end = matchingBraceEnd(text, i);
    if (end < 0) continue;
    const slice = text.slice(i, end + 1);
    try {
      const obj = JSON.parse(slice) as { move?: unknown };
      if (typeof obj.move === "string" && obj.move.trim()) {
        last = obj.move.trim();
      }
    } catch {
      /* skip invalid / truncated objects */
    }
  }
  return last;
}

function matchingBraceEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
