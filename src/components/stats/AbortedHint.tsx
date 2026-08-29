"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";

const TOAST_MS = 4500;

const AbortedHintContext = createContext<(() => void) | null>(null);

/** One toast host for the stats page (bottom-right). */
export function AbortedHintProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("stats");
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const show = useCallback(() => {
    setOpen(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), TOAST_MS);
  }, []);

  return (
    <AbortedHintContext.Provider value={show}>
      {children}
      {open && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 max-w-sm border border-[var(--line)] bg-[var(--panel)] px-4 py-3 text-sm text-[var(--fg)] shadow-lg"
        >
          {t("abortedHint")}
        </div>
      )}
    </AbortedHintContext.Provider>
  );
}

/** Clickable Aborted* label; uses the shared page toast. */
export function AbortedHint() {
  const t = useTranslations("stats");
  const show = useContext(AbortedHintContext);
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => show?.()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          show?.();
        }
      }}
      className="cursor-pointer hover:text-[var(--fg)]"
      aria-label={t("abortedHintAria")}
    >
      {t("aborted")}
    </span>
  );
}
