/** Simple in-memory sliding-window rate limiter (per process). */

import { ERROR_CODES } from "@/lib/api/errors";

type Entry = { hits: number[]; expiresAt: number };

const buckets = new Map<string, Entry>();

/** Safety valve so forged client identities cannot grow the map without bound. */
const MAX_BUCKETS = 20_000;
const SWEEP_INTERVAL_MS = 60_000;
let lastSweep = 0;

/**
 * Forwarded headers are attacker-controlled unless a reverse proxy we own
 * rewrites them, so they are only honoured when the deployment opts in.
 */
const TRUST_PROXY_HEADERS = /^(1|true|yes|on)$/i.test(
  process.env.TRUST_PROXY_HEADERS ?? "",
);
/** How many proxies append to `x-forwarded-for` between the client and us. */
const TRUSTED_PROXY_HOPS = Math.max(
  1,
  Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "1", 10) || 1,
);
/** Bucket used when no trustworthy client identity is available. */
const SHARED_BUCKET = "shared";

function sweep(now: number): void {
  for (const [key, entry] of buckets) {
    if (entry.expiresAt <= now) buckets.delete(key);
  }
  lastSweep = now;
}

/**
 * @returns true if the request is allowed
 */
export function allowRequest(
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  if (now - lastSweep > SWEEP_INTERVAL_MS) sweep(now);

  const cutoff = now - windowMs;
  const prev = buckets.get(key);
  const recent = prev ? prev.hits.filter((t) => t > cutoff) : [];

  // Re-inserting moves the key to the end, making iteration order recency
  // order so the overflow eviction below drops the least recently used keys.
  buckets.delete(key);

  if (recent.length >= limit) {
    buckets.set(key, { hits: recent, expiresAt: now + windowMs });
    return false;
  }
  recent.push(now);
  buckets.set(key, { hits: recent, expiresAt: now + windowMs });

  if (buckets.size > MAX_BUCKETS) {
    sweep(now);
    for (const oldest of buckets.keys()) {
      if (buckets.size <= MAX_BUCKETS) break;
      if (oldest !== key) buckets.delete(oldest);
    }
  }
  return true;
}

export function clientIp(req: Request): string {
  if (!TRUST_PROXY_HEADERS) return SHARED_BUCKET;

  const chain = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (chain.length > 0) {
    // Only the right-most entries were appended by proxies we control;
    // anything further left may have been forged by the client.
    return chain[Math.max(0, chain.length - TRUSTED_PROXY_HOPS)];
  }

  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return SHARED_BUCKET;
}

export type RateLimitRule = {
  /** Requests allowed per window for a single client. */
  limit: number;
  windowMs: number;
  /**
   * Requests allowed per window across all clients. Caps abuse even when the
   * per-client identity is forged or unavailable.
   */
  globalLimit?: number;
};

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

/**
 * Limits against an arbitrary subject rather than the caller's IP. Prefer this
 * when a request carries an authenticated identifier (such as a match id): it
 * cannot be forged, and it does not collapse into one bucket when forwarded
 * headers are untrusted.
 */
export function enforceRateLimitBy(
  subject: string,
  name: string,
  rule: RateLimitRule,
): RateLimitResult {
  const retryAfterSeconds = Math.max(1, Math.ceil(rule.windowMs / 1000));

  // Per-subject first, so a single noisy caller is rejected by its own bucket
  // before it can consume the shared allowance.
  if (!allowRequest(`${name}:${subject}`, rule.limit, rule.windowMs)) {
    return { allowed: false, retryAfterSeconds };
  }
  if (
    rule.globalLimit !== undefined &&
    !allowRequest(`${name}:*`, rule.globalLimit, rule.windowMs)
  ) {
    return { allowed: false, retryAfterSeconds };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function enforceRateLimit(
  req: Request,
  name: string,
  rule: RateLimitRule,
): RateLimitResult {
  return enforceRateLimitBy(clientIp(req), name, rule);
}

export function tooManyRequests(retryAfterSeconds: number): Response {
  return Response.json(
    {
      // The text is a fallback for direct API callers; browsers translate the
      // code instead, since this string cannot follow the user's locale.
      error: "Rate limit exceeded. Try again shortly.",
      code: ERROR_CODES.rateLimited,
    },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}
