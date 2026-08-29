import type { GameId, GameResult, GameState, PlayerColor } from "@/lib/games/types";
import type { ProviderId } from "@/lib/llm/providers";
import type { ReasoningLevel } from "@/lib/llm/reasoning";

export type Participant =
  | { kind: "human"; name?: string }
  | { kind: "model"; provider: ProviderId; model: string; name?: string };

export type MatchStatus = "playing" | "finished";

export type MatchMode = "human_vs_model" | "model_vs_model" | "human_vs_human";

export type LlmLogEntry = {
  at: number;
  side: PlayerColor;
  provider?: ProviderId;
  model?: string;
  raw: string;
  parsedMove?: string;
  error?: string;
};

/** One successful model move's LLM round-trip timing (persisted in move_history). */
export type ThinkSample = {
  at: number;
  side: PlayerColor;
  provider: ProviderId;
  model: string;
  san: string;
  /** Milliseconds from LLM request start until the legal move was accepted. */
  thinkMs: number;
  /** Arena reasoning level used for this move. */
  reasoningLevel: ReasoningLevel;
};

/**
 * Short model output for a successful move (persisted for Replay).
 * `raw` is clipped / JSON-extracted — not full reasoning dumps.
 */
export type MoveOutputSample = {
  /** 0-based index into `state.moveHistory` / persisted `moves[]`. */
  moveIndex: number;
  side: PlayerColor;
  san: string;
  raw: string;
};

/**
 * Persisted failed model attempt (illegal / unparsable, or soft refusal).
 * `moveIndex` is the position when the attempt occurred (= moves on board).
 */
export type MoveFailureSample = {
  at: number;
  side: PlayerColor;
  /** Position index when the failure occurred (matches `moves.length` at attempt time). */
  moveIndex: number;
  error: string;
  raw: string;
  provider?: ProviderId;
  model?: string;
  /** When true, this attempt incremented illegal strikes. */
  countedStrike: boolean;
  /** Arena reasoning level at the time of the attempt. Omitted on legacy rows. */
  reasoningLevel?: ReasoningLevel;
};

export type Match = {
  id: string;
  /** Stable 1-based series number from SQLite; set at create. */
  seq?: number;
  createdAt: number;
  updatedAt: number;
  gameId: GameId;
  mode: MatchMode;
  status: MatchStatus;
  players: { w: Participant; b: Participant };
  state: GameState;
  result?: GameResult;
  publicSpectate: boolean;
  autoPlay: boolean;
  autoDelayMs: number;
  /** Arena Reasoning: off | low | medium | high. */
  reasoningLevel: ReasoningLevel;
  /**
   * When true, Chess/Othello/Xiangqi prompts include legal-move lists.
   * Ignored for Go/Gomoku (no full legal list).
   */
  legalMovesProtection: boolean;
  /**
   * When true, prompts include a short per-game tactical tip
   * (play actively when safe / avoid hanging material).
   */
  tacticalGuidance: boolean;
  /**
   * Last play-client heartbeat. If stale while still playing, the match
   * is aborted with no winner (player left the play page).
   */
  lastHeartbeatAt: number;
  llmLog: LlmLogEntry[];
  /** Successful model-move think times; serialized into move_history v2+. */
  thinkSamples: ThinkSample[];
  /** Short model outputs per successful move; serialized into move_history v3+. */
  moveOutputs: MoveOutputSample[];
  /** Failed model attempts; serialized into move_history v4+. */
  moveFailures: MoveFailureSample[];
  illegalStrikes: { w: number; b: number };
  /** Capability token for mutating the match (server-only; stripped in API). */
  playToken?: string;
  /** Capability token for private spectate (server-only; stripped in API). */
  spectateToken?: string;
  /**
   * Client identity at create time (rate-limit bucket / IP). Server-only;
   * used to cap concurrent playing matches per IP.
   */
  creatorIp?: string;
};

export type CreateMatchInput = {
  gameId: GameId;
  mode: MatchMode;
  players: { w: Participant; b: Participant };
  publicSpectate?: boolean;
  autoPlay?: boolean;
  autoDelayMs?: number;
  /** Preferred: off | low | medium | high. */
  reasoningLevel?: ReasoningLevel;
  /** @deprecated Prefer reasoningLevel. true → high, false → off. */
  reasoning?: boolean;
  /** Default true for Chess/Othello/Xiangqi; forced false for Go/Gomoku. */
  legalMovesProtection?: boolean;
  /** Default true — short tactical tip in the move prompt. */
  tacticalGuidance?: boolean;
  goSize?: number;
};
