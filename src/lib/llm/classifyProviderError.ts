import { ERROR_CODES, type ErrorCode } from "@/lib/api/errors";
import type { ProviderId } from "./providers";

/**
 * Classify MiniMax OpenAI-compatible errors from `base_resp.status_code`,
 * falling back to HTTP status when the body has no usable code.
 */
export function classifyMinimaxError(
  httpStatus: number,
  body: unknown,
): ErrorCode {
  const code = readMinimaxStatusCode(body);
  if (code != null) {
    if (code === 1004 || code === 2049) return ERROR_CODES.authenticationError;
    if (code === 1008) return ERROR_CODES.billingError;
    if (code === 1039 || code === 2056) return ERROR_CODES.quotaExceeded;
    if (code === 1002 || code === 1041 || code === 2045) {
      return ERROR_CODES.rateLimit;
    }
    if (code === 1000 || code === 1001 || code === 1024 || code === 1033) {
      return ERROR_CODES.serverError;
    }
    if (
      code === 1026 ||
      code === 1027 ||
      code === 1042 ||
      code === 1043 ||
      code === 1044 ||
      code === 2013
    ) {
      return ERROR_CODES.modelUnavailable;
    }
    if (code !== 0) return ERROR_CODES.modelUnavailable;
  }
  return classifyHttpProviderError(httpStatus, body);
}

