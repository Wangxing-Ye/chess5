"use client";

import { ChessPieceGlyph } from "@/components/boards/chessPieces";
import type { CapturedGlyph } from "@/lib/games/captures";

function GlyphStack({
  items,
  emptyLabel,
}: {
  items: CapturedGlyph[];
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return (
      <span className="text-[10px] text-[var(--fg-muted)] opacity-40">
        {emptyLabel}
      </span>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-0.5">
      {items.map((item) => {
        const recentClass = item.recent
          ? "rounded-sm bg-[rgba(6,182,212,0.2)] ring-1 ring-[var(--cyan)]"
          : "";

        if (item.chessPiece) {
          const side = item.tone === "light" ? "w" : "b";
          return (
            <span
              key={item.id}
              className={`inline-flex h-[30px] w-[30px] items-center justify-center text-[20px] ${recentClass}`}
              title={item.recent ? "Latest capture" : undefined}
            >
              <ChessPieceGlyph piece={item.chessPiece} side={side} />
            </span>
          );
        }

        const tone =
          item.tone === "light"
            ? "text-[#f1f5f9] [text-shadow:0_0_1px_#0f172a]"
            : item.tone === "dark"
              ? "text-[#475569] [text-shadow:0_0_1px_rgba(241,245,249,0.4)]"
              : item.tone === "red"
                ? "text-[#f87171]"
                : "text-[var(--fg-muted)]";
        return (
          <span
            key={item.id}
            className={`inline-flex h-[30px] w-[30px] items-center justify-center text-[17.5px] leading-none ${tone} ${recentClass}`}
            title={item.recent ? "Latest capture" : undefined}
          >
            {item.glyph}
          </span>
        );
      })}
    </div>
  );
}

/** Left-side trays: Side B captures on top, Side A captures on bottom. */
export function CaptureTray({
  byB,
  byW,
}: {
  byB: CapturedGlyph[];
  byW: CapturedGlyph[];
}) {
  return (
    <aside
      aria-label="Captured pieces"
      className="flex h-full w-[62px] shrink-0 flex-col justify-between py-1"
    >
      <GlyphStack items={byB} emptyLabel="·" />
      <GlyphStack items={byW} emptyLabel="·" />
    </aside>
  );
}

/** Go: top = stones Side B took (dark), bottom = stones Side A took (light). */
export function GoCaptureTray({
  capturesB,
  capturesW,
  label,
}: {
  capturesB: number;
  capturesW: number;
  label: string;
}) {
  return (
    <aside
      aria-label={label}
      className="flex h-full w-12 shrink-0 flex-col justify-between sm:w-14"
    >
      <div
        className={`flex items-center gap-1 text-xs ${
          capturesB > 0 ? "text-[var(--cyan)]" : "text-[var(--fg-muted)]"
        }`}
      >
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#0b1220] shadow-[inset_0_0_0_1px_rgba(148,163,184,0.35)]" />
        <span>
          ×<span className="ml-0.5">{capturesB}</span>
        </span>
      </div>
      <div
        className={`flex items-center gap-1 text-xs ${
          capturesW > 0 ? "text-[var(--cyan)]" : "text-[var(--fg-muted)]"
        }`}
      >
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#e8eef9]" />
        <span>
          ×<span className="ml-0.5">{capturesW}</span>
        </span>
      </div>
    </aside>
  );
}
