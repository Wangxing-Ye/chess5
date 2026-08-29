import { Chess, type Square } from "chess.js";
import { extractMoveFromModelText } from "./extractMove";
import type { GameEngine, GameState, Move } from "./types";

function fromChess(chess: Chess, history: string[], last?: Move): GameState {
  return {
    gameId: "chess",
    fen: chess.fen(),
    turn: chess.turn(),
    moveHistory: history,
    lastMove: last,
  };
}

export const chessEngine: GameEngine = {
  id: "chess",

  newGame() {
    return fromChess(new Chess(), []);
  },

  legalMoves(state) {
    const chess = new Chess(state.fen);
    return chess.moves({ verbose: true }).map((m) => ({
      san: m.san,
      from: m.from,
      to: m.to,
    }));
  },

  applyMove(state, move) {
    const chess = new Chess(state.fen);
    const input = typeof move === "string" ? move : move.san;
    const result =
      chess.move(input) ||
      (typeof move !== "string" && move.from && move.to
        ? chess.move({
            from: move.from as Square,
            to: move.to as Square,
            promotion: "q",
          })
        : null);
    if (!result) throw new Error(`Illegal chess move: ${input}`);
    const applied: Move = {
      san: result.san,
      from: result.from,
      to: result.to,
      meta: {
        captured: Boolean(result.captured),
        capturedPiece: result.captured || undefined,
      },
    };
    return fromChess(chess, [...state.moveHistory, result.san], applied);
  },

  isTerminal(state) {
    const chess = new Chess(state.fen);
    if (chess.isCheckmate()) {
      return {
        over: true,
        result: {
          winner: chess.turn() === "w" ? "b" : "w",
          reason: "checkmate",
        },
      };
    }
    if (chess.isStalemate()) {
      return { over: true, result: { winner: "draw", reason: "stalemate" } };
    }
    if (chess.isDraw()) {
      return { over: true, result: { winner: "draw", reason: "draw" } };
    }
    return { over: false };
  },

  toPromptView(state, options) {
    const chess = new Chess(state.fen);
    const protect = options?.legalMovesProtection !== false;
    const lines = [
      "Game: Chess (international)",
      `FEN: ${state.fen}`,
      `Turn: ${state.turn === "w" ? "White" : "Black"}`,
      `ASCII:\n${chess.ascii()}`,
    ];
    if (protect) {
      lines.push(`Legal moves: ${chess.moves().join(", ")}`);
    }
    lines.push('Reply with JSON only: {"move":"<SAN>","comment":"..."}');
    return lines.join("\n");
  },

  parseMove(text, state) {
    const legal = this.legalMoves(state);
    const fromJson = extractMoveFromModelText(text);
    const candidate = (fromJson ?? text.trim()).replace(/^["']|["']$/g, "");
    const found = legal.find(
      (m) =>
        m.san === candidate ||
        m.san.replace("=", "") === candidate ||
        `${m.from}${m.to}` === candidate ||
        `${m.from}-${m.to}` === candidate,
    );
    return found ?? null;
  },

  getBoardMatrix(state) {
    const chess = new Chess(state.fen);
    return chess
      .board()
      .map((row) => row.map((p) => (p ? `${p.color}${p.type}` : null)));
  },
};
