"use client";

import { useTranslations } from "next-intl";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-xl flex-col justify-center px-4 py-16">
      <h1 className="font-[family-name:var(--font-display)] text-2xl text-[var(--fg)]">
        {t("title")}
      </h1>
      <p className="mt-3 text-sm text-[var(--fg-muted)]">
        {error.message || t("generic")}
      </p>
      <button type="button" className="btn btn-primary mt-6 w-fit" onClick={reset}>
        {t("retry")}
      </button>
    </div>
  );
}
