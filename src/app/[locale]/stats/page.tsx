import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  hvmPlayerSummary,
  hvmSummary,
  modelFailureSummary,
  modelThinkSummary,
  mvmSummary,
} from "@/lib/db/matches";
import { AbortedHint, AbortedHintProvider } from "@/components/stats/AbortedHint";
import { reapOrphanMatches } from "@/lib/match/orphans";

export const dynamic = "force-dynamic";

/** Average model think time for stats tables. */
function fmtAvgThink(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)} s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m} m ${s} s`;
}

export default async function StatsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("stats");
  const tGames = await getTranslations("games");
  const tArena = await getTranslations("arena");

  // Close DB "in progress" rows whose live match is gone (restart / left page).
  reapOrphanMatches();

  const hvm = hvmSummary();
  const hvmPlayers = hvmPlayerSummary();
  const mvm = mvmSummary();
  const think = modelThinkSummary();
  const failures = modelFailureSummary();

  return (
    <AbortedHintProvider>
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--fg)]">
        {t("title")}
      </h1>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <section className="panel p-5">
          <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--cyan)]">
            {t("hvmTitle")}
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div>
              <div className="text-2xl font-bold">{hvm.total}</div>
              <div className="text-xs font-semibold text-[var(--fg-muted)]">
                {t("total")}
              </div>
            </div>
            <div>
              <div className="text-lg font-medium text-[var(--success)]">
                {hvm.humanWins}
              </div>
              <div className="text-xs text-[var(--fg-muted)]">{t("humanWins")}</div>
            </div>
            <div>
              <div className="text-lg font-medium text-[var(--accent)]">
                {hvm.modelWins}
              </div>
              <div className="text-xs text-[var(--fg-muted)]">{t("modelWins")}</div>
            </div>
            <div>
              <div className="text-lg font-medium">{hvm.draws}</div>
              <div className="text-xs text-[var(--fg-muted)]">{t("draws")}</div>
            </div>
            <div>
              <div className="text-lg font-medium text-[var(--fg-faint)]">
                {hvm.aborted}
              </div>
              <div className="text-xs text-[var(--fg-muted)]">
                <AbortedHint />
              </div>
            </div>
            <div>
              <div className="text-lg font-medium text-[var(--cyan)]">
                {hvm.inProgress}
              </div>
              <div className="text-xs text-[var(--fg-muted)]">{t("inProgress")}</div>
            </div>
          </div>
          {hvm.models.length > 0 && (
            <div className="mt-4">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-[var(--fg-muted)]">
                  <tr>
                    <th className="py-1 font-normal">{tArena("modelId")}</th>
                    <th className="py-1 text-right font-normal">{t("wins")}</th>
                    <th className="py-1 text-right font-normal">{t("losses")}</th>
                    <th className="py-1 text-right font-normal">
                      {t("drawsShort")}
                    </th>
                    <th className="py-1 text-right font-normal">
                      {t("abortedShort")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {hvm.models.map((m) => (
                    <tr key={m.model} className="border-t border-[var(--line)]">
                      <td className="py-1.5">{m.model}</td>
                      <td className="py-1.5 text-right text-[var(--success)]">
                        {m.wins}
                      </td>
                      <td className="py-1.5 text-right text-[var(--danger)]">
                        {m.losses}
                      </td>
                      <td className="py-1.5 text-right">{m.draws}</td>
                      <td className="py-1.5 text-right text-[var(--fg-faint)]">
                        {m.aborted}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {hvm.byGame.length > 0 && (
            <div className="mt-4">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-[var(--fg-muted)]">
                  <tr>
                    <th className="py-1 font-normal">{t("game")}</th>
                    <th className="py-1 text-right font-normal">
                      {t("humanWins")}
                    </th>
                    <th className="py-1 text-right font-normal">
                      {t("modelWins")}
                    </th>
                    <th className="py-1 text-right font-normal">{t("draws")}</th>
                    <th className="py-1 text-right font-normal">
                      <AbortedHint />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {hvm.byGame.map((row) => (
                    <tr
                      key={row.gameId}
                      className="border-t border-[var(--line)]"
                    >
                      <td className="py-1.5">
                        {tGames(row.gameId as never)}
                      </td>
                      <td className="py-1.5 text-right text-[var(--success)]">
                        {row.humanWins}
                      </td>
                      <td className="py-1.5 text-right text-[var(--accent)]">
                        {row.modelWins}
                      </td>
                      <td className="py-1.5 text-right">{row.draws}</td>
                      <td className="py-1.5 text-right text-[var(--fg-faint)]">
                        {row.aborted}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel p-5">
          <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--cyan)]">
            {t("mvmTitle")}
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div>
              <div className="text-2xl font-bold">{mvm.total}</div>
              <div className="text-xs font-semibold text-[var(--fg-muted)]">
                {t("total")}
              </div>
            </div>
            <div>
              <div className="text-lg font-medium text-[var(--success)]">
                {mvm.decided}
              </div>
              <div className="text-xs text-[var(--fg-muted)]">{t("decided")}</div>
            </div>
            <div>
              <div className="text-lg font-medium">{mvm.draws}</div>
              <div className="text-xs text-[var(--fg-muted)]">{t("draws")}</div>
            </div>
            <div>
              <div className="text-lg font-medium text-[var(--fg-faint)]">
                {mvm.aborted}
              </div>
              <div className="text-xs text-[var(--fg-muted)]">
                <AbortedHint />
              </div>
            </div>
            <div>
              <div className="text-lg font-medium text-[var(--cyan)]">
                {mvm.inProgress}
              </div>
              <div className="text-xs text-[var(--fg-muted)]">{t("inProgress")}</div>
            </div>
          </div>
          {mvm.models.length > 0 && (
            <div className="mt-4">
              <div className="label">{t("modelRecord")}</div>
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-[var(--fg-muted)]">
                  <tr>
                    <th className="py-1 font-normal">{tArena("modelId")}</th>
                    <th className="py-1 text-right font-normal">{t("wins")}</th>
                    <th className="py-1 text-right font-normal">{t("losses")}</th>
                    <th className="py-1 text-right font-normal">
                      {t("drawsShort")}
                    </th>
                    <th className="py-1 text-right font-normal">
                      {t("abortedShort")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {mvm.models.map((m) => (
                    <tr key={m.model} className="border-t border-[var(--line)]">
                      <td className="py-1.5">{m.model}</td>
                      <td className="py-1.5 text-right text-[var(--success)]">
                        {m.wins}
                      </td>
                      <td className="py-1.5 text-right text-[var(--danger)]">
                        {m.losses}
                      </td>
                      <td className="py-1.5 text-right">{m.draws}</td>
                      <td className="py-1.5 text-right text-[var(--fg-faint)]">
                        {m.aborted}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {Object.keys(mvm.byGame).length > 0 && (
            <div className="mt-4">
              <div className="label">{t("byGame")}</div>
              <div className="flex flex-wrap gap-2 text-xs">
                {Object.entries(mvm.byGame).map(([g, n]) => (
                  <span key={g} className="border border-[var(--line)] px-2 py-1">
                    {tGames(g as never)}: {n}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      {failures.length > 0 && (
        <section className="panel mt-8 p-5">
          <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--cyan)]">
            {t("failuresTitle")}
          </h2>
          <p className="mt-1 text-xs text-[var(--fg-muted)]">{t("failuresDesc")}</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="text-xs text-[var(--fg-muted)]">
                <tr>
                  <th className="py-1 font-normal">{tArena("modelId")}</th>
                  <th className="py-1 text-right font-normal">
                    {t("failuresTotal")}
                  </th>
                  <th className="py-1 text-right font-normal">
                    {t("failuresIllegalOff")}
                  </th>
                  <th className="py-1 text-right font-normal">
                    {t("failuresIllegalLow")}
                  </th>
                  <th className="py-1 text-right font-normal">
                    {t("failuresIllegalMedium")}
                  </th>
                  <th className="py-1 text-right font-normal">
                    {t("failuresIllegalHigh")}
                  </th>
                  <th className="py-1 text-right font-normal">
                    {t("failuresSoft")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {failures.map((row) => (
                  <tr key={row.model} className="border-t border-[var(--line)]">
                    <td className="py-1.5">{row.model}</td>
                    <td className="py-1.5 text-right">{row.failures}</td>
                    <td className="py-1.5 text-right text-[var(--danger)]">
                      {row.illegalOff > 0 ? row.illegalOff : "—"}
                    </td>
                    <td className="py-1.5 text-right text-[var(--danger)]">
                      {row.illegalLow > 0 ? row.illegalLow : "—"}
                    </td>
                    <td className="py-1.5 text-right text-[var(--danger)]">
                      {row.illegalMedium > 0 ? row.illegalMedium : "—"}
                    </td>
                    <td className="py-1.5 text-right text-[var(--danger)]">
                      {row.illegalHigh > 0 ? row.illegalHigh : "—"}
                    </td>
                    <td className="py-1.5 text-right text-[var(--fg-faint)]">
                      {row.soft > 0 ? row.soft : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {think.length > 0 && (
        <section className="panel mt-8 p-5">
          <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--cyan)]">
            {t("thinkTitle")}
          </h2>
          <p className="mt-1 text-xs text-[var(--fg-muted)]">{t("thinkDesc")}</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead className="text-xs text-[var(--fg-muted)]">
                <tr>
                  <th className="py-1 font-normal">{tArena("modelId")}</th>
                  <th className="py-1 text-right font-normal">
                    {t("thinkMovesOff")}
                  </th>
                  <th className="py-1 text-right font-normal">
                    {t("thinkAvgOff")}
                  </th>
                  <th className="py-1 text-right font-normal">
                    {t("thinkMovesLow")}
                  </th>
                  <th className="py-1 text-right font-normal">
                    {t("thinkAvgLow")}
                  </th>
                  <th className="py-1 text-right font-normal">
                    {t("thinkMovesMedium")}
                  </th>
                  <th className="py-1 text-right font-normal">
                    {t("thinkAvgMedium")}
                  </th>
                  <th className="py-1 text-right font-normal">
                    {t("thinkMovesHigh")}
                  </th>
                  <th className="py-1 text-right font-normal">
                    {t("thinkAvgHigh")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {think.map((row) => {
                  const cell = (b: { moves: number; avgMs: number | null }) => (
                    <>
                      <td className="py-1.5 text-right">
                        {b.moves > 0 ? b.moves : "—"}
                      </td>
                      <td className="py-1.5 text-right">
                        {b.avgMs != null ? fmtAvgThink(b.avgMs) : "—"}
                      </td>
                    </>
                  );
                  return (
                    <tr key={row.model} className="border-t border-[var(--line)]">
                      <td className="py-1.5">{row.model}</td>
                      {cell(row.off)}
                      {cell(row.low)}
                      {cell(row.medium)}
                      {cell(row.high)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {hvmPlayers.length > 0 && (
        <section className="panel mt-8 p-5">
          <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--cyan)]">
            {t("playerRecordTitle")}
          </h2>
          <p className="mt-1 text-xs text-[var(--fg-muted)]">
            {t("playerRecordDesc")}
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-[var(--fg-muted)]">
                <tr>
                  <th className="py-1 font-normal">{t("playerName")}</th>
                  <th className="py-1 text-right font-normal">{t("games")}</th>
                  <th className="py-1 text-right font-normal">{t("wins")}</th>
                  <th className="py-1 text-right font-normal">{t("losses")}</th>
                  <th className="py-1 text-right font-normal">
                    {t("drawsShort")}
                  </th>
                  <th className="py-1 text-right font-normal">
                    {t("abortedShort")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {hvmPlayers.map((p) => (
                  <tr
                    key={p.name === "" ? "__unnamed__" : p.name}
                    className="border-t border-[var(--line)]"
                  >
                    <td className="py-1.5">
                      {p.name === "" ? t("playerUnnamed") : p.name}
                    </td>
                    <td className="py-1.5 text-right">{p.games}</td>
                    <td className="py-1.5 text-right text-[var(--success)]">
                      {p.wins}
                    </td>
                    <td className="py-1.5 text-right text-[var(--danger)]">
                      {p.losses}
                    </td>
                    <td className="py-1.5 text-right">{p.draws}</td>
                    <td className="py-1.5 text-right text-[var(--fg-faint)]">
                      {p.aborted}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
    </AbortedHintProvider>
  );
}
