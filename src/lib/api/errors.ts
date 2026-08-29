/**
 * Machine-readable failure reasons shared by the API routes and the browser.
 *
 * Site rate limits stay as `rate_limited`. Provider failures use the seven
 * classes below so Play UI can choose retry vs fix-key vs billing copy.
 */
export const ERROR_CODES = {
  /** This app's own RPM / concurrency gates. */
  rateLimited: "rate_limited",
  /** Upstream provider RPM / growth limits. */
  rateLimit: "rate_limit",
  billingError: "billing_error",
  quotaExceeded: "quota_exceeded",
  authenticationError: "authentication_error",
  permissionError: "permission_error",
  modelUnavailable: "model_unavailable",
  /** Upstream 5xx, transport/network failures, etc. */
  serverError: "server_error",
  /** Live match evicted; SQLite still has an ended record for Replay. */
  matchFinished: "match_finished",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Shape of every non-2xx JSON body the API returns. */
export type ApiErrorBody = { error?: string; code?: ErrorCode };

/**
 * @returns a key in the `apiErrors` message namespace, or null when the
 * server's own text is more useful than anything we could translate — bad
 * request bodies and unknown models are developer-facing, not user-facing.
 */
export function apiErrorKey(status: number, code?: string): string | null {
  switch (code) {
    case ERROR_CODES.rateLimited:
      return "rateLimited";
    case ERROR_CODES.rateLimit:
      return "rateLimit";
    case ERROR_CODES.billingError:
      return "billingError";
    case ERROR_CODES.quotaExceeded:
      return "quotaExceeded";
    case ERROR_CODES.authenticationError:
      return "authenticationError";
    case ERROR_CODES.permissionError:
      return "permissionError";
    case ERROR_CODES.modelUnavailable:
      return "modelUnavailable";
    case ERROR_CODES.serverError:
      return "serverError";
    case ERROR_CODES.matchFinished:
      return "matchFinished";
  }
  if (status === 429) return "rateLimited";
  if (status === 401 || status === 403) return "forbidden";
  if (status === 404) return "matchGone";
  if (status >= 500) return "serverError";
  return null;
}

const NO_RETRY = new Set<string>([
  ERROR_CODES.authenticationError,
  ERROR_CODES.permissionError,
  ERROR_CODES.billingError,
  ERROR_CODES.quotaExceeded,
  ERROR_CODES.modelUnavailable,
]);

/**
 * Only rate-limit and server_error classes retry. Auth / billing / quota /
 * permission / model_unavailable never do — even when wrapped in a 502.
 */
export function isRetryable(status: number, code?: string): boolean {
  if (code) {
    if (NO_RETRY.has(code)) return false;
    return (
      code === ERROR_CODES.rateLimit ||
      code === ERROR_CODES.rateLimited ||
      code === ERROR_CODES.serverError
    );
  }
  // Missing code: treat bare 429 / 5xx like rate-limit / server_error.
  return status === 429 || status >= 500;
}

/** RPM-style limits need a longer client backoff than 5xx blips. */
export function isRateLimitFailure(status: number, code?: string): boolean {
  return (
    status === 429 ||
    code === ERROR_CODES.rateLimited ||
    code === ERROR_CODES.rateLimit
  );
}
