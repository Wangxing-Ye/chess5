"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { GameBoard } from "@/components/boards/GameBoard";
import { CaptureTray, GoCaptureTray } from "@/components/match/CaptureTray";
import { Link } from "@/i18n/navigation";
import {
  goCaptureCounts,
  materialCaptures,
  supportsCaptureTray,
} from "@/lib/games/captures";
import { othelloDiscCounts } from "@/lib/games/othello";
import { isReplayableGameId, stateAtPly } from "@/lib/games/replay";
import { reasonLabel } from "@/lib/games/reasons";
import type { GameId } from "@/lib/games/types";
import { PROVIDERS } from "@/lib/llm/providers";
import type { MatchMode, MoveFailureSample, MoveOutputSample, Participant } from "@/lib/match/types";

export type ReplayPayload = {
  id: string;
  seq: number;
  gameId: string;
  mode: MatchMode;
  startedAt: number;
  endedAt: number | null;
  winner: string | null;
  winReason: string | null;
  playerW: Participant;
  playerB: Participant;
  moves: string[];
  outputs: MoveOutputSample[];
  failures: MoveFailureSample[];
};

function labelParticipant(p: Participant, humanLabel: string): string {
  if (p.kind === "human") {
    const name = p.name?.trim();
    return name ? `${humanLabel} · ${name}` : humanLabel;
  }
  const name = PROVIDERS.find((x) => x.id === p.provider)?.name ?? p.provider;
  return `${name} · ${p.model}`;
}

function fmt(ts: number | null, locale: string): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const time = new Intl.DateTimeFormat(locale, {
    timeStyle: "medium",
  }).format(d);
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
  }).format(d);
  return `${time} · ${date}`;
}

