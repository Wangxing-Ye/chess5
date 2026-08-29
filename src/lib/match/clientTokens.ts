"use client";

const playKey = (matchId: string) => `chess5.play.${matchId}`;
const spectateKey = (matchId: string) => `chess5.spectate.${matchId}`;

export function saveMatchTokens(
  matchId: string,
  playToken: string,
  spectateToken: string,
): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(playKey(matchId), playToken);
  sessionStorage.setItem(spectateKey(matchId), spectateToken);
}

export function getPlayToken(matchId: string): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(playKey(matchId));
}

export function getSpectateToken(matchId: string): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(spectateKey(matchId));
}

export function rememberSpectateToken(matchId: string, token: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(spectateKey(matchId), token);
}
