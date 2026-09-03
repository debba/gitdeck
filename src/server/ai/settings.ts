import type { AiProviderId, AiProviderInfo, AiSettingSource, AiSettingsSummary, AiSettingsUpdate } from "../../types/ai";
import { deletePreference, getPreference, setPreference } from "../preferenceStore";
import { AI_PROVIDER_ORDER, AI_PROVIDERS, isAiProviderId, type AiProviderDefinition } from "./providers";

const SCOPE = "ai";
const PROVIDER_KEY = "provider";

interface StoredProviderOverrides {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

/** Fully resolved configuration used to talk to a provider. */
export interface ResolvedAiConfig {
  provider: AiProviderDefinition;
  providerSource: AiSettingSource;
  apiKey: string | null;
  apiKeySource: AiSettingSource;
  model: string | null;
  modelSource: AiSettingSource;
  baseUrl: string;
  baseUrlSource: AiSettingSource;
}

function providerKey(id: AiProviderId): string {
  return `provider:${id}`;
}

function readStored(id: AiProviderId): StoredProviderOverrides {
  const stored = getPreference<StoredProviderOverrides | null>(SCOPE, providerKey(id), null);
  return stored && typeof stored === "object" ? stored : {};
}

function envValue(names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

function envApiKey(provider: AiProviderDefinition, explicit: boolean): string | null {
  // AI_API_KEY is a generic key that only applies to the provider selected via
  // AI_PROVIDER, otherwise it would be ambiguous which service it belongs to.
  return envValue(provider.envKeyNames) ?? (explicit ? envValue(["AI_API_KEY"]) : null);
}

function resolveProvider(): { provider: AiProviderDefinition; source: AiSettingSource; explicitEnv: boolean } {
  const stored = getPreference<string | null>(SCOPE, PROVIDER_KEY, null);
  const envProvider = process.env.AI_PROVIDER?.trim().toLowerCase();
  const explicitEnv = isAiProviderId(envProvider);
  if (isAiProviderId(stored)) return { provider: AI_PROVIDERS[stored], source: "database", explicitEnv: explicitEnv && envProvider === stored };
  if (explicitEnv) return { provider: AI_PROVIDERS[envProvider], source: "env", explicitEnv: true };
  const detected = AI_PROVIDER_ORDER.find((id) => envValue(AI_PROVIDERS[id].envKeyNames));
  if (detected) return { provider: AI_PROVIDERS[detected], source: "env", explicitEnv: false };
  return { provider: AI_PROVIDERS.openai, source: "default", explicitEnv: false };
}

/**
 * Resolves the effective AI configuration. Values saved in SQLite win over the
 * environment, which in turn wins over built-in defaults; every field records
 * the layer it came from so the UI can show it.
 */
export function resolveAiConfig(): ResolvedAiConfig {
  const { provider, source: providerSource, explicitEnv } = resolveProvider();
  const stored = readStored(provider.id);

  const storedKey = stored.apiKey?.trim() || null;
  const envKey = envApiKey(provider, explicitEnv);
  const apiKey = storedKey ?? envKey;
  const apiKeySource: AiSettingSource = storedKey ? "database" : envKey ? "env" : "none";

  const storedModel = stored.model?.trim() || null;
  const envModel = envValue(provider.envModelNames) ?? (explicitEnv ? envValue(["AI_MODEL"]) : null);
  const model = storedModel ?? envModel ?? provider.defaultModel;
  const modelSource: AiSettingSource = storedModel ? "database" : envModel ? "env" : model ? "default" : "none";

  const storedBaseUrl = stored.baseUrl?.trim() || null;
  const envBaseUrl = explicitEnv ? envValue(["AI_BASE_URL"]) : null;
  const baseUrl = (storedBaseUrl ?? envBaseUrl ?? provider.defaultBaseUrl).replace(/\/+$/, "");
  const baseUrlSource: AiSettingSource = storedBaseUrl ? "database" : envBaseUrl ? "env" : "default";

  return { provider, providerSource, apiKey, apiKeySource, model, modelSource, baseUrl, baseUrlSource };
}

export function isAiConfigured(config = resolveAiConfig()): boolean {
  if (!config.model) return false;
  return Boolean(config.apiKey) || !config.provider.requiresApiKey;
}

export function maskSecret(value: string): string {
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 3)}…${value.slice(-4)}`;
}

function describeProvider(definition: AiProviderDefinition): AiProviderInfo {
  const stored = readStored(definition.id);
  return {
    id: definition.id,
    label: definition.label,
    envKeyName: definition.envKeyNames[0] ?? "AI_API_KEY",
    defaultModel: definition.defaultModel,
    defaultBaseUrl: definition.defaultBaseUrl,
    requiresApiKey: definition.requiresApiKey,
    supportsBaseUrl: definition.supportsBaseUrl,
    hasEnvKey: Boolean(envValue(definition.envKeyNames)),
    hasStoredKey: Boolean(stored.apiKey?.trim()),
    storedModel: stored.model?.trim() || null,
    storedBaseUrl: stored.baseUrl?.trim() || null,
  };
}

export function summarizeAiSettings(): AiSettingsSummary {
  const config = resolveAiConfig();
  return {
    enabled: isAiConfigured(config),
    provider: { value: config.provider.id, source: config.providerSource },
    apiKey: {
      configured: Boolean(config.apiKey),
      masked: config.apiKey ? maskSecret(config.apiKey) : null,
      source: config.apiKeySource,
    },
    model: { value: config.model, source: config.modelSource },
    baseUrl: { value: config.baseUrl, source: config.baseUrlSource },
    providers: AI_PROVIDER_ORDER.map((id) => describeProvider(AI_PROVIDERS[id])),
  };
}

export class AiSettingsValidationError extends Error {}

function validateUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AiSettingsValidationError("invalid base URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new AiSettingsValidationError("base URL must use http or https");
  return value.replace(/\/+$/, "");
}

/**
 * Persists overrides for one provider. Fields left `undefined` are untouched,
 * empty strings remove the override so the environment value applies again.
 */
export function updateAiSettings(update: AiSettingsUpdate): AiSettingsSummary {
  const providerId = update.provider ?? resolveAiConfig().provider.id;
  if (!isAiProviderId(providerId)) throw new AiSettingsValidationError("unknown provider");
  if (update.provider !== undefined) setPreference(SCOPE, PROVIDER_KEY, providerId);

  const next: StoredProviderOverrides = { ...readStored(providerId) };
  if (update.apiKey !== undefined) {
    const apiKey = String(update.apiKey).trim();
    if (apiKey) next.apiKey = apiKey;
    else delete next.apiKey;
  }
  if (update.model !== undefined) {
    const model = String(update.model).trim();
    if (model.length > 200) throw new AiSettingsValidationError("model name too long");
    if (model) next.model = model;
    else delete next.model;
  }
  if (update.baseUrl !== undefined) {
    const baseUrl = String(update.baseUrl).trim();
    if (baseUrl) next.baseUrl = validateUrl(baseUrl);
    else delete next.baseUrl;
  }

  if (Object.keys(next).length) setPreference(SCOPE, providerKey(providerId), next);
  else deletePreference(SCOPE, providerKey(providerId));
  return summarizeAiSettings();
}

/** Removes every stored override so the environment configuration applies. */
export function resetAiSettings(): AiSettingsSummary {
  deletePreference(SCOPE, PROVIDER_KEY);
  for (const id of AI_PROVIDER_ORDER) deletePreference(SCOPE, providerKey(id));
  return summarizeAiSettings();
}
