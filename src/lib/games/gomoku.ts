import { extractMoveFromModelText } from "./extractMove";
import type { GameEngine, Move, PlayerColor } from "./types";

const SIZE = 15;

type Cell = PlayerColor | null;

function emptyBoard(): Cell[][] {
  return Array.from({ length: SIZE }, () => Array<Cell>(SIZE).fill(null));
}

function parseFen(fen: string): { board: Cell[][]; turn: PlayerColor } {
  const [rows, turn] = fen.split(" ");
  const board = rows.split("/").map((row) =>
    row.split("").map((c) => {
      if (c === "w" || c === "b") return c;
      return null;
    }),
  ) as Cell[][];
  return { board, turn: (turn as PlayerColor) || "w" };
}

function toFen(board: Cell[][], turn: PlayerColor): string {
  const rows = board.map((row) => row.map((c) => c ?? ".").join("")).join("/");
  return `${rows} ${turn}`;
}

function coord(san: string): { r: number; c: number } | null {
  const m = san.trim().toUpperCase().match(/^([A-O])(1[0-5]|[1-9])$/);
  if (!m) return null;
  const c = m[1].charCodeAt(0) - 65;
  const r = SIZE - parseInt(m[2], 10);
  if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return null;
  return { r, c };
}

function toSan(r: number, c: number): string {
  return `${String.fromCharCode(65 + c)}${SIZE - r}`;
}

function countDir(
  board: Cell[][],
  r: number,
  c: number,
  dr: number,
  dc: number,
  color: PlayerColor,
): number {
  let n = 0;
  let rr = r + dr;
  let cc = c + dc;
  while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr][cc] === color) {
    n++;
    rr += dr;
    cc += dc;
  }
  return n;
}

function wins(board: Cell[][], r: number, c: number, color: PlayerColor): boolean {
  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];
  return dirs.some(([dr, dc]) => {
    const total =
      1 +
      countDir(board, r, c, dr, dc, color) +
      countDir(board, r, c, -dr, -dc, color);
    return total >= 5;
  });
}

function boardFull(board: Cell[][]): boolean {
  return board.every((row) => row.every((c) => c !== null));
}

export const gomokuEngine: GameEngine = {
  id: "gomoku",

  newGame() {
    return {
      gameId: "gomoku",
      fen: toFen(emptyBoard(), "w"),
      turn: "w",
      moveHistory: [],
    };
  },

  legalMoves(state) {
    const { board } = parseFen(state.fen);
    const moves: Move[] = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (!board[r][c]) {
          const san = toSan(r, c);
          moves.push({ san, to: san });
        }
      }
    }
    return moves;
  },

  applyMove(state, move) {
    const san = typeof move === "string" ? move : move.san;
    const pos = coord(san);
    if (!pos) throw new Error(`Invalid gomoku coordinate: ${san}`);
    const { board, turn } = parseFen(state.fen);
    if (board[pos.r][pos.c]) throw new Error(`Occupied: ${san}`);
    board[pos.r][pos.c] = turn;
    const next: PlayerColor = turn === "w" ? "b" : "w";
    const applied: Move = {
      san: toSan(pos.r, pos.c),
      to: toSan(pos.r, pos.c),
      meta: { captured: false },
    };
    return {
      gameId: "gomoku",
      fen: toFen(board, next),
      turn: next,
      moveHistory: [...state.moveHistory, applied.san],
      lastMove: applied,
    };
  },

  isTerminal(state) {
    const { board } = parseFen(state.fen);
    if (state.lastMove) {
      const pos = coord(state.lastMove.san);
      if (pos) {
        const prevTurn: PlayerColor = state.turn === "w" ? "b" : "w";
        if (
          board[pos.r][pos.c] === prevTurn &&
          wins(board, pos.r, pos.c, prevTurn)
        ) {
          return {
            over: true,
            result: { winner: prevTurn, reason: "five-in-a-row" },
          };
        }
      }
    }
    if (boardFull(board)) {
      return { over: true, result: { winner: "draw", reason: "board-full" } };
    }
    return { over: false };
  },

  toPromptView(state) {
    const { board } = parseFen(state.fen);
    const lines = board.map((row, r) => {
      const cells = row
        .map((c) => (c === "w" ? "X" : c === "b" ? "O" : "."))
        .join(" ");
      return `${String(SIZE - r).padStart(2, " ")} ${cells}`;
    });
    const header = `   ${Array.from({ length: SIZE }, (_, i) =>
      String.fromCharCode(65 + i),
    ).join(" ")}`;
    return [
      "Game: Gomoku 15x15 (free-style). Five in a row wins.",
      `You are ${state.turn === "w" ? "X (first player, w)" : "O (second player, b)"}.`,
      "Coordinates like H8 (column A-O, row 1-15).",
      header,
      ...lines,
      'Reply with JSON only: {"move":"H8","comment":"..."}',
    ].join("\n");
  },

  parseMove(text, state) {
    const candidate = extractMoveFromModelText(text) ?? text.trim();
    // Prefer 10–15 before 1–9 so "H13" is not truncated to "H1".
    const m = candidate.toUpperCase().match(/[A-O](1[0-5]|[1-9])/);
    if (!m) return null;
    const san = m[0];
    if (!coord(san)) return null;
    return this.legalMoves(state).find((x) => x.san === san) ?? null;
  },

  getBoardMatrix(state) {
    const { board } = parseFen(state.fen);
    return board.map((row) => row.map((c) => c));
  },
};

export const GOMOKU_SIZE = SIZE;
