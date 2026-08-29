"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

const LOCALE_LABELS: Record<string, string> = {
  en: "EN",
  zh: "简体",
  "zh-TW": "繁體",
  ko: "한국어",
  ja: "日本語",
  fr: "FR",
  es: "ES",
};

function pathMatches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  const links = [
    { href: "/arena", label: t("arena") },
    { href: "/settings/keys", label: t("keys") },
    { href: "/stats", label: t("stats") },
    { href: "/history", label: t("history") },
  ] as const;

  return (
    <header className="relative z-20 border-b border-[var(--line)]">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 font-[family-name:var(--font-display)] text-lg tracking-tight"
        >
          <img
            src="/icon-512.png"
            alt=""
            width={28}
            height={28}
            className="h-7 w-7 shrink-0"
            decoding="async"
          />
          <span>
            <span className="text-[var(--fg)]">chess</span>
            <span className="text-[var(--accent)]">5</span>
            <span className="text-[var(--fg-muted)]">.ai</span>
          </span>
        </Link>
        <nav className="flex items-center gap-4 text-sm sm:gap-5">
          {links.map(({ href, label }) => {
            const active = pathMatches(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                className="site-nav-link"
                aria-current={active ? "page" : undefined}
              >
                {label}
              </Link>
            );
          })}
          <select
            aria-label="Language"
            className="border border-[var(--line)] bg-transparent px-2 py-1 text-xs text-[var(--fg)]"
            value={locale}
            onChange={(e) => {
              const next = e.target.value as (typeof routing.locales)[number];
              const search =
                typeof window !== "undefined" ? window.location.search : "";
              router.replace(`${pathname}${search}`, { locale: next });
            }}
          >
            {routing.locales.map((l) => (
              <option key={l} value={l} className="bg-[var(--bg)]">
                {LOCALE_LABELS[l]}
              </option>
            ))}
          </select>
        </nav>
      </div>
    </header>
  );
}
