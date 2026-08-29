import { extractMoveFromModelText } from "./extractMove";
import type { GameEngine, Move, PlayerColor } from "./types";

/**
 * Simplified Xiangqi engine (9×10).
 * Piece codes: R N B A K C P (red / first player "w") and lowercase for black.
 */

const COLS = 9;
const ROWS = 10;

type Piece = string | null;

const START: Piece[][] = [
  ["r", "n", "b", "a", "k", "a", "b", "n", "r"],
  [null, null, null, null, null, null, null, null, null],
  [null, "c", null, null, null, null, null, "c", null],
  ["p", null, "p", null, "p", null, "p", null, "p"],
  [null, null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null, null],
  ["P", null, "P", null, "P", null, "P", null, "P"],
  [null, "C", null, null, null, null, null, "C", null],
  [null, null, null, null, null, null, null, null, null],
  ["R", "N", "B", "A", "K", "A", "B", "N", "R"],
];

function clone(board: Piece[][]): Piece[][] {
  return board.map((r) => [...r]);
}

function isRed(p: string): boolean {
  return p === p.toUpperCase();
}

function inPalace(r: number, c: number, red: boolean): boolean {
  if (c < 3 || c > 5) return false;
  return red ? r >= 7 && r <= 9 : r >= 0 && r <= 2;
}

function toFen(board: Piece[][], turn: PlayerColor): string {
  const rows = board
    .map((row) =>
      row
        .map((p) => p ?? ".")
        .join("")
        .replace(/\.+/g, (m) => String(m.length)),
    )
    .join("/");
  return `${rows} ${turn}`;
}

function parseFen(fen: string): { board: Piece[][]; turn: PlayerColor } {
  const [rowsPart, turn] = fen.split(" ");
  const board = rowsPart.split("/").map((row) => {
    const cells: Piece[] = [];
    for (const ch of row) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < parseInt(ch, 10); i++) cells.push(null);
      } else {
        cells.push(ch);
      }
    }
    while (cells.length < COLS) cells.push(null);
    return cells.slice(0, COLS);
  });
  while (board.length < ROWS) board.push(Array(COLS).fill(null));
  return { board: board.slice(0, ROWS), turn: (turn as PlayerColor) || "w" };
}

function sq(r: number, c: number): string {
  return `${String.fromCharCode(97 + c)}${ROWS - r}`;
}

function parseSq(s: string): { r: number; c: number } | null {
  const m = s.toLowerCase().match(/^([a-i])([1-9]|10)$/);
  if (!m) return null;
  const c = m[1].charCodeAt(0) - 97;
  const r = ROWS - parseInt(m[2], 10);
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
  return { r, c };
}

function onBoard(r: number, c: number): boolean {
  return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

function sameSide(a: string, b: string): boolean {
  return isRed(a) === isRed(b);
}

function countBetween(
  board: Piece[][],
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): number {
  let n = 0;
  if (r1 === r2) {
    const [min, max] = c1 < c2 ? [c1, c2] : [c2, c1];
    for (let c = min + 1; c < max; c++) if (board[r1][c]) n++;
  } else if (c1 === c2) {
    const [min, max] = r1 < r2 ? [r1, r2] : [r2, r1];
    for (let r = min + 1; r < max; r++) if (board[r][c1]) n++;
  }
  return n;
}

function findKing(board: Piece[][], red: boolean): { r: number; c: number } | null {
  const target = red ? "K" : "k";
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) if (board[r][c] === target) return { r, c };
  return null;
}

function flyingGeneral(board: Piece[][]): boolean {
  const rk = findKing(board, true);
  const bk = findKing(board, false);
  if (!rk || !bk || rk.c !== bk.c) return false;
  return countBetween(board, rk.r, rk.c, bk.r, bk.c) === 0;
}

function genMoves(board: Piece[][], r: number, c: number): { r: number; c: number }[] {
  const p = board[r][c];
  if (!p) return [];
  const red = isRed(p);
  const type = p.toUpperCase();
  const out: { r: number; c: number }[] = [];
  const push = (rr: number, cc: number) => {
    if (!onBoard(rr, cc)) return;
    const t = board[rr][cc];
    if (t && sameSide(p, t)) return;
    out.push({ r: rr, c: cc });
  };

  if (type === "K") {
    for (const [dr, dc] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ]) {
      const rr = r + dr;
      const cc = c + dc;
      if (inPalace(rr, cc, red)) push(rr, cc);
    }
  } else if (type === "A") {
    for (const [dr, dc] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      const rr = r + dr;
      const cc = c + dc;
      if (inPalace(rr, cc, red)) push(rr, cc);
    }
  } else if (type === "B") {
    for (const [dr, dc] of [
      [2, 2],
      [2, -2],
      [-2, 2],
      [-2, -2],
    ]) {
      const rr = r + dr;
      const cc = c + dc;
      const er = r + dr / 2;
      const ec = c + dc / 2;
      if (!onBoard(rr, cc) || board[er][ec]) continue;
      if (red && rr < 5) continue;
      if (!red && rr > 4) continue;
      push(rr, cc);
    }
  } else if (type === "N") {
    const hops = [
      [-2, -1, -1, 0],
      [-2, 1, -1, 0],
      [2, -1, 1, 0],
      [2, 1, 1, 0],
      [-1, -2, 0, -1],
      [1, -2, 0, -1],
      [-1, 2, 0, 1],
      [1, 2, 0, 1],
    ];
    for (const [dr, dc, br, bc] of hops) {
      if (board[r + br]?.[c + bc]) continue;
      push(r + dr, c + dc);
    }
  } else if (type === "R") {
    for (const [dr, dc] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ]) {
      let rr = r + dr;
      let cc = c + dc;
      while (onBoard(rr, cc)) {
        if (!board[rr][cc]) out.push({ r: rr, c: cc });
        else {
          if (!sameSide(p, board[rr][cc]!)) out.push({ r: rr, c: cc });
          break;
        }
        rr += dr;
        cc += dc;
      }
    }
  } else if (type === "C") {
    for (const [dr, dc] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ]) {
      let rr = r + dr;
      let cc = c + dc;
      let jumped = false;
      while (onBoard(rr, cc)) {
        if (!jumped) {
          if (!board[rr][cc]) out.push({ r: rr, c: cc });
          else jumped = true;
        } else {
          if (board[rr][cc]) {
            if (!sameSide(p, board[rr][cc]!)) out.push({ r: rr, c: cc });
            break;
          }
        }
        rr += dr;
        cc += dc;
      }
    }
  } else if (type === "P") {
    const forward = red ? -1 : 1;
    push(r + forward, c);
    const crossed = red ? r <= 4 : r >= 5;
    if (crossed) {
      push(r, c - 1);
      push(r, c + 1);
    }
  }
  return out;
}

