import type { ProviderId } from "@/lib/llm/providers";

/** Arena Reasoning control (Off / Low / Medium / High). */
export type ReasoningLevel = "off" | "low" | "medium" | "high";

export const REASONING_LEVELS: ReasoningLevel[] = [
  "off",
  "low",
  "medium",
  "high",
];

export function isReasoningLevel(value: unknown): value is ReasoningLevel {
  return (
    value === "off" ||
    value === "low" ||
    value === "medium" ||
    value === "high"
  );
}

/**
 * Normalize create-match / legacy payloads.
 * Legacy `reasoning: true` → high; `false` / missing → off.
 */
export function parseReasoningLevel(value: unknown): ReasoningLevel {
  if (isReasoningLevel(value)) return value;
  if (value === true) return "high";
  return "off";
}

export function reasoningIsOn(level: ReasoningLevel): boolean {
  return level !== "off";
}

/**
 * True when Arena Off can map to a real disable / none / thinking-off knob.
 * Meta, xAI, Moonshot, Gemini, Fable, MiniMax M2, Mistral, GLM-5.3,
 * GPT-6 Astra cannot fully turn off.
 */
export function supportsReasoningOff(
  providerId: ProviderId,
  model: string,
): boolean {
  switch (providerId) {
    case "openai":
      // GPT-6 Astra rejects reasoning_effort none; Off is not available.
      return !openaiAlwaysThinking(model);
    case "deepseek":
    case "alibaba":
      return true;
    case "zhipu":
      // GLM-5.3 always thinks; Off is rejected by the API.
      return !zhipuAlwaysThinking(model);
    case "minimax":
      // M3 can disable; M2.x ignores disabled.
      return !/m2/i.test(model);
    case "anthropic":
      // Fable cannot disable thinking; Opus / Sonnet can.
      return !/fable/i.test(model);
    case "meta":
    case "xai":
    case "moonshot":
    case "google":
    case "mistral":
      return false;
    default:
      return false;
  }
}

/** Zhipu GLM-5.3 rejects thinking.disabled; effort must be low | high | max. */
function zhipuAlwaysThinking(model: string): boolean {
  return /glm-5\.3/i.test(model);
}

/** OpenAI GPT-6 Astra cannot set reasoning_effort to none. */
function openaiAlwaysThinking(model: string): boolean {
  return /gpt-6-astra/i.test(model);
}

/** GLM-5.2+ accept reasoning_effort low | high | max when thinking is on. */
function zhipuHasEffortGrades(model: string): boolean {
  return /glm-5\.[23]/i.test(model);
}


/**
 * Completion token budget by Arena Reasoning level.
 * Off is omitted for most OpenAI-style APIs (vendor default); Anthropic Off uses
 * {@link ANTHROPIC_OFF_MAX_TOKENS}. Always-on providers (Meta / xAI / Moonshot)
 * map Off → Low budget.
 */
export const ANTHROPIC_OFF_MAX_TOKENS = 1_024;

export function maxTokensForReasoningLevel(
  level: Exclude<ReasoningLevel, "off">,
): number {
  switch (level) {
    case "low":
      return 8_192;
    case "medium":
      return 16_384;
    case "high":
      return 32_768;
  }
}

/** Budget when the provider still thinks at Arena Off (cannot fully disable). */
function alwaysOnOffBudget(): number {
  return maxTokensForReasoningLevel("low");
}

function setCompletionBudget(
  body: Record<string, unknown>,
  level: ReasoningLevel,
  field: "max_completion_tokens" | "max_tokens" = "max_completion_tokens",
): void {
  if (level === "off") return;
  body[field] = maxTokensForReasoningLevel(level);
}

