export const AI_PROVIDER_IDS = ["openai", "anthropic", "gemini", "openrouter", "custom"] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

/** Where an effective AI setting value comes from. */
export type AiSettingSource = "database" | "env" | "default" | "none";

export interface AiProviderInfo {
  id: AiProviderId;
  label: string;
  /** Environment variable read for this provider's API key. */
  envKeyName: string;
  defaultModel: string | null;
  defaultBaseUrl: string;
  requiresApiKey: boolean;
  /** Whether the base URL is meaningful for the user (custom endpoints). */
  supportsBaseUrl: boolean;
  hasEnvKey: boolean;
  hasStoredKey: boolean;
  storedModel: string | null;
  storedBaseUrl: string | null;
}

export interface AiSettingsSummary {
  /** True when the active provider has everything it needs to answer requests. */
  enabled: boolean;
  provider: { value: AiProviderId; source: AiSettingSource };
  apiKey: { configured: boolean; masked: string | null; source: AiSettingSource };
  model: { value: string | null; source: AiSettingSource };
  baseUrl: { value: string; source: AiSettingSource };
  providers: AiProviderInfo[];
}

export interface AiSettingsUpdate {
  provider?: AiProviderId;
  /** Omit to keep the stored key, empty string to remove the override. */
  apiKey?: string;
  /** Empty string removes the override. */
  model?: string;
  /** Empty string removes the override. */
  baseUrl?: string;
}

export interface AiConnectionTest {
  ok: true;
  provider: AiProviderId;
  model: string;
  latencyMs: number;
  reply: string;
}
