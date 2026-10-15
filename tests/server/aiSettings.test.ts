import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rm } from "node:fs/promises";

const { TMP_DIR } = vi.hoisted(() => {
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { resolve } = require("node:path") as typeof import("node:path");
  return { TMP_DIR: resolve(tmpdir(), `gitdeck-ai-settings-${process.pid}-${Date.now()}`) };
});

vi.mock("../../src/server/config", () => ({ DATA_DIR: TMP_DIR }));

const settings = await import("../../src/server/ai/settings");
const { closeDatabase } = await import("../../src/server/sqlite");

const AI_ENV = [
  "AI_PROVIDER", "AI_API_KEY", "AI_MODEL", "AI_BASE_URL",
  "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_DIGEST_MODEL",
  "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENROUTER_API_KEY", "OPENROUTER_MODEL",
];

describe("AI settings resolution", () => {
  beforeEach(() => {
    for (const name of AI_ENV) delete process.env[name];
    settings.resetAiSettings();
  });
  afterEach(() => {
    for (const name of AI_ENV) delete process.env[name];
  });
  afterAll(async () => {
    closeDatabase();
    await rm(TMP_DIR, { recursive: true, force: true });
  });

  it("falls back to OpenAI defaults and reports the feature as disabled", () => {
    const summary = settings.summarizeAiSettings();
    expect(summary.enabled).toBe(false);
    expect(summary.provider).toEqual({ value: "openai", source: "default" });
    expect(summary.apiKey).toEqual({ configured: false, masked: null, source: "none" });
    expect(summary.model).toEqual({ value: "gpt-4.1-mini", source: "default" });
    expect(summary.baseUrl.source).toBe("default");
  });

  it("auto-detects the provider from environment keys and honours legacy model names", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-secret-1234";
    let summary = settings.summarizeAiSettings();
    expect(summary.enabled).toBe(true);
    expect(summary.provider).toEqual({ value: "anthropic", source: "env" });
    expect(summary.apiKey).toEqual({ configured: true, masked: "sk-…1234", source: "env" });

    process.env.OPENAI_API_KEY = "sk-openai-secret-9876";
    process.env.OPENAI_DIGEST_MODEL = "gpt-legacy";
    summary = settings.summarizeAiSettings();
    expect(summary.provider.value).toBe("openai");
    expect(summary.model).toEqual({ value: "gpt-legacy", source: "env" });
  });

  it("applies generic AI_* variables only to the explicitly selected provider", () => {
    process.env.AI_API_KEY = "generic-key-0001";
    process.env.AI_MODEL = "some-model";
    expect(settings.summarizeAiSettings().apiKey.configured).toBe(false);

    process.env.AI_PROVIDER = "custom";
    process.env.AI_BASE_URL = "http://ollama.local:11434/v1/";
    const summary = settings.summarizeAiSettings();
    expect(summary.provider).toEqual({ value: "custom", source: "env" });
    expect(summary.apiKey.source).toBe("env");
    expect(summary.model).toEqual({ value: "some-model", source: "env" });
    expect(summary.baseUrl).toEqual({ value: "http://ollama.local:11434/v1", source: "env" });
    expect(summary.enabled).toBe(true);
  });

  it("lets database overrides win over the environment and reports their source", () => {
    process.env.OPENAI_API_KEY = "sk-env-key-4242";
    settings.updateAiSettings({ provider: "openrouter", apiKey: "or-db-key-7777", model: "meta-llama/llama-3-70b" });

    const summary = settings.summarizeAiSettings();
    expect(summary.provider).toEqual({ value: "openrouter", source: "database" });
    expect(summary.apiKey).toEqual({ configured: true, masked: "or-…7777", source: "database" });
    expect(summary.model).toEqual({ value: "meta-llama/llama-3-70b", source: "database" });
    expect(summary.baseUrl).toEqual({ value: "https://openrouter.ai/api/v1", source: "default" });
    const openai = summary.providers.find((entry) => entry.id === "openai");
    expect(openai?.hasEnvKey).toBe(true);
    expect(openai?.hasStoredKey).toBe(false);
  });

  it("removes overrides with empty strings and clears everything on reset", () => {
    process.env.OPENAI_API_KEY = "sk-env-key-4242";
    settings.updateAiSettings({ provider: "openai", apiKey: "sk-db-key-1111", model: "gpt-x" });
    expect(settings.summarizeAiSettings().apiKey.source).toBe("database");

    let summary = settings.updateAiSettings({ apiKey: "" });
    expect(summary.apiKey).toEqual({ configured: true, masked: "sk-…4242", source: "env" });
    expect(summary.model.source).toBe("database");

    summary = settings.resetAiSettings();
    expect(summary.model).toEqual({ value: "gpt-4.1-mini", source: "default" });
    expect(summary.provider.source).toBe("env");
  });

  it("keeps per-provider overrides when switching provider", () => {
    settings.updateAiSettings({ provider: "gemini", apiKey: "gem-key-0001" });
    settings.updateAiSettings({ provider: "openai" });
    const summary = settings.summarizeAiSettings();
    expect(summary.provider.value).toBe("openai");
    expect(summary.providers.find((entry) => entry.id === "gemini")?.hasStoredKey).toBe(true);
  });

  it("rejects invalid base URLs", () => {
    expect(() => settings.updateAiSettings({ provider: "custom", baseUrl: "not a url" })).toThrow(settings.AiSettingsValidationError);
    expect(() => settings.updateAiSettings({ provider: "custom", baseUrl: "ftp://x" })).toThrow(/http or https/);
  });
});
