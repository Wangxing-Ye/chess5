import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";

const SECTION_KEYS = [
  "s1",
  "s2",
  "s3",
  "s4",
  "s5",
  "s6",
  "s7",
  "s8",
  "s9",
  "s10",
] as const;

export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("terms");
  const tHome = await getTranslations("home");
  const tErrors = await getTranslations("errors");

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--fg)]">
        {t("title")}
      </h1>
      <p className="mt-2 text-xs text-[var(--fg-muted)]">{t("updated")}</p>
      <p className="mt-6 text-sm leading-relaxed text-[var(--fg-muted)]">
        {t("intro")}
      </p>

      <div className="mt-10 space-y-8">
        {SECTION_KEYS.map((key) => (
          <section key={key}>
            <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--fg)]">
              {t(`${key}Title`)}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--fg-muted)]">
              {t(`${key}Body`)}
            </p>
          </section>
        ))}
      </div>

      <div className="mt-12 flex flex-wrap gap-4 border-t border-[var(--line)] pt-8 text-sm text-[var(--fg-muted)]">
        <Link href="/" className="transition-colors hover:text-[var(--cyan)]">
          {tErrors("backHome")}
        </Link>
        <a
          href="https://github.com/Wangxing-Ye/chess5"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-[var(--cyan)]"
        >
          {tHome("footerGitHub")}
        </a>
      </div>
    </div>
  );
}
