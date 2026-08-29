"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GameBoard } from "@/components/boards/GameBoard";
import { CaptureTray, GoCaptureTray } from "@/components/match/CaptureTray";
import { useRouter, Link } from "@/i18n/navigation";
import {
  type ApiErrorBody,
  apiErrorKey,
  ERROR_CODES,
  isRateLimitFailure,
  isRetryable,
} from "@/lib/api/errors";
import {
  playAbortSound,
  playCaptureSound,
  playCheckSound,
  playGameOverSound,
  playMoveSound,
  isThinkingSoundMuted,
  setThinkingSoundMuted,
  startThinkingSound,
  startWarningSound,
  stopThinkingSound,
  stopWarningSound,
  unlockAudio,
} from "@/lib/audio/moveSounds";
import { getEngine } from "@/lib/games";
import {
  goCaptureCounts,
  materialCaptures,
  supportsCaptureTray,
} from "@/lib/games/captures";
import { othelloDiscCounts } from "@/lib/games/othello";
import { reasonLabel } from "@/lib/games/reasons";
import type { Move } from "@/lib/games/types";
import { ensureKeysHydrated, getKey } from "@/lib/keys/store";
import { diagnoseLlmFailure } from "@/lib/llm/diagnoseOutput";
import { buildMovePrompt } from "@/lib/llm/prompt";
import { PROVIDERS } from "@/lib/llm/providers";
import {
  getPlayToken,
  getSpectateToken,
  rememberSpectateToken,
  saveMatchTokens,
} from "@/lib/match/clientTokens";
import {
  HUMAN_NAME_MAX,
  loadStoredHumanName,
  saveStoredHumanName,
  withStoredHumanName,
} from "@/lib/match/humanName";
import type { Match } from "@/lib/match/types";
import {
  canResignAtPly,
  MIN_RESIGN_PLIES,
} from "@/lib/match/resign";

function labelParticipant(p: Match["players"]["w"], humanLabel: string): string {
  if (p.kind === "human") {
    const name = p.name?.trim();
    return name ? `${humanLabel} · ${name}` : humanLabel;
  }
  const name = PROVIDERS.find((x) => x.id === p.provider)?.name ?? p.provider;
  return `${name} · ${p.model}`;
}

function accessToken(matchId: string): string | null {
  return getPlayToken(matchId) || getSpectateToken(matchId);
}

/** Elapsed match time as H:MM:SS (hours may grow beyond 9). */
function formatMatchElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatMatchStarted(ts: number, locale: string): string {
  const d = new Date(ts);
  const time = new Intl.DateTimeFormat(locale, {
    timeStyle: "medium",
  }).format(d);
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
  }).format(d);
  return `${time} · ${date}`;
}

/** Illegal-strike count: 0 muted, 1 white, 2 yellow, 3+ red. */
function illegalStrikeColor(n: number): string {
  if (n >= 3) return "var(--danger)";
  if (n === 2) return "#facc15";
  if (n === 1) return "var(--fg)";
  return "var(--fg-muted)";
}

function IllegalStrikeCount({ n }: { n: number }) {
  return (
    <span style={{ color: illegalStrikeColor(n) }}>{n}</span>
  );
}

/** server_error / network: 1s → 2s → 4s, up to 3 retries. */
const MAX_TRANSPORT_RETRIES = 3;
/** rate_limit / rate_limited: fixed 30s gap, up to 2 retries. */
const MAX_RATE_LIMIT_RETRIES = 2;
/** Wait between rate-limit retries (HvM and MvM). */
const RATE_LIMIT_BACKOFF_MS = 30_000;
/** Human idle on their turn this long ⇒ warning sound + flashing name. */
const HUMAN_IDLE_WARN_MS = 3 * 60_000;

function playHeaders(matchId: string, json = true): HeadersInit {
  const headers: Record<string, string> = {};
  if (json) headers["Content-Type"] = "application/json";
  const play = getPlayToken(matchId);
  if (play) headers["X-Play-Token"] = play;
  return headers;
}

function readHeaders(matchId: string): HeadersInit {
  const headers: Record<string, string> = {};
  const play = getPlayToken(matchId);
  const spectate = getSpectateToken(matchId);
  if (play) headers["X-Play-Token"] = play;
  else if (spectate) headers["X-Spectate-Token"] = spectate;
  return headers;
}

function streamUrl(matchId: string): string {
  const t = accessToken(matchId);
  const q = t ? `?t=${encodeURIComponent(t)}` : "";
  return `/api/matches/${matchId}/stream${q}`;
}

function spectateShareUrl(
  origin: string,
  locale: string,
  matchId: string,
): string {
  const base = `${origin}/${locale}/spectate/${matchId}`;
  const t = getSpectateToken(matchId);
  return t ? `${base}?t=${encodeURIComponent(t)}` : base;
}

