import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  countMatchRecords,
  listMatchRecords,
  parseListRow,
} from "@/lib/db/matches";
import { reasonLabel } from "@/lib/games/reasons";
import { Link } from "@/i18n/navigation";
import { getMatch } from "@/lib/match/store";
import type { Participant } from "@/lib/match/types";
import { PROVIDERS } from "@/lib/llm/providers";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

function participantLabel(p: Participant, humanLabel: string): string {
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

/** Elapsed wall time as "X h Y m Z s" (always three parts). */
function fmtDuration(startedAt: number, endedAt: number | null): string | null {
  if (!endedAt || endedAt < startedAt) return null;
  const totalSec = Math.floor((endedAt - startedAt) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h} h ${m} m ${s} s`;
}

function parsePage(raw: string | string[] | undefined): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const n = Number.parseInt(s ?? "1", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export default async function HistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("history");
  const tModes = await getTranslations("modes");
  const tGames = await getTranslations("games");
  const tArena = await getTranslations("arena");
  const tReasons = await getTranslations("reasons");

  const total = countMatchRecords();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(parsePage(sp.page), totalPages);
  const offset = (page - 1) * PAGE_SIZE;
  // Keyset on seq (no OFFSET / no move_history blob).
  const rows = listMatchRecords(PAGE_SIZE, offset).map(parseListRow);
  const humanLabel = tArena("human");

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--fg)]">
        {t("title")}
      </h1>

      <section className="mt-8">
        {rows.length === 0 ? (
          <p className="text-sm text-[var(--fg-muted)]">{t("empty")}</p>
        ) : (
          <>
            {totalPages > 1 && (
              <nav
                className="mb-4 flex flex-wrap items-center justify-between gap-3"
                aria-label={t("pagination")}
              >
                <div className="flex flex-wrap items-center gap-1">
                  {page > 1 ? (
                    <Link
                      href="/history"
                      className="btn btn-ghost !px-3 !py-2 text-sm"
                    >
                      {t("firstPage")}
                    </Link>
                  ) : (
                    <span className="btn btn-ghost !px-3 !py-2 text-sm opacity-40">
                      {t("firstPage")}
                    </span>
                  )}
                  {page > 1 ? (
                    <Link
                      href={page === 2 ? "/history" : `/history?page=${page - 1}`}
                      className="btn btn-ghost !px-3 !py-2 text-sm"
                    >
                      {t("prevPage")}
                    </Link>
                  ) : (
                    <span className="btn btn-ghost !px-3 !py-2 text-sm opacity-40">
                      {t("prevPage")}
                    </span>
                  )}
                </div>
                <span className="text-sm text-[var(--fg-muted)]">
                  {t("pageOf", { page, pages: totalPages })}
                  {" · "}
                  {t("pageSize", { size: PAGE_SIZE })}
                </span>
                <div className="flex flex-wrap items-center gap-1">
                  {page < totalPages ? (
                    <Link
                      href={`/history?page=${page + 1}`}
                      className="btn btn-ghost !px-3 !py-2 text-sm"
                    >
                      {t("nextPage")}
                    </Link>
                  ) : (
                    <span className="btn btn-ghost !px-3 !py-2 text-sm opacity-40">
                      {t("nextPage")}
                    </span>
                  )}
                  {page < totalPages ? (
                    <Link
                      href={`/history?page=${totalPages}`}
                      className="btn btn-ghost !px-3 !py-2 text-sm"
                    >
                      {t("lastPage")}
                    </Link>
                  ) : (
                    <span className="btn btn-ghost !px-3 !py-2 text-sm opacity-40">
                      {t("lastPage")}
                    </span>
                  )}
                </div>
              </nav>
            )}
            <div className="space-y-2">
              {rows.map((r) => {
                const live = getMatch(r.id);
                const canWatch = live?.status === "playing";
                const canReplay = Boolean(r.ended_at);
                const winnerText =
                  r.winner === "draw"
                    ? t("draws")
                    : r.winner === "w"
                      ? participantLabel(r.playerW, humanLabel)
                      : r.winner === "b"
                        ? participantLabel(r.playerB, humanLabel)
                        : r.ended_at
                          ? t("noWinner")
                          : t("inProgress");
                const reasonText = reasonLabel(r.win_reason, tReasons);
                const duration = fmtDuration(r.started_at, r.ended_at);
                return (
                  <div key={r.id} className="panel px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-[var(--fg)]">
                        <span className="text-[var(--fg-faint)]">
                          {t("matchNo", { n: r.seq })}
                        </span>{" "}
                        · {tGames(r.game_id as never)} · {tModes(r.mode)}
                      </span>
                      <span className="flex flex-col items-end gap-1 text-xs">
                        <span className="text-[var(--fg-faint)]">
                          {t("started")} {fmt(r.started_at, locale)} ·{" "}
                          {t("ended")} {fmt(r.ended_at, locale)}
                        </span>
                        {duration && (
                          <span className="text-[var(--fg-faint)]">
                            {t("duration")} {duration}
                          </span>
                        )}
                        {canWatch ? (
                          <Link
                            href={`/spectate/${r.id}`}
                            className="text-[var(--cyan)] hover:underline"
                          >
                            {t("watch")}
                          </Link>
                        ) : canReplay ? (
                          <Link
                            href={`/replay/${r.id}`}
                            className="text-[var(--cyan)] hover:underline"
                          >
                            {t("replay")}
                          </Link>
                        ) : null}
                      </span>
                    </div>
                    <div className="mt-1 text-[var(--fg-muted)]">
                      {participantLabel(r.playerW, humanLabel)} vs{" "}
                      {participantLabel(r.playerB, humanLabel)} ·{" "}
                      {t("moves", { count: r.moveCount })}
                    </div>
                    <div className="mt-1">
                      {t("winner")}:{" "}
                      <span className="text-[var(--accent)]">{winnerText}</span>
                      {reasonText ? ` · ${reasonText}` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
