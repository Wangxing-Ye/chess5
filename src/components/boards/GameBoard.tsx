"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { getEngine } from "@/lib/games";
import { GOMOKU_SIZE } from "@/lib/games/gomoku";
import type { GameState, Move } from "@/lib/games/types";
import { OTHELLO_SIZE } from "@/lib/games/othello";
import { ChessBoard } from "./ChessBoard";
import { goLabels, gomokuLabels, GridBoard, PointStone } from "./GridBoard";
import { XiangqiBoard } from "./XiangqiBoard";

export function GameBoard({
  state,
  onMove,
  readOnly,
  hidePass,
  checkFlash,
}: {
  state: GameState;
  onMove: (move: Move | string) => void;
  readOnly?: boolean;
  /** When true, Go pass control is omitted (render it outside the board row). */
  hidePass?: boolean;
  /** Chess HvM: flash human king when in check. */
  checkFlash?: { side: "w" | "b"; flashKey: number } | null;
}) {
  const t = useTranslations("play");
  const engine = getEngine(state.gameId);
  const legal = useMemo(() => engine.legalMoves(state), [engine, state]);
  const [selected, setSelected] = useState<string | null>(null);
  const matrix = engine.getBoardMatrix?.(state) ?? [];
  const gomokuLabelSet = useMemo(() => gomokuLabels(GOMOKU_SIZE), []);
  const goSize = (state.data?.size as number) || matrix.length || 9;
  const goLabelSet = useMemo(() => goLabels(goSize), [goSize]);
  const lastCaptured = state.lastMove?.meta?.captured === true;
  const flashKey = state.moveHistory.length;

  if (state.gameId === "chess") {
    return (
      <ChessBoard
        state={state}
        legal={legal}
        selected={selected}
        onSelectSquare={(sq) => setSelected(sq)}
        onMove={(m) => {
          setSelected(null);
          onMove(m);
        }}
        readOnly={readOnly}
        checkFlash={checkFlash}
      />
    );
  }

  if (state.gameId === "xiangqi") {
    return (
      <XiangqiBoard
        matrix={matrix}
        legal={legal}
        selected={selected}
        onSelect={setSelected}
        onMove={(m) => {
          setSelected(null);
          onMove(m);
        }}
        lastFrom={state.lastMove?.from}
        lastTo={state.lastMove?.to}
        lastCaptured={lastCaptured}
        flashKey={flashKey}
        readOnly={readOnly}
      />
    );
  }

  if (state.gameId === "othello") {
    const othelloLabels = gomokuLabels(OTHELLO_SIZE);
    const canPass = legal.some((m) => m.san === "pass");
    return (
      <div>
        <GridBoard
          size={OTHELLO_SIZE}
          matrix={matrix}
          legalSans={legal.filter((m) => m.san !== "pass").map((m) => m.san)}
          lastSan={state.lastMove?.san}
          lastCaptured={lastCaptured}
          flashKey={flashKey}
          readOnly={readOnly}
          labels={othelloLabels}
          onPlace={(san) => onMove(san)}
          renderCell={(v) => <PointStone value={v} firstIs="w" />}
          ghostPreview
        />
        {!readOnly && canPass && (
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              className="btn btn-ghost !py-2 text-sm"
              onClick={() => onMove("pass")}
            >
              {t("pass")}
            </button>
          </div>
        )}
      </div>
    );
  }

  if (state.gameId === "gomoku") {
    return (
      <GridBoard
        size={GOMOKU_SIZE}
        matrix={matrix}
        legalSans={legal.map((m) => m.san)}
        lastSan={state.lastMove?.san}
        lastCaptured={lastCaptured}
        flashKey={flashKey}
        readOnly={readOnly}
        labels={gomokuLabelSet}
        onPlace={(san) => onMove(san)}
        renderCell={(v) => <PointStone value={v} />}
        ghostPreview
      />
    );
  }

  return (
    <div>
      <GridBoard
        size={goSize}
        matrix={matrix}
        legalSans={legal.filter((m) => m.san !== "pass").map((m) => m.san)}
        lastSan={state.lastMove?.san}
        lastCaptured={lastCaptured}
        flashKey={flashKey}
        readOnly={readOnly}
        labels={goLabelSet}
        onPlace={(san) => onMove(san)}
        renderCell={(v) => <PointStone value={v} firstIs="w" />}
        ghostPreview
      />
      {!hidePass && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            className="btn btn-ghost !py-2 text-sm"
            disabled={readOnly}
            onClick={() => onMove("pass")}
          >
            {t("pass")}
          </button>
        </div>
      )}
    </div>
  );
}