export function MatchRoom({
  matchId,
  spectate = false,
  onFinished,
}: {
  matchId: string;
  spectate?: boolean;
  /** Fired once when this match reaches finished. */
  onFinished?: (match: Match) => void;
}) {
  const t = useTranslations("play");
  const tArena = useTranslations("arena");
  const tGames = useTranslations("games");
  const tReasons = useTranslations("reasons");
  const tErr = useTranslations("apiErrors");
  const tHistory = useTranslations("history");
  const locale = useLocale();
  const router = useRouter();
  const [match, setMatch] = useState<Match | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Live match evicted; SQLite still has an ended record for Replay. */
  const [matchFinished, setMatchFinished] = useState(false);
  /** Base message while a transport retry countdown is running. */
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const [retryUntil, setRetryUntil] = useState<number | null>(null);
  const [thinking, setThinking] = useState(false);
  const [thinkingSec, setThinkingSec] = useState(0);
  /** Human turn idle past HUMAN_IDLE_WARN_MS — flash name + loop warning MP3. */
  const [idleWarn, setIdleWarn] = useState(false);
  const [editingHumanSide, setEditingHumanSide] = useState<"w" | "b" | null>(
    null,
  );
  const [humanNameDraft, setHumanNameDraft] = useState("");
  const [savingHumanName, setSavingHumanName] = useState(false);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [confirmingResign, setConfirmingResign] = useState(false);
  const [confirmingAbort, setConfirmingAbort] = useState(false);
  const [confirmingRestart, setConfirmingRestart] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [spectateCopied, setSpectateCopied] = useState(false);
  const spectateCopiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [thinkingMuted, setThinkingMuted] = useState(() =>
    typeof window === "undefined" ? false : isThinkingSoundMuted(),
  );
  /** Wall clock for Status header; updates every second while playing. */
  const [clockNow, setClockNow] = useState(() => Date.now());
  /** Apply localStorage human name once per match id. */
  const humanNameApplied = useRef<string | null>(null);
  const busy = useRef(false);
  /** Retry budget for failed requests, reset whenever the position advances. */
  const transportRetry = useRef({ ply: -1, count: 0 });
  const matchRef = useRef<Match | null>(null);
  const moveCountRef = useRef(0);
  const moveSoundPrimed = useRef(false);
  const gameOverSoundPlayed = useRef(false);
  const sawPlaying = useRef(false);
  const finishedNotified = useRef<string | null>(null);
  const audioReady = useRef(false);
  const requestLlmMoveRef = useRef<(current: Match) => Promise<void>>(
    async () => {},
  );

  useEffect(() => {
    matchRef.current = match;
  }, [match]);

  useEffect(() => {
    moveCountRef.current = 0;
    moveSoundPrimed.current = false;
    gameOverSoundPlayed.current = false;
    sawPlaying.current = false;
    finishedNotified.current = null;
    humanNameApplied.current = null;
    stopThinkingSound();
    stopWarningSound();
    const id = window.requestAnimationFrame(() => {
      setThinking(false);
      setIdleWarn(false);
      setRetryMessage(null);
      setRetryUntil(null);
      setMatchFinished(false);
    });
    return () => window.cancelAnimationFrame(id);
  }, [matchId]);

  // Restore browser-saved human name onto this match if the player has none.
  useEffect(() => {
    if (spectate || !match || match.status !== "playing") return;
    if (humanNameApplied.current === match.id) return;

    const named = (["w", "b"] as const).find(
      (s) =>
        match.players[s].kind === "human" &&
        Boolean(match.players[s].name?.trim()),
    );
    if (named) {
      const n = match.players[named].name!.trim();
      saveStoredHumanName(n);
      humanNameApplied.current = match.id;
      return;
    }

    const stored = loadStoredHumanName();
    if (!stored) {
      humanNameApplied.current = match.id;
      return;
    }
    const side = (["w", "b"] as const).find(
      (s) => match.players[s].kind === "human",
    );
    if (!side) {
      humanNameApplied.current = match.id;
      return;
    }
    humanNameApplied.current = match.id;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/matches/${match.id}`, {
          method: "PATCH",
          headers: playHeaders(match.id),
          body: JSON.stringify({
            action: "set_human_name",
            side,
            name: stored,
          }),
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled && data.match) setMatch(data.match);
      } catch {
        /* ignore — name can still be set manually */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [match, matchId, spectate]);

  // Live "Retrying in Ns" countdown for transport backoffs.
  useEffect(() => {
    if (retryUntil == null || retryMessage == null) return;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((retryUntil - Date.now()) / 1000));
      setError(
        tErr("withRetry", {
          message: retryMessage,
          seconds,
        }),
      );
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [retryUntil, retryMessage, tErr]);

  // Persist spectate token from share URL (?t=) for private matches.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t");
    if (t) rememberSpectateToken(matchId, t);
  }, [matchId]);

  // Play-client presence: heartbeat every 10s. Missing ~60s → server aborts.
  useEffect(() => {
    if (spectate) return;
    if (!getPlayToken(matchId)) return;

    let cancelled = false;
    const beat = async () => {
      try {
        const res = await fetch(`/api/matches/${matchId}`, {
          method: "PATCH",
          headers: playHeaders(matchId),
          body: JSON.stringify({ action: "heartbeat" }),
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const next = data.match as Match | undefined;
        if (next?.status === "finished") setMatch(next);
      } catch {
        /* offline / tab background */
      }
    };

    void beat();
    const id = window.setInterval(beat, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [matchId, spectate]);

  // Elapsed seconds while the model is thinking (shown next to the label).
  useEffect(() => {
    if (!thinking) return;
    const boot = window.requestAnimationFrame(() => setThinkingSec(0));
    const id = window.setInterval(() => {
      setThinkingSec((s) => s + 1);
    }, 1000);
    return () => {
      window.cancelAnimationFrame(boot);
      window.clearInterval(id);
    };
  }, [thinking]);

  // Match elapsed clock (Status header): tick while playing; freeze when finished.
  const playingMatchId =
    match?.status === "playing" ? match.id : null;
  useEffect(() => {
    if (!playingMatchId) return;
    const id = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [playingMatchId]);

  useEffect(() => {
    return () => {
      if (spectateCopiedTimer.current) clearTimeout(spectateCopiedTimer.current);
    };
  }, []);

  /**
   * Server error text is English-only, so translate what we can recognise and
   * keep the raw message for the failures no locale has wording for.
   */
  const describeError = useCallback(
    (status: number, body: ApiErrorBody): string => {
      const key = apiErrorKey(status, body.code);
      return key ? tErr(key) : body.error || tErr("generic");
    },
    [tErr],
  );

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/matches/${matchId}`, {
      headers: readHeaders(matchId),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.code === ERROR_CODES.matchFinished) {
        setMatchFinished(true);
      }
      throw new Error(describeError(res.status, data));
    }
    setMatchFinished(false);
    setMatch(data.match);
  }, [matchId, describeError]);

  // Unlock Web Audio after first user gesture so model moves can beep too.
  useEffect(() => {
    const arm = () => {
      if (audioReady.current) return;
      unlockAudio();
      audioReady.current = true;
    };
    window.addEventListener("pointerdown", arm, { once: true });
    window.addEventListener("keydown", arm, { once: true });
    return () => {
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
    };
  }, []);

  // Thinking ambience while the play client waits on an LLM move.
  useEffect(() => {
    if (spectate || !thinking || thinkingMuted) {
      stopThinkingSound();
      return;
    }
    startThinkingSound();
    return () => {
      stopThinkingSound();
    };
  }, [thinking, spectate, thinkingMuted]);

  // SSE sync (provides initial snapshot too)
  useEffect(() => {
    const es = new EventSource(streamUrl(matchId));
    es.addEventListener("match", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { match: Match };
        const prev = matchRef.current;
        // Only a position that actually moved on makes a message stale. The
        // stream also fires on heartbeats, which would otherwise wipe an error
        // seconds after it appears.
        if (
          !prev ||
          prev.status !== data.match.status ||
          prev.state.moveHistory.length !== data.match.state.moveHistory.length
        ) {
          setError(null);
        }
        setMatch(data.match);
      } catch {
        /* ignore */
      }
    });
    es.addEventListener("error", () => {
      void refresh().catch((e: Error) => setError(e.message));
    });
    return () => es.close();
  }, [matchId, refresh]);

  // Play move / capture sound when a new ply appears (skip initial hydrate).
  // After that, if Chess HvM and the human is in check, play check sound.
  useEffect(() => {
    if (!match) return;
    const len = match.state.moveHistory.length;
    if (!moveSoundPrimed.current) {
      moveCountRef.current = len;
      moveSoundPrimed.current = true;
      return;
    }
    if (len > moveCountRef.current) {
      const lastSan = match.state.lastMove?.san ?? "";
      const captured = match.state.lastMove?.meta?.captured === true;
      const humanSide =
        match.mode === "human_vs_model"
          ? match.players.w.kind === "human"
            ? "w"
            : "b"
          : null;
      const humanInCheck =
        match.gameId === "chess" &&
        humanSide !== null &&
        match.state.turn === humanSide &&
        (lastSan.endsWith("+") || lastSan.endsWith("#"));

      void (async () => {
        if (captured) await playCaptureSound();
        else if (lastSan !== "pass") await playMoveSound();
        if (humanInCheck) await playCheckSound();
      })();
    }
    moveCountRef.current = len;
  }, [match]);

  // Track that we saw this match while still playing (skip fanfare on reopen).
  useEffect(() => {
    if (match?.status === "playing") sawPlaying.current = true;
  }, [match?.status]);

  // Play fanfare once when a side wins (not draw / abort).
  useEffect(() => {
    if (!match) return;
    if (!sawPlaying.current) return;
    if (match.status !== "finished") return;
    const winner = match.result?.winner;
    if (winner !== "w" && winner !== "b") return;
    if (gameOverSoundPlayed.current) return;
    gameOverSoundPlayed.current = true;
    playGameOverSound();
  }, [match]);

  // Notify parent once per finished match.
  useEffect(() => {
    if (!match || !onFinished) return;
    if (match.status !== "finished") return;
    if (finishedNotified.current === match.id) return;
    finishedNotified.current = match.id;
    onFinished(match);
  }, [match, onFinished]);

  const viewState = useMemo(() => {
    if (!match) return null;
    if (historyIndex === null) return match.state;
    const engine = getEngine(match.gameId);
    let s = engine.newGame(
      match.gameId === "go" ? { size: match.state.data?.size } : undefined,
    );
    for (let i = 0; i < historyIndex; i++) {
      try {
        s = engine.applyMove(s, match.state.moveHistory[i]);
      } catch {
        break;
      }
    }
    return s;
  }, [match, historyIndex]);

  const humanCheckFlash = useMemo(() => {
    if (!match || !viewState || historyIndex !== null) return null;
    if (match.gameId !== "chess" || match.mode !== "human_vs_model") return null;
    const humanSide: "w" | "b" =
      match.players.w.kind === "human" ? "w" : "b";
    if (viewState.turn !== humanSide) return null;
    const lastSan = viewState.lastMove?.san ?? "";
    if (!lastSan.endsWith("+") && !lastSan.endsWith("#")) return null;
    return { side: humanSide, flashKey: viewState.moveHistory.length };
  }, [match, viewState, historyIndex]);

  const captureMaterial = useMemo(
    () => (viewState ? materialCaptures(viewState) : null),
    [viewState],
  );
  const goCaptures = useMemo(
    () => (viewState ? goCaptureCounts(viewState) : null),
    [viewState],
  );

  const toMove = match
    ? match.state.turn === "w"
      ? match.players.w
      : match.players.b
    : null;

  const humanTurn =
    !spectate &&
    match?.status === "playing" &&
    toMove?.kind === "human" &&
    historyIndex === null;

  // After 3 minutes with no human move on their turn: warn with sound + flash.
  useEffect(() => {
    if (!humanTurn) {
      const boot = window.requestAnimationFrame(() => setIdleWarn(false));
      return () => window.cancelAnimationFrame(boot);
    }
    const boot = window.requestAnimationFrame(() => setIdleWarn(false));
    const id = window.setTimeout(() => setIdleWarn(true), HUMAN_IDLE_WARN_MS);
    return () => {
      window.cancelAnimationFrame(boot);
      window.clearTimeout(id);
    };
  }, [
    humanTurn,
    match?.state.turn,
    match?.state.moveHistory.length,
    matchId,
  ]);

  useEffect(() => {
    if (spectate || !idleWarn) {
      stopWarningSound();
      return;
    }
    startWarningSound();
    return () => {
      stopWarningSound();
    };
  }, [idleWarn, spectate]);

  const requestLlmMove = useCallback(
    async (current: Match) => {
      if (busy.current || current.status !== "playing") return;
      const side = current.state.turn;
      const participant = side === "w" ? current.players.w : current.players.b;
      if (participant.kind !== "model") return;

      await ensureKeysHydrated();
      const apiKey = getKey(participant.provider);
      if (!apiKey) {
        setError(t("missingKey", { provider: participant.provider }));
        return;
      }

      const strikesBefore = current.illegalStrikes[side];
      const plyBefore = current.state.moveHistory.length;
      busy.current = true;
      setThinking(true);
      setError(null);
      setRetryMessage(null);
      setRetryUntil(null);
      const thinkStartedAt = Date.now();

      let retryAfterMs: number | null = null;
      /** MvM: after rate-limit retries are exhausted, end the match with no winner. */
      let abortForRateLimit = false;

      if (transportRetry.current.ply !== plyBefore) {
        transportRetry.current = { ply: plyBefore, count: 0 };
      }

      /** @returns the backoff to use, or null once retries are exhausted. */
      const transportBackoffMs = (
        res: Response | null,
        code?: string,
      ): number | null => {
        const attempt = transportRetry.current;
        const rateLimited = isRateLimitFailure(res?.status ?? 0, code);
        const max = rateLimited ? MAX_RATE_LIMIT_RETRIES : MAX_TRANSPORT_RETRIES;
        if (attempt.count >= max) return null;
        attempt.count += 1;
        const retryAfter = Number(res?.headers.get("retry-after"));
        if (Number.isFinite(retryAfter) && retryAfter > 0) {
          return Math.min(Math.max(retryAfter, 1) * 1000, 60_000);
        }
        if (rateLimited) return RATE_LIMIT_BACKOFF_MS;
        return 1000 * 2 ** (attempt.count - 1);
      };

      /** Reports why the move failed, and how long until the next attempt. */
      const fail = (
        reason: string,
        res: Response | null,
        retry: boolean,
        code?: string,
      ) => {
        if (retry) retryAfterMs = transportBackoffMs(res, code);
        if (retryAfterMs === null) {
          setRetryMessage(null);
          setRetryUntil(null);
          const rateLimited = isRateLimitFailure(res?.status ?? 0, code);
          if (rateLimited && current.mode === "model_vs_model") {
            abortForRateLimit = true;
            setError(tErr("rateLimitAborted"));
            return;
          }
          setError(rateLimited ? tErr("rateLimitRefresh") : reason);
          return;
        }
        setRetryMessage(reason);
        setRetryUntil(Date.now() + retryAfterMs);
        setError(
          tErr("withRetry", {
            message: reason,
            seconds: Math.round(retryAfterMs / 1000),
          }),
        );
      };

      try {
        const prompt = buildMovePrompt(current.state, side, {
          legalMovesProtection: current.legalMovesProtection,
          tacticalGuidance: current.tacticalGuidance,
          reasoningLevel: current.reasoningLevel,
        });
        const res = await fetch("/api/llm/complete", {
          method: "POST",
          headers: playHeaders(current.id),
          body: JSON.stringify({
            provider: participant.provider,
            model: participant.model,
            apiKey,
            prompt,
            matchId: current.id,
          }),
        });
        const data = await res.json().catch(() => ({}));

        // A failed request means the proxy, the provider, or the network broke
        // down — the model never chose a move, so this must not be recorded as
        // an illegal one. Retry transient failures instead.
        if (!res.ok) {
          fail(
            describeError(res.status, data),
            res,
            isRetryable(res.status, data.code),
            data.code,
          );
        } else {
          const engine = getEngine(current.gameId);
          const modelText =
            typeof data.text === "string" ? data.text : "";
          const providerRaw =
            typeof data.providerRaw === "string" ? data.providerRaw : "";
          const rawForLog = modelText.trim() || providerRaw || "";
          const parsed = engine.parseMove(modelText, current.state);
          const diagnosis = parsed
            ? null
            : diagnoseLlmFailure(modelText, providerRaw);
          const skipIllegal = Boolean(diagnosis?.skipIllegalStrike);
          const patchRes = await fetch(`/api/matches/${current.id}`, {
            method: "PATCH",
            headers: playHeaders(current.id),
            body: JSON.stringify({
              action: "llm_result",
              side,
              raw: rawForLog,
              parsedMove: parsed?.san ?? modelText,
              provider: participant.provider,
              model: participant.model,
              thinkMs: parsed ? Date.now() - thinkStartedAt : undefined,
              error: diagnosis?.detail,
              countIllegal: parsed ? undefined : !skipIllegal,
            }),
          });
          const patchData = await patchRes.json();
          if (!patchRes.ok) {
            setError(describeError(patchRes.status, patchData));
            await refresh();
          } else {
            transportRetry.current.count = 0;
            setRetryMessage(null);
            setRetryUntil(null);
            const updated = patchData.match as Match;
            setMatch(updated);

            if (skipIllegal && diagnosis) {
              // Provider refusal / safety — do not count as illegal or hammer retries.
              setError(
                t("modelRefused", { detail: diagnosis.detail }),
              );
            } else {
              const registeredIllegal =
                updated.illegalStrikes[side] > strikesBefore;
              const stillSamePosition =
                updated.status === "playing" &&
                updated.state.turn === side &&
                updated.state.moveHistory.length === plyBefore;

              if (
                registeredIllegal &&
                stillSamePosition &&
                updated.illegalStrikes[side] < 3
              ) {
                // The log keeps the English detail for the record; the player
                // only needs to know the model missed and is trying again.
                setError(t("illegalOutput"));
                retryAfterMs = 600;
              }
            }
          }
        }
      } catch (e) {
        // fetch only rejects when the request never completed; anything else
        // reaching here already carries a message meant for this user.
        if (e instanceof TypeError) {
          fail(tErr("serverError"), null, true, ERROR_CODES.serverError);
        } else setError(e instanceof Error ? e.message : tErr("generic"));
      } finally {
        busy.current = false;
        // Clear thinking for both terminal failures and backoff waits so the
        // "Model is thinking…" label and looped MP3 do not overlap a retry
        // countdown (e.g. rate-limit "Retrying in 30s"). The next attempt
        // turns thinking back on when requestLlmMove runs again.
        setThinking(false);
      }

      if (abortForRateLimit) {
        try {
          playAbortSound();
          const abortRes = await fetch(`/api/matches/${current.id}`, {
            method: "PATCH",
            headers: playHeaders(current.id),
            body: JSON.stringify({ action: "abort" }),
          });
          const abortData = await abortRes.json().catch(() => ({}));
          if (abortRes.ok && abortData.match) {
            setMatch(abortData.match as Match);
          }
        } catch {
          /* keep rateLimitAborted error */
        }
        return;
      }

      if (retryAfterMs !== null) {
        window.setTimeout(() => {
          const latest = matchRef.current;
          if (
            !latest ||
            latest.status !== "playing" ||
            latest.state.turn !== side ||
            latest.state.moveHistory.length !== plyBefore ||
            latest.illegalStrikes[side] >= 3 ||
            (latest.mode === "model_vs_model" && !latest.autoPlay)
          ) {
            setRetryMessage(null);
            setRetryUntil(null);
            return;
          }
          void requestLlmMoveRef.current(latest);
        }, retryAfterMs);
      }
    },
    [refresh, describeError, t, tErr],
  );

  useEffect(() => {
    requestLlmMoveRef.current = requestLlmMove;
  }, [requestLlmMove]);

  // Drive model turns. Depend on ply/turn/autoPlay — not the whole `match`
  // object — so SSE polls (~800ms) do not reset the auto-play delay timer.
  const turn = match?.state.turn;
  const ply = match?.state.moveHistory.length;
  const autoPlay = match?.autoPlay;
  const autoDelayMs = match?.autoDelayMs;
  const matchStatus = match?.status;
  const matchMode = match?.mode;

  useEffect(() => {
    if (spectate || !matchRef.current || matchStatus !== "playing" || historyIndex !== null)
      return;
    if (toMove?.kind !== "model") return;
    if (matchMode === "model_vs_model" && !autoPlay) return;

    const delay = matchMode === "model_vs_model" ? (autoDelayMs ?? 3000) : 400;
    const scheduledTurn = turn;
    const scheduledPly = ply;
    const timer = setTimeout(() => {
      const current = matchRef.current;
      if (!current || current.status !== "playing") return;
      if (current.state.turn !== scheduledTurn) return;
      if (current.state.moveHistory.length !== scheduledPly) return;
      if (matchMode === "model_vs_model" && !current.autoPlay) return;
      requestLlmMove(current);
    }, delay);
    return () => clearTimeout(timer);
  }, [
    spectate,
    historyIndex,
    requestLlmMove,
    toMove?.kind,
    turn,
    ply,
    autoPlay,
    autoDelayMs,
    matchStatus,
    matchMode,
  ]);

  const submitMove = async (move: Move | string) => {
    if (!match || !humanTurn) return;
    setError(null);
    const san = typeof move === "string" ? move : move.san;
    const res = await fetch(`/api/matches/${match.id}`, {
      method: "PATCH",
      headers: playHeaders(match.id),
      body: JSON.stringify({
        action: san === "pass" ? "pass" : "move",
        move: san,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(describeError(res.status, data));
      return;
    }
    setMatch(data.match);
  };

  const openHumanNameEditor = (side: "w" | "b") => {
    if (!match || spectate) return;
    const player = match.players[side];
    if (player.kind !== "human") return;
    setEditingHumanSide(side);
    setHumanNameDraft(player.name ?? "");
  };

  const saveHumanName = async () => {
    if (!match || !editingHumanSide) return;
    setSavingHumanName(true);
    setError(null);
    try {
      const name = humanNameDraft.slice(0, HUMAN_NAME_MAX);
      const res = await fetch(`/api/matches/${match.id}`, {
        method: "PATCH",
        headers: playHeaders(match.id),
        body: JSON.stringify({
          action: "set_human_name",
          side: editingHumanSide,
          name,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(describeError(res.status, data));
      saveStoredHumanName(name);
      setMatch(data.match);
      setEditingHumanSide(null);
    } catch (e) {
      if (e instanceof TypeError) setError(tErr("serverError"));
      else setError(e instanceof Error ? e.message : tErr("generic"));
    } finally {
      setSavingHumanName(false);
    }
  };

  const renderSideLabel = (side: "w" | "b") => {
    const player = match!.players[side];
    const discs = viewState ? othelloDiscCounts(viewState) : null;
    const label = labelParticipant(player, tArena("human"));
    const text =
      discs != null ? `${label} (${discs[side]})` : label;
    const active =
      match!.status === "playing" && match!.state.turn === side;
    const canEdit =
      !spectate &&
      match!.mode === "human_vs_model" &&
      player.kind === "human";
    const warnFlash =
      idleWarn && active && player.kind === "human" && !spectate;
    const tone = warnFlash
      ? "anim-idle-warn"
      : active
        ? "text-[var(--cyan)]"
        : "text-[var(--fg-muted)]";

    if (!canEdit) {
      return (
        <p
          className={`text-center font-[family-name:var(--font-display)] text-sm sm:text-base ${tone}`}
        >
          {text}
        </p>
      );
    }

    return (
      <div className="relative flex flex-col items-center">
        <button
          type="button"
          className={`cursor-pointer font-[family-name:var(--font-display)] text-sm sm:text-base transition-colors hover:text-[var(--cyan)] ${tone}`}
          title={t("editHumanName")}
          onClick={() => openHumanNameEditor(side)}
        >
          {text}
        </button>
        {editingHumanSide === side && (
          <div className="absolute top-full z-20 mt-2 w-[min(90vw,14rem)] border border-[var(--line)] bg-[color-mix(in_srgb,var(--bg-panel)_96%,transparent)] p-3 shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-md">
            <label className="label" htmlFor={`human-name-${side}`}>
              {t("humanNameLabel")}
            </label>
            <input
              id={`human-name-${side}`}
              className="field !py-2 text-sm"
              maxLength={HUMAN_NAME_MAX}
              autoFocus
              autoComplete="off"
              placeholder={t("humanNamePlaceholder")}
              value={humanNameDraft}
              onChange={(e) =>
                setHumanNameDraft(e.target.value.slice(0, HUMAN_NAME_MAX))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void saveHumanName();
                }
                if (e.key === "Escape") setEditingHumanSide(null);
              }}
            />
            <p className="mt-1 text-[10px] text-[var(--fg-muted)]">
              {t("humanNameHint")}
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="btn btn-primary flex-1 !py-1.5 text-xs"
                disabled={savingHumanName}
                onClick={() => void saveHumanName()}
              >
                {t("confirm")}
              </button>
              <button
                type="button"
                className="btn btn-ghost flex-1 !py-1.5 text-xs"
                disabled={savingHumanName}
                onClick={() => setEditingHumanSide(null)}
              >
                {t("cancel")}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const setAuto = async (autoPlay: boolean) => {
    if (!match) return;
    // Resuming is the closest thing to a manual retry, so give a position whose
    // requests all failed a fresh budget rather than leaving it stuck.
    if (autoPlay) transportRetry.current.count = 0;
    const res = await fetch(`/api/matches/${match.id}`, {
      method: "PATCH",
      headers: playHeaders(match.id),
      body: JSON.stringify({ action: "set_auto", autoPlay }),
    });
    const data = await res.json();
    if (res.ok) setMatch(data.match);
  };

  if (error && !match) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-[var(--danger)]">{error}</p>
        {matchFinished && (
          <p className="mt-4">
            <Link
              href={`/replay/${matchId}`}
              className="text-[var(--cyan)] hover:underline"
            >
              {t("viewReplay")}
            </Link>
          </p>
        )}
      </div>
    );
  }

  if (!match || !viewState) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-[var(--fg-muted)]">
        {t("loading")}
      </div>
    );
  }

  const lastLog = match.llmLog[match.llmLog.length - 1];
  const humanLabel = tArena("human");
  const reserveThinkingB =
    match.mode === "model_vs_model" || match.players.b.kind === "model";
  const reserveThinkingW =
    match.mode === "model_vs_model" || match.players.w.kind === "model";
  const thinkingVisibleB =
    thinking && match.state.turn === "b" && reserveThinkingB;
  const thinkingVisibleW =
    thinking && match.state.turn === "w" && reserveThinkingW;
  const thinkingLabel = `${t("thinking")} (${thinkingSec}s)`;
  const plyCount = match.state.moveHistory.length;
  const resignAllowed = canResignAtPly(plyCount);
  const winnerText =
    match.result?.winner === "draw"
      ? t("draw")
      : match.result?.winner
        ? labelParticipant(
            match.result.winner === "w" ? match.players.w : match.players.b,
            humanLabel,
          )
        : t("noWinner");
  const reasonText = reasonLabel(match.result?.reason, tReasons);

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[1fr_320px]">
      <div>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h1 className="font-[family-name:var(--font-display)] text-2xl">
            {match.seq != null && (
              <>
                <span className="text-[var(--fg-faint)]">
                  {tHistory("matchNo", { n: match.seq })}
                </span>{" "}
              </>
            )}
            {spectate ? t("spectating") : t("match")} · {tGames(match.gameId)}
          </h1>
          <div className="flex flex-wrap gap-2">
            {!spectate && (
              <>
                <button
                  type="button"
                  className="btn btn-ghost !py-2 text-sm"
                  aria-pressed={thinkingMuted}
                  onClick={() => {
                    const next = !thinkingMuted;
                    setThinkingSoundMuted(next);
                    setThinkingMuted(next);
                  }}
                >
                  {thinkingMuted ? t("unmuteThinking") : t("muteThinking")}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost !py-2 text-sm"
                  onClick={async () => {
                    const url = spectateShareUrl(
                      window.location.origin,
                      locale,
                      match.id,
                    );
                    try {
                      await navigator.clipboard.writeText(url);
                      setSpectateCopied(true);
                      if (spectateCopiedTimer.current) {
                        clearTimeout(spectateCopiedTimer.current);
                      }
                      spectateCopiedTimer.current = setTimeout(
                        () => setSpectateCopied(false),
                        2000,
                      );
                    } catch {
                      setError(t("spectateCopyFailed"));
                    }
                  }}
                >
                  {spectateCopied ? t("spectateCopied") : t("spectateLink")}
                </button>
              </>
            )}
            {match.mode === "model_vs_model" && !spectate && (
              <>
                <button
                  type="button"
                  className="btn btn-ghost !py-2 text-sm"
                  onClick={() => setAuto(!match.autoPlay)}
                >
                  {match.autoPlay ? t("pause") : t("resume")}
                </button>
                {!match.autoPlay && (
                  <button
                    type="button"
                    className="btn btn-ghost !py-2 text-sm"
                    onClick={() => requestLlmMove(match)}
                    disabled={thinking || match.status !== "playing"}
                  >
                    {t("step")}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        <div
          className={
            supportsCaptureTray(match.gameId)
              ? "grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 sm:gap-x-3"
              : ""
          }
        >
          <div className="col-start-2">
            {reserveThinkingB && (
              <p
                className={`mb-1 min-h-[1.25rem] text-center text-sm anim-pulse ${
                  thinkingVisibleB ? "text-[var(--cyan)]" : "invisible"
                }`}
                aria-hidden={!thinkingVisibleB}
              >
                {thinkingLabel}
              </p>
            )}
            <div className="mb-3">{renderSideLabel("b")}</div>
          </div>

          {captureMaterial && (
            <div className="row-start-2">
              <CaptureTray
                byB={captureMaterial.byB}
                byW={captureMaterial.byW}
              />
            </div>
          )}
          {goCaptures && (
            <div className="row-start-2">
              <GoCaptureTray
                capturesB={goCaptures.b}
                capturesW={goCaptures.w}
                label={t("captures")}
              />
            </div>
          )}
          <div
            className={
              supportsCaptureTray(match.gameId) ? "row-start-2 min-w-0" : "min-w-0"
            }
          >
            <GameBoard
              state={viewState}
              onMove={submitMove}
              readOnly={!humanTurn || historyIndex !== null}
              hidePass={match.gameId === "go"}
              checkFlash={humanCheckFlash}
            />
          </div>

          <div className="col-start-2">
            {match.gameId === "go" && (
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  className="btn btn-ghost !py-2 text-sm"
                  disabled={!humanTurn || historyIndex !== null}
                  onClick={() => submitMove("pass")}
                >
                  {t("pass")}
                </button>
              </div>
            )}
            <div className="mt-3">{renderSideLabel("w")}</div>
            {reserveThinkingW && (
              <p
                className={`mt-1 min-h-[1.25rem] text-center text-sm anim-pulse ${
                  thinkingVisibleW ? "text-[var(--cyan)]" : "invisible"
                }`}
                aria-hidden={!thinkingVisibleW}
              >
                {thinkingLabel}
              </p>
            )}
          </div>
        </div>

        {error && (
          <p className="mt-3 text-center text-sm text-[var(--danger)]">{error}</p>
        )}
        {match.status === "finished" && (
          <p className="mt-4 border border-[var(--line)] px-4 py-3 text-center text-sm">
            {t("finished")} · {t("winner")}{" "}
            <span className="text-[var(--accent)]">{winnerText}</span>
            {" · "}
            {reasonText}
          </p>
        )}
      </div>

      <aside className="space-y-4">
        <div className="panel p-4">
          <div className="mb-[0.35rem] flex items-baseline justify-between gap-2">
            <div className="label !mb-0">{t("status")}</div>
            <span className="font-mono text-xs tabular-nums text-[var(--fg-muted)]">
              {formatMatchElapsed(
                match.status === "finished"
                  ? Math.max(0, match.updatedAt - match.createdAt)
                  : Math.max(0, clockNow - match.createdAt),
              )}
            </span>
          </div>
          <p className="text-sm">
            {match.status === "finished"
              ? t("finished")
              : toMove
                ? `${t("turn")} ${labelParticipant(toMove, humanLabel)}`
                : t("turn")}
          </p>
          <p className="mt-2 text-xs text-[var(--fg-muted)]">
            {tHistory("started")} {formatMatchStarted(match.createdAt, locale)}
          </p>
          <p className="mt-2 text-xs text-[var(--fg-muted)]">
            {t("illegalStrikes")}{" "}
            {match.mode === "human_vs_model" ? (
              <IllegalStrikeCount
                n={
                  match.players.w.kind === "model"
                    ? match.illegalStrikes.w
                    : match.illegalStrikes.b
                }
              />
            ) : (
              <>
                w:
                <IllegalStrikeCount n={match.illegalStrikes.w} />
                {" / b:"}
                <IllegalStrikeCount n={match.illegalStrikes.b} />
              </>
            )}
          </p>
          {match.reasoningLevel !== "off" && (
            <p className="mt-1 text-xs text-[var(--cyan)]">
              {t("reasoningLevelLabel", {
                level: t(`reasoningLevel.${match.reasoningLevel}`),
              })}
            </p>
          )}
          {match.legalMovesProtection && (
            <p className="mt-1 text-xs text-[var(--cyan)]">
              {t("legalMovesProtectionOn")}
            </p>
          )}
          {match.tacticalGuidance && (
            <p className="mt-1 text-xs text-[var(--cyan)]">
              {t("tacticalGuidanceOn")}
            </p>
          )}
        </div>

        <div className="panel p-4">
          <div className="label">{t("moveHistory")}</div>
          <div className="mt-2 max-h-56 overflow-auto text-sm">
            {match.state.moveHistory.length === 0 && (
              <p className="text-[var(--fg-muted)]">{t("noMoves")}</p>
            )}
            <ol className="space-y-1">
              {[...match.state.moveHistory]
                .map((m, i) => ({ m, i }))
                .reverse()
                .map(({ m, i }) => (
                  <li key={`${m}-${i}`}>
                    <button
                      type="button"
                      className={`text-left hover:text-[var(--cyan)] ${
                        historyIndex === i + 1 ? "text-[var(--accent)]" : ""
                      }`}
                      onClick={() => setHistoryIndex(i + 1)}
                    >
                      {i + 1}. {m}
                    </button>
                  </li>
                ))}
            </ol>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="btn btn-ghost !px-2 !py-1 text-xs"
              onClick={() => setHistoryIndex(null)}
            >
              {t("live")}
            </button>
            <button
              type="button"
              className="btn btn-ghost !px-2 !py-1 text-xs"
              onClick={() =>
                setHistoryIndex((h) =>
                  Math.max(0, (h ?? match.state.moveHistory.length) - 1),
                )
              }
            >
              {t("prev")}
            </button>
            <button
              type="button"
              className="btn btn-ghost !px-2 !py-1 text-xs"
              onClick={() =>
                setHistoryIndex((h) => {
                  const cur = h ?? match.state.moveHistory.length;
                  const next = Math.min(match.state.moveHistory.length, cur + 1);
                  return next === match.state.moveHistory.length ? null : next;
                })
              }
            >
              {t("next")}
            </button>
          </div>
        </div>

        <div className="panel p-4">
          <div className="label">{t("lastOutput")}</div>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-[var(--fg-muted)]">
            {lastLog
              ? `${lastLog.parsedMove ? `move: ${lastLog.parsedMove}\n` : ""}${
                  lastLog.error ? `error: ${lastLog.error}\n` : ""
                }${lastLog.raw || "(empty)"}`
              : "—"}
          </pre>
        </div>

        {!spectate &&
          match.status === "playing" &&
          (confirmingResign ? (
            <div className="panel p-4">
              <p className="text-sm text-[var(--fg)]">{t("resignConfirm")}</p>
              {!resignAllowed && (
                <p className="mt-2 text-sm text-[var(--fg-muted)]">
                  {t("resignTooEarly", { min: MIN_RESIGN_PLIES })}
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="btn btn-primary flex-1 !py-2 text-sm"
                  disabled={!resignAllowed}
                  onClick={async () => {
                    if (!resignAllowed) return;
                    setConfirmingResign(false);
                    await fetch(`/api/matches/${match.id}`, {
                      method: "PATCH",
                      headers: playHeaders(match.id),
                      body: JSON.stringify({
                        action: "resign",
                        side: match.state.turn,
                      }),
                    });
                    await refresh();
                  }}
                >
                  {t("confirm")}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost flex-1 !py-2 text-sm"
                  onClick={() => setConfirmingResign(false)}
                >
                  {t("cancel")}
                </button>
              </div>
            </div>
          ) : confirmingAbort ? (
            <div className="panel p-4">
              <p className="text-sm text-[var(--fg)]">{t("abortConfirm")}</p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="btn btn-primary flex-1 !py-2 text-sm"
                  onClick={async () => {
                    setConfirmingAbort(false);
                    busy.current = false;
                    setThinking(false);
                    setThinkingSec(0);
                    setIdleWarn(false);
                    setRetryMessage(null);
                    setRetryUntil(null);
                    setError(null);
                    stopThinkingSound();
                    stopWarningSound();
                    playAbortSound();
                    await fetch(`/api/matches/${match.id}`, {
                      method: "PATCH",
                      headers: playHeaders(match.id),
                      body: JSON.stringify({ action: "abort" }),
                    });
                    await refresh();
                  }}
                >
                  {t("confirm")}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost flex-1 !py-2 text-sm"
                  onClick={() => setConfirmingAbort(false)}
                >
                  {t("cancel")}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-ghost flex-1 !px-3 !py-2 text-sm"
                disabled={
                  match.mode === "model_vs_model" ||
                  thinking ||
                  toMove?.kind !== "human"
                }
                onClick={() => setConfirmingResign(true)}
              >
                {t("resign")}
              </button>
              <button
                type="button"
                className="btn btn-ghost flex-1 !px-3 !py-2 text-sm"
                onClick={() => setConfirmingAbort(true)}
              >
                {t("abort")}
              </button>
            </div>
          ))}

        {!spectate &&
          match.status === "finished" &&
          (confirmingRestart ? (
            <div className="space-y-2">
              <div className="panel p-4">
                <p className="text-sm text-[var(--fg)]">{t("restartConfirm")}</p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    className="btn btn-primary flex-1 !py-2 text-sm"
                    disabled={restarting}
                    onClick={async () => {
                      setRestarting(true);
                      setError(null);
                      try {
                        const res = await fetch("/api/matches", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            gameId: match.gameId,
                            mode: match.mode,
                            players: {
                              w: withStoredHumanName(match.players.w),
                              b: withStoredHumanName(match.players.b),
                            },
                            publicSpectate: match.publicSpectate,
                            autoPlay: match.autoPlay,
                            autoDelayMs: match.autoDelayMs,
                            reasoningLevel: match.reasoningLevel,
                            legalMovesProtection: match.legalMovesProtection,
                            tacticalGuidance: match.tacticalGuidance,
                            goSize:
                              match.gameId === "go"
                                ? (match.state.data?.size as number | undefined)
                                : undefined,
                          }),
                        });
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok) {
                          throw new Error(describeError(res.status, data));
                        }
                        if (data.playToken && data.spectateToken) {
                          saveMatchTokens(
                            data.match.id,
                            data.playToken,
                            data.spectateToken,
                          );
                        }
                        setConfirmingRestart(false);
                        router.push(`/play/${data.match.id}`);
                      } catch (e) {
                        if (e instanceof TypeError) setError(tErr("serverError"));
                        else setError(e instanceof Error ? e.message : tErr("generic"));
                        setRestarting(false);
                      }
                    }}
                  >
                    {restarting ? t("restarting") : t("confirm")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost flex-1 !py-2 text-sm"
                    disabled={restarting}
                    onClick={() => setConfirmingRestart(false)}
                  >
                    {t("cancel")}
                  </button>
                </div>
              </div>
              <Link href="/arena" className="btn btn-ghost w-full">
                {t("backToArena")}
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              <button
                type="button"
                className="btn btn-ghost w-full"
                onClick={() => setConfirmingRestart(true)}
              >
                {t("restart")}
              </button>
              <Link href="/arena" className="btn btn-ghost w-full">
                {t("backToArena")}
              </Link>
            </div>
          ))}

      </aside>
    </div>
  );
}
