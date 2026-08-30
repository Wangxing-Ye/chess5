"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { GameIcon } from "@/components/brand/GameIcons";
import { Link, useRouter } from "@/i18n/navigation";
import { apiErrorKey } from "@/lib/api/errors";
import { GAME_IDS } from "@/lib/games";
import {
  supportsLegalMovesProtection,
  type GameId,
} from "@/lib/games/types";
import { ensureKeysHydrated, getKey } from "@/lib/keys/store";
import { PROVIDERS, type ProviderId } from "@/lib/llm/providers";
import {
  supportsReasoningOff,
  type ReasoningLevel,
} from "@/lib/llm/reasoning";
import { saveMatchTokens } from "@/lib/match/clientTokens";
import { withStoredHumanName } from "@/lib/match/humanName";
import type { MatchMode, Participant } from "@/lib/match/types";

type ArenaMode = "human_vs_model" | "model_vs_model";

function parseGameParam(raw: string | null): GameId {
  if (raw && (GAME_IDS as string[]).includes(raw)) return raw as GameId;
  return "chess";
}

function providersForLevel(level: ReasoningLevel) {
  if (level !== "off") return PROVIDERS;
  return PROVIDERS.filter((p) =>
    p.models.some((m) => supportsReasoningOff(p.id, m)),
  );
}

function modelsForLevel(provider: ProviderId, level: ReasoningLevel): string[] {
  const all = PROVIDERS.find((p) => p.id === provider)?.models ?? [];
  if (level !== "off") return all;
  return all.filter((m) => supportsReasoningOff(provider, m));
}

function sameModelPick(
  a: { provider: ProviderId; model: string },
  b: { provider: ProviderId; model: string },
): boolean {
  return a.provider === b.provider && a.model === b.model;
}

/** First provider+model allowed under `level` that is not `exclude`. */
function pickDifferentFrom(
  level: ReasoningLevel,
  exclude: { provider: ProviderId; model: string },
): { provider: ProviderId; model: string } {
  for (const p of providersForLevel(level)) {
    for (const m of modelsForLevel(p.id, level)) {
      if (p.id !== exclude.provider || m !== exclude.model) {
        return { provider: p.id, model: m };
      }
    }
  }
  return exclude;
}

function defaultModelFor(
  provider: ProviderId,
  level: ReasoningLevel = "off",
  excludeModel?: string,
): string {
  const models = modelsForLevel(provider, level).filter(
    (m) => m !== excludeModel,
  );
  if (models.length) return models[0]!;
  return PROVIDERS.find((p) => p.id === provider)!.defaultModel;
}

function pickProvider(
  level: ReasoningLevel,
  exclude?: ProviderId,
): ProviderId {
  const pool = providersForLevel(level).filter((p) => p.id !== exclude);
  const list = pool.length > 0 ? pool : providersForLevel(level);
  return list[Math.floor(Math.random() * list.length)]!.id;
}

/** Keep selection valid when Reasoning is Off. */
function coerceSelection(
  provider: ProviderId,
  model: string,
  level: ReasoningLevel,
): { provider: ProviderId; model: string } {
  if (level !== "off") return { provider, model };
  if (supportsReasoningOff(provider, model)) return { provider, model };
  const same = modelsForLevel(provider, "off");
  if (same.length) return { provider, model: same[0]! };
  const fallback = providersForLevel("off")[0]!;
  return {
    provider: fallback.id,
    model: modelsForLevel(fallback.id, "off")[0]!,
  };
}