function readMinimaxStatusCode(body: unknown): number | null {
  if (!body || typeof body !== "object") return null;
  const base = (body as { base_resp?: unknown }).base_resp;
  if (!base || typeof base !== "object") return null;
  const raw = (base as { status_code?: unknown }).status_code;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** True when MiniMax returned a non-success business code (even on HTTP 200). */
export function minimaxBusinessFailed(body: unknown): boolean {
  const code = readMinimaxStatusCode(body);
  return code != null && code !== 0;
}

const OPENAI_BILLING_CODES = new Set([
  "credit_balance_exhausted",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "insufficient_quota",
  "billing_not_active",
  "billing_hard_limit_reached",
]);

const OPENAI_QUOTA_CODES = new Set(["organization_usage_limit_exceeded"]);

const OPENAI_RATE_LIMIT_CODES = new Set([
  "rate_limit_exceeded",
  "rate_limit_reached",
]);

/**
 * OpenAI-only mapping (api.openai.com). Order:
 * 401 → auth; 403 → permission; billing codes; quota codes;
 * 429 → rate_limit (fallback); other 4xx → model_unavailable; 5xx → server_error.
 */
export function classifyOpenaiError(
  httpStatus: number,
  body: unknown,
): ErrorCode {
  const { code, type, message } = readOpenaiErrorFields(body);

  if (httpStatus === 401) return ERROR_CODES.authenticationError;
  if (httpStatus === 403) return ERROR_CODES.permissionError;

  if (
    OPENAI_BILLING_CODES.has(code) ||
    OPENAI_BILLING_CODES.has(type) ||
    code === "billing"
  ) {
    return ERROR_CODES.billingError;
  }

  if (OPENAI_QUOTA_CODES.has(code) || OPENAI_QUOTA_CODES.has(type)) {
    return ERROR_CODES.quotaExceeded;
  }

  if (httpStatus === 429) {
    if (
      message.includes("rate limit") ||
      OPENAI_RATE_LIMIT_CODES.has(code) ||
      type === "rate_limit_error" ||
      type.includes("rate_limit")
    ) {
      return ERROR_CODES.rateLimit;
    }
    // Unknown 429: almost always RPM/TPM — do not treat as model_unavailable.
    return ERROR_CODES.rateLimit;
  }

  if (httpStatus >= 500) return ERROR_CODES.serverError;
  if (httpStatus >= 400) return ERROR_CODES.modelUnavailable;
  return ERROR_CODES.modelUnavailable;
}

function readOpenaiErrorFields(body: unknown): {
  code: string;
  type: string;
  message: string;
} {
  if (!body || typeof body !== "object") {
    return { code: "", type: "", message: "" };
  }
  const err = (body as { error?: unknown }).error;
  const o =
    err && typeof err === "object" ? (err as Record<string, unknown>) : null;
  return {
    code: typeof o?.code === "string" ? o.code.toLowerCase() : "",
    type: typeof o?.type === "string" ? o.type.toLowerCase() : "",
    message: typeof o?.message === "string" ? o.message.toLowerCase() : "",
  };
}

const ZHIPU_AUTH_CODES = new Set([
  "1000",
  "1001",
  "1002",
  "1003",
  "1004",
  "1005",
]);
const ZHIPU_BILLING_CODES = new Set(["1113", "1309"]);
const ZHIPU_QUOTA_CODES = new Set(["1308", "1310"]);
const ZHIPU_RATE_LIMIT_CODES = new Set(["1302", "1305", "1313"]);
const ZHIPU_SERVER_CODES = new Set(["500", "1200", "1230", "1234", "1312"]);

/**
 * Zhipu / z.ai mapping: prefer `error.code` (string), then HTTP fallback.
 * Bare 429 with no known code → rate_limit so Play still uses long backoff.
 */
export function classifyZhipuError(
  httpStatus: number,
  body: unknown,
): ErrorCode {
  const code = readZhipuErrorCode(body);

  if (httpStatus === 401 || ZHIPU_AUTH_CODES.has(code)) {
    return ERROR_CODES.authenticationError;
  }
  if (httpStatus === 403 || code === "1220") {
    return ERROR_CODES.permissionError;
  }
  if (ZHIPU_BILLING_CODES.has(code)) return ERROR_CODES.billingError;
  if (ZHIPU_QUOTA_CODES.has(code)) return ERROR_CODES.quotaExceeded;
  if (ZHIPU_RATE_LIMIT_CODES.has(code)) return ERROR_CODES.rateLimit;
  if (ZHIPU_SERVER_CODES.has(code)) return ERROR_CODES.serverError;

  if (httpStatus === 429) return ERROR_CODES.rateLimit;
  if (httpStatus >= 500) return ERROR_CODES.serverError;
  if (httpStatus >= 400) return ERROR_CODES.modelUnavailable;
  return ERROR_CODES.modelUnavailable;
}

function readZhipuErrorCode(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const err = (body as { error?: unknown }).error;
  if (!err || typeof err !== "object") return "";
  const raw = (err as { code?: unknown }).code;
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return "";
}

/**
 * Default mapping for providers without a dedicated table
 * (HTTP + light OpenAI-compatible body hints).
 */
export function classifyHttpProviderError(
  httpStatus: number,
  body?: unknown,
): ErrorCode {
  const bodyHint = classifyFromOpenAiStyleBody(body);

  if (httpStatus === 401) return ERROR_CODES.authenticationError;
  if (httpStatus === 403) {
    return bodyHint === ERROR_CODES.authenticationError
      ? ERROR_CODES.authenticationError
      : ERROR_CODES.permissionError;
  }
  if (httpStatus === 429) {
    if (
      bodyHint === ERROR_CODES.quotaExceeded ||
      bodyHint === ERROR_CODES.billingError
    ) {
      return bodyHint;
    }
    return ERROR_CODES.rateLimit;
  }
  if (httpStatus >= 500) return ERROR_CODES.serverError;
  if (bodyHint === ERROR_CODES.authenticationError) {
    return ERROR_CODES.authenticationError;
  }
  if (httpStatus >= 400) return ERROR_CODES.modelUnavailable;
  return ERROR_CODES.modelUnavailable;
}

function classifyFromOpenAiStyleBody(body: unknown): ErrorCode | null {
  if (body == null) return null;

  const err =
    body && typeof body === "object"
      ? ((body as { error?: unknown }).error ?? body)
      : null;
  const o =
    err && typeof err === "object" ? (err as Record<string, unknown>) : null;
  const code = typeof o?.code === "string" ? o.code.toLowerCase() : "";
  const type = typeof o?.type === "string" ? o.type.toLowerCase() : "";
  const combined = `${code} ${type}`;

  if (
    combined.includes("insufficient_quota") ||
    combined.includes("quota_exceeded")
  ) {
    // Compatible vendors often reuse this string; keep as quota for them.
    return ERROR_CODES.quotaExceeded;
  }
  if (
    combined.includes("billing_not_active") ||
    combined.includes("billing_hard_limit") ||
    code === "billing"
  ) {
    return ERROR_CODES.billingError;
  }
  if (combined.includes("rate_limit") || type === "rate_limit_error") {
    return ERROR_CODES.rateLimit;
  }
  if (
    type === "authentication_error" ||
    code === "invalid_api_key" ||
    combined.includes("invalid_authentication")
  ) {
    return ERROR_CODES.authenticationError;
  }
  if (type === "permission_error") {
    return ERROR_CODES.permissionError;
  }

  return null;
}

/**
 * Anthropic Messages API. Prefer status + `error.type` / `details.error_code`
 * / spend-limit message text. Retry-After does not change the class (both
 * rate-limit branches map to RATE_LIMIT).
 */
export function classifyAnthropicError(
  httpStatus: number,
  body: unknown,
): ErrorCode {
  const { message, detailCode } = readAnthropicErrorFields(body);

  if (httpStatus === 401) return ERROR_CODES.authenticationError;
  if (httpStatus === 403) return ERROR_CODES.permissionError;
  if (httpStatus === 402) return ERROR_CODES.billingError;

  if (
    httpStatus === 429 &&
    detailCode === "enforced_spend_limit_reached"
  ) {
    return ERROR_CODES.billingError;
  }

  if (httpStatus === 400) {
    if (
      message.includes("reached your specified api usage limits") ||
      message.includes("reached your specified workspace api usage limits")
    ) {
      return ERROR_CODES.billingError;
    }
  }

  if (httpStatus === 429) {
    // Including type === "rate_limit_error" and unknown 429 bodies.
    return ERROR_CODES.rateLimit;
  }

  if (httpStatus === 500 || httpStatus === 504 || httpStatus === 529) {
    return ERROR_CODES.serverError;
  }
  if (httpStatus >= 500) return ERROR_CODES.serverError;
  if (httpStatus >= 400) return ERROR_CODES.modelUnavailable;
  return ERROR_CODES.modelUnavailable;
}

function readAnthropicErrorFields(body: unknown): {
  type: string;
  message: string;
  detailCode: string;
} {
  if (!body || typeof body !== "object") {
    return { type: "", message: "", detailCode: "" };
  }
  const err = (body as { error?: unknown }).error;
  const o =
    err && typeof err === "object" ? (err as Record<string, unknown>) : null;
  const details =
    o?.details && typeof o.details === "object"
      ? (o.details as Record<string, unknown>)
      : null;
  const detailRaw = details?.error_code;
  return {
    type: typeof o?.type === "string" ? o.type : "",
    message: typeof o?.message === "string" ? o.message.toLowerCase() : "",
    detailCode:
      typeof detailRaw === "string"
        ? detailRaw
        : typeof detailRaw === "number" && Number.isFinite(detailRaw)
          ? String(detailRaw)
          : "",
  };
}

const GEMINI_BILLING_PATTERNS = [
  "billing",
  "payment",
  "paid",
  "payment required",
  "billing account",
  "billing is disabled",
  "billing must be enabled",
] as const;

const GEMINI_MODEL_UNAVAILABLE = new Set([
  "invalid_request",
  "invalid_argument",
  "parameter_unknown",
  "not_found",
  "model_not_found",
  "already_exists",
  "unimplemented",
]);

const GEMINI_SERVER = new Set([
  "aborted",
  "api_error",
  "service_unavailable",
  "deadline_exceeded",
  "unavailable",
  "internal",
  "unknown",
]);

/**
 * Google Gemini (Generative Language API). Reads string `error.code`,
 * `error.status` (e.g. RESOURCE_EXHAUSTED), and HTTP. Cancelled/499 →
 * model_unavailable so Play does not retry as server_error.
 */
export function classifyGeminiError(
  httpStatus: number,
  body: unknown,
): ErrorCode {
  const { token, message } = readGeminiErrorFields(body);

  if (token === "authentication" || token === "unauthenticated" || httpStatus === 401) {
    return ERROR_CODES.authenticationError;
  }

  if (token === "permission_denied" || httpStatus === 403) {
    return ERROR_CODES.permissionError;
  }

  if (
    token === "failed_precondition" &&
    GEMINI_BILLING_PATTERNS.some((p) => message.includes(p))
  ) {
    return ERROR_CODES.billingError;
  }

  if (httpStatus === 429) {
    if (token === "quota_exceeded") return ERROR_CODES.quotaExceeded;
    // RESOURCE_EXHAUSTED often means daily/free quota; treat as quota when
    // the message clearly says so, otherwise rate_limit (retryable).
    if (
      token === "resource_exhausted" &&
      (message.includes("quota") || message.includes("limit: 0"))
    ) {
      return ERROR_CODES.quotaExceeded;
    }
    if (
      token === "rate_limit_exceeded" ||
      token === "too_many_requests" ||
      token === "resource_exhausted"
    ) {
      return ERROR_CODES.rateLimit;
    }
    return ERROR_CODES.rateLimit;
  }

  if (GEMINI_MODEL_UNAVAILABLE.has(token)) {
    return ERROR_CODES.modelUnavailable;
  }

  if (GEMINI_SERVER.has(token)) {
    return ERROR_CODES.serverError;
  }

  // Client cancel: do not map to server_error (would auto-retry).
  if (token === "cancelled" || httpStatus === 499) {
    return ERROR_CODES.modelUnavailable;
  }

  if (httpStatus >= 500) return ERROR_CODES.serverError;
  if (httpStatus >= 400) return ERROR_CODES.modelUnavailable;
  return ERROR_CODES.modelUnavailable;
}

function readGeminiErrorFields(body: unknown): {
  token: string;
  message: string;
} {
  if (!body || typeof body !== "object") {
    return { token: "", message: "" };
  }
  const err = (body as { error?: unknown }).error;
  const o =
    err && typeof err === "object" ? (err as Record<string, unknown>) : null;
  const message =
    typeof o?.message === "string" ? o.message.toLowerCase() : "";

  // Prefer string reason codes; Google REST often puts the enum in `status`.
  let token = "";
  if (typeof o?.status === "string" && o.status.trim()) {
    token = o.status.trim().toLowerCase();
  } else if (typeof o?.code === "string" && o.code.trim()) {
    token = o.code.trim().toLowerCase();
  }
  // Numeric `code` is usually the HTTP status — ignore for token matching.

  return { token, message };
}

const MISTRAL_BILLING_CODES = new Set([
  "billing_error",
  "payment_required",
  "payment_failed",
  "spending_limit_reached",
  "monthly_spending_limit_reached",
  "workspace_spending_limit_reached",
  "organization_spending_limit_reached",
]);

const MISTRAL_QUOTA_CODES = new Set([
  "quota_exceeded",
  "monthly_quota_exceeded",
  "monthly_usage_limit_reached",
  "tokens_per_month_exceeded",
  "monthly_token_limit_reached",
  "consumption_cap_reached",
]);

const MISTRAL_BILLING_PATTERNS = [
  "payment required",
  "payment failed",
  "payment method",
  "billing",
  "spending limit",
  "monthly spending limit",
  "workspace spending limit",
  "organization spending limit",
  "spend limit",
  "monthly budget",
] as const;

const MISTRAL_QUOTA_PATTERNS = [
  "tokens per month",
  "token per month",
  "tokens-per-month",
  "monthly token",
  "monthly usage",
  "monthly quota",
  "usage cap",
  "consumption cap",
  "monthly consumption",
  "monthly limit",
  "quota exceeded",
  "quota has been exceeded",
] as const;

const MISTRAL_RATE_LIMIT_PATTERNS = [
  "rate limit",
  "too many requests",
  "requests per second",
  "rps",
  "tokens per minute",
  "token per minute",
  "tokens-per-minute",
  "tpm",
  "throughput",
] as const;

function messageHasAny(message: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => message.includes(p));
}

