import { chessEngine } from "./chess";
import { goEngine } from "./go";
import { gomokuEngine } from "./gomoku";
import { othelloEngine } from "./othello";
import type { GameEngine, GameId } from "./types";
import { xiangqiEngine } from "./xiangqi";

export const ENGINES: Record<GameId, GameEngine> = {
  chess: chessEngine,
  xiangqi: xiangqiEngine,
  gomoku: gomokuEngine,
  go: goEngine,
  othello: othelloEngine,
};

export const GAME_IDS: GameId[] = [
  "chess",
  "go",
  "xiangqi",
  "gomoku",
  "othello",
];

export function getEngine(id: GameId): GameEngine {
  return ENGINES[id];
}

export * from "./types";
