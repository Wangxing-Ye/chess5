"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { ProviderId } from "@/lib/llm/providers";

/** Encrypted payload in localStorage (persistent). */
const STORAGE_KEY = "chess5.byok.v2";
/** AES-GCM key material (same origin, long-lived). */
const KEY_MATERIAL = "chess5.byok.k";
/** Legacy plaintext localStorage key — migrated then removed. */
const LEGACY_STORAGE_KEY = "chess5.byok.keys";
const CHANGE_EVENT = "chess5-keys-changed";

export type KeyMap = Partial<Record<ProviderId, string>>;

type EncryptedBlob = {
  v: 2;
  iv: string;
  ct: string;
};

let memory: KeyMap = {};
let hydrated = false;
let hydratePromise: Promise<void> | null = null;
let revision = 0;

function bump(): void {
  revision += 1;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function getAesKey(): Promise<CryptoKey> {
  let raw = localStorage.getItem(KEY_MATERIAL);
  // Migrate tab-scoped key material if present.
  if (!raw) {
    raw = sessionStorage.getItem(KEY_MATERIAL);
    if (raw) {
      localStorage.setItem(KEY_MATERIAL, raw);
      sessionStorage.removeItem(KEY_MATERIAL);
    }
  }
  if (!raw) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    raw = bytesToB64(bytes);
    localStorage.setItem(KEY_MATERIAL, raw);
  }
  return crypto.subtle.importKey(
    "raw",
    b64ToBytes(raw),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptKeys(keys: KeyMap): Promise<string> {
  const key = await getAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(keys));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext,
  );
  const blob: EncryptedBlob = {
    v: 2,
    iv: bytesToB64(iv),
    ct: bytesToB64(new Uint8Array(ciphertext)),
  };
  return JSON.stringify(blob);
}

async function decryptKeys(raw: string): Promise<KeyMap | null> {
  try {
    const blob = JSON.parse(raw) as EncryptedBlob;
    if (blob.v !== 2 || !blob.iv || !blob.ct) return null;
    const key = await getAesKey();
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(blob.iv) },
      key,
      b64ToBytes(blob.ct),
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as KeyMap;
  } catch {
    return null;
  }
}

async function persist(keys: KeyMap): Promise<void> {
  try {
    if (Object.keys(keys).length === 0) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, await encryptKeys(keys));
  } catch {
    /* quota / private mode */
  }
}

function readLegacyPlaintext(): KeyMap | null {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as KeyMap;
  } catch {
    return null;
  }
}

function readEncryptedCandidate(): string | null {
  const fromLocal = localStorage.getItem(STORAGE_KEY);
  if (fromLocal) return fromLocal;
  const fromSession = sessionStorage.getItem(STORAGE_KEY);
  if (fromSession) {
    localStorage.setItem(STORAGE_KEY, fromSession);
    sessionStorage.removeItem(STORAGE_KEY);
    return fromSession;
  }
  return null;
}

async function hydrate(): Promise<void> {
  if (typeof window === "undefined" || hydrated) return;
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    try {
      const encrypted = readEncryptedCandidate();
      if (encrypted) {
        const keys = await decryptKeys(encrypted);
        if (keys) {
          memory = keys;
          // Re-persist under localStorage + current key material.
          await persist(memory);
          localStorage.removeItem(LEGACY_STORAGE_KEY);
          sessionStorage.removeItem(STORAGE_KEY);
          sessionStorage.removeItem(KEY_MATERIAL);
          hydrated = true;
          bump();
          return;
        }
      }

      const legacy = readLegacyPlaintext();
      if (legacy && Object.keys(legacy).length > 0) {
        memory = legacy;
        await persist(memory);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        hydrated = true;
        bump();
        return;
      }

      localStorage.removeItem(LEGACY_STORAGE_KEY);
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(KEY_MATERIAL);
    } finally {
      hydrated = true;
      bump();
    }
  })();

  return hydratePromise;
}

if (typeof window !== "undefined") {
  void hydrate();
}

/** Ensure encrypted localStorage has been loaded into memory. */
export function ensureKeysHydrated(): Promise<void> {
  return hydrate();
}

export function loadKeys(): KeyMap {
  if (typeof window !== "undefined" && !hydrated) {
    void hydrate();
  }
  return { ...memory };
}

export function saveKeys(keys: KeyMap): void {
  memory = { ...keys };
  bump();
  void persist(memory);
}

export function getKey(provider: ProviderId): string | undefined {
  if (typeof window !== "undefined" && !hydrated) {
    void hydrate();
  }
  return memory[provider];
}

function subscribe(callback: () => void): () => void {
  if (typeof window !== "undefined" && !hydrated) {
    void hydrate();
  }
  const onStorage = (e: StorageEvent) => {
    if (
      e.key === STORAGE_KEY ||
      e.key === KEY_MATERIAL ||
      e.key === LEGACY_STORAGE_KEY
    ) {
      // Another tab changed keys — reload from storage.
      hydrated = false;
      hydratePromise = null;
      void hydrate().then(callback);
    }
  };
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): string {
  return `${revision}:${JSON.stringify(memory)}`;
}

function getServerSnapshot(): string {
  return "0:{}";
}

/** Reactive view of stored keys, safe for SSR hydration. */
export function useStoredKeys(): KeyMap {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(() => {
    const json = raw.slice(raw.indexOf(":") + 1);
    if (!json) return {};
    try {
      return JSON.parse(json) as KeyMap;
    } catch {
      return {};
    }
  }, [raw]);
}
