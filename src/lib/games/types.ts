import type { ReasoningLevel } from "@/lib/llm/reasoning";

export type GameId = "chess" | "xiangqi" | "gomoku" | "go" | "othello";

export type PlayerColor = "w" | "b";

export type GameResult = {
  winner: PlayerColor | "draw" | null;
  reason: string;
};

export type Move = {
  /** Canonical move string understood by the engine */
  san: string;
  from?: string;
  to?: string;
  meta?: Record<string, unknown>;
};

export type GameState = {
  gameId: GameId;
  /** Opaque serialized board / engine state */
  fen: string;
  turn: PlayerColor;
  moveHistory: string[];
  lastMove?: Move;
  /** Extra engine-specific payload */
  data?: Record<string, unknown>;
};

export type PromptViewOptions = {
  /** When false, omit legal-move lists (Chess/Othello/Xiangqi). Default true. */
  legalMovesProtection?: boolean;
  /** When false, omit the per-game tactical tip. Default true. */
  tacticalGuidance?: boolean;
  /** Arena reasoning level — used for prompt-only providers (e.g. Mistral). */
  reasoningLevel?: ReasoningLevel;
};

export interface GameEngine {
  id: GameId;
  newGame(options?: Record<string, unknown>): GameState;
  legalMoves(state: GameState): Move[];
  applyMove(state: GameState, move: Move | string): GameState;
  isTerminal(state: GameState): { over: boolean; result?: GameResult };
  toPromptView(state: GameState, options?: PromptViewOptions): string;
  parseMove(text: string, state: GameState): Move | null;
  getBoardMatrix?(state: GameState): (string | null)[][];
}

/** Games that can include a legal-move list in the LLM prompt. */
export function supportsLegalMovesProtection(gameId: GameId): boolean {
  return gameId === "chess" || gameId === "othello" || gameId === "xiangqi";
}
