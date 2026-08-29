"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

const POLL_MS = 4500;
const ANIM_MS = 320;

type Props = {
  initial: number;
};

export function MatchCountLive({ initial }: Props) {
  const t = useTranslations("home");
  const locale = useLocale();
  const [shown, setShown] = useState(initial);
  const targetRef = useRef(initial);
  const shownRef = useRef(initial);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    shownRef.current = shown;
  }, [shown]);

  useEffect(() => {
    function animateTo(next: number) {
      if (next <= targetRef.current) return;
      targetRef.current = next;
      const from = shownRef.current;
      const to = next;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      const start = performance.now();
      const tick = (now: number) => {
        const tNorm = Math.min(1, (now - start) / ANIM_MS);
        const eased = 1 - (1 - tNorm) ** 3;
        const value = Math.round(from + (to - from) * eased);
        setShown(value);
        if (tNorm < 1) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          rafRef.current = null;
          setShown(to);
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    }

    let timer: ReturnType<typeof setInterval> | null = null;

    async function poll() {
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetch("/api/matches/count", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { count?: unknown };
        if (typeof data.count === "number" && Number.isFinite(data.count)) {
          animateTo(Math.max(0, Math.floor(data.count)));
        }
      } catch {
        /* ignore transient network errors */
      }
    }

    function start() {
      void poll();
      timer = setInterval(() => void poll(), POLL_MS);
    }

    function onVisibility() {
      if (document.visibilityState === "visible") {
        void poll();
        if (!timer) timer = setInterval(() => void poll(), POLL_MS);
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer) clearInterval(timer);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const formatted = new Intl.NumberFormat(locale).format(shown);

  return (
    <Link
      href="/history"
      className="anim-rise-delay group mt-6 inline-flex items-baseline gap-2.5 text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)]"
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 shrink-0 translate-y-[-0.1em] rounded-full bg-[var(--cyan)] opacity-80 anim-pulse"
      />
      <span className="font-[family-name:var(--font-display)] text-xl tabular-nums tracking-tight text-[var(--fg)] sm:text-2xl">
        {t("matchesPlayed", { n: formatted })}
      </span>
    </Link>
  );
}
