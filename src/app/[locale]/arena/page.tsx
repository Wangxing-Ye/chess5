import { setRequestLocale } from "next-intl/server";
import { useTranslations } from "next-intl";
import { Suspense, use } from "react";
import { CreateMatchForm } from "@/components/arena/CreateMatchForm";

export default function ArenaPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("arena");

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--fg)]">
        {t("title")}
      </h1>
      <p className="mt-2 text-[var(--fg-muted)]">{t("subtitle")}</p>
      <div className="mt-8">
        <Suspense fallback={<p className="text-sm text-[var(--fg-muted)]">…</p>}>
          <CreateMatchForm />
        </Suspense>
      </div>
    </div>
  );
}