function fmtDuration(startedAt: number, endedAt: number | null): string | null {
  if (!endedAt || endedAt < startedAt) return null;
  const totalSec = Math.floor((endedAt - startedAt) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h} h ${m} m ${s} s`;
}

/** Illegal-strike count: 0 muted, 1 white, 2 yellow, 3+ red. */
function illegalStrikeColor(n: number): string {
  if (n >= 3) return "var(--danger)";
  if (n === 2) return "#facc15";
  if (n === 1) return "var(--fg)";
  return "var(--fg-muted)";
}

function IllegalStrikeCount({ n }: { n: number }) {
  return <span style={{ color: illegalStrikeColor(n) }}>{n}</span>;
}

export function ReplayRoom({ record }: { record: ReplayPayload }) {
  const t = useTranslations("play");
  const tReplay = useTranslations("replay");
  const tGames = useTranslations("games");
  const tModes = useTranslations("modes");
  const tArena = useTranslations("arena");
  const tReasons = useTranslations("reasons");
  const tHistory = useTranslations("history");
  const locale = useLocale();
  const humanLabel = tArena("human");

  const supported = isReplayableGameId(record.gameId);
  const gameId = supported ? (record.gameId as GameId) : null;
  const moves = record.moves;
  const [ply, setPly] = useState(moves.length);

  const viewState = useMemo(() => {
    if (!gameId) return null;
    return stateAtPly(gameId, moves, ply);
  }, [gameId, moves, ply]);

  const outputAtPly = useMemo(() => {
    if (ply <= 0) return null;
    return record.outputs.find((o) => o.moveIndex === ply - 1) ?? null;
  }, [record.outputs, ply]);

  const failuresAtPly = useMemo(
    () => record.failures.filter((f) => f.moveIndex === ply),
    [record.failures, ply],
  );

  const captureMaterial = useMemo(
    () => (viewState ? materialCaptures(viewState) : null),
    [viewState],
  );
  const goCaptures = useMemo(
    () => (viewState ? goCaptureCounts(viewState) : null),
    [viewState],
  );
  const discCounts = useMemo(
    () => (viewState ? othelloDiscCounts(viewState) : null),
    [viewState],
  );

  const duration = fmtDuration(record.startedAt, record.endedAt);

  const illegalStrikes = useMemo(() => {
    const strikes = { w: 0, b: 0 };
    for (const f of record.failures) {
      if (f.countedStrike) strikes[f.side] += 1;
    }
    return strikes;
  }, [record.failures]);

  const winnerText =
    record.winner === "draw"
      ? tHistory("draws")
      : record.winner === "w"
        ? labelParticipant(record.playerW, humanLabel)
        : record.winner === "b"
          ? labelParticipant(record.playerB, humanLabel)
          : record.endedAt
            ? tHistory("noWinner")
            : tHistory("inProgress");
  const reasonText = reasonLabel(record.winReason, tReasons);

  if (!supported || !viewState || !gameId) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl">
          {tReplay("title")}
        </h1>
        <p className="mt-3 text-sm text-[var(--danger)]">
          {tReplay("unsupported")}
        </p>
        <Link
          href="/history"
          className="mt-6 inline-block text-sm text-[var(--cyan)]"
        >
          {tReplay("backToHistory")}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[1fr_320px]">
      <div>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h1 className="font-[family-name:var(--font-display)] text-2xl">
            <span className="text-[var(--fg-faint)]">
              {tHistory("matchNo", { n: record.seq })}
            </span>{" "}
            · {tReplay("title")} · {tGames(gameId)}
          </h1>
          <Link href="/history" className="btn btn-ghost !py-1 text-sm">
            {tReplay("backToHistory")}
          </Link>
        </div>

        <div
          className={
            supportsCaptureTray(gameId)
              ? "grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 sm:gap-x-3"
              : ""
          }
        >
          <div
            className={
              supportsCaptureTray(gameId)
                ? "col-start-2 mb-3 text-center font-[family-name:var(--font-display)] text-sm text-[var(--cyan)] sm:text-base"
                : "mb-3 text-center font-[family-name:var(--font-display)] text-sm text-[var(--cyan)] sm:text-base"
            }
          >
            {labelParticipant(record.playerB, humanLabel)}
            {discCounts != null ? ` (${discCounts.b})` : ""}
          </div>

          {captureMaterial && (
            <div className="row-start-2">
              <CaptureTray
                byB={captureMaterial.byB}
                byW={captureMaterial.byW}
              />
            </div>
          )}
          {goCaptures && (
            <div className="row-start-2">
              <GoCaptureTray
                capturesB={goCaptures.b}
                capturesW={goCaptures.w}
                label={t("captures")}
              />
            </div>
          )}
          <div
            className={
              supportsCaptureTray(gameId) ? "row-start-2 min-w-0" : "min-w-0"
            }
          >
            <GameBoard state={viewState} onMove={() => {}} readOnly hidePass />
          </div>

          <div
            className={
              supportsCaptureTray(gameId)
                ? "col-start-2 mt-3 text-center font-[family-name:var(--font-display)] text-sm text-[var(--cyan)] sm:text-base"
                : "mt-3 text-center font-[family-name:var(--font-display)] text-sm text-[var(--cyan)] sm:text-base"
            }
          >
            {labelParticipant(record.playerW, humanLabel)}
            {discCounts != null ? ` (${discCounts.w})` : ""}
          </div>
        </div>

        <p className="mt-4 border border-[var(--line)] px-4 py-3 text-center text-sm">
          {tModes(record.mode)} · {t("winner")}{" "}
          <span className="text-[var(--accent)]">{winnerText}</span>
          {reasonText ? ` · ${reasonText}` : ""}
        </p>
      </div>

      <aside className="space-y-4">
        <div className="panel p-4">
          <div className="label">{t("status")}</div>
          <p className="text-sm text-[var(--fg-muted)]">
            {tReplay("ply", { current: ply, total: moves.length })}
          </p>
          <p className="mt-2 text-xs text-[var(--fg-muted)]">
            {t("illegalStrikes")}{" "}
            {record.mode === "human_vs_model" ? (
              <IllegalStrikeCount
                n={
                  record.playerW.kind === "model"
                    ? illegalStrikes.w
                    : illegalStrikes.b
                }
              />
            ) : (
              <>
                w:
                <IllegalStrikeCount n={illegalStrikes.w} />
                {" / b:"}
                <IllegalStrikeCount n={illegalStrikes.b} />
              </>
            )}
          </p>
          <p className="mt-2 text-xs text-[var(--fg-faint)]">
            {tHistory("started")} {fmt(record.startedAt, locale)}
          </p>
          <p className="mt-1 text-xs text-[var(--fg-faint)]">
            {tHistory("ended")} {fmt(record.endedAt, locale)}
          </p>
          {duration && (
            <p className="mt-1 text-xs text-[var(--fg-faint)]">
              {tHistory("duration")} {duration}
            </p>
          )}
        </div>

        <div className="panel p-4">
          <div className="label">{t("moveHistory")}</div>
          <div className="mt-2 max-h-56 overflow-auto text-sm">
            {moves.length === 0 && (
              <p className="text-[var(--fg-muted)]">{t("noMoves")}</p>
            )}
            <ol className="space-y-1">
              {[...moves]
                .map((m, i) => ({ m, i }))
                .reverse()
                .map(({ m, i }) => (
                  <li key={`${m}-${i}`}>
                    <button
                      type="button"
                      className={`text-left hover:text-[var(--cyan)] ${
                        ply === i + 1 ? "text-[var(--accent)]" : ""
                      }`}
                      onClick={() => setPly(i + 1)}
                    >
                      {i + 1}. {m}
                    </button>
                  </li>
                ))}
            </ol>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="btn btn-ghost !px-2 !py-1 text-xs"
              onClick={() => setPly(moves.length)}
            >
              {tReplay("end")}
            </button>
            <button
              type="button"
              className="btn btn-ghost !px-2 !py-1 text-xs"
              disabled={ply <= 0}
              onClick={() => setPly((p) => Math.max(0, p - 1))}
            >
              {t("prev")}
            </button>
            <button
              type="button"
              className="btn btn-ghost !px-2 !py-1 text-xs"
              disabled={ply >= moves.length}
              onClick={() => setPly((p) => Math.min(moves.length, p + 1))}
            >
              {t("next")}
            </button>
          </div>
        </div>

        <div className="panel p-4">
          <div className="label">{t("lastOutput")}</div>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-[var(--fg-muted)]">
            {outputAtPly
              ? `${outputAtPly.san ? `move: ${outputAtPly.san}\n` : ""}${
                  outputAtPly.raw || "(empty)"
                }`
              : ply <= 0
                ? "—"
                : tReplay("noModelOutput")}
          </pre>
          {failuresAtPly.length > 0 && (
            <div className="mt-3 space-y-3">
              <div className="label text-[var(--danger)]">
                {tReplay("failuresAfterPly", { count: failuresAtPly.length })}
              </div>
              {failuresAtPly.map((f, i) => (
                <pre
                  key={`${f.at}-${i}`}
                  className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--line)] p-2 text-xs text-[var(--fg-muted)]"
                >
                  {f.countedStrike
                    ? `${tReplay("failureIllegal")}\n`
                    : `${tReplay("failureSoft")}\n`}
                  {`error: ${f.error}\n${f.raw || "(empty)"}`}
                </pre>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