function ModelFields({
  provider,
  setProvider,
  model,
  setModel,
  reasoningLevel,
  exclude,
}: {
  provider: ProviderId;
  setProvider: (p: ProviderId) => void;
  model: string;
  setModel: (m: string) => void;
  reasoningLevel: ReasoningLevel;
  /** Opposing side — same provider+model is not offered. */
  exclude?: { provider: ProviderId; model: string };
}) {
  const t = useTranslations("arena");
  const providers = useMemo(() => {
    return providersForLevel(reasoningLevel).filter((p) => {
      const available = modelsForLevel(p.id, reasoningLevel).filter(
        (m) =>
          !(exclude && exclude.provider === p.id && exclude.model === m),
      );
      return available.length > 0;
    });
  }, [reasoningLevel, exclude]);
  const models = useMemo(() => {
    let list = modelsForLevel(provider, reasoningLevel);
    if (exclude && exclude.provider === provider) {
      list = list.filter((m) => m !== exclude.model);
    }
    return list;
  }, [provider, reasoningLevel, exclude]);

  useEffect(() => {
    if (!providers.some((p) => p.id === provider) && providers[0]) {
      const p = providers[0];
      setProvider(p.id);
      setModel(
        defaultModelFor(
          p.id,
          reasoningLevel,
          exclude && exclude.provider === p.id ? exclude.model : undefined,
        ),
      );
      return;
    }
    if (models.length > 0 && !models.includes(model)) {
      setModel(models[0]!);
    }
  }, [
    providers,
    provider,
    models,
    model,
    reasoningLevel,
    exclude,
    setProvider,
    setModel,
  ]);

  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <div>
        <label className="label">
          {t.rich("providerWithCount", {
            count: providers.length,
            n: (chunks) => (
              <span className="text-[var(--fg)]">{chunks}</span>
            ),
          })}
        </label>
        <select
          className="field"
          value={provider}
          onChange={(e) => {
            const id = e.target.value as ProviderId;
            setProvider(id);
            const excludeModel =
              exclude && exclude.provider === id ? exclude.model : undefined;
            setModel(defaultModelFor(id, reasoningLevel, excludeModel));
          }}
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">{t("modelId")}</label>
        <select
          className="field"
          value={models.includes(model) ? model : (models[0] ?? model)}
          onChange={(e) => setModel(e.target.value)}
        >
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function buildModel(provider: ProviderId, model: string): Participant {
  return {
    kind: "model",
    provider,
    model,
    name: PROVIDERS.find((p) => p.id === provider)?.name,
  };
}

export function CreateMatchForm() {
  const t = useTranslations("arena");
  const tModes = useTranslations("modes");
  const tGames = useTranslations("games");
  const tErr = useTranslations("apiErrors");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [gameId, setGameId] = useState<GameId>(() =>
    parseGameParam(searchParams.get("game")),
  );
  const [goSize, setGoSize] = useState(9);
  const [mode, setMode] = useState<ArenaMode>("human_vs_model");
  const [wProvider, setWProvider] = useState<ProviderId>("openai");
  const [bProvider, setBProvider] = useState<ProviderId>("openai");
  const [wModel, setWModel] = useState(() => defaultModelFor("openai", "off"));
  const [bModel, setBModel] = useState(() => defaultModelFor("openai", "off"));
  const [autoPlay, setAutoPlay] = useState(true);
  const [autoDelayMs, setAutoDelayMs] = useState(3000);
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningLevel>("off");
  const [legalMovesProtection, setLegalMovesProtection] = useState(true);
  const [tacticalGuidance, setTacticalGuidance] = useState(true);
  const [error, setError] = useState<ReactNode>(null);
  const [loading, setLoading] = useState(false);

  const missingKeyMessage = (provider: ProviderId) =>
    t.rich("missingKey", {
      provider,
      keys: (chunks) => (
        <Link
          href="/settings/keys"
          className="font-medium text-[var(--cyan)] underline underline-offset-2 hover:opacity-80"
        >
          {chunks}
        </Link>
      ),
    });

  const applyReasoningLevel = (level: ReasoningLevel) => {
    setReasoningLevel(level);
    const w = coerceSelection(wProvider, wModel, level);
    let b = coerceSelection(bProvider, bModel, level);
    if (sameModelPick(w, b)) {
      b = pickDifferentFrom(level, w);
    }
    setWProvider(w.provider);
    setWModel(w.model);
    setBProvider(b.provider);
    setBModel(b.model);
  };

  // Keep White/Black distinct in model-vs-model (same provider+model not allowed).
  // Deferred setState avoids react-hooks/set-state-in-effect cascading-render lint.
  useEffect(() => {
    if (mode !== "model_vs_model") return;
    if (
      !sameModelPick(
        { provider: wProvider, model: wModel },
        { provider: bProvider, model: bModel },
      )
    ) {
      return;
    }
    const next = pickDifferentFrom(reasoningLevel, {
      provider: wProvider,
      model: wModel,
    });
    const id = window.requestAnimationFrame(() => {
      setBProvider(next.provider);
      setBModel(next.model);
    });
    return () => window.cancelAnimationFrame(id);
  }, [mode, wProvider, wModel, bProvider, bModel, reasoningLevel]);

  // Randomize defaults on the client after mount (avoid SSR hydration mismatch).
  // Deferred so the update is not a synchronous setState inside the effect body.
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      const level: ReasoningLevel = "off";
      const w = pickProvider(level);
      const b = pickProvider(level, w);
      setWProvider(w);
      setBProvider(b);
      setWModel(defaultModelFor(w, level));
      setBModel(defaultModelFor(b, level));
    });
    return () => window.cancelAnimationFrame(id);
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    await ensureKeysHydrated();

    if (
      mode === "model_vs_model" &&
      sameModelPick(
        { provider: wProvider, model: wModel },
        { provider: bProvider, model: bModel },
      )
    ) {
      setError(t("sameModelBothSides"));
      return;
    }

    if (reasoningLevel === "off") {
      const sides =
        mode === "human_vs_model"
          ? [{ provider: bProvider, model: bModel }]
          : [
              { provider: wProvider, model: wModel },
              { provider: bProvider, model: bModel },
            ];
      for (const s of sides) {
        if (!supportsReasoningOff(s.provider, s.model)) {
          setError(t("reasoningOffModelInvalid"));
          return;
        }
      }
    }

    if (mode === "human_vs_model") {
      if (!getKey(bProvider)) {
        setError(missingKeyMessage(bProvider));
        return;
      }
    } else {
      if (!getKey(wProvider)) {
        setError(missingKeyMessage(wProvider));
        return;
      }
      if (!getKey(bProvider)) {
        setError(missingKeyMessage(bProvider));
        return;
      }
    }

    const matchMode: MatchMode = mode;
    const players =
      mode === "human_vs_model"
        ? {
            w: withStoredHumanName({ kind: "human" as const }),
            b: buildModel(bProvider, bModel),
          }
        : {
            w: buildModel(wProvider, wModel),
            b: buildModel(bProvider, bModel),
          };

    setLoading(true);
    try {
      const res = await fetch("/api/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId,
          mode: matchMode,
          players,
          publicSpectate: true,
          autoPlay: mode === "model_vs_model" ? autoPlay : false,
          autoDelayMs,
          reasoningLevel,
          legalMovesProtection: supportsLegalMovesProtection(gameId)
            ? legalMovesProtection
            : false,
          tacticalGuidance,
          goSize: gameId === "go" ? goSize : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const key = apiErrorKey(res.status, data.code);
        throw new Error(key ? tErr(key) : data.error || tErr("generic"));
      }
      if (data.playToken && data.spectateToken) {
        saveMatchTokens(data.match.id, data.playToken, data.spectateToken);
      }
      router.push(`/play/${data.match.id}`);
    } catch (err) {
      if (err instanceof TypeError) setError(tErr("serverError"));
      else setError(err instanceof Error ? err.message : tErr("generic"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="panel p-4">
        <div className="label" id="game-label">
          {t("game")}
        </div>
        <ul
          className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
          role="listbox"
          aria-labelledby="game-label"
          aria-activedescendant={`game-${gameId}`}
        >
          {GAME_IDS.map((id) => {
            const selected = gameId === id;
            return (
              <li key={id}>
                <button
                  type="button"
                  id={`game-${id}`}
                  role="option"
                  aria-selected={selected}
                  onClick={() => setGameId(id)}
                  className={`w-full border px-4 py-4 text-left transition-colors ${
                    selected
                      ? "border-[rgba(59,130,246,0.65)] bg-[var(--accent-soft)]"
                      : "border-[var(--line)] hover:border-[rgba(59,130,246,0.45)]"
                  }`}
                >
                  <GameIcon gameId={id} />
                  <div className="mt-3 font-[family-name:var(--font-display)] text-[var(--cyan)]">
                    {tGames(id)}
                  </div>
                  <div className="mt-1 text-sm text-[var(--fg-muted)]">
                    {tGames(`${id}Desc`)}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
        {gameId === "go" && (
          <div className="mt-3">
            <label className="label">{t("boardSize")}</label>
            <select
              className="field"
              value={goSize}
              onChange={(e) => setGoSize(Number(e.target.value))}
            >
              {[9, 13, 19].map((n) => (
                <option key={n} value={n}>
                  {n}×{n}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="panel p-4">
        <div className="label">{t("mode")}</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {(["human_vs_model", "model_vs_model"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`btn ${mode === m ? "btn-primary" : "btn-ghost"} !px-3 !py-2 text-sm`}
              onClick={() => setMode(m)}
            >
              {tModes(m)}
            </button>
          ))}
        </div>
      </div>

      <div className="panel p-4">
        <div className="label" id="reasoning-label">
          {t("reasoning")}
        </div>
        <div
          className="mt-2 flex flex-wrap gap-2"
          role="group"
          aria-labelledby="reasoning-label"
        >
          {(["off", "low", "medium", "high"] as const).map((level) => (
            <button
              key={level}
              type="button"
              className={`btn ${reasoningLevel === level ? "btn-primary" : "btn-ghost"} !px-3 !py-2 text-sm`}
              onClick={() => applyReasoningLevel(level)}
            >
              {t(`reasoningLevel.${level}`)}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-[var(--fg-muted)]">
          {reasoningLevel === "off"
            ? t("reasoningOffHint")
            : t("reasoningHint")}
        </p>
      </div>

      <div className="panel p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="label !mb-0" id="tacticalGuidance-label">
            {t("tacticalGuidance")}
          </span>
          <div className="flex items-center gap-2">
            <span className="min-w-[1.75rem] text-right text-xs text-[var(--fg-muted)]">
              {tacticalGuidance ? t("toggleOn") : t("toggleOff")}
            </span>
            <button
              id="tacticalGuidance"
              type="button"
              role="switch"
              aria-checked={tacticalGuidance}
              aria-labelledby="tacticalGuidance-label"
              className={`toggle ${tacticalGuidance ? "toggle-on" : ""}`}
              onClick={() => setTacticalGuidance((v) => !v)}
            >
              <span className="toggle-knob" />
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-[var(--fg-muted)]">
          {t("tacticalGuidanceHint")}
        </p>
      </div>

      <div className="panel p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="label !mb-0" id="legalMovesProtection-label">
            {t("legalMovesProtection")}
          </span>
          {supportsLegalMovesProtection(gameId) && (
            <div className="flex items-center gap-2">
              <span className="min-w-[1.75rem] text-right text-xs text-[var(--fg-muted)]">
                {legalMovesProtection ? t("toggleOn") : t("toggleOff")}
              </span>
              <button
                id="legalMovesProtection"
                type="button"
                role="switch"
                aria-checked={legalMovesProtection}
                aria-labelledby="legalMovesProtection-label"
                className={`toggle ${legalMovesProtection ? "toggle-on" : ""}`}
                onClick={() => setLegalMovesProtection((v) => !v)}
              >
                <span className="toggle-knob" />
              </button>
            </div>
          )}
        </div>
        <p className="mt-2 text-xs text-[var(--fg-muted)]">
          {supportsLegalMovesProtection(gameId)
            ? t("legalMovesProtectionHint")
            : t("legalMovesProtectionNA")}
        </p>
      </div>

      {mode === "human_vs_model" ? (
        <>
          <div className="panel p-4">
            <div className="label">{t(`sideA.${gameId}`)}</div>
            <p className="mt-2 text-sm text-[var(--fg)]">{t("humanFixed")}</p>
          </div>
          <div className="panel p-4">
            <div className="label">{t(`sideB.${gameId}`)}</div>
            <p className="mt-1 text-xs text-[var(--fg-muted)]">{t("model")}</p>
            <ModelFields
              provider={bProvider}
              setProvider={setBProvider}
              model={bModel}
              setModel={setBModel}
              reasoningLevel={reasoningLevel}
            />
          </div>
        </>
      ) : (
        <>
          <div className="panel p-4">
            <div className="label">{t(`sideA.${gameId}`)}</div>
            <p className="mt-1 text-xs text-[var(--fg-muted)]">{t("model")}</p>
            <ModelFields
              provider={wProvider}
              setProvider={setWProvider}
              model={wModel}
              setModel={setWModel}
              reasoningLevel={reasoningLevel}
              exclude={{ provider: bProvider, model: bModel }}
            />
          </div>
          <div className="panel p-4">
            <div className="label">{t(`sideB.${gameId}`)}</div>
            <p className="mt-1 text-xs text-[var(--fg-muted)]">{t("model")}</p>
            <ModelFields
              provider={bProvider}
              setProvider={setBProvider}
              model={bModel}
              setModel={setBModel}
              reasoningLevel={reasoningLevel}
              exclude={{ provider: wProvider, model: wModel }}
            />
          </div>
          <div className="panel p-4">
            <label className="label">{t("autoplay")}</label>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoPlay}
                  onChange={(e) => setAutoPlay(e.target.checked)}
                />
                {t("runAuto")}
              </label>
              <div className="flex items-center gap-2 text-sm text-[var(--fg-muted)]">
                {t("delay")}
                <select
                  className="field !w-28"
                  value={autoDelayMs}
                  onChange={(e) => setAutoDelayMs(Number(e.target.value))}
                >
                  {[1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000].map((n) => (
                    <option key={n} value={n}>
                      {n} ms
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </>
      )}

      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

      <button type="submit" className="btn btn-primary" disabled={loading}>
        {loading ? t("creating") : t("start")}
      </button>
    </form>
  );
}
