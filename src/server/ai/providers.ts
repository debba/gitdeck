import type { AiProviderId } from "../../types/ai";

export type AiWireFormat = "openai-chat" | "anthropic-messages" | "gemini-generate";

export interface AiProviderDefinition {
  id: AiProviderId;
  label: string;
  wire: AiWireFormat;
  /** Environment variables checked, in order, for this provider's API key. */
  envKeyNames: string[];
  /** Environment variables checked, in order, for this provider's model. */
  envModelNames: string[];
  defaultModel: string | null;
  defaultBaseUrl: string;
  requiresApiKey: boolean;
  supportsBaseUrl: boolean;
}

export const AI_PROVIDERS: Record<AiProviderId, AiProviderDefinition> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    wire: "openai-chat",
    envKeyNames: ["OPENAI_API_KEY"],
    // OPENAI_DIGEST_MODEL is the pre-multi-provider name, still honoured.
    envModelNames: ["OPENAI_MODEL", "OPENAI_DIGEST_MODEL"],
    defaultModel: "gpt-4.1-mini",
    defaultBaseUrl: "https://api.openai.com/v1",
    requiresApiKey: true,
    supportsBaseUrl: false,
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    wire: "anthropic-messages",
    envKeyNames: ["ANTHROPIC_API_KEY"],
    envModelNames: ["ANTHROPIC_MODEL"],
    defaultModel: "claude-sonnet-5",
    defaultBaseUrl: "https://api.anthropic.com",
    requiresApiKey: true,
    supportsBaseUrl: false,
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    wire: "gemini-generate",
    envKeyNames: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    envModelNames: ["GEMINI_MODEL"],
    defaultModel: "gemini-2.5-flash",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    requiresApiKey: true,
    supportsBaseUrl: false,
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    wire: "openai-chat",
    envKeyNames: ["OPENROUTER_API_KEY"],
    envModelNames: ["OPENROUTER_MODEL"],
    defaultModel: "openai/gpt-4.1-mini",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    requiresApiKey: true,
    supportsBaseUrl: false,
  },
  custom: {
    id: "custom",
    label: "OpenAI-compatible",
    wire: "openai-chat",
    envKeyNames: [],
    envModelNames: [],
    defaultModel: null,
    defaultBaseUrl: "http://localhost:11434/v1",
    requiresApiKey: false,
    supportsBaseUrl: true,
  },
};

/** Order used to auto-detect the provider when `AI_PROVIDER` is not set. */
export const AI_PROVIDER_ORDER: AiProviderId[] = ["openai", "anthropic", "gemini", "openrouter", "custom"];

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === "string" && value in AI_PROVIDERS;
}