/**
 * Mistral API. On 429, check billing/quota (code + message) before rate_limit.
 * Unknown 429 → rate_limit.
 */
export function classifyMistralError(
  httpStatus: number,
  body: unknown,
): ErrorCode {
  const { code, message } = readMistralErrorFields(body);

  if (httpStatus === 401) return ERROR_CODES.authenticationError;
  if (httpStatus === 403) return ERROR_CODES.permissionError;
  if (httpStatus === 402) return ERROR_CODES.billingError;

  if (httpStatus === 429) {
    if (MISTRAL_BILLING_CODES.has(code)) return ERROR_CODES.billingError;
    if (MISTRAL_QUOTA_CODES.has(code)) return ERROR_CODES.quotaExceeded;
    if (messageHasAny(message, MISTRAL_BILLING_PATTERNS)) {
      return ERROR_CODES.billingError;
    }
    if (messageHasAny(message, MISTRAL_QUOTA_PATTERNS)) {
      return ERROR_CODES.quotaExceeded;
    }
    if (messageHasAny(message, MISTRAL_RATE_LIMIT_PATTERNS)) {
      return ERROR_CODES.rateLimit;
    }
    return ERROR_CODES.rateLimit;
  }

  if (httpStatus === 404 || httpStatus === 422) {
    return ERROR_CODES.modelUnavailable;
  }
  if (
    httpStatus === 500 ||
    httpStatus === 502 ||
    httpStatus === 503 ||
    httpStatus === 504
  ) {
    return ERROR_CODES.serverError;
  }
  if (httpStatus >= 500) return ERROR_CODES.serverError;
  if (httpStatus >= 400) return ERROR_CODES.modelUnavailable;
  return ERROR_CODES.modelUnavailable;
}

