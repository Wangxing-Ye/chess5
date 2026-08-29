import { extractMoveFromModelText } from "./extractMove";
import type { GameEngine, GameState, Move, PlayerColor } from "./types";

type Cell = PlayerColor | null;

function sizeOf(state: GameState): number {
  return (state.data?.size as number) || 9;
}

function empty(size: number): Cell[][] {
  return Array.from({ length: size }, () => Array<Cell>(size).fill(null));
}

function toFen(
  board: Cell[][],
  turn: PlayerColor,
  ko: string | null,
  passes: number,
): string {
  const rows = board.map((row) => row.map((c) => c ?? ".").join("")).join("/");
  return `${rows} ${turn} ${ko ?? "-"} ${passes}`;
}

function parseFen(fen: string): {
  board: Cell[][];
  turn: PlayerColor;
  ko: string | null;
  passes: number;
} {
  const [rows, turn, ko, passes] = fen.split(" ");
  const board = rows
    .split("/")
    .map((row) => row.split("").map((c) => (c === "w" || c === "b" ? c : null))) as Cell[][];
  return {
    board,
    turn: (turn as PlayerColor) || "w",
    ko: ko === "-" ? null : ko,
    passes: parseInt(passes || "0", 10),
  };
}

function key(r: number, c: number): string {
  return `${r},${c}`;
}

function neighbors(r: number, c: number, size: number): [number, number][] {
  return (
    [
      [r - 1, c],
      [r + 1, c],
      [r, c - 1],
      [r, c + 1],
    ] as [number, number][]
  ).filter(([rr, cc]) => rr >= 0 && rr < size && cc >= 0 && cc < size);
}

function groupAndLiberties(
  board: Cell[][],
  r: number,
  c: number,
): { stones: [number, number][]; libs: Set<string> } {
  const color = board[r][c];
  const size = board.length;
  const stones: [number, number][] = [];
  const libs = new Set<string>();
  if (!color) return { stones, libs };
  const seen = new Set<string>();
  const q: [number, number][] = [[r, c]];
  seen.add(key(r, c));
  while (q.length) {
    const [cr, cc] = q.pop()!;
    stones.push([cr, cc]);
    for (const [nr, nc] of neighbors(cr, cc, size)) {
      const v = board[nr][nc];
      if (!v) libs.add(key(nr, nc));
      else if (v === color && !seen.has(key(nr, nc))) {
        seen.add(key(nr, nc));
        q.push([nr, nc]);
      }
    }
  }
  return { stones, libs };
}

function toSan(r: number, c: number, size: number): string {
  const letters = "ABCDEFGHJKLMNOPQRST";
  return `${letters[c]}${size - r}`;
}

function parseSan(
  san: string,
  size: number,
): { r: number; c: number } | "pass" | null {
  if (/^pass$/i.test(san.trim())) return "pass";
  const letters = "ABCDEFGHJKLMNOPQRST".slice(0, size);
  const m = san.trim().toUpperCase().match(/^([A-T])(\d{1,2})$/);
  if (!m) return null;
  const c = letters.indexOf(m[1]);
  const r = size - parseInt(m[2], 10);
  if (c < 0 || r < 0 || r >= size) return null;
  return { r, c };
}

function play(
  board: Cell[][],
  r: number,
  c: number,
  color: PlayerColor,
  ko: string | null,
): { board: Cell[][]; ko: string | null; captured: number } | null {
  const size = board.length;
  if (board[r][c]) return null;
  if (ko === key(r, c)) return null;
  const next = board.map((row) => [...row]);
  next[r][c] = color;
  const opp: PlayerColor = color === "b" ? "w" : "b";
  let captured = 0;
  const captCoords: [number, number][] = [];
  for (const [nr, nc] of neighbors(r, c, size)) {
    if (next[nr][nc] !== opp) continue;
    const g = groupAndLiberties(next, nr, nc);
    if (g.libs.size === 0) {
      for (const [sr, sc] of g.stones) {
        next[sr][sc] = null;
        captCoords.push([sr, sc]);
        captured++;
      }
    }
  }
  const self = groupAndLiberties(next, r, c);
  if (self.libs.size === 0) return null; // suicide
  let newKo: string | null = null;
  if (captured === 1 && self.stones.length === 1) {
    newKo = key(captCoords[0][0], captCoords[0][1]);
  }
  return { board: next, ko: newKo, captured };
}

