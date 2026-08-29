import { setRequestLocale } from "next-intl/server";
import { useTranslations } from "next-intl";
import { use } from "react";
import { GameIcon } from "@/components/brand/GameIcons";
import { HeroVisual } from "@/components/brand/HeroVisual";
import { MatchCountLive } from "@/components/brand/MatchCountLive";
import { Link } from "@/i18n/navigation";
import { countMatchRecordsFresh } from "@/lib/db/matches";
import { GAME_IDS } from "@/lib/games";
import packageJson from "../../../package.json";

export const dynamic = "force-dynamic";

export default function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("home");
  const tGames = useTranslations("games");
  const matchCount = countMatchRecordsFresh();

  return (
    <div className="relative min-h-[calc(100vh-3.5rem)] overflow-hidden">
      <HeroVisual />
      <section className="relative z-10 mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-6xl flex-col justify-center px-4 pb-16 pt-10 sm:px-6">
        <p className="anim-rise font-[family-name:var(--font-display)] text-5xl font-bold tracking-tight text-[var(--fg)] sm:text-7xl md:text-8xl">
          chess<span className="text-[var(--accent)]">5</span>
          <span className="text-[var(--fg-muted)]">.ai</span>
        </p>
        <h1 className="anim-rise-delay mt-5 max-w-2xl font-[family-name:var(--font-display)] text-2xl font-medium leading-snug text-[var(--fg)] sm:text-3xl">
          {t("slogan")}
        </h1>
        <p className="anim-rise-delay mt-4 max-w-xl text-base text-[var(--fg-muted)] sm:text-lg">
          {t("heroDesc")}
        </p>
        <div>
          <MatchCountLive initial={matchCount} />
        </div>
        <div className="anim-rise-delay mt-8 flex flex-wrap gap-3">
          <Link href="/arena" className="btn btn-primary">
            {t("ctaEnter")}
          </Link>
          <Link href="/settings/keys" className="btn btn-ghost">
            {t("ctaKeys")}
          </Link>
        </div>
      </section>

      <section className="relative z-10 border-t border-[var(--line)] bg-[rgba(7,11,20,0.65)]">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="font-[family-name:var(--font-display)] text-xl text-[var(--fg)]">
            {t("gamesTitle")}
          </h2>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {GAME_IDS.map((id) => (
              <li key={id}>
                <Link
                  href={`/arena?game=${id}`}
                  className="block border border-[var(--line)] px-4 py-4 transition-colors hover:border-[rgba(59,130,246,0.45)]"
                >
                  <GameIcon gameId={id} />
                  <div className="mt-3 font-[family-name:var(--font-display)] text-[var(--cyan)]">
                    {tGames(id)}
                  </div>
                  <div className="mt-1 text-sm text-[var(--fg-muted)]">
                    {tGames(`${id}Desc`)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="relative z-10 border-t border-[var(--line)]">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="font-[family-name:var(--font-display)] text-xl text-[var(--fg)]">
            {t("rulesTitle")}
          </h2>
          <ol className="mt-6 max-w-2xl list-decimal space-y-3 pl-5 text-sm leading-relaxed text-[var(--fg-muted)]">
            <li>{t("rules1")}</li>
            <li>{t("rules2")}</li>
            <li>{t("rules3")}</li>
            <li>{t("rules4")}</li>
            <li>{t("rules5")}</li>
          </ol>
        </div>
      </section>

      <section className="relative z-10 border-t border-[var(--line)] bg-[rgba(7,11,20,0.65)]">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="font-[family-name:var(--font-display)] text-xl text-[var(--fg)]">
            {t("aboutTitle")}
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[var(--fg-muted)]">
            {t.rich("aboutDesc", {
              source: (chunks) => (
                <a
                  href="https://github.com/Wangxing-Ye/chess5"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--fg)] underline underline-offset-2 transition-colors hover:text-[var(--cyan)]"
                >
                  {chunks}
                </a>
              ),
            })}
          </p>
        </div>
      </section>

      <footer className="relative z-10 border-t border-[var(--line)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-[var(--fg-muted)] sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            {t("footerCopy")}
            <span className="ml-2 text-xs opacity-60">v{packageJson.version}</span>
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link
              href="/terms"
              className="transition-colors hover:text-[var(--cyan)]"
            >
              {t("footerTerms")}
            </Link>
            <a
              href="https://github.com/Wangxing-Ye/chess5"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-[var(--cyan)]"
            >
              {t("footerGitHub")}
            </a>
            <a
              href="https://x.com/wilsonye2025"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-[var(--cyan)]"
            >
              {t("footerX")}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