function readMistralErrorFields(body: unknown): {
  code: string;
  message: string;
} {
  if (!body || typeof body !== "object") {
    return { code: "", message: "" };
  }
  const root = body as Record<string, unknown>;
  const err = root.error;
  const o =
    err && typeof err === "object" ? (err as Record<string, unknown>) : null;
  const raw = o?.code ?? root.code;
  let code = "";
  if (typeof raw === "string") code = raw.trim().toLowerCase();
  else if (typeof raw === "number" && Number.isFinite(raw)) code = String(raw);
  return {
    code,
    message: typeof o?.message === "string" ? o.message.toLowerCase() : "",
  };
}

/**
 * DeepSeek / Meta: HTTP-status-only mapping (no body inspection).
 * 401 auth · 403 permission · 402 billing · 429 rate_limit ·
 * other 4xx model_unavailable · 5xx server_error.
 */
export function classifyDeepseekMetaError(httpStatus: number): ErrorCode {
  if (httpStatus === 401) return ERROR_CODES.authenticationError;
  if (httpStatus === 403) return ERROR_CODES.permissionError;
  if (httpStatus === 402) return ERROR_CODES.billingError;
  if (httpStatus === 429) return ERROR_CODES.rateLimit;
  if (httpStatus >= 500) return ERROR_CODES.serverError;
  if (httpStatus >= 400) return ERROR_CODES.modelUnavailable;
  return ERROR_CODES.modelUnavailable;
}

