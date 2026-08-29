"use client";

import {
  CHESS_PIECE_FONT,
  CHESS_PIECE_GLYPH,
  chessPieceSideClass,
} from "@/lib/games/chessGlyphs";

export function ChessPieceGlyph({
  piece,
  side,
  className = "",
}: {
  /** Piece letter: k q r b n p */
  piece: string;
  side: "w" | "b";
  className?: string;
}) {
  const glyph = CHESS_PIECE_GLYPH[piece.toLowerCase()] ?? piece;
  return (
    <span
      className={`inline-flex items-center justify-center leading-none ${chessPieceSideClass(side)} ${className}`}
      style={{ fontFamily: CHESS_PIECE_FONT }}
    >
      {glyph}
    </span>
  );
}
