"use client";

import type { GameState, Move } from "@/lib/games/types";
import { ChessPieceGlyph } from "./chessPieces";

const FILES = "abcdefgh";
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1] as const;

function fenToMatrix(fen: string): (string | null)[][] {
  const rows = fen.split(" ")[0].split("/");
  return rows.map((row) => {
    const cells: (string | null)[] = [];
    for (const ch of row) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < parseInt(ch, 10); i++) cells.push(null);
      } else {
        const color = ch === ch.toUpperCase() ? "w" : "b";
        cells.push(`${color}${ch.toLowerCase()}`);
      }
    }
    return cells;
  });
}

function findKingSquare(fen: string, color: "w" | "b"): string | null {
  const board = fenToMatrix(fen);
  const king = `${color}k`;
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      if (board[r][c] === king) return `${FILES[c]}${RANKS[r]}`;
    }
  }
  return null;
}

export function ChessBoard({
  state,
  legal,
  selected,
  onSelectSquare,
  onMove,
  readOnly,
  checkFlash,
}: {
  state: GameState;
  legal: Move[];
  selected: string | null;
  onSelectSquare: (sq: string) => void;
  onMove: (move: Move) => void;
  readOnly?: boolean;
  /** Flash the human king square red when put in check. */
  checkFlash?: { side: "w" | "b"; flashKey: number } | null;
}) {
  const board = fenToMatrix(state.fen);
  const lastFrom = state.lastMove?.from;
  const lastTo = state.lastMove?.to;
  const lastCaptured = state.lastMove?.meta?.captured === true;
  const flashKey = state.moveHistory.length;
  const checkSquare = checkFlash
    ? findKingSquare(state.fen, checkFlash.side)
    : null;

  return (
    <div className="mx-auto w-full max-w-[min(92vw,560px)] select-none overflow-auto">
      <div
        className="grid gap-px border border-[var(--line)] bg-[var(--line)]"
        style={{
          gridTemplateColumns: "auto repeat(8, minmax(0, 1fr))",
        }}
      >
        {board.map((row, r) => (
          <div key={`rank-${RANKS[r]}`} className="contents">
            <div className="flex items-center justify-center bg-[var(--bg-panel)] px-1.5 text-[10px] text-[var(--fg-muted)]">
              {RANKS[r]}
            </div>
            {row.map((cell, c) => {
              const sq = `${FILES[c]}${RANKS[r]}`;
              const dark = (r + c) % 2 === 1;
              const isSelected = selected === sq;
              const targets = legal.filter((m) => m.from === selected);
              const isTarget = targets.some((m) => m.to === sq);
              const isLastTo = sq === lastTo;
              const isCheckFlash = sq === checkSquare && checkFlash;
              const lastClass = isCheckFlash
                ? "king-in-check"
                : isLastTo
                  ? lastCaptured
                    ? "last-to last-to-capture"
                    : "last-to"
                  : sq === lastFrom
                    ? "last-from"
                    : "";
              const isBlack = cell?.startsWith("b");
              const cellKey = isCheckFlash
                ? `${sq}-check${checkFlash.flashKey}`
                : isLastTo && lastCaptured
                  ? `${sq}-c${flashKey}`
                  : sq;
              return (
                <button
                  key={cellKey}
                  type="button"
                  disabled={readOnly}
                  className={`board-cell relative flex aspect-square items-center justify-center text-[clamp(1.1rem,4vw,2rem)] ${
                    dark ? "bg-[#1a2740]" : "bg-[#243552]"
                  } ${isSelected ? "ring-2 ring-inset ring-[var(--accent)]" : ""} ${lastClass}`}
                  onClick={() => {
                    if (readOnly) return;
                    if (selected && isTarget) {
                      const move = targets.find((m) => m.to === sq)!;
                      onMove(move);
                      return;
                    }
                    onSelectSquare(sq);
                  }}
                >
                  {cell && (
                    <ChessPieceGlyph
                      piece={cell[1]!}
                      side={isBlack ? "b" : "w"}
                    />
                  )}
                  {isTarget && (
                    <span className="absolute h-3 w-3 rounded-full bg-[var(--cyan)]/70" />
                  )}
                </button>
              );
            })}
          </div>
        ))}
        <div className="bg-[var(--bg-panel)]" />
        {FILES.split("").map((file) => (
          <div
            key={file}
            className="bg-[var(--bg-panel)] py-1 text-center text-[10px] text-[var(--fg-muted)]"
          >
            {file}
          </div>
        ))}
      </div>
    </div>
  );
}
