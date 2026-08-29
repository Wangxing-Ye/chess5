export type ProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "meta"
  | "mistral"
  | "deepseek"
  | "alibaba"
  | "zhipu"
  | "minimax"
  | "moonshot";

export type ProviderConfig = {
  id: ProviderId;
  name: string;
  defaultModel: string;
  models: string[];
  baseUrl: string;
  style: "openai" | "anthropic" | "google";
  /** Console page where the user creates or manages API keys. */
  keysUrl: string;
};

export const PROVIDERS: ProviderConfig[] = [
  {
    id: "openai",
    name: "OpenAI",
    defaultModel: "gpt-5.6-terra",
    models: ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna"],
    baseUrl: "https://api.openai.com/v1",
    style: "openai",
    keysUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    defaultModel: "claude-fable-5",
    models: ["claude-fable-5", "claude-opus-5", "claude-sonnet-5"],
    baseUrl: "https://api.anthropic.com/v1",
    style: "anthropic",
    keysUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "google",
    name: "Google",
    defaultModel: "gemini-3.6-flash",
    models: [
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
    ],
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    style: "google",
    keysUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "xai",
    name: "xAI",
    defaultModel: "grok-4.6",
    models: ["grok-4.6", "grok-4.5"],
    baseUrl: "https://api.x.ai/v1",
    style: "openai",
    keysUrl: "https://console.x.ai/",
  },
  {
    id: "meta",
    name: "Meta",
    defaultModel: "muse-spark-1.2",
    models: ["muse-spark-1.2", "muse-spark-1.1"],
    baseUrl: "https://api.meta.ai/v1",
    style: "openai",
    keysUrl: "https://dev.meta.ai/",
  },
  {
    id: "mistral",
    name: "Mistral",
    defaultModel: "mistral-large-latest",
    models: [
      "mistral-large-latest",
      "mistral-medium-latest",
      "mistral-small-latest",
    ],
    baseUrl: "https://api.mistral.ai/v1",
    style: "openai",
    keysUrl: "https://console.mistral.ai/api-keys",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    defaultModel: "deepseek-v4-pro",
    models: ["deepseek-v4-pro", "deepseek-v4-flash"],
    baseUrl: "https://api.deepseek.com",
    style: "openai",
    keysUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "alibaba",
    name: "Alibaba",
    defaultModel: "qwen3.8-max",
    models: ["qwen3.8-max", "qwen3.7-max", "qwen3.7-plus"],
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    style: "openai",
    keysUrl: "https://qwen.ai/apiplatform",
  },
  {
    id: "zhipu",
    name: "Zhipu",
    defaultModel: "glm-5.3",
    models: ["glm-5.3", "glm-5.2", "glm-5.1"],
    baseUrl: "https://api.z.ai/api/paas/v4",
    style: "openai",
    keysUrl: "https://z.ai/model-api",
  },
  {
    id: "minimax",
    name: "MiniMax",
    defaultModel: "MiniMax-M3",
    models: ["MiniMax-M3", "MiniMax-M2.7"],
    baseUrl: "https://api.minimax.io/v1",
    style: "openai",
    keysUrl:
      "https://platform.minimax.io/user-center/basic-information/interface-key",
  },
  {
    id: "moonshot",
    name: "Moonshot",
    defaultModel: "kimi-k3",
    models: ["kimi-k3"],
    baseUrl: "https://api.moonshot.ai/v1",
    style: "openai",
    keysUrl: "https://platform.kimi.ai/",
  },
];

export function getProvider(id: ProviderId): ProviderConfig {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return p;
}
