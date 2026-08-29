"use client";

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/** Call once after a user gesture so later autoplay (model moves) is allowed. */
export function unlockAudio(): void {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") void c.resume();
}

/** Soft click for a normal placement / non-capturing move. */
export function playMoveSound(): Promise<void> {
  return playMedia("/media/game_move.mp3");
}

/** Capture sound when a piece is taken (public/media/game_kill.mp3). */
export function playCaptureSound(): Promise<void> {
  return playMedia("/media/game_kill.mp3");
}

/** Check warning after a move that puts the human in check. */
export function playCheckSound(): Promise<void> {
  return playMedia("/media/game_check.mp3");
}

let thinkingAudio: HTMLAudioElement | null = null;
let thinkingMuted = false;

const THINKING_MUTE_KEY = "chess5.thinkingSoundMuted";

function readThinkingMuted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(THINKING_MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Whether the model-thinking loop is muted (persisted in localStorage). */
export function isThinkingSoundMuted(): boolean {
  if (typeof window === "undefined") return thinkingMuted;
  thinkingMuted = readThinkingMuted();
  return thinkingMuted;
}

/** Mute or unmute the model-thinking loop; stops playback when muting. */
export function setThinkingSoundMuted(muted: boolean): void {
  thinkingMuted = muted;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(THINKING_MUTE_KEY, muted ? "1" : "0");
    } catch {
      /* ignore quota / private mode */
    }
  }
  if (muted) stopThinkingSound();
}

/** Loop while a model is generating a move (public/media/model_thinking.mp3). */
export function startThinkingSound(): void {
  if (typeof window === "undefined") return;
  if (thinkingMuted || readThinkingMuted()) {
    thinkingMuted = true;
    return;
  }
  try {
    stopWarningSound();
    if (!thinkingAudio) {
      thinkingAudio = new Audio("/media/model_thinking.mp3");
      thinkingAudio.loop = true;
      thinkingAudio.volume = 0.55;
    }
    thinkingAudio.currentTime = 0;
    void thinkingAudio.play().catch(() => {
      /* autoplay may be blocked until a gesture */
    });
  } catch {
    /* ignore */
  }
}

/** Stop the thinking loop when the model finishes or errors out. */
export function stopThinkingSound(): void {
  if (!thinkingAudio) return;
  try {
    thinkingAudio.pause();
    thinkingAudio.currentTime = 0;
  } catch {
    /* ignore */
  }
}

let warningAudio: HTMLAudioElement | null = null;

/** Loop while a human has been idle on their turn too long. */
export function startWarningSound(): void {
  if (typeof window === "undefined") return;
  try {
    stopThinkingSound();
    if (!warningAudio) {
      warningAudio = new Audio("/media/game_warning.mp3");
      warningAudio.loop = true;
      warningAudio.volume = 0.65;
    }
    warningAudio.currentTime = 0;
    void warningAudio.play().catch(() => {
      /* autoplay may be blocked until a gesture */
    });
  } catch {
    /* ignore */
  }
}

/** Stop the human-idle warning loop. */
export function stopWarningSound(): void {
  if (!warningAudio) return;
  try {
    warningAudio.pause();
    warningAudio.currentTime = 0;
  } catch {
    /* ignore */
  }
}

function playMedia(src: string, volume = 0.85): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    try {
      const audio = new Audio(src);
      audio.volume = volume;
      const done = () => resolve();
      audio.addEventListener("ended", done, { once: true });
      audio.addEventListener("error", done, { once: true });
      void audio.play().catch(done);
    } catch {
      resolve();
    }
  });
}

/** Fanfare when a side wins (public/media/game_over.wav). */
export function playGameOverSound(): void {
  void playMedia("/media/game_over.wav");
}

/** Sound after confirming End Match (public/media/game_end.mp3). */
export function playAbortSound(): void {
  void playMedia("/media/game_end.mp3");
}