/** OpenAI-compatible Chat Completions body knobs. */
export function applyOpenAiStyleReasoning(
  body: Record<string, unknown>,
  providerId: ProviderId,
  level: ReasoningLevel,
  model: string,
): void {
  const on = reasoningIsOn(level);

  switch (providerId) {
    case "openai": {
      // Astra cannot disable; Off → low (Arena hides Astra when Off).
      if (openaiAlwaysThinking(model) && level === "off") {
        body.reasoning_effort = "low";
        body.max_completion_tokens = alwaysOnOffBudget();
        break;
      }
      body.reasoning_effort =
        level === "off"
          ? "none"
          : level === "low"
            ? "low"
            : level === "medium"
              ? "medium"
              : "high";
      setCompletionBudget(body, level);
      break;
    }

    case "mistral":
      // No reasoning_effort / thinking switch on large|medium|small-latest.
      break;

    case "meta": {
      // Cannot disable; Off → minimal + Low token budget.
      body.reasoning_effort =
        level === "off"
          ? "minimal"
          : level === "low"
            ? "low"
            : level === "medium"
              ? "medium"
              : "high";
      body.max_completion_tokens =
        level === "off"
          ? alwaysOnOffBudget()
          : maxTokensForReasoningLevel(level);
      break;
    }

    case "xai": {
      // Cannot disable; Off → low.
      body.reasoning_effort =
        level === "off" || level === "low"
          ? "low"
          : level === "medium"
            ? "medium"
            : "high";
      body.max_completion_tokens =
        level === "off"
          ? alwaysOnOffBudget()
          : maxTokensForReasoningLevel(level);
      break;
    }

    case "moonshot": {
      // low | high | max; cannot disable. Off/Low → low; Medium → high; High → max.
      body.reasoning_effort =
        level === "off" || level === "low"
          ? "low"
          : level === "medium"
            ? "high"
            : "max";
      body.max_completion_tokens =
        level === "off"
          ? alwaysOnOffBudget()
          : maxTokensForReasoningLevel(level);
      break;
    }

    case "deepseek": {
      if (!on) {
        body.thinking = { type: "disabled" };
        break;
      }
      body.thinking = { type: "enabled" };
      body.reasoning_effort =
        level === "low" ? "low" : level === "medium" ? "high" : "max";
      setCompletionBudget(body, level);
      break;
    }

    case "alibaba": {
      // DashScope requires max_completion_tokens > thinking_budget (strict).
      if (!on) {
        body.enable_thinking = false;
        break;
      }
      body.enable_thinking = true;
      if (level === "low") {
        body.thinking_budget = 8_192;
        body.max_completion_tokens = 16_384;
      } else if (level === "medium") {
        body.thinking_budget = 16_384;
        body.max_completion_tokens = 32_768 + 16_384;
      } else {
        body.thinking_budget = 32_768;
        body.max_completion_tokens = 32_768 + 32_768;
      }
      break;
    }

    case "zhipu": {
      const alwaysOn = zhipuAlwaysThinking(model);
      if (!on && !alwaysOn) {
        body.thinking = { type: "disabled" };
        break;
      }
      body.thinking = { type: "enabled" };
      // GLM-5.2+ / always-on 5.3: effort is low | high | max only.
      if (alwaysOn || zhipuHasEffortGrades(model)) {
        body.reasoning_effort =
          level === "off" || level === "low"
            ? "low"
            : level === "medium"
              ? "high"
              : "max";
      }
      body.max_completion_tokens =
        level === "off"
          ? alwaysOnOffBudget()
          : maxTokensForReasoningLevel(level);
      break;
    }

    case "minimax": {
      const isM2 = /m2/i.test(model);
      if (isM2) {
        // Always on; disabled is accepted but ignored.
        body.thinking = { type: "enabled" };
        if (on) setCompletionBudget(body, level);
        break;
      }
      // M3: enabled | adaptive | disabled
      body.thinking = {
        type: on ? (level === "high" ? "enabled" : "adaptive") : "disabled",
      };
      if (on) setCompletionBudget(body, level);
      break;
    }

    default:
      if (on) {
        body.reasoning_effort =
          level === "low" ? "low" : level === "medium" ? "medium" : "high";
        setCompletionBudget(body, level);
      }
      break;
  }
}

/** Anthropic Messages API knobs. */
export function applyAnthropicReasoning(
  body: Record<string, unknown>,
  level: ReasoningLevel,
  model: string,
): void {
  const isFable = /fable/i.test(model);
  const effort =
    level === "off" || level === "low"
      ? "low"
      : level === "medium"
        ? "medium"
        : "high";

  if (isFable) {
    body.max_tokens =
      level === "off"
        ? ANTHROPIC_OFF_MAX_TOKENS
        : maxTokensForReasoningLevel(level);
    body.output_config = { effort };
    return;
  }

  if (level === "off") {
    body.max_tokens = ANTHROPIC_OFF_MAX_TOKENS;
    body.thinking = { type: "disabled" };
    return;
  }

  body.max_tokens = maxTokensForReasoningLevel(level);
  body.thinking = { type: "adaptive" };
  body.output_config = { effort };
}

/** Gemini 3.8+ rejects thinkingLevel MINIMAL; Off falls back to LOW. */
function geminiSupportsMinimalThinking(model: string): boolean {
  return !/gemini-3\.8/i.test(model);
}

/** Google Gemini generateContent knobs. */
export function applyGeminiReasoning(
  generationConfig: Record<string, unknown>,
  level: ReasoningLevel,
  model: string,
): void {
  // Cannot disable; Off → MINIMAL when supported, else LOW.
  const thinkingLevel =
    level === "off"
      ? geminiSupportsMinimalThinking(model)
        ? "MINIMAL"
        : "LOW"
      : level === "low"
        ? "LOW"
        : level === "medium"
          ? "MEDIUM"
          : "HIGH";
  generationConfig.thinkingConfig = { thinkingLevel };
}

/** Optional prompt nudge when API has no reasoning knobs (e.g. Mistral). */
export function reasoningPromptHint(level: ReasoningLevel): string | null {
  if (level === "off") return null;
  if (level === "low") {
    return "Briefly consider the main threat and reply with the JSON move.";
  }
  if (level === "medium") {
    return "Think step by step about tactics, then reply with the JSON move only.";
  }
  return "Analyze the position carefully (threats, tactics, plan), then reply with the JSON move only.";
}
