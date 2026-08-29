import { Chess } from "chess.js";
import { CHESS_PIECE_GLYPH } from "@/lib/games/chessGlyphs";
import type { GameState, PlayerColor } from "./types";
import { xiangqiEngine } from "./xiangqi";

export type CapturedGlyph = {
  id: string;
  glyph: string;
  recent: boolean;
  /** Visual tone for dark boards */
  tone: "light" | "dark" | "red" | "muted";
  /** Chess piece letter when game is chess (for shared board/tray styling). */
  chessPiece?: string;
};

export type MaterialCaptures = {
  /** Pieces Side A (w) captured from Side B */
  byW: CapturedGlyph[];
  /** Pieces Side B (b) captured from Side A */
  byB: CapturedGlyph[];
};

const XIANGQI_GLYPH: Record<string, string> = {
  K: "帅",
  A: "仕",
  B: "相",
  N: "马",
  R: "车",
  C: "炮",
  P: "兵",
  k: "将",
  a: "士",
  b: "象",
  n: "马",
  r: "车",
  c: "炮",
  p: "卒",
};

function markRecent(lists: MaterialCaptures, lastCaptor: PlayerColor | null) {
  if (lastCaptor === "w" && lists.byW.length > 0) {
    lists.byW[lists.byW.length - 1].recent = true;
  }
  if (lastCaptor === "b" && lists.byB.length > 0) {
    lists.byB[lists.byB.length - 1].recent = true;
  }
  return lists;
}

function chessCaptures(state: GameState): MaterialCaptures {
  const chess = new Chess();
  const byW: CapturedGlyph[] = [];
  const byB: CapturedGlyph[] = [];
  let lastCaptor: PlayerColor | null = null;
  let i = 0;
  for (const san of state.moveHistory) {
    const turn = chess.turn() as PlayerColor;
    const move = chess.move(san);
    if (move?.captured) {
      // Captured piece belongs to the opponent of `turn`
      const color = turn === "w" ? "b" : "w";
      const piece = move.captured;
      const glyph = CHESS_PIECE_GLYPH[piece] ?? piece;
      const item: CapturedGlyph = {
        id: `${i}-${piece}-${turn}`,
        glyph,
        recent: false,
        tone: color === "w" ? "light" : "dark",
        chessPiece: piece,
      };
      if (turn === "w") byW.push(item);
      else byB.push(item);
      lastCaptor = turn;
    }
    i++;
  }
  return markRecent({ byW, byB }, lastCaptor);
}

function xiangqiCaptures(state: GameState): MaterialCaptures {
  let s = xiangqiEngine.newGame();
  const byW: CapturedGlyph[] = [];
  const byB: CapturedGlyph[] = [];
  let lastCaptor: PlayerColor | null = null;
  let i = 0;
  for (const san of state.moveHistory) {
    const turn = s.turn;
    s = xiangqiEngine.applyMove(s, san);
    const taken = s.lastMove?.meta?.capturedPiece;
    if (typeof taken === "string" && taken) {
      const glyph = XIANGQI_GLYPH[taken] ?? taken;
      const item: CapturedGlyph = {
        id: `${i}-${taken}-${turn}`,
        glyph,
        recent: false,
        tone: taken === taken.toUpperCase() ? "red" : "muted",
      };
      if (turn === "w") byW.push(item);
      else byB.push(item);
      lastCaptor = turn;
    }
    i++;
  }
  return markRecent({ byW, byB }, lastCaptor);
}

/** Chess / Xiangqi captured-piece lists for the current view state. */
export function materialCaptures(state: GameState): MaterialCaptures | null {
  if (state.gameId === "chess") return chessCaptures(state);
  if (state.gameId === "xiangqi") return xiangqiCaptures(state);
  return null;
}

/** Go capture counts (stones taken by each side). */
export function goCaptureCounts(
  state: GameState,
): { w: number; b: number } | null {
  if (state.gameId !== "go") return null;
  const c = state.data?.captures as { w?: number; b?: number } | undefined;
  return { w: c?.w ?? 0, b: c?.b ?? 0 };
}

export function supportsCaptureTray(gameId: string): boolean {
  return gameId === "chess" || gameId === "xiangqi" || gameId === "go";
}
