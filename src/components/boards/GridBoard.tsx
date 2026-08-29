"use client";

/** Shared clickable grid for stone-placement games (Gomoku / Go / Othello) */
export function GridBoard({
  size,
  matrix,
  onPlace,
  legalSans,
  lastSan,
  lastCaptured,
  flashKey = 0,
  readOnly,
  renderCell,
  labels,
  /** Othello: show dark-gray ghost stone on hover/focus of legal empties. */
  ghostPreview = false,
}: {
  size: number;
  matrix: (string | null)[][];
  onPlace: (san: string) => void;
  legalSans: string[];
  lastSan?: string;
  lastCaptured?: boolean;
  flashKey?: number;
  readOnly?: boolean;
  renderCell: (value: string | null, san: string) => React.ReactNode;
  labels: { cols: string[]; rows: string[] };
  ghostPreview?: boolean;
}) {
  const legal = new Set(legalSans);

  return (
    <div className="mx-auto w-full max-w-[min(92vw,560px)] overflow-auto">
      <div
        className="grid gap-px border border-[var(--line)] bg-[var(--line)]"
        style={{ gridTemplateColumns: `auto repeat(${size}, minmax(0, 1fr))` }}
      >
        <div className="bg-[var(--bg-panel)]" />
        {labels.cols.map((c) => (
          <div
            key={c}
            className="bg-[var(--bg-panel)] py-1 text-center text-[10px] text-[var(--fg-muted)]"
          >
            {c}
          </div>
        ))}
        {matrix.map((row, r) => (
          <div key={`row-${r}`} className="contents">
            <div className="flex items-center justify-center bg-[var(--bg-panel)] px-1 text-[10px] text-[var(--fg-muted)]">
              {labels.rows[r]}
            </div>
            {row.map((cell, c) => {
              const san = `${labels.cols[c]}${labels.rows[r]}`;
              const can = legal.has(san);
              const isLast = lastSan === san;
              const lastClass = isLast
                ? lastCaptured
                  ? "last-to last-to-capture"
                  : "last-to"
                : "";
              const showGhost = ghostPreview && can && !cell && !readOnly;
              return (
                <button
                  key={isLast && lastCaptured ? `${san}-c${flashKey}` : san}
                  type="button"
                  disabled={readOnly || !can || !!cell}
                  className={`board-cell relative aspect-square bg-[#152033] text-sm ${lastClass} ${
                    can && !cell
                      ? "group hover:bg-[#1c2b45] focus-visible:bg-[#1c2b45] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--cyan)]"
                      : ""
                  }`}
                  onClick={() => onPlace(san)}
                >
                  {renderCell(cell, san)}
                  {showGhost && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 m-auto hidden h-[70%] w-[70%] rounded-full bg-[#1b2230]/50 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.35)] group-hover:block group-focus-visible:block"
                    />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function gomokuLabels(size = 15) {
  return {
    cols: Array.from({ length: size }, (_, i) => String.fromCharCode(65 + i)),
    rows: Array.from({ length: size }, (_, i) => String(size - i)),
  };
}

export function goLabels(size: number) {
  const letters = "ABCDEFGHJKLMNOPQRST".slice(0, size);
  return {
    cols: letters.split(""),
    rows: Array.from({ length: size }, (_, i) => String(size - i)),
  };
}

export function PointStone({
  value,
  firstIs,
}: {
  value: string | null;
  firstIs?: string;
}) {
  if (!value) return null;
  const isDark = firstIs ? value === firstIs : value === "w";
  return (
    <span
      className={`mx-auto block h-[70%] w-[70%] rounded-full ${
        isDark
          ? "bg-[#0b1220] shadow-[inset_0_0_0_1px_rgba(148,163,184,0.35)]"
          : "bg-[#e8eef9] shadow-[inset_0_0_0_1px_rgba(15,23,42,0.25)]"
      }`}
    />
  );
}
