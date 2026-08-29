/** Shared chess Unicode glyphs + CSS classes for board and capture tray. */

export const CHESS_PIECE_GLYPH: Record<string, string> = {
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};

/** Prefer symbol fonts so small tray glyphs match large board glyphs. */
export const CHESS_PIECE_FONT =
  '"Segoe UI Symbol", "Apple Symbols", "Noto Sans Symbols 2", "DejaVu Sans", sans-serif';

export function chessPieceSideClass(side: "w" | "b"): string {
  return side === "b"
    ? "text-[#0b1220] [text-shadow:0_0_1px_#0891b2,0_0_2px_#0e7490,0_1px_0_#64748b,-1px_0_#64748b,0_-1px_#64748b,1px_0_#64748b]"
    : "text-[#f8fafc] [text-shadow:0_0_1px_#0f172a,0_1px_0_#0f172a,-1px_0_#0f172a,0_-1px_#0f172a,0_1px_2px_rgba(0,0,0,0.55)]";
}