function allLegal(board: Piece[][], turn: PlayerColor): Move[] {
  const redTurn = turn === "w";
  const moves: Move[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = board[r][c];
      if (!p || isRed(p) !== redTurn) continue;
      for (const t of genMoves(board, r, c)) {
        const next = clone(board);
        next[t.r][t.c] = p;
        next[r][c] = null;
        if (flyingGeneral(next)) continue;
        const from = sq(r, c);
        const to = sq(t.r, t.c);
        moves.push({ san: `${from}${to}`, from, to });
      }
    }
  }
  return moves;
}

export const xiangqiEngine: GameEngine = {
  id: "xiangqi",

  newGame() {
    return {
      gameId: "xiangqi",
      fen: toFen(clone(START), "w"),
      turn: "w",
      moveHistory: [],
    };
  },

  legalMoves(state) {
    const { board, turn } = parseFen(state.fen);
    return allLegal(board, turn);
  },

  applyMove(state, move) {
    const san = (typeof move === "string" ? move : move.san)
      .toLowerCase()
      .replace(/[^a-i0-9]/g, "");
    let from: { r: number; c: number } | null = null;
    let to: { r: number; c: number } | null = null;
    if (typeof move !== "string" && move.from && move.to) {
      from = parseSq(move.from);
      to = parseSq(move.to);
    } else {
      const m = san.match(/^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/);
      if (m) {
        from = parseSq(m[1]);
        to = parseSq(m[2]);
      }
    }
    if (!from || !to) throw new Error(`Invalid xiangqi move: ${san}`);
    const legal = this.legalMoves(state);
    const found = legal.find(
      (x) => x.from === sq(from.r, from.c) && x.to === sq(to.r, to.c),
    );
    if (!found) throw new Error(`Illegal xiangqi move: ${san}`);
    const { board, turn } = parseFen(state.fen);
    const piece = board[from.r][from.c]!;
    const taken = board[to.r][to.c];
    const captured = Boolean(taken);
    board[to.r][to.c] = piece;
    board[from.r][from.c] = null;
    const next: PlayerColor = turn === "w" ? "b" : "w";
    return {
      gameId: "xiangqi",
      fen: toFen(board, next),
      turn: next,
      moveHistory: [...state.moveHistory, found.san],
      lastMove: {
        ...found,
        meta: {
          captured,
          capturedPiece: taken || undefined,
        },
      },
    };
  },

  isTerminal(state) {
    const { board, turn } = parseFen(state.fen);
    const redKing = findKing(board, true);
    const blackKing = findKing(board, false);
    if (!redKing)
      return { over: true, result: { winner: "b", reason: "king-captured" } };
    if (!blackKing)
      return { over: true, result: { winner: "w", reason: "king-captured" } };
    if (allLegal(board, turn).length === 0) {
      return {
        over: true,
        result: { winner: turn === "w" ? "b" : "w", reason: "no-legal-moves" },
      };
    }
    return { over: false };
  },

  toPromptView(state, options) {
    const { board } = parseFen(state.fen);
    const lines = board.map((row, r) => {
      const cells = row.map((p) => p ?? ".").join(" ");
      return `${String(ROWS - r).padStart(2, " ")} ${cells}`;
    });
    const protect = options?.legalMovesProtection !== false;
    const parts = [
      "Game: Xiangqi (Chinese chess)",
      "Board files a-i, ranks 1-10. Red(uppercase)=w moves first, Black(lowercase)=b.",
      `Turn: ${state.turn}`,
      "   a b c d e f g h i",
      ...lines,
    ];
    if (protect) {
      parts.push(
        `Sample legal: ${this.legalMoves(state)
          .slice(0, 30)
          .map((m) => m.san)
          .join(", ")}`,
      );
    }
    parts.push(
      'Reply with JSON only: {"move":"h3e3","comment":"..."} (from+to squares)',
    );
    return parts.join("\n");
  },

  parseMove(text, state) {
    const candidate = extractMoveFromModelText(text) ?? text.trim();
    const cleaned = candidate.toLowerCase().replace(/[^a-i0-9]/g, "");
    const m = cleaned.match(/^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/);
    if (!m) return null;
    const san = `${m[1]}${m[2]}`;
    return this.legalMoves(state).find((x) => x.san === san) ?? null;
  },

  getBoardMatrix(state) {
    return parseFen(state.fen).board;
  },
};
