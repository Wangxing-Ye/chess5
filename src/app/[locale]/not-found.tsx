import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function NotFound() {
  const t = useTranslations("errors");
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-xl flex-col justify-center px-4 py-16">
      <h1 className="font-[family-name:var(--font-display)] text-2xl">
        {t("notFoundTitle")}
      </h1>
      <p className="mt-3 text-sm text-[var(--fg-muted)]">{t("notFoundDesc")}</p>
      <Link href="/" className="btn btn-primary mt-6 w-fit">
        {t("backHome")}
      </Link>
    </div>
  );
}
