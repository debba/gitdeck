import { afterEach, describe, expect, it, vi } from "vitest";
import { AiNotConfiguredError, generateStructured, parseJsonAnswer } from "../../src/server/ai/client";
import { AI_PROVIDERS } from "../../src/server/ai/providers";
import type { ResolvedAiConfig } from "../../src/server/ai/settings";

function config(id: keyof typeof AI_PROVIDERS, overrides: Partial<ResolvedAiConfig> = {}): ResolvedAiConfig {
  const provider = AI_PROVIDERS[id];
  return {
    provider,
    providerSource: "env",
    apiKey: "test-key",
    apiKeySource: "env",
    model: provider.defaultModel ?? "local-model",
    modelSource: "default",
    baseUrl: provider.defaultBaseUrl,
    baseUrlSource: "default",
    ...overrides,
  };
}

const request = {
  instructions: "Summarise.",
  input: "data",
  schemaName: "answer",
  schema: { type: "object" as const, additionalProperties: false, properties: { headline: { type: "string" } }, required: ["headline"] },
  maxOutputTokens: 100,
};

function mockFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function lastCall(fetchMock: ReturnType<typeof vi.fn>): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) as Record<string, unknown> };
}

describe("parseJsonAnswer", () => {
  it("accepts plain JSON, fenced JSON and JSON surrounded by prose", () => {
    expect(parseJsonAnswer('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonAnswer('Here you go:\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(parseJsonAnswer('Sure! {"a":3} hope it helps')).toEqual({ a: 3 });
    expect(() => parseJsonAnswer("nope")).toThrow(/not valid JSON/);
  });
});

describe("generateStructured", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refuses to run without credentials", async () => {
    await expect(generateStructured(request, config("openai", { apiKey: null, apiKeySource: "none" }))).rejects.toBeInstanceOf(AiNotConfiguredError);
  });

  it("uses strict JSON schema output with OpenAI", async () => {
    const fetchMock = mockFetch({ choices: [{ message: { content: '{"headline":"hi"}' } }] });
    const result = await generateStructured<{ headline: string }>(request, config("openai"));
    expect(result).toEqual({ provider: "openai", model: "gpt-4.1-mini", data: { headline: "hi" } });
    const call = lastCall(fetchMock);
    expect(call.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(call.headers.Authorization).toBe("Bearer test-key");
    expect(call.body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "answer", strict: true } });
  });

  it("falls back to JSON mode plus prompt schema for OpenRouter and adds attribution headers", async () => {
    const fetchMock = mockFetch({ choices: [{ message: { content: '```json\n{"headline":"routed"}\n```' } }] });
    const result = await generateStructured<{ headline: string }>(request, config("openrouter"));
    expect(result.data.headline).toBe("routed");
    const call = lastCall(fetchMock);
    expect(call.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(call.headers["X-Title"]).toBe("Gitdeck");
    expect(call.body.response_format).toEqual({ type: "json_object" });
    expect(String((call.body.messages as Array<{ content: string }>)[0].content)).toContain('"headline"');
  });

  it("works against a key-less OpenAI-compatible endpoint", async () => {
    const fetchMock = mockFetch({ choices: [{ message: { content: '{"headline":"local"}' } }] });
    const result = await generateStructured<{ headline: string }>(request, config("custom", { apiKey: null, apiKeySource: "none", baseUrl: "http://localhost:11434/v1", model: "llama3" }));
    expect(result).toMatchObject({ provider: "custom", model: "llama3" });
    const call = lastCall(fetchMock);
    expect(call.url).toBe("http://localhost:11434/v1/chat/completions");
    expect(call.headers.Authorization).toBeUndefined();
  });

  it("forces a tool call with Anthropic and reads the tool input", async () => {
    const fetchMock = mockFetch({ content: [{ type: "tool_use", name: "answer", input: { headline: "claude" } }] });
    const result = await generateStructured<{ headline: string }>(request, config("anthropic"));
    expect(result.data).toEqual({ headline: "claude" });
    const call = lastCall(fetchMock);
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");
    expect(call.headers["x-api-key"]).toBe("test-key");
    expect(call.body.tool_choice).toEqual({ type: "tool", name: "answer" });
  });

  it("strips unsupported schema keywords for Gemini", async () => {
    const fetchMock = mockFetch({ candidates: [{ content: { parts: [{ text: '{"headline":"gemini"}' }] } }] });
    const result = await generateStructured<{ headline: string }>(request, config("gemini"));
    expect(result.data).toEqual({ headline: "gemini" });
    const call = lastCall(fetchMock);
    expect(call.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
    expect(call.headers["x-goog-api-key"]).toBe("test-key");
    const generation = call.body.generationConfig as { responseSchema: Record<string, unknown>; responseMimeType: string };
    expect(generation.responseMimeType).toBe("application/json");
    expect(generation.responseSchema).not.toHaveProperty("additionalProperties");
  });

  it("surfaces upstream error messages", async () => {
    mockFetch({ error: { message: "invalid model" } }, 400);
    await expect(generateStructured(request, config("openai"))).rejects.toThrow(/HTTP 400: invalid model/);
  });
});
