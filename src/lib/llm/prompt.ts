import { getEngine } from "@/lib/games";
import type {
  GameId,
  GameState,
  PlayerColor,
  PromptViewOptions,
} from "@/lib/games/types";
import { reasoningPromptHint } from "@/lib/llm/reasoning";

const TACTICAL_TIPS: Record<GameId, string> = {
  chess:
    "Play actively when safe: prefer moves that create threats, but do not hang pieces or leave material en prise unless it is a clear sacrifice.",
  xiangqi:
    "Play actively when safe: prefer checks, captures, and threats, but do not leave pieces unprotected to be taken for free unless it is a clear sacrifice.",
  othello:
    "Play actively when safe: prefer moves that flip well and keep good structure, but avoid reckless edge/corner grabs that hand the opponent a strong reply.",
  gomoku:
    "Play actively when safe: block immediate opponent fours/threes and build your own threats, but do not ignore a forced win or forced block for the opponent.",
  go: "Play actively when safe: prefer purposeful moves that make territory or attack weak groups, but avoid dumping stones into atari or leaving groups with no eyes to die for free.",
};

export function buildMovePrompt(
  state: GameState,
  side: PlayerColor,
  options?: PromptViewOptions,
): string {
  const engine = getEngine(state.gameId);
  const parts = [
    "You are playing a board game as a careful expert.",
    `You play side: ${side}.`,
    "Choose exactly one legal move.",
    "Output ONLY a single JSON object, no markdown.",
  ];
  if (options?.tacticalGuidance !== false) {
    parts.push(TACTICAL_TIPS[state.gameId]);
  }
  const hint = reasoningPromptHint(options?.reasoningLevel ?? "off");
  if (hint) parts.push(hint);
  parts.push(engine.toPromptView(state, options));
  return parts.join("\n\n");
}
