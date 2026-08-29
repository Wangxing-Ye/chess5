import { extractMoveFromModelText } from "./extractMove";
import type { GameEngine, Move, PlayerColor } from "./types";

/** 8×8 Othello / Reversi. First player "w" plays dark (black) discs. */
const SIZE = 8;
const DIRS: [number, number][] = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

type Cell = PlayerColor | null;

function emptyBoard(): Cell[][] {
  return Array.from({ length: SIZE }, () => Array<Cell>(SIZE).fill(null));
}

function startBoard(): Cell[][] {
  const board = emptyBoard();
  // Standard: D4/E5 white, E4/D5 black (files A–H, ranks 8→1 top→bottom)
  board[4][3] = "b"; // D4
  board[4][4] = "w"; // E4
  board[3][3] = "w"; // D5
  board[3][4] = "b"; // E5
  return board;
}

function parseFen(fen: string): {
  board: Cell[][];
  turn: PlayerColor;
  passes: number;
} {
  const [rows, turn, passesStr] = fen.split(" ");
  const board = rows.split("/").map((row) =>
    row.split("").map((c) => {
      if (c === "w" || c === "b") return c;
      return null;
    }),
  ) as Cell[][];
  return {
    board,
    turn: (turn as PlayerColor) || "w",
    passes: parseInt(passesStr || "0", 10) || 0,
  };
}

function toFen(board: Cell[][], turn: PlayerColor, passes: number): string {
  const rows = board.map((row) => row.map((c) => c ?? ".").join("")).join("/");
  return `${rows} ${turn} ${passes}`;
}

function coord(san: string): { r: number; c: number } | null {
  const m = san.trim().toUpperCase().match(/^([A-H])([1-8])$/);
  if (!m) return null;
  const c = m[1].charCodeAt(0) - 65;
  const r = SIZE - parseInt(m[2], 10);
  return { r, c };
}

function toSan(r: number, c: number): string {
  return `${String.fromCharCode(65 + c)}${SIZE - r}`;
}

function flipsAt(
  board: Cell[][],
  r: number,
  c: number,
  color: PlayerColor,
): [number, number][] {
  if (board[r][c]) return [];
  const opp: PlayerColor = color === "w" ? "b" : "w";
  const flips: [number, number][] = [];
  for (const [dr, dc] of DIRS) {
    const line: [number, number][] = [];
    let rr = r + dr;
    let cc = c + dc;
    while (
      rr >= 0 &&
      rr < SIZE &&
      cc >= 0 &&
      cc < SIZE &&
      board[rr][cc] === opp
    ) {
      line.push([rr, cc]);
      rr += dr;
      cc += dc;
    }
    if (
      line.length > 0 &&
      rr >= 0 &&
      rr < SIZE &&
      cc >= 0 &&
      cc < SIZE &&
      board[rr][cc] === color
    ) {
      flips.push(...line);
    }
  }
  return flips;
}

function placementMoves(board: Cell[][], turn: PlayerColor): Move[] {
  const moves: Move[] = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (flipsAt(board, r, c, turn).length > 0) {
        const san = toSan(r, c);
        moves.push({ san, to: san });
      }
    }
  }
  return moves;
}

function countDiscs(board: Cell[][]): { w: number; b: number } {
  let w = 0;
  let b = 0;
  for (const row of board) {
    for (const c of row) {
      if (c === "w") w++;
      else if (c === "b") b++;
    }
  }
  return { w, b };
}

/** Live disc totals for Side A (w) / Side B (b); null if not Othello. */
export function othelloDiscCounts(state: {
  gameId: string;
  fen: string;
}): { w: number; b: number } | null {
  if (state.gameId !== "othello") return null;
  return countDiscs(parseFen(state.fen).board);
}

function resultFromCounts(board: Cell[][]) {
  const { w, b } = countDiscs(board);
  if (w > b) return { winner: "w" as const, reason: "disc-count" };
  if (b > w) return { winner: "b" as const, reason: "disc-count" };
  return { winner: "draw" as const, reason: "disc-count" };
}

