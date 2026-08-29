import { randomBytes, randomUUID, timingSafeEqual } from "crypto";
import type { Match } from "./types";

/**
 * Compares tokens without an early exit. Length is checked first because
 * `timingSafeEqual` requires equal-sized buffers; tokens are fixed-length, so
 * that comparison reveals nothing useful.
 */
function tokensMatch(a: string, b: string | undefined): boolean {
  if (!b) return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export type ClientMatch = Omit<Match, "playToken" | "spectateToken" | "creatorIp">;

export function newMatchId(): string {
  return `m_${randomUUID()}`;
}

export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

export function toClientMatch(match: Match): ClientMatch {
  const rest = { ...match } as Match &
    Partial<Pick<Match, "playToken" | "spectateToken" | "creatorIp">>;
  delete rest.playToken;
  delete rest.spectateToken;
  delete rest.creatorIp;
  return rest as ClientMatch;
}

export function assertServerSecrets(match: Match): asserts match is Match & {
  playToken: string;
  spectateToken: string;
} {
  if (!match.playToken || !match.spectateToken) {
    throw new Error("Match secrets missing");
  }
}

export function extractBearerOrHeader(
  req: Request,
  headerName: string,
): string | null {
  const named = req.headers.get(headerName)?.trim();
  if (named) return named;
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return null;
}

export function extractPlayToken(req: Request): string | null {
  return extractBearerOrHeader(req, "x-play-token");
}

export function extractSpectateToken(
  req: Request,
  url?: URL,
): string | null {
  const header = extractBearerOrHeader(req, "x-spectate-token");
  if (header) return header;
  if (url) {
    const q =
      url.searchParams.get("t") ||
      url.searchParams.get("token") ||
      url.searchParams.get("spectate");
    if (q?.trim()) return q.trim();
  }
  return null;
}

/** Play token may also spectate. */
export function canSpectate(match: Match, token: string | null): boolean {
  if (match.publicSpectate) return true;
  if (!token) return false;
  return (
    tokensMatch(token, match.spectateToken) ||
    tokensMatch(token, match.playToken)
  );
}

export function requirePlayToken(
  match: Match,
  token: string | null,
): boolean {
  return Boolean(token && tokensMatch(token, match.playToken));
}
