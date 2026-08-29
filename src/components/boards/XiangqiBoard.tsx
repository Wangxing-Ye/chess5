"use client";

import type { Move } from "@/lib/games/types";

const RED: Record<string, string> = {
  K: "帅",
  A: "仕",
  B: "相",
  N: "马",
  R: "车",
  C: "炮",
  P: "兵",
};
const BLACK: Record<string, string> = {
  k: "将",
  a: "士",
  b: "象",
  n: "马",
  r: "车",
  c: "炮",
  p: "卒",
};

const FILES = "abcdefghi";
const RANKS = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1] as const;

export function XiangqiBoard({
  matrix,
  legal,
  selected,
  onSelect,
  onMove,
  lastFrom,
  lastTo,
  lastCaptured,
  flashKey = 0,
  readOnly,
}: {
  matrix: (string | null)[][];
  legal: Move[];
  selected: string | null;
  onSelect: (sq: string) => void;
  onMove: (m: Move) => void;
  lastFrom?: string;
  lastTo?: string;
  lastCaptured?: boolean;
  flashKey?: number;
  readOnly?: boolean;
}) {
  return (
    <div className="mx-auto w-full max-w-[min(92vw,520px)] overflow-auto">
      <div
        className="grid gap-px border border-[var(--line)] bg-[var(--line)]"
        style={{
          gridTemplateColumns: "auto repeat(9, minmax(0, 1fr))",
        }}
      >
        {matrix.map((row, r) => (
          <div key={`rank-${RANKS[r]}`} className="contents">
            <div className="flex items-center justify-center bg-[var(--bg-panel)] px-1 text-[10px] text-[var(--fg-muted)]">
              {RANKS[r]}
            </div>
            {row.map((cell, c) => {
              const sq = `${FILES[c]}${RANKS[r]}`;
              const isSelected = selected === sq;
              const targets = legal.filter((m) => m.from === selected);
              const isTarget = targets.some((m) => m.to === sq);
              const river = r === 4 || r === 5;
              const isLastTo = sq === lastTo;
              const lastClass = isLastTo
                ? lastCaptured
                  ? "last-to last-to-capture"
                  : "last-to"
                : sq === lastFrom
                  ? "last-from"
                  : "";
              return (
                <button
                  key={isLastTo && lastCaptured ? `${sq}-c${flashKey}` : sq}
                  type="button"
                  disabled={readOnly}
                  className={`board-cell relative aspect-square border border-[rgba(148,163,184,0.12)] text-[clamp(0.85rem,3.2vw,1.25rem)] ${
                    river ? "bg-[#152033]" : "bg-[#1c2a42]"
                  } ${isSelected ? "ring-2 ring-inset ring-[var(--accent)]" : ""} ${lastClass}`}
                  onClick={() => {
                    if (readOnly) return;
                    if (selected && isTarget) {
                      onMove(targets.find((m) => m.to === sq)!);
                      return;
                    }
                    onSelect(sq);
                  }}
                >
                  {cell && (
                    <span
                      className={
                        cell === cell.toUpperCase()
                          ? "text-[#f87171]"
                          : "text-[var(--fg)]"
                      }
                    >
                      {RED[cell] || BLACK[cell] || cell}
                    </span>
                  )}
                  {isTarget && (
                    <span className="absolute bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-[var(--cyan)]" />
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
      <div className="mt-1 text-center text-[10px] text-[var(--fg-muted)]">
        楚河 · 汉界
      </div>
    </div>
  );
}