export const goEngine: GameEngine = {
  id: "go",

  newGame(options) {
    const size = (options?.size as number) || 9;
    // First player "w" plays dark stones.
    return {
      gameId: "go",
      fen: toFen(empty(size), "w", null, 0),
      turn: "w",
      moveHistory: [],
      data: { size, captures: { w: 0, b: 0 } },
    };
  },

  legalMoves(state) {
    const size = sizeOf(state);
    const { board, turn, ko } = parseFen(state.fen);
    const moves: Move[] = [{ san: "pass" }];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const res = play(board, r, c, turn, ko);
        if (res) {
          const san = toSan(r, c, size);
          moves.push({ san, to: san });
        }
      }
    }
    return moves;
  },

  applyMove(state, move) {
    const size = sizeOf(state);
    const san = typeof move === "string" ? move : move.san;
    const { board, turn, ko, passes } = parseFen(state.fen);
    const captures = {
      w: (state.data?.captures as { w: number; b: number })?.w ?? 0,
      b: (state.data?.captures as { w: number; b: number })?.b ?? 0,
    };
    const parsed = parseSan(san, size);
    if (!parsed) throw new Error(`Invalid go move: ${san}`);
    const next: PlayerColor = turn === "w" ? "b" : "w";
    if (parsed === "pass") {
      return {
        gameId: "go",
        fen: toFen(board, next, null, passes + 1),
        turn: next,
        moveHistory: [...state.moveHistory, "pass"],
        lastMove: { san: "pass" },
        data: { size, captures },
      };
    }
    const res = play(board, parsed.r, parsed.c, turn, ko);
    if (!res) throw new Error(`Illegal go move: ${san}`);
    captures[turn] += res.captured;
    const applied: Move = {
      san: toSan(parsed.r, parsed.c, size),
      to: toSan(parsed.r, parsed.c, size),
      meta: {
        captured: res.captured > 0,
        captureCount: res.captured,
      },
    };
    return {
      gameId: "go",
      fen: toFen(res.board, next, res.ko, 0),
      turn: next,
      moveHistory: [...state.moveHistory, applied.san],
      lastMove: applied,
      data: { size, captures },
    };
  },

  isTerminal(state) {
    const { passes } = parseFen(state.fen);
    if (passes >= 2) {
      const captures = (state.data?.captures as { w: number; b: number }) || {
        w: 0,
        b: 0,
      };
      // Simplified: higher capture count wins (not full territory scoring)
      let winner: PlayerColor | "draw" = "draw";
      if (captures.w > captures.b) winner = "w";
      else if (captures.b > captures.w) winner = "b";
      return {
        over: true,
        result: { winner, reason: "two-passes" },
      };
    }
    return { over: false };
  },

  toPromptView(state) {
    const size = sizeOf(state);
    const { board, turn } = parseFen(state.fen);
    const letters = "ABCDEFGHJKLMNOPQRST".slice(0, size);
    const lines = board.map((row, r) => {
      const cells = row
        .map((c) => (c === "w" ? "X" : c === "b" ? "O" : "."))
        .join(" ");
      return `${String(size - r).padStart(2, " ")} ${cells}`;
    });
    return [
      `Game: Go ${size}x${size}`,
      'Dark=X (w) moves first, Light=O (b). Coordinates skip letter I. Pass with "pass".',
      `Turn: ${turn}`,
      `Captures: ${JSON.stringify(state.data?.captures ?? {})}`,
      `   ${letters.split("").join(" ")}`,
      ...lines,
      "Game ends after two consecutive passes (higher capture count wins, simplified).",
      'Reply with JSON only: {"move":"D4","comment":"..."}',
    ].join("\n");
  },

  parseMove(text, state) {
    const size = sizeOf(state);
    const candidate = extractMoveFromModelText(text) ?? text.trim();
    if (/^pass$/i.test(candidate)) return { san: "pass" };
    const parsed = parseSan(candidate, size);
    if (!parsed || parsed === "pass") return null;
    const san = toSan(parsed.r, parsed.c, size);
    return this.legalMoves(state).find((m) => m.san === san) ?? null;
  },

  getBoardMatrix(state) {
    return parseFen(state.fen).board;
  },
};
