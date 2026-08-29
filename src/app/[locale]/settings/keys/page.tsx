"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { apiErrorKey } from "@/lib/api/errors";
import {
  ensureKeysHydrated,
  getKey,
  saveKeys,
  useStoredKeys,
} from "@/lib/keys/store";
import { PROVIDERS, type ProviderId } from "@/lib/llm/providers";

export default function KeysPage() {
  const t = useTranslations("keys");
  const tErr = useTranslations("apiErrors");
  const keys = useStoredKeys();
  const [status, setStatus] = useState<Partial<Record<ProviderId, string>>>({});
  const [testing, setTesting] = useState<ProviderId | null>(null);

  const update = (id: ProviderId, value: string) => {
    const next = { ...keys };
    if (value.trim()) next[id] = value;
    else delete next[id];
    saveKeys(next);
  };

  const deleteKey = (id: ProviderId) => {
    update(id, "");
    setStatus((s) => {
      const next = { ...s };
      delete next[id];
      return next;
    });
  };

  const test = async (id: ProviderId) => {
    await ensureKeysHydrated();
    const apiKey = getKey(id);
    if (!apiKey) {
      setStatus((s) => ({ ...s, [id]: t("addFirst") }));
      return;
    }
    setTesting(id);
    setStatus((s) => ({ ...s, [id]: t("testing") }));
    try {
      const res = await fetch("/api/llm/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: id, apiKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const key = apiErrorKey(res.status, data.code);
        let message = key ? tErr(key) : data.error || tErr("generic");
        // Friendly codes hide the real cause (wrong endpoint, quota, rejected
        // params, etc.); surface a short provider snippet so Test is debuggable.
        if (
          typeof data.error === "string" &&
          data.error.trim() &&
          (data.code === "rate_limit" ||
            data.code === "billing_error" ||
            data.code === "quota_exceeded" ||
            data.code === "authentication_error" ||
            data.code === "permission_error" ||
            data.code === "model_unavailable" ||
            data.code === "server_error")
        ) {
          const detail =
            data.error.length > 180
              ? `${data.error.slice(0, 180)}…`
              : data.error;
          message = `${message} ${detail}`;
        }
        throw new Error(message);
      }
      setStatus((s) => ({ ...s, [id]: t("connected") }));
    } catch (e) {
      const message =
        e instanceof TypeError
          ? tErr("serverError")
          : e instanceof Error
            ? e.message
            : tErr("generic");
      setStatus((s) => ({ ...s, [id]: message }));
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--fg)]">
        {t("title")}
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-[var(--fg-muted)]">{t("desc")}</p>

      <div className="mt-8 space-y-4">
        {PROVIDERS.map((p) => (
          <div key={p.id} className="panel p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-[220px] flex-1">
                <label className="label" htmlFor={`key-${p.id}`}>
                  <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span>{p.name}</span>
                    <a
                      href={p.keysUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-normal text-[var(--cyan)] underline underline-offset-2 hover:opacity-80"
                    >
                      {t("getKey")}
                    </a>
                  </span>
                </label>
                <input
                  id={`key-${p.id}`}
                  className="field"
                  type="password"
                  autoComplete="off"
                  placeholder={t("placeholder", { provider: p.name })}
                  value={keys[p.id] ?? ""}
                  onChange={(e) => update(p.id, e.target.value)}
                />
                <p className="mt-1 text-xs text-[var(--fg-muted)]">
                  {t("defaultModel", { model: p.defaultModel })}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={testing === p.id}
                  onClick={() => test(p.id)}
                >
                  {testing === p.id ? t("testing") : t("test")}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={!keys[p.id] || testing === p.id}
                  onClick={() => deleteKey(p.id)}
                >
                  {t("delete")}
                </button>
              </div>
            </div>
            {status[p.id] && (
              <p
                className={`mt-2 text-sm ${
                  status[p.id] === t("connected")
                    ? "text-[var(--success)]"
                    : "text-[var(--danger)]"
                }`}
              >
                {status[p.id]}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