/**
 * xAI: HTTP-status-only. No billing/quota split — all 429 → rate_limit.
 */
export function classifyXaiError(httpStatus: number): ErrorCode {
  if (httpStatus === 401) return ERROR_CODES.authenticationError;
  if (httpStatus === 403) return ERROR_CODES.permissionError;
  if (httpStatus === 429) return ERROR_CODES.rateLimit;
  if (
    httpStatus === 400 ||
    httpStatus === 404 ||
    httpStatus === 405 ||
    httpStatus === 415 ||
    httpStatus === 422
  ) {
    return ERROR_CODES.modelUnavailable;
  }
  if (httpStatus >= 500) return ERROR_CODES.serverError;
  if (httpStatus >= 400) return ERROR_CODES.modelUnavailable;
  return ERROR_CODES.modelUnavailable;
}

/**
 * Moonshot / Kimi: prefer `error.type` on 429
 * (quota vs overload vs rate_limit).
 */
export function classifyMoonshotError(
  httpStatus: number,
  body: unknown,
): ErrorCode {
  const errorType = readMoonshotErrorType(body);

  if (httpStatus === 401) return ERROR_CODES.authenticationError;
  if (httpStatus === 403) return ERROR_CODES.permissionError;

  if (httpStatus === 429) {
    if (errorType === "exceeded_current_quota_error") {
      return ERROR_CODES.quotaExceeded;
    }
    if (errorType === "engine_overloaded_error") {
      return ERROR_CODES.serverError;
    }
    if (errorType === "rate_limit_reached_error") {
      return ERROR_CODES.rateLimit;
    }
    return ERROR_CODES.rateLimit;
  }

  if (httpStatus === 404) return ERROR_CODES.modelUnavailable;
  if (httpStatus >= 500) return ERROR_CODES.serverError;
  if (httpStatus >= 400) return ERROR_CODES.modelUnavailable;
  return ERROR_CODES.modelUnavailable;
}