export const othelloEngine: GameEngine = {
  id: "othello",

  newGame() {
    return {
      gameId: "othello",
      fen: toFen(startBoard(), "w", 0),
      turn: "w",
      moveHistory: [],
    };
  },

  legalMoves(state) {
    const { board, turn } = parseFen(state.fen);
    const places = placementMoves(board, turn);
    if (places.length > 0) return places;
    return [{ san: "pass" }];
  },

  applyMove(state, move) {
    const san = (typeof move === "string" ? move : move.san).trim();
    const { board, turn, passes } = parseFen(state.fen);
    const next: PlayerColor = turn === "w" ? "b" : "w";

    if (san.toLowerCase() === "pass") {
      const places = placementMoves(board, turn);
      if (places.length > 0) throw new Error("Illegal pass: moves available");
      const applied: Move = { san: "pass", meta: { captured: false } };
      return {
        gameId: "othello",
        fen: toFen(board, next, passes + 1),
        turn: next,
        moveHistory: [...state.moveHistory, applied.san],
        lastMove: applied,
      };
    }

    const pos = coord(san);
    if (!pos) throw new Error(`Invalid othello coordinate: ${san}`);
    const flips = flipsAt(board, pos.r, pos.c, turn);
    if (flips.length === 0) throw new Error(`Illegal othello move: ${san}`);

    board[pos.r][pos.c] = turn;
    for (const [rr, cc] of flips) board[rr][cc] = turn;

    const applied: Move = {
      san: toSan(pos.r, pos.c),
      to: toSan(pos.r, pos.c),
      meta: { captured: flips.length > 0, flips: flips.length },
    };
    return {
      gameId: "othello",
      fen: toFen(board, next, 0),
      turn: next,
      moveHistory: [...state.moveHistory, applied.san],
      lastMove: applied,
    };
  },

  isTerminal(state) {
    const { board, turn, passes } = parseFen(state.fen);
    if (passes >= 2) {
      return { over: true, result: resultFromCounts(board) };
    }
    const filled = board.every((row) => row.every((c) => c !== null));
    if (filled) {
      return { over: true, result: resultFromCounts(board) };
    }
    // If neither side can place, end even without recorded passes
    if (
      placementMoves(board, turn).length === 0 &&
      placementMoves(board, turn === "w" ? "b" : "w").length === 0
    ) {
      return { over: true, result: resultFromCounts(board) };
    }
    return { over: false };
  },

  toPromptView(state, options) {
    const { board } = parseFen(state.fen);
    const { w, b } = countDiscs(board);
    const lines = board.map((row, r) => {
      const cells = row
        .map((c) => (c === "w" ? "X" : c === "b" ? "O" : "."))
        .join(" ");
      return `${SIZE - r} ${cells}`;
    });
    const header = `  ${Array.from({ length: SIZE }, (_, i) =>
      String.fromCharCode(65 + i),
    ).join(" ")}`;
    const protect = options?.legalMovesProtection !== false;
    const parts = [
      "Game: Othello / Reversi 8x8. Place a disc to flank and flip opponent discs.",
      `You are ${state.turn === "w" ? "X (black, first, w)" : "O (white, second, b)"}.`,
      `Disc count: X=${w} O=${b}.`,
    ];
    if (protect) {
      parts.push(
        `Legal moves: ${this.legalMoves(state)
          .map((m) => m.san)
          .join(", ")}`,
      );
    }
    parts.push(
      "Coordinates like D3 (columns A-H, rows 1-8). Use pass only if listed.",
      header,
      ...lines,
      'Reply with JSON only: {"move":"D3","comment":"..."}',
    );
    return parts.join("\n");
  },

  parseMove(text, state) {
    const candidate = extractMoveFromModelText(text) ?? text.trim();
    if (/^pass$/i.test(candidate)) {
      return this.legalMoves(state).find((x) => x.san === "pass") ?? null;
    }
    const m = candidate.toUpperCase().match(/[A-H][1-8]/);
    if (!m) return null;
    const san = m[0];
    return this.legalMoves(state).find((x) => x.san === san) ?? null;
  },

  getBoardMatrix(state) {
    const { board } = parseFen(state.fen);
    return board.map((row) => row.map((c) => c));
  },
};

export const OTHELLO_SIZE = SIZE;
