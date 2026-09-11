import type { AiConnectionTest } from "../../types/ai";
import { isAiConfigured, resolveAiConfig, type ResolvedAiConfig } from "./settings";

const REQUEST_TIMEOUT_MS = 60_000;

export interface JsonSchema {
  type: "object";
  additionalProperties?: boolean;
  properties: Record<string, unknown>;
  required: string[];
}

export interface StructuredRequest {
  /** System-level instructions describing the task. */
  instructions: string;
  /** User content, usually the data to reason about. */
  input: string;
  /** JSON schema of the expected answer; the object is returned parsed. */
  schema: JsonSchema;
  schemaName: string;
  maxOutputTokens: number;
}

export interface StructuredResult<T> {
  provider: string;
  model: string;
  data: T;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super("AI provider is not configured");
    this.name = "AiNotConfiguredError";
  }
}

export class AiRequestError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "AiRequestError";
  }
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, label: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new AiRequestError(`${label} request failed: ${(error as Error).message}`);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new AiRequestError(`${label} request failed with HTTP ${response.status}${summarizeError(detail)}`, response.status);
  }
  return response.json();
}

function summarizeError(body: string): string {
  if (!body) return "";
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    const message = typeof parsed.error === "string" ? parsed.error : parsed.error?.message ?? parsed.message;
    return message ? `: ${message.slice(0, 200)}` : "";
  } catch {
    return `: ${body.slice(0, 200)}`;
  }
}

/** Parses a JSON object out of a model answer, tolerating code fences and prose around it. */
export function parseJsonAnswer<T>(text: string): T {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // fall through to the lenient extraction below
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);
  try {
    return JSON.parse(candidate) as T;
  } catch {
    throw new AiRequestError("AI answer was not valid JSON");
  }
}

function schemaInstructions(request: StructuredRequest): string {
  return `${request.instructions}\n\nAnswer with a single JSON object matching this JSON schema, without markdown or commentary:\n${JSON.stringify(request.schema)}`;
}

async function callOpenAiChat<T>(config: ResolvedAiConfig, request: StructuredRequest): Promise<T> {
  const headers: Record<string, string> = {};
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  if (config.provider.id === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/debba/gitdeck";
    headers["X-Title"] = "Gitdeck";
  }
  // OpenAI enforces the schema server-side. Other compatible servers vary in
  // what they accept, so they get plain JSON mode plus the schema in the prompt.
  const strict = config.provider.id === "openai";
  const json = await postJson(`${config.baseUrl}/chat/completions`, headers, {
    model: config.model,
    messages: [
      { role: "system", content: strict ? request.instructions : schemaInstructions(request) },
      { role: "user", content: request.input },
    ],
    response_format: strict
      ? { type: "json_schema", json_schema: { name: request.schemaName, strict: true, schema: request.schema } }
      : { type: "json_object" },
    max_tokens: request.maxOutputTokens,
    temperature: 0.4,
  }, config.provider.label) as { choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }> };
  const content = json.choices?.[0]?.message?.content;
  const text = typeof content === "string"
    ? content
    : (content ?? []).map((part) => part.text ?? "").join("");
  if (!text.trim()) throw new AiRequestError(`${config.provider.label} returned an empty answer`);
  return parseJsonAnswer<T>(text);
}

async function callAnthropic<T>(config: ResolvedAiConfig, request: StructuredRequest): Promise<T> {
  const toolName = request.schemaName;
  const json = await postJson(`${config.baseUrl}/v1/messages`, {
    "x-api-key": config.apiKey ?? "",
    "anthropic-version": "2023-06-01",
  }, {
    model: config.model,
    max_tokens: request.maxOutputTokens,
    system: request.instructions,
    messages: [{ role: "user", content: request.input }],
    tools: [{ name: toolName, description: "Record the structured answer.", input_schema: request.schema }],
    tool_choice: { type: "tool", name: toolName },
  }, config.provider.label) as { content?: Array<{ type?: string; name?: string; input?: unknown; text?: string }> };
  const toolUse = (json.content ?? []).find((block) => block.type === "tool_use" && block.name === toolName);
  if (toolUse?.input && typeof toolUse.input === "object") return toolUse.input as T;
  const text = (json.content ?? []).map((block) => block.text ?? "").join("");
  if (!text.trim()) throw new AiRequestError(`${config.provider.label} returned an empty answer`);
  return parseJsonAnswer<T>(text);
}

/** Gemini accepts an OpenAPI subset: strip keywords it rejects. */
function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === "additionalProperties") continue;
    out[key] = toGeminiSchema(value);
  }
  return out;
}

async function callGemini<T>(config: ResolvedAiConfig, request: StructuredRequest): Promise<T> {
  const url = `${config.baseUrl}/models/${encodeURIComponent(config.model ?? "")}:generateContent`;
  const json = await postJson(url, { "x-goog-api-key": config.apiKey ?? "" }, {
    systemInstruction: { parts: [{ text: request.instructions }] },
    contents: [{ role: "user", parts: [{ text: request.input }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: toGeminiSchema(request.schema),
      maxOutputTokens: request.maxOutputTokens,
      temperature: 0.4,
    },
  }, config.provider.label) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = (json.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("");
  if (!text.trim()) throw new AiRequestError(`${config.provider.label} returned an empty answer`);
  return parseJsonAnswer<T>(text);
}

/**
 * Runs a structured-output request against the configured provider. Callers
 * describe the task once; the provider-specific wire format is handled here.
 */
export async function generateStructured<T>(request: StructuredRequest, config = resolveAiConfig()): Promise<StructuredResult<T>> {
  if (!isAiConfigured(config) || !config.model) throw new AiNotConfiguredError();
  let data: T;
  switch (config.provider.wire) {
    case "anthropic-messages":
      data = await callAnthropic<T>(config, request);
      break;
    case "gemini-generate":
      data = await callGemini<T>(config, request);
      break;
    default:
      data = await callOpenAiChat<T>(config, request);
  }
  return { provider: config.provider.id, model: config.model, data };
}

/** Sends a minimal request to verify credentials, model name and endpoint. */
export async function testAiConnection(): Promise<AiConnectionTest> {
  const config = resolveAiConfig();
  const startedAt = Date.now();
  const result = await generateStructured<{ reply: string }>({
    instructions: "You are a connectivity check. Reply with the single word OK.",
    input: "ping",
    schema: { type: "object", additionalProperties: false, properties: { reply: { type: "string" } }, required: ["reply"] },
    schemaName: "connectivity_check",
    maxOutputTokens: 200,
  }, config);
  return {
    ok: true,
    provider: result.provider as AiConnectionTest["provider"],
    model: result.model,
    latencyMs: Date.now() - startedAt,
    reply: String(result.data.reply ?? "").slice(0, 80),
  };
}