function readMoonshotErrorType(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const err = (body as { error?: unknown }).error;
  if (!err || typeof err !== "object") return "";
  const type = (err as { type?: unknown }).type;
  return typeof type === "string" ? type.trim().toLowerCase() : "";
}

const ALIBABA_RATE_QUOTA_CODES = new Set([
  "Throttling.RateQuota",
  "limit_requests",
  "limit_request",
]);

const ALIBABA_BURST_CODES = new Set([
  "Throttling.BurstRate",
  "limit_burst_rate",
]);

const ALIBABA_ALLOCATION_CODES = new Set([
  "Throttling.AllocationQuota",
  "insufficient_quota",
]);

const ALIBABA_BILLING_CODES = new Set([
  "Arrearage",
  "isv.OUT_OF_SERVICE",
  "CommodityNotPurchased",
  "PrepaidBillOverdue",
  "PostpaidBillOverdue",
]);

/**
 * Alibaba Qwen / DashScope compatible-mode. Prefer `error.code` (preserve
 * casing for Throttling.* / Arrearage). Free quota via 429 message text.
 */
export function classifyAlibabaError(
  httpStatus: number,
  body: unknown,
): ErrorCode {
  const { code, message } = readAlibabaErrorFields(body);

  if (httpStatus === 401) return ERROR_CODES.authenticationError;
  if (httpStatus === 403) return ERROR_CODES.permissionError;

  if (ALIBABA_BILLING_CODES.has(code)) return ERROR_CODES.billingError;

  if (
    httpStatus === 429 &&
    message.includes("free allocated quota exceeded")
  ) {
    return ERROR_CODES.quotaExceeded;
  }

  if (
    ALIBABA_RATE_QUOTA_CODES.has(code) ||
    ALIBABA_BURST_CODES.has(code) ||
    ALIBABA_ALLOCATION_CODES.has(code)
  ) {
    return ERROR_CODES.rateLimit;
  }

  if (httpStatus === 429) return ERROR_CODES.rateLimit;
  if (httpStatus >= 500) return ERROR_CODES.serverError;
  if (httpStatus >= 400) return ERROR_CODES.modelUnavailable;
  return ERROR_CODES.modelUnavailable;
}

function readAlibabaErrorFields(body: unknown): {
  code: string;
  message: string;
} {
  if (!body || typeof body !== "object") {
    return { code: "", message: "" };
  }
  const root = body as Record<string, unknown>;
  const err = root.error;
  const o =
    err && typeof err === "object" ? (err as Record<string, unknown>) : null;
  const raw = o?.code ?? o?.type ?? root.code;
  let code = "";
  if (typeof raw === "string") code = raw.trim();
  else if (typeof raw === "number" && Number.isFinite(raw)) code = String(raw);
  const message =
    typeof o?.message === "string"
      ? o.message.toLowerCase()
      : typeof root.message === "string"
        ? root.message.toLowerCase()
        : "";
  return { code, message };
}

export function classifyProviderError(
  providerId: ProviderId,
  httpStatus: number,
  body: unknown,
): ErrorCode {
  if (providerId === "minimax") return classifyMinimaxError(httpStatus, body);
  if (providerId === "openai") return classifyOpenaiError(httpStatus, body);
  if (providerId === "zhipu") return classifyZhipuError(httpStatus, body);
  if (providerId === "anthropic") {
    return classifyAnthropicError(httpStatus, body);
  }
  if (providerId === "google") return classifyGeminiError(httpStatus, body);
  if (providerId === "mistral") return classifyMistralError(httpStatus, body);
  if (providerId === "deepseek" || providerId === "meta") {
    return classifyDeepseekMetaError(httpStatus);
  }
  if (providerId === "xai") return classifyXaiError(httpStatus);
  if (providerId === "moonshot") {
    return classifyMoonshotError(httpStatus, body);
  }
  if (providerId === "alibaba") return classifyAlibabaError(httpStatus, body);
  return classifyHttpProviderError(httpStatus, body);
}

export function tryParseJsonBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
