import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AppRouter } from "../../src/server/router";
import type { Account } from "../../src/server/providers/types";
import { buildUtcIsoReviewWeekRanges } from "../../src/utils/growth/weeklyReview";

const state = vi.hoisted(() => {
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { resolve } = require("node:path") as typeof import("node:path");
  return {
    activeAccountId: "account-a" as string | null,
    tmpDir: resolve(tmpdir(), `gitdeck-growth-routes-${process.pid}-${Date.now()}`),
    generateSuggestions: vi.fn(),
    generateProposals: vi.fn(),
    aiConfigured: false,
    generateStructured: vi.fn(),
    collectSignals: vi.fn(),
    fetchReadmeSignal: vi.fn(),
    fetchAdditionalSourceSignals: vi.fn(),
    readPublicMedia: vi.fn(),
    refreshContentPerformance: vi.fn(),
  };
});

vi.mock("../../src/server/config", () => ({ DATA_DIR: state.tmpDir }));
vi.mock("../../src/server/accountStore", () => ({
  getActive: vi.fn(async (): Promise<Account | null> => state.activeAccountId ? ({
    id: state.activeAccountId,
    providerKind: "github",
    providerConfigId: "github.com",
    label: state.activeAccountId,
    login: state.activeAccountId,
    accessToken: "token",
    scope: "repo",
    obtainedAt: "2026-09-04T00:00:00.000Z",
    source: "token",
  }) : null),
}));
vi.mock("../../src/server/goals", () => ({
  generateGoalProposals: state.generateProposals,
  generateRepositoryInterventionSuggestions: state.generateSuggestions,
  refreshGoal: vi.fn(async (goal) => goal),
  SOCIAL_PROPOSALS_VERSION: 4,
}));
vi.mock("../../src/server/ai/settings", () => ({
  isAiConfigured: vi.fn(() => state.aiConfigured),
}));
vi.mock("../../src/server/ai/client", async (importActual) => ({
  ...await importActual<typeof import("../../src/server/ai/client")>(),
  generateStructured: state.generateStructured,
}));
vi.mock("../../src/server/growth/signals", () => ({
  collectRepositorySignals: state.collectSignals,
  fetchReadmeSignal: state.fetchReadmeSignal,
  fetchAdditionalSourceSignals: state.fetchAdditionalSourceSignals,
  readPublicMedia: state.readPublicMedia,
  PublicMediaTooLargeError: class PublicMediaTooLargeError extends Error {},
  UnsupportedPublicMediaTypeError: class UnsupportedPublicMediaTypeError extends Error {},
}));
vi.mock("../../src/server/growth/attribution", () => ({
  refreshContentPerformance: state.refreshContentPerformance,
}));

const { registerGrowthRoutes } = await import("../../src/server/routes/growth");
const { AiNotConfiguredError, AiRequestError } = await import("../../src/server/ai/client");
const goalStore = await import("../../src/server/goalStore");
const growthStore = await import("../../src/server/growth/store");
const { closeDatabase } = await import("../../src/server/sqlite");

interface TestResponse {
  status: number;
  body: Record<string, any>;
}

interface RawTestResponse {
  status: number;
  body: string;
  buffer: Buffer;
  headers: Record<string, string>;
}

function request(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): IncomingMessage {
  const rawBody = Buffer.isBuffer(body) || typeof body === "string";
  const input = body === undefined ? [] : [rawBody ? body : JSON.stringify(body)];
  const req = Readable.from(input) as IncomingMessage;
  req.method = method;
  req.url = path;
  req.headers = {
    ...(body === undefined || rawBody ? {} : { "content-type": "application/json" }),
    ...headers,
  };
  return req;
}

async function dispatchRaw(
  method: string,
  path: string,
  body?: unknown,
  requestHeaders: Record<string, string> = {},
): Promise<RawTestResponse> {
  let status = 0;
  let responseBuffer = Buffer.alloc(0);
  const headers: Record<string, string> = {};
  const res = {
    writeHead(code: number, values: Record<string, string | number> = {}) {
      status = code;
      for (const [name, value] of Object.entries(values)) headers[name.toLowerCase()] = String(value);
    },
    end(chunk?: Buffer | string | Uint8Array) {
      responseBuffer = chunk === undefined ? Buffer.alloc(0) : Buffer.from(chunk);
    },
    setHeader(name: string, value: string | number | readonly string[]) {
      headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
    },
  } as unknown as ServerResponse;
  const router = new AppRouter();
  registerGrowthRoutes(router);
  await router.dispatch(request(method, path, body, requestHeaders), res, new URL(path, "http://localhost"));
  return { status, body: responseBuffer.toString(), buffer: responseBuffer, headers };
}

async function dispatch(method: string, path: string, body?: unknown): Promise<TestResponse> {
  const response = await dispatchRaw(method, path, body);
  return { status: response.status, body: JSON.parse(response.body) as Record<string, any> };
}

function profileInput() {
  return {
    language: "en",
    voice: "Practical",
    audience: "Maintainers",
    channels: { x: true, linkedin: true, mastodon: true, bluesky: false, discussion: false, blog: false },
    cadence: { x: 3, linkedin: 1, mastodon: 3, bluesky: 0, discussion: 0, blog: 0 },
    pillars: [{ id: "product", label: "Product", weight: 100, description: "Outcomes" }],
    hashtags: ["#opensource"],
    avoid: "Hype",
    timezone: "Europe/Rome",
    postingWindows: [{ weekday: 1, hour: 10 }],
    color: "#2563EB",
  };
}

function settingsInput() {
  return {
    timezone: " Europe/Rome ",
    cadence: { x: 4, linkedin: 2, mastodon: 1, bluesky: 0, discussion: 0, blog: 0 },
    pillars: [{ id: "Product-Value", label: " Product value ", weight: 100, description: " Outcomes " }],
  };
}

beforeEach(async () => {
  closeDatabase();
  await rm(state.tmpDir, { recursive: true, force: true });
  state.activeAccountId = "account-a";
  state.aiConfigured = false;
  state.collectSignals.mockReset();
  state.collectSignals.mockResolvedValue({
    generatedOn: "2026-09-04",
    repository: "acme/repo",
    repositoryMetadata: null,
    openIssues: [],
    openPullRequests: [],
    mergedPullRequests: [],
    releases: [],
    readme: null,
    additionalSources: [],
    recentCommits: [],
    starHistory: [],
    goals: [],
  });
  state.fetchReadmeSignal.mockReset();
  state.fetchReadmeSignal.mockResolvedValue(null);
  state.fetchAdditionalSourceSignals.mockReset();
  state.fetchAdditionalSourceSignals.mockResolvedValue([]);
  state.readPublicMedia.mockReset();
  state.readPublicMedia.mockResolvedValue({
    body: Buffer.from("remote media"),
    contentType: "image/png",
    length: 12,
    finalUrl: "https://cdn.example/media.png",
  });
  state.generateStructured.mockReset();
  state.refreshContentPerformance.mockReset();
  state.refreshContentPerformance.mockResolvedValue({
    performance: [],
    pending: [],
    refreshedAt: "2026-09-10T00:00:00.000Z",
  });
  state.generateSuggestions.mockReset();
  state.generateSuggestions.mockResolvedValue([{
    category: "marketing",
    title: "Share the release",
    action: "Publish a grounded release story.",
  }]);
  state.generateProposals.mockReset();
  state.generateProposals.mockResolvedValue([
    {
      title: "Release thread",
      format: "x-thread",
      summary: "Maintainers and contributors",
      content: "One\n\n---\n\nTwo",
      threadPosts: ["One", "Two"],
      mediaSuggestions: [{ kind: "image", title: "Release", sourceUrl: "https://example.com/release.png", guidance: "Show the release." }],
    },
    {
      title: "Release on LinkedIn",
      format: "linkedin-post",
      summary: "Engineering leaders",
      content: "A grounded release update.",
      threadPosts: [],
      mediaSuggestions: [{ kind: "image", title: "Release", sourceUrl: "https://example.com/release.png", guidance: "Show the release." }],
    },
    {
      title: "Release on Mastodon",
      format: "mastodon-post",
      summary: "Open-source community",
      content: "A community release update.",
      threadPosts: [],
      mediaSuggestions: [{ kind: "image", title: "Release", sourceUrl: "https://example.com/release.png", guidance: "Show the release." }],
    },
  ]);
});

afterAll(async () => {
  closeDatabase();
  await rm(state.tmpDir, { recursive: true, force: true });
});

describe("Growth API routes", () => {
  it("requires an active account", async () => {
    state.activeAccountId = null;
    const response = await dispatch("GET", "/api/growth/workspaces");
    expect(response).toEqual({
      status: 401,
      body: { ok: false, needsAuth: true, error: "authentication required" },
    });
  });

  it("rejects unknown and duplicate query input across Growth endpoints", async () => {
    const invalidRequests: Array<[string, string, unknown?]> = [
      ["GET", "/api/growth/workspaces?unknown=1"],
      ["GET", "/api/growth/workspace/acme/repo?unknown=1"],
      ["GET", "/api/growth/profiles/acme/repo?unknown=1"],
      ["PUT", "/api/growth/profiles/acme/repo?unknown=1", profileInput()],
      ["GET", "/api/growth/interventions?repo=acme/repo&repo=acme/other"],
      ["POST", "/api/growth/interventions/scan?unknown=1", { repository: "acme/repo" }],
      ["GET", "/api/growth/assets/example/file?unknown=1"],
      ["POST", "/api/growth/assets/cards?unknown=1", {}],
      ["GET", "/api/growth/plans?repo=acme/repo&repo=acme/other"],
      ["POST", "/api/growth/plans/generate?unknown=1", {}],
      ["GET", "/api/growth/content?status=draft&status=ready"],
      ["POST", "/api/growth/content/example/published?unknown=1", {}],
    ];

    for (const [method, path, body] of invalidRequests) {
      const response = await dispatch(method, path, body);
      expect(response.status, `${method} ${path}`).toBe(400);
      expect(response.body.ok).toBe(false);
    }
  });

  it("round-trips, isolates, and resets growth-wide settings", async () => {
    const defaults = await dispatch("GET", "/api/growth/settings");
    expect(defaults.status).toBe(200);
    expect(defaults.body.settings).toMatchObject({ timezone: "UTC", cadence: { x: 3 } });
    expect(defaults.body.settings.pillars).toHaveLength(5);

    const saved = await dispatch("PUT", "/api/growth/settings", settingsInput());
    expect(saved).toEqual({
      status: 200,
      body: {
        ok: true,
        settings: {
          timezone: "Europe/Rome",
          cadence: settingsInput().cadence,
          pillars: [{ id: "product-value", label: "Product value", weight: 100, description: "Outcomes" }],
        },
      },
    });
    expect((await dispatch("GET", "/api/growth/settings")).body.settings).toEqual(saved.body.settings);

    state.activeAccountId = "account-b";
    expect((await dispatch("GET", "/api/growth/settings")).body.settings.timezone).toBe("UTC");
    await dispatch("PUT", "/api/growth/settings", { ...settingsInput(), timezone: "America/New_York" });

    state.activeAccountId = "account-a";
    expect((await dispatch("DELETE", "/api/growth/settings")).body.settings.timezone).toBe("UTC");
    state.activeAccountId = "account-b";
    expect((await dispatch("GET", "/api/growth/settings")).body.settings.timezone).toBe("America/New_York");
  });

  it("strictly validates growth settings requests", async () => {
    const invalidDocuments = [
      {},
      null,
      [],
      { ...settingsInput(), unknown: true },
      { ...settingsInput(), timezone: "Mars/Olympus" },
      { ...settingsInput(), cadence: { ...settingsInput().cadence, x: 15 } },
      { ...settingsInput(), cadence: { x: 1 } },
      { ...settingsInput(), pillars: [] },
      { ...settingsInput(), pillars: [
        { id: "same", label: "One", weight: 50, description: "" },
        { id: "SAME", label: "Two", weight: 50, description: "" },
      ] },
    ];
    for (const body of invalidDocuments) {
      const response = await dispatch("PUT", "/api/growth/settings", body);
      expect(response.status).toBe(400);
      expect(response.body.ok).toBe(false);
    }

    expect((await dispatchRaw("PUT", "/api/growth/settings", "{broken")).status).toBe(400);
    expect((await dispatch("GET", "/api/growth/settings?unknown=1")).status).toBe(400);
    expect((await dispatch("PUT", "/api/growth/settings?unknown=1", settingsInput())).status).toBe(400);
    expect((await dispatch("DELETE", "/api/growth/settings", { unknown: true })).status).toBe(400);
    expect((await dispatch("DELETE", "/api/growth/settings?unknown=1")).status).toBe(400);
  });

  it("requires an active account for every growth settings method", async () => {
    state.activeAccountId = null;
    for (const [method, body] of [
      ["GET", undefined],
      ["PUT", settingsInput()],
      ["DELETE", undefined],
    ] as const) {
      expect((await dispatch(method, "/api/growth/settings", body)).status).toBe(401);
    }
  });

  it("uploads, lists, and serves private asset bytes without exposing stored paths", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    const query = new URLSearchParams({
      repo: "acme/rocket",
      filename: "release.png",
      title: "Release image",
      alt: "Release dashboard",
      width: "1200",
      height: "630",
    });
    const uploaded = await dispatchRaw("POST", `/api/growth/assets?${query}`, bytes, {
      "content-type": "image/png",
      "content-length": String(bytes.byteLength),
    });
    expect(uploaded.status).toBe(201);
    const uploadBody = JSON.parse(uploaded.body) as Record<string, any>;
    expect(uploadBody.asset).toMatchObject({
      accountId: "account-a",
      repository: "acme/rocket",
      kind: "image",
      origin: "upload",
      title: "Release image",
      alt: "Release dashboard",
      width: 1200,
      height: 630,
    });
    expect(uploadBody.asset).not.toHaveProperty("path");
    const id = uploadBody.asset.id as string;

    const listed = await dispatch("GET", "/api/growth/assets?repo=acme%2Frocket");
    expect(listed.status).toBe(200);
    expect(listed.body.assets).toEqual([uploadBody.asset]);
    expect(listed.body.assets[0]).not.toHaveProperty("path");

    const downloaded = await dispatchRaw("GET", `/api/growth/assets/${id}/file`);
    expect(downloaded.status).toBe(200);
    expect(downloaded.buffer).toEqual(bytes);
    expect(downloaded.headers).toMatchObject({
      "content-type": "image/png",
      "content-length": String(bytes.byteLength),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    });

    state.activeAccountId = "account-b";
    expect((await dispatch("GET", "/api/growth/assets?repo=acme%2Frocket")).body.assets).toEqual([]);
    expect((await dispatch("GET", `/api/growth/assets/${id}/file`)).status).toBe(404);
    state.activeAccountId = null;
    expect((await dispatch("GET", `/api/growth/assets/${id}/file`)).status).toBe(401);
  });

  it("creates and privately renders every account-scoped SVG card template", async () => {
    await dispatch("PUT", "/api/growth/profiles/acme/rocket", {
      ...profileInput(),
      color: "#BE123C",
    });
    const templates = [
      ["release", { version: "v2.4.0", highlights: ["Faster plans"] }],
      ["milestone", { value: 10000, label: "Stars", detail: "Community powered" }],
      ["stats", { stats: [{ label: "Stars", value: 5120 }, { label: "Forks", value: 340 }] }],
      ["quote", { quote: "A focused workflow", attribution: "A maintainer" }],
      ["whats-new", { items: ["Calendar", "Media library"] }],
    ] as const;
    const ids: string[] = [];

    for (const [template, data] of templates) {
      const created = await dispatch("POST", "/api/growth/assets/cards", {
        repository: "acme/rocket",
        template,
        title: `${template} card`,
        alt: `${template} card description`,
        data,
      });
      expect(created.status).toBe(201);
      expect(created.body.asset).toMatchObject({
        accountId: "account-a",
        repository: "acme/rocket",
        kind: "image",
        origin: "generated",
        url: null,
        width: 1200,
        height: 675,
        cardTemplate: template,
        cardData: data,
      });
      expect(created.body.asset).not.toHaveProperty("path");
      ids.push(created.body.asset.id as string);
    }

    expect(growthStore.listGrowthAssets("account-a", "acme/rocket")).toHaveLength(5);
    const rendered = await dispatchRaw("GET", `/api/growth/assets/${ids[0]}/file`);
    expect(rendered.status).toBe(200);
    expect(rendered.headers).toMatchObject({
      "content-type": "image/svg+xml",
      "content-length": String(rendered.buffer.byteLength),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    });
    expect(rendered.body).toContain("#BE123C");
    expect(rendered.body).toContain("release card");
    expect(rendered.body).not.toContain("<script");

    state.activeAccountId = "account-b";
    expect((await dispatch("GET", `/api/growth/assets/${ids[0]}/file`)).status).toBe(404);
    expect((await dispatch("GET", "/api/growth/assets?repo=acme%2Frocket")).body.assets).toEqual([]);
  });

  it("rejects malformed card bodies and stored metadata without serving SVG", async () => {
    const base = {
      repository: "acme/repo",
      template: "release",
      title: "Release",
      alt: "Release card",
      data: { version: "v1", highlights: ["Shipped"] },
    };
    const invalid = [
      { ...base, extra: true },
      { ...base, repository: "bad" },
      { ...base, template: "unknown" },
      { ...base, title: " " },
      { ...base, data: { version: "v1", highlights: [] } },
      { ...base, data: { version: "v1", highlights: ["Shipped"], unknown: true } },
      { ...base, template: "milestone", data: { value: -1, label: "Stars", detail: "Invalid" } },
      { ...base, template: "stats", data: { stats: [{ label: "Stars", value: "many" }] } },
      { ...base, template: "quote", data: { quote: "Missing attribution" } },
      { ...base, template: "whats-new", data: { items: Array.from({ length: 6 }, () => "Update") } },
    ];
    for (const body of invalid) {
      expect((await dispatch("POST", "/api/growth/assets/cards", body)).status).toBe(400);
    }
    expect(growthStore.listGrowthAssets("account-a", "acme/repo")).toEqual([]);

    const malformed = growthStore.createGrowthAsset({
      accountId: "account-a",
      repository: "acme/repo",
      kind: "image",
      origin: "generated",
      title: "Malformed",
      alt: "Malformed",
      cardTemplate: "quote",
      cardData: { quote: "Missing attribution" },
    });
    const response = await dispatch("GET", `/api/growth/assets/${malformed.id}/file`);
    expect(response).toEqual({ status: 404, body: { ok: false, error: "asset not found" } });
    expect(JSON.stringify(response.body)).not.toContain("<svg");
  });

  it("rejects malformed asset requests without creating rows or files", async () => {
    const validQuery = "repo=acme%2Frepo&filename=release.png&title=Release&alt=Release";
    const invalidRequests: Array<[string, string, Buffer | undefined, Record<string, string> | undefined, number]> = [
      ["GET", "/api/growth/assets", undefined, undefined, 400],
      ["GET", "/api/growth/assets?repo=acme%2Frepo&repo=acme%2Fother", undefined, undefined, 400],
      ["GET", "/api/growth/assets?repo=bad", undefined, undefined, 400],
      ["GET", "/api/growth/assets?repo=acme%2Frepo&unknown=1", undefined, undefined, 400],
      ["POST", `/api/growth/assets?${validQuery}&title=Duplicate`, Buffer.from("x"), { "content-type": "image/png" }, 400],
      ["POST", `/api/growth/assets?${validQuery}&unknown=1`, Buffer.from("x"), { "content-type": "image/png" }, 400],
      ["POST", `/api/growth/assets?${validQuery.replace("acme%2Frepo", "bad")}`, Buffer.from("x"), { "content-type": "image/png" }, 400],
      ["POST", `/api/growth/assets?${validQuery}&width=0`, Buffer.from("x"), { "content-type": "image/png" }, 400],
      ["POST", `/api/growth/assets?${validQuery}`, Buffer.from("x"), { "content-type": "image/svg+xml" }, 415],
      ["POST", `/api/growth/assets?${validQuery}`, Buffer.from("x"), { "content-type": "image/png", "content-length": String(25 * 1024 * 1024 + 1) }, 413],
    ];
    for (const [method, path, requestBody, headers, expectedStatus] of invalidRequests) {
      const response = await dispatchRaw(method, path, requestBody, headers);
      expect(response.status, `${method} ${path}`).toBe(expectedStatus);
    }
    expect(growthStore.listGrowthAssets("account-a", "acme/repo")).toEqual([]);
    const assetRoot = resolve(state.tmpDir, "growth-assets");
    const files = await readdir(assetRoot).catch(() => [] as string[]);
    expect(files).toEqual([]);
  });

  it("discovers, verifies, deduplicates, and privately proxies account-scoped source imports", async () => {
    goalStore.saveRepositoryContentSources("account-a", "acme/repo", [
      { type: "website", value: "https://project.example" },
      { type: "repository", value: "acme/docs" },
    ]);
    state.fetchReadmeSignal.mockResolvedValueOnce({
      excerpt: "README",
      mediaUrls: ["https://cdn.example/readme.png#preview"],
    });
    state.fetchAdditionalSourceSignals.mockResolvedValueOnce([
      { type: "website", title: "Project", mediaUrls: ["https://cdn.example/site.webm"] },
      { type: "repository", mediaUrls: ["https://cdn.example/docs.png"] },
    ]);
    const candidates = await dispatch("GET", "/api/growth/assets/import-candidates?repo=acme%2Frepo");
    expect(candidates.status).toBe(200);
    expect(candidates.body.candidates).toEqual([
      expect.objectContaining({ origin: "readme", url: "https://cdn.example/readme.png" }),
      expect.objectContaining({ origin: "website", source: "https://project.example" }),
      expect.objectContaining({ origin: "readme", source: "acme/docs" }),
    ]);

    const selected = candidates.body.candidates[1];
    state.fetchReadmeSignal.mockResolvedValue({
      excerpt: "README",
      mediaUrls: ["https://cdn.example/readme.png"],
    });
    state.fetchAdditionalSourceSignals.mockResolvedValue([
      { type: "website", title: "Project", mediaUrls: ["https://cdn.example/site.webm"] },
      { type: "repository", mediaUrls: ["https://cdn.example/docs.png"] },
    ]);
    state.readPublicMedia.mockResolvedValue({
      body: Buffer.from("remote video"),
      contentType: "video/webm",
      length: 12,
      finalUrl: selected.url,
    });
    const input = {
      repository: "acme/repo",
      origin: "website",
      url: selected.url,
      title: "Project demo",
      alt: "A walkthrough of the project",
    };
    const imported = await dispatch("POST", "/api/growth/assets/import", input);
    expect(imported.status).toBe(201);
    expect(imported.body).toMatchObject({
      ok: true,
      duplicate: false,
      asset: { accountId: "account-a", kind: "video", origin: "website", url: selected.url },
    });
    expect(imported.body.asset).not.toHaveProperty("path");
    expect(state.readPublicMedia).toHaveBeenCalledWith(selected.url);

    const duplicate = await dispatch("POST", "/api/growth/assets/import", input);
    expect(duplicate).toMatchObject({ status: 200, body: { duplicate: true } });
    expect(state.readPublicMedia).toHaveBeenCalledTimes(1);
    const forged = await dispatch("POST", "/api/growth/assets/import", {
      ...input,
      url: "https://attacker.example/forged.png",
    });
    expect(forged.status).toBe(400);

    const id = imported.body.asset.id as string;
    const proxied = await dispatchRaw("GET", `/api/growth/assets/${id}/file`);
    expect(proxied.status).toBe(200);
    expect(proxied.buffer).toEqual(Buffer.from("remote video"));
    expect(proxied.headers).toMatchObject({
      "content-type": "video/webm",
      "content-length": "12",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    });
    expect(state.readPublicMedia).toHaveBeenCalledTimes(2);

    state.activeAccountId = "account-b";
    expect((await dispatch("GET", `/api/growth/assets/${id}/file`)).status).toBe(404);
    expect((await dispatch("GET", "/api/growth/assets?repo=acme%2Frepo")).body.assets).toEqual([]);
  });

  it("rejects malformed and unavailable import requests", async () => {
    const valid = {
      repository: "acme/repo",
      origin: "readme",
      url: "https://cdn.example/readme.png",
      title: "README image",
      alt: "README image",
    };
    state.fetchReadmeSignal.mockResolvedValue({ excerpt: "README", mediaUrls: [valid.url] });
    expect((await dispatch("GET", "/api/growth/assets/import-candidates")).status).toBe(400);
    expect((await dispatch("GET", "/api/growth/assets/import-candidates?repo=bad")).status).toBe(400);
    expect((await dispatch("POST", "/api/growth/assets/import", { ...valid, extra: true })).status).toBe(400);
    expect((await dispatch("POST", "/api/growth/assets/import", { ...valid, origin: "upload" })).status).toBe(400);
    expect((await dispatch("POST", "/api/growth/assets/import", { ...valid, alt: " " })).status).toBe(400);
    state.readPublicMedia.mockRejectedValueOnce(new Error("unavailable"));
    expect((await dispatch("POST", "/api/growth/assets/import", valid)).status).toBe(422);
  });

  it("returns a generic not-found response for missing, traversing, and malformed generated asset files", async () => {
    await mkdir(state.tmpDir, { recursive: true });
    await writeFile(resolve(state.tmpDir, "secret.png"), "secret");
    const traversal = growthStore.createGrowthAsset({
      accountId: "account-a",
      repository: "acme/repo",
      kind: "image",
      origin: "upload",
      path: "../secret.png",
      title: "Secret",
      alt: "Secret",
    });
    const missing = growthStore.createGrowthAsset({
      accountId: "account-a",
      repository: "acme/repo",
      kind: "image",
      origin: "upload",
      path: "missing.png",
      title: "Missing",
      alt: "Missing",
    });
    const generated = growthStore.createGrowthAsset({
      accountId: "account-a",
      repository: "acme/repo",
      kind: "image",
      origin: "generated",
      cardTemplate: "release",
      cardData: { title: "Release" },
      title: "Generated",
      alt: "Generated",
    });

    for (const id of [traversal.id, missing.id, generated.id, "unknown-id"]) {
      const response = await dispatch("GET", `/api/growth/assets/${id}/file`);
      expect(response).toEqual({ status: 404, body: { ok: false, error: "asset not found" } });
      expect(JSON.stringify(response.body)).not.toContain("secret");
    }
  });

  it("round-trips normalized profiles and rejects invalid planning constraints", async () => {
    const input = {
      ...profileInput(),
      voice: "  Practical and direct  ",
      hashtags: [" #OpenSource ", "#opensource", "#GitDeck"],
      color: "#2563eb",
    };
    const saved = await dispatch("PUT", "/api/growth/profiles/acme/rocket", input);
    expect(saved.status).toBe(200);
    expect(saved.body.profile).toMatchObject({
      repository: "acme/rocket",
      voice: "Practical and direct",
      hashtags: ["#OpenSource", "#GitDeck"],
      color: "#2563EB",
    });
    expect((await dispatch("GET", "/api/growth/profiles/acme/rocket")).body.profile)
      .toEqual(saved.body.profile);

    const invalidProfiles: Array<[unknown, string]> = [
      [{ ...profileInput(), timezone: "Mars/Olympus" }, "IANA timezone"],
      [{ ...profileInput(), cadence: { ...profileInput().cadence, x: 15 } }, "0 through 14"],
      [{ ...profileInput(), channels: { ...profileInput().channels, unknown: true } }, "supported channel"],
      [{ ...profileInput(), pillars: [{ id: "product", label: "Product", weight: 101, description: "" }] }, "0 through 100"],
    ];
    for (const [invalid, message] of invalidProfiles) {
      const response = await dispatch("PUT", "/api/growth/profiles/acme/rocket", invalid);
      expect(response.status).toBe(400);
      expect(response.body.error).toContain(message);
    }
  });

  it("discovers profile-only and goal-backed workspaces and returns real counters", async () => {
    expect((await dispatch("PUT", "/api/growth/profiles/acme/profile-only", profileInput())).status).toBe(200);
    goalStore.createGoal({
      accountId: "account-a",
      repository: "acme/goal-only",
      metric: "stars",
      targetValue: 100,
      deadline: "2099-12-31",
    });
    await dispatch("POST", "/api/growth/interventions", {
      repository: "acme/profile-only",
      category: "marketing",
      title: "Share the roadmap",
      action: "Publish the next milestone.",
    });
    const scheduledFor = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await dispatch("POST", "/api/growth/content", {
      repository: "acme/profile-only",
      channel: "linkedin",
      format: "linkedin-post",
      status: "scheduled",
      scheduledFor,
      title: "Roadmap",
      media: [{ kind: "image", url: "https://example.com/roadmap.png", alt: "Roadmap" }],
    });

    const workspaces = await dispatch("GET", "/api/growth/workspaces");
    expect(workspaces.status).toBe(200);
    expect(workspaces.body.workspaces.map((workspace: { repository: string }) => workspace.repository))
      .toEqual(["acme/goal-only", "acme/profile-only"]);
    const goalOnly = workspaces.body.workspaces.find(
      (workspace: { repository: string }) => workspace.repository === "acme/goal-only",
    );
    const profileOnly = workspaces.body.workspaces.find(
      (workspace: { repository: string }) => workspace.repository === "acme/profile-only",
    );
    expect(goalOnly.color).toBe(growthStore.getGrowthProfile("account-a", "acme/goal-only").color);
    expect(profileOnly.color).toBe("#2563EB");

    const overview = await dispatch("GET", "/api/growth/workspace/acme/profile-only");
    expect(overview.body.workspace).toMatchObject({
      repository: "acme/profile-only",
      color: "#2563EB",
      interventionsByStatus: { proposed: 1, accepted: 0, dismissed: 0, done: 0 },
      contentItemsByStatus: { idea: 0, draft: 0, ready: 0, scheduled: 1, published: 0, skipped: 0 },
    });
    expect(overview.body.workspace.nextSevenDays).toHaveLength(1);
  });

  it("rejects invalid bodies and unknown patch fields with 400", async () => {
    const intervention = await dispatch("POST", "/api/growth/interventions", {
      repository: "acme/repo",
      category: "community",
      title: "Welcome contributors",
      action: "Thank first-time contributors.",
    });
    const content = await dispatch("POST", "/api/growth/content", {
      repository: "acme/repo",
      channel: "x",
      format: "x-thread",
      status: "draft",
    });
    const cases: Array<[string, string, unknown]> = [
      ["PUT", "/api/growth/profiles/acme/repo", {}],
      ["POST", "/api/growth/interventions", { repository: "bad", category: "other", title: "", action: "" }],
      ["PATCH", `/api/growth/interventions/${intervention.body.intervention.id}`, { origin: "ai" }],
      ["POST", "/api/growth/content", { repository: "acme/repo", channel: "email", format: "email" }],
      ["PATCH", `/api/growth/content/${content.body.contentItem.id}`, { repository: "other/repo" }],
      ["POST", `/api/growth/content/${content.body.contentItem.id}/published`, { url: 42 }],
    ];

    for (const [method, path, body] of cases) {
      const response = await dispatch(method, path, body);
      expect(response.status, `${method} ${path}`).toBe(400);
      expect(response.body.ok).toBe(false);
    }
    expect((await dispatch("GET", "/api/growth/content?status=unknown")).status).toBe(400);
    expect((await dispatch("GET", "/api/growth/workspace/bad/repo%2Fextra")).status).toBe(400);
  });

  it("scopes lists, reads, mutations, and deletes to the active account", async () => {
    await dispatch("PUT", "/api/growth/profiles/acme/private", {
      ...profileInput(),
      color: "#ABCDEF",
    });
    const interventionResponse = await dispatch("POST", "/api/growth/interventions", {
      repository: "acme/private",
      category: "engineering",
      title: "Explain the architecture",
      action: "Draft an architecture note.",
    });
    const contentResponse = await dispatch("POST", "/api/growth/content", {
      repository: "acme/private",
      channel: "blog",
      format: "doc",
      status: "draft",
    });
    const interventionId = interventionResponse.body.intervention.id as string;
    const contentId = contentResponse.body.contentItem.id as string;

    state.activeAccountId = "account-b";
    expect((await dispatch("GET", "/api/growth/workspaces")).body.workspaces).toEqual([]);
    goalStore.createGoal({
      accountId: "account-b",
      repository: "acme/private",
      metric: "stars",
      targetValue: 10,
      deadline: "2099-12-31",
    });
    const isolatedWorkspaces = (await dispatch("GET", "/api/growth/workspaces")).body.workspaces;
    expect(isolatedWorkspaces).toHaveLength(1);
    expect(isolatedWorkspaces[0]).toMatchObject({ repository: "acme/private" });
    expect(isolatedWorkspaces[0].color).toBe(growthStore.getGrowthProfile("account-b", "acme/private").color);
    expect(isolatedWorkspaces[0].color).not.toBe("#ABCDEF");
    expect((await dispatch("GET", "/api/growth/interventions?repo=acme%2Fprivate")).body.interventions).toEqual([]);
    expect((await dispatch("GET", "/api/growth/content?repo=acme%2Fprivate")).body.contentItems).toEqual([]);
    expect((await dispatch("PATCH", `/api/growth/interventions/${interventionId}`, { status: "done" })).status).toBe(404);
    expect((await dispatch("PATCH", `/api/growth/content/${contentId}`, { title: "Changed" })).status).toBe(404);
    expect((await dispatch("DELETE", `/api/growth/content/${contentId}`)).status).toBe(404);
    expect((await dispatch("GET", "/api/growth/profiles/acme/private")).body.profile.voice).toBe("");

    expect(growthStore.getGrowthIntervention("account-a", interventionId)?.status).toBe("proposed");
    expect(growthStore.getContentItem("account-a", contentId)?.title).toBe("");
  });

  it("generates and lists account-scoped editorial plans with strict validation and overlap protection", async () => {
    const input = profileInput();
    await dispatch("PUT", "/api/growth/profiles/acme/repo", {
      ...input,
      channels: { ...input.channels, linkedin: false, mastodon: false },
      cadence: { ...input.cadence, x: 1, linkedin: 0, mastodon: 0 },
    });

    const generated = await dispatch("POST", "/api/growth/plans/generate", {
      repository: "acme/repo",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    });
    expect(generated.status).toBe(201);
    expect(generated.body).toMatchObject({
      ok: true,
      aiEnabled: false,
      usedFallback: true,
      weightsAdjusted: false,
      plan: { accountId: "account-a", repository: "acme/repo", status: "active" },
    });
    expect(generated.body.contentItems).toHaveLength(1);
    expect(state.collectSignals).toHaveBeenCalledTimes(1);

    const listed = await dispatch("GET", "/api/growth/plans?repo=acme%2Frepo");
    expect(listed.status).toBe(200);
    expect(listed.body.plans.map((plan: { id: string }) => plan.id)).toEqual([generated.body.plan.id]);

    const invalidRequests: Array<[string, string, unknown?]> = [
      ["GET", "/api/growth/plans"],
      ["GET", "/api/growth/plans?repo=bad"],
      ["GET", "/api/growth/plans?repo=acme%2Frepo&unknown=1"],
      ["POST", "/api/growth/plans/generate", { repository: "bad", periodStart: "2026-09-07", periodEnd: "2026-09-13" }],
      ["POST", "/api/growth/plans/generate", { repository: "acme/repo", periodStart: "2026-09-08", periodEnd: "2026-09-13" }],
      ["POST", "/api/growth/plans/generate", { repository: "acme/repo", periodStart: "2026-09-07", periodEnd: "2026-09-13", extra: true }],
    ];
    for (const [method, path, body] of invalidRequests) {
      expect((await dispatch(method, path, body)).status, `${method} ${path}`).toBe(400);
    }

    const overlapping = await dispatch("POST", "/api/growth/plans/generate", {
      repository: "acme/repo",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-20",
    });
    expect(overlapping.status).toBe(400);
    expect(growthStore.listContentPlans("account-a", "acme/repo")).toHaveLength(1);
    expect(growthStore.listContentItems("account-a", { repository: "acme/repo" })).toHaveLength(1);

    state.activeAccountId = "account-b";
    expect((await dispatch("GET", "/api/growth/plans?repo=acme%2Frepo")).body.plans).toEqual([]);
    expect((await dispatch("POST", "/api/growth/plans/generate", {
      repository: "acme/repo",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    })).status).toBe(201);
    expect(growthStore.listContentPlans("account-a", "acme/repo")).toHaveLength(1);
    expect(growthStore.listContentPlans("account-b", "acme/repo")).toHaveLength(1);
  });

  it("generates deconflicted multi-repository plans with strict validation and account isolation", async () => {
    const input = profileInput();
    const compact = {
      ...input,
      channels: { ...input.channels, linkedin: false, mastodon: false },
      cadence: { ...input.cadence, x: 1, linkedin: 0, mastodon: 0 },
    };
    await dispatch("PUT", "/api/growth/profiles/acme/alpha", compact);
    await dispatch("PUT", "/api/growth/profiles/acme/zeta", compact);

    const invalidBodies = [
      { repositories: ["acme/alpha"], periodStart: "2026-09-07", periodEnd: "2026-09-13" },
      { repositories: ["acme/alpha", "ACME/ALPHA"], periodStart: "2026-09-07", periodEnd: "2026-09-13" },
      { repositories: ["acme/alpha", "bad"], periodStart: "2026-09-07", periodEnd: "2026-09-13" },
      { repositories: ["acme/alpha", "acme/zeta"], periodStart: "2026-09-08", periodEnd: "2026-09-13" },
      { repositories: ["acme/alpha", "acme/zeta"], periodStart: "2026-09-07", periodEnd: "2026-09-13", extra: true },
    ];
    for (const body of invalidBodies) {
      expect((await dispatch("POST", "/api/growth/plans/generate-multiple", body)).status).toBe(400);
    }

    const generated = await dispatch("POST", "/api/growth/plans/generate-multiple", {
      repositories: ["acme/zeta", "acme/alpha"],
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    });
    expect(generated.status).toBe(201);
    expect(generated.body).toMatchObject({
      ok: true,
      deconflictedItemCount: 1,
      remainingCollisionCount: 0,
      plans: [
        { plan: { accountId: "account-a", repository: "acme/alpha" }, aiEnabled: false, usedFallback: true },
        { plan: { accountId: "account-a", repository: "acme/zeta" }, aiEnabled: false, usedFallback: true },
      ],
    });
    expect(generated.body.plans.map((entry: Record<string, any>) => entry.contentItems[0].scheduledFor)).toEqual([
      "2026-09-07T08:00:00.000Z",
      "2026-09-08T08:00:00.000Z",
    ]);

    const accountAIds = generated.body.plans.map((entry: Record<string, any>) => entry.plan.id as string);
    const beforeOverlapCounts = generated.body.plans.map((entry: Record<string, any>) => (
      growthStore.listContentPlans("account-a", entry.plan.repository).length
    ));
    expect((await dispatch("POST", "/api/growth/plans/generate-multiple", {
      repositories: ["acme/alpha", "acme/zeta"],
      periodStart: "2026-09-07",
      periodEnd: "2026-09-20",
    })).status).toBe(400);
    expect(generated.body.plans.map((entry: Record<string, any>) => (
      growthStore.listContentPlans("account-a", entry.plan.repository).length
    ))).toEqual(beforeOverlapCounts);

    state.activeAccountId = "account-b";
    const otherAccount = await dispatch("POST", "/api/growth/plans/generate-multiple", {
      repositories: ["acme/alpha", "acme/zeta"],
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    });
    expect(otherAccount.status).toBe(201);
    expect(otherAccount.body.plans.every((entry: Record<string, any>) => entry.plan.accountId === "account-b")).toBe(true);
    expect(accountAIds.some((id: string) => JSON.stringify(otherAccount.body).includes(id))).toBe(false);
  });

  it("does not persist a partial multi-plan set when one provider call fails", async () => {
    const input = profileInput();
    const compact = {
      ...input,
      channels: { ...input.channels, linkedin: false, mastodon: false },
      cadence: { ...input.cadence, x: 1, linkedin: 0, mastodon: 0 },
    };
    await dispatch("PUT", "/api/growth/profiles/acme/alpha", compact);
    await dispatch("PUT", "/api/growth/profiles/acme/zeta", compact);
    state.aiConfigured = true;
    state.generateStructured
      .mockResolvedValueOnce({ provider: "test", model: "test", data: { assignments: [] } })
      .mockRejectedValueOnce(new AiRequestError("second planner failed"));

    const response = await dispatch("POST", "/api/growth/plans/generate-multiple", {
      repositories: ["acme/alpha", "acme/zeta"],
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    });
    expect(response).toEqual({ status: 502, body: { ok: false, error: "second planner failed" } });
    expect(growthStore.listContentPlans("account-a")).toEqual([]);
    expect(growthStore.listContentItems("account-a")).toEqual([]);
  });

  it("regenerates and archives plans with strict bodies, account scope, and protected content", async () => {
    const input = profileInput();
    await dispatch("PUT", "/api/growth/profiles/acme/repo", {
      ...input,
      channels: { ...input.channels, linkedin: false, mastodon: false },
      cadence: { ...input.cadence, x: 1, linkedin: 0, mastodon: 0 },
    });
    const generated = await dispatch("POST", "/api/growth/plans/generate", {
      repository: "acme/repo",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    });
    const sourceId = generated.body.plan.id as string;
    const draft = growthStore.createContentItem({
      accountId: "account-a",
      repository: "acme/repo",
      planId: sourceId,
      channel: "x",
      format: "x-thread",
      status: "draft",
    });
    const ready = growthStore.createContentItem({
      accountId: "account-a",
      repository: "acme/repo",
      planId: sourceId,
      channel: "x",
      format: "x-thread",
      status: "ready",
      media: [{ kind: "image", url: "https://example.com/card.png", alt: "Card" }],
    });

    expect((await dispatch("POST", `/api/growth/plans/${sourceId}/regenerate`, { unknown: true })).status).toBe(400);
    state.activeAccountId = "account-b";
    expect((await dispatch("POST", `/api/growth/plans/${sourceId}/regenerate`, { unknown: true })).status).toBe(404);
    expect((await dispatch("POST", `/api/growth/plans/${sourceId}/archive`, { unknown: true })).status).toBe(404);
    state.activeAccountId = "account-a";

    await dispatch("PUT", "/api/growth/profiles/acme/repo", {
      ...input,
      channels: { ...input.channels, linkedin: false, mastodon: false },
      cadence: { ...input.cadence, x: 2, linkedin: 0, mastodon: 0 },
    });
    const regenerated = await dispatch("POST", `/api/growth/plans/${sourceId}/regenerate`, {});
    expect(regenerated.status).toBe(201);
    expect(regenerated.body).toMatchObject({
      ok: true,
      sourcePlan: { id: sourceId, status: "archived" },
      plan: { status: "active", repository: "acme/repo" },
      aiEnabled: false,
      usedFallback: true,
      weightsAdjusted: false,
    });
    expect(regenerated.body.contentItems).toHaveLength(2);
    expect(regenerated.body.affectedContentItems.map((item: { id: string }) => item.id))
      .toContain(draft.id);
    expect(growthStore.getContentItem("account-a", ready.id)?.status).toBe("ready");
    const overlappingRegeneration = await dispatch("POST", `/api/growth/plans/${sourceId}/regenerate`, {});
    expect(overlappingRegeneration.status).toBe(400);
    expect(growthStore.listContentPlans("account-a", "acme/repo")).toHaveLength(2);

    const replacementId = regenerated.body.plan.id as string;
    expect((await dispatch("POST", `/api/growth/plans/${replacementId}/archive`, { extra: true })).status).toBe(400);
    const archived = await dispatch("POST", `/api/growth/plans/${replacementId}/archive`, {});
    expect(archived.status).toBe(200);
    expect(archived.body.plan).toMatchObject({ id: replacementId, status: "archived" });
    expect(archived.body.contentItems).toHaveLength(2);
    expect(archived.body.contentItems.every((item: { status: string }) => item.status === "skipped")).toBe(true);
    expect(growthStore.getContentItem("account-a", ready.id)?.status).toBe("ready");
  });

  it("returns a typed AI request error without persisting a plan", async () => {
    state.aiConfigured = true;
    state.generateStructured.mockRejectedValueOnce(new AiRequestError("planner provider failed"));

    const response = await dispatch("POST", "/api/growth/plans/generate", {
      repository: "acme/failure",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    });

    expect(response).toEqual({
      status: 502,
      body: { ok: false, error: "planner provider failed" },
    });
    expect(growthStore.listContentPlans("account-a", "acme/failure")).toEqual([]);
    expect(growthStore.listContentItems("account-a", { repository: "acme/failure" })).toEqual([]);
  });

  it("generates repository or mission interventions with dedupe and preserves user status", async () => {
    const first = await dispatch("POST", "/api/growth/interventions/generate", {
      repository: "acme/repo",
    });
    expect(first.status).toBe(200);
    expect(first.body.interventions).toEqual([
      expect.objectContaining({ origin: "ai", status: "proposed", title: "Share the release" }),
    ]);
    const interventionId = first.body.interventions[0].id as string;
    await dispatch("PATCH", `/api/growth/interventions/${interventionId}`, { status: "accepted" });
    state.generateSuggestions.mockResolvedValueOnce([{
      category: "marketing",
      title: " SHARE the release! ",
      action: "Publish the updated release story.",
    }]);

    const repeated = await dispatch("POST", "/api/growth/interventions/generate", {
      repository: "acme/repo",
    });
    expect(repeated.body.interventions).toEqual([
      expect.objectContaining({ id: interventionId, status: "accepted", action: "Publish the updated release story." }),
    ]);
    expect((await dispatch("GET", "/api/growth/interventions?repo=acme%2Frepo")).body.interventions).toHaveLength(1);

    const goal = goalStore.createGoal({
      accountId: "account-a",
      repository: "acme/repo",
      metric: "stars",
      targetValue: 100,
      deadline: "2099-12-31",
    });
    expect((await dispatch("POST", "/api/growth/interventions/generate", {
      repository: "acme/repo",
      goalId: goal.id,
    })).status).toBe(200);
    expect(state.generateSuggestions).toHaveBeenLastCalledWith(
      "account-a",
      "acme/repo",
      expect.objectContaining({ id: goal.id }),
    );
    expect((await dispatch("POST", "/api/growth/interventions/generate", {
      repository: "acme/other",
      goalId: goal.id,
    })).status).toBe(400);
  });

  it("scans deterministic interventions with strict validation, account scope, and status preservation", async () => {
    expect((await dispatch("POST", "/api/growth/interventions/scan", {
      repository: "invalid",
    })).status).toBe(400);
    expect((await dispatch("POST", "/api/growth/interventions/scan", {
      repository: "acme/repo",
      unknown: true,
    })).status).toBe(400);

    state.activeAccountId = null;
    expect((await dispatch("POST", "/api/growth/interventions/scan", {
      repository: "acme/repo",
    })).status).toBe(401);
    expect(state.collectSignals).not.toHaveBeenCalled();

    state.activeAccountId = "account-a";
    state.collectSignals.mockResolvedValue({
      generatedOn: "2026-09-10",
      repository: "acme/repo",
      repositoryMetadata: null,
      openIssues: [],
      openPullRequests: [],
      mergedPullRequests: [],
      releases: [{
        tag_name: "v1.0.0",
        html_url: "https://github.com/acme/repo/releases/tag/v1.0.0",
        published_at: new Date(Date.now() - 4 * 86_400_000).toISOString(),
      }],
      readme: null,
      additionalSources: [],
      recentCommits: [],
      starHistory: [],
      goals: [],
    });
    const first = await dispatch("POST", "/api/growth/interventions/scan", {
      repository: "acme/repo",
    });
    expect(first.status).toBe(200);
    expect(first.body.scannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(first.body.interventions).toEqual([
      expect.objectContaining({ origin: "rule", ruleKey: "release:v1.0.0", status: "proposed" }),
    ]);
    expect(state.collectSignals).toHaveBeenCalledWith("account-a", "acme/repo");
    const id = first.body.interventions[0].id as string;
    await dispatch("PATCH", `/api/growth/interventions/${id}`, { status: "accepted" });
    const repeated = await dispatch("POST", "/api/growth/interventions/scan", { repository: "acme/repo" });
    expect(repeated.body.interventions[0]).toMatchObject({ id, status: "accepted" });
    expect(growthStore.listGrowthInterventions("account-a", { repository: "acme/repo" })).toHaveLength(1);

    state.activeAccountId = "account-b";
    const otherAccount = await dispatch("POST", "/api/growth/interventions/scan", { repository: "acme/repo" });
    expect(otherAccount.body.interventions[0].id).not.toBe(id);
    expect(otherAccount.body.interventions[0].accountId).toBe("account-b");
  });

  it("recycles eligible evergreen rule interventions once with strict account-safe failures", async () => {
    const media = [{ kind: "image" as const, url: "https://example.com/guide.png", alt: "Guide" }];
    const oldDate = new Date(Date.now() - 61 * 86_400_000).toISOString();
    const source = growthStore.createContentItem({
      accountId: "account-a",
      repository: "acme/repo",
      goalIds: [],
      channel: "linkedin",
      format: "linkedin-post",
      pillar: "education",
      title: "Evergreen guide",
      body: "Published source copy",
      media,
      sources: ["https://example.com/guide"],
      status: "published",
      publishedAt: oldDate,
      evergreen: 1,
    });
    const intervention = growthStore.upsertGrowthRuleIntervention({
      accountId: "account-a",
      repository: "acme/repo",
      category: "marketing",
      title: "Recycle evergreen guide",
      action: "Create a fresh angle.",
      ruleKey: `evergreen:${source.id}`,
    });

    expect((await dispatch("POST", `/api/growth/interventions/${intervention.id}/recycle`, {
      unexpected: true,
    })).status).toBe(400);
    const first = await dispatch("POST", `/api/growth/interventions/${intervention.id}/recycle`, {});
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      ok: true,
      duplicate: false,
      contentItem: {
        interventionId: intervention.id,
        repository: "acme/repo",
        channel: "linkedin",
        format: "linkedin-post",
        pillar: "education",
        title: "",
        body: "",
        media: [],
        sources: ["https://example.com/guide"],
        status: "idea",
        evergreen: 0,
      },
    });
    const repeated = await dispatch("POST", `/api/growth/interventions/${intervention.id}/recycle`);
    expect(repeated.status).toBe(200);
    expect(repeated.body).toMatchObject({ duplicate: true, contentItem: { id: first.body.contentItem.id } });
    expect(growthStore.getContentItem("account-a", source.id)).toMatchObject({
      title: "Evergreen guide",
      body: "Published source copy",
      status: "published",
      evergreen: 1,
    });
    expect(growthStore.listContentItems("account-a", { repository: "acme/repo" })).toHaveLength(2);

    state.activeAccountId = "account-b";
    const foreign = await dispatch("POST", `/api/growth/interventions/${intervention.id}/recycle`, {});
    state.activeAccountId = "account-a";
    const missing = await dispatch("POST", "/api/growth/interventions/missing/recycle", {});

    const ineligibleSource = growthStore.createContentItem({
      accountId: "account-a",
      repository: "acme/repo",
      channel: "x",
      format: "x-thread",
      media,
      status: "published",
      publishedAt: oldDate,
      evergreen: 0,
    });
    const ineligibleRule = growthStore.upsertGrowthRuleIntervention({
      accountId: "account-a",
      repository: "acme/repo",
      category: "marketing",
      title: "Not evergreen",
      action: "Do not recycle.",
      ruleKey: `evergreen:${ineligibleSource.id}`,
    });
    const recentSource = growthStore.createContentItem({
      accountId: "account-a",
      repository: "acme/repo",
      channel: "x",
      format: "x-thread",
      media,
      status: "published",
      publishedAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      evergreen: 1,
    });
    const staleRule = growthStore.upsertGrowthRuleIntervention({
      accountId: "account-a",
      repository: "acme/repo",
      category: "marketing",
      title: "Too recent",
      action: "Wait.",
      ruleKey: `evergreen:${recentSource.id}`,
    });
    const manual = growthStore.createGrowthIntervention({
      accountId: "account-a",
      repository: "acme/repo",
      category: "marketing",
      title: "Manual collision",
      action: "Do not recycle.",
      origin: "manual",
      ruleKey: `evergreen:${source.id}`,
      dedupeKey: "manual-collision",
    });
    const rejected = await Promise.all([ineligibleRule.id, staleRule.id, manual.id].map((id) => (
      dispatch("POST", `/api/growth/interventions/${id}/recycle`, {})
    )));

    expect(foreign).toEqual(missing);
    expect(foreign).toMatchObject({ status: 404, body: { ok: false, error: "evergreen intervention not found" } });
    expect(rejected.map(({ status }) => status)).toEqual([404, 404, 404]);
  });

  it("lists and refreshes account-scoped performance with strict filters and bodies", async () => {
    const media = [{ kind: "image" as const, url: "https://example.com/card.png", alt: "Card" }];
    const accountA = growthStore.createContentItem({
      accountId: "account-a",
      repository: "acme/repo",
      channel: "x",
      format: "x-thread",
      status: "published",
      publishedAt: "2026-09-01T00:00:00.000Z",
      media,
    });
    const otherRepository = growthStore.createContentItem({
      accountId: "account-a",
      repository: "acme/other",
      channel: "x",
      format: "x-thread",
      status: "published",
      publishedAt: "2026-09-01T00:00:00.000Z",
      media,
    });
    const accountB = growthStore.createContentItem({
      accountId: "account-b",
      repository: "acme/repo",
      channel: "x",
      format: "x-thread",
      status: "published",
      publishedAt: "2026-09-01T00:00:00.000Z",
      media,
    });
    for (const [accountId, contentId, window] of [
      ["account-a", accountA.id, "48h"],
      ["account-a", otherRepository.id, "7d"],
      ["account-b", accountB.id, "48h"],
    ] as const) {
      growthStore.upsertContentPerformance(accountId, {
        contentId,
        window,
        measuredAt: "2026-09-10T00:00:00.000Z",
        metrics: { starsDelta: 3, forksDelta: -1 },
      });
    }

    const filtered = await dispatch(
      "GET",
      `/api/growth/performance?repo=acme%2Frepo&contentId=${accountA.id}&window=48h`,
    );
    expect(filtered).toEqual({
      status: 200,
      body: {
        ok: true,
        performance: [{
          accountId: "account-a",
          contentId: accountA.id,
          window: "48h",
          measuredAt: "2026-09-10T00:00:00.000Z",
          metrics: { starsDelta: 3, forksDelta: -1 },
        }],
      },
    });
    expect((await dispatch("GET", `/api/growth/performance?repo=acme%2Fother&contentId=${accountA.id}`)).body.performance)
      .toEqual([]);

    state.activeAccountId = "account-b";
    expect((await dispatch("GET", "/api/growth/performance?repo=acme%2Frepo")).body.performance)
      .toEqual([expect.objectContaining({ accountId: "account-b", contentId: accountB.id })]);
    expect((await dispatch("GET", `/api/growth/performance?contentId=${accountA.id}`)).status).toBe(404);
    state.activeAccountId = "account-a";
    expect((await dispatch("GET", "/api/growth/performance?contentId=missing")).status).toBe(404);

    const malformedFilters = [
      "/api/growth/performance?unknown=1",
      "/api/growth/performance?repo=invalid",
      "/api/growth/performance?contentId=",
      "/api/growth/performance?window=30d",
      "/api/growth/performance?window=48h&window=7d",
    ];
    for (const path of malformedFilters) {
      expect((await dispatch("GET", path)).status, path).toBe(400);
    }
    for (const body of [
      { repository: "invalid" },
      { repository: "acme/repo", unknown: true },
      [],
    ]) {
      expect((await dispatch("POST", "/api/growth/performance/refresh", body)).status).toBe(400);
    }
    expect((await dispatch("POST", "/api/growth/performance/refresh?repo=acme%2Frepo", {})).status).toBe(400);

    state.refreshContentPerformance.mockResolvedValueOnce({
      performance: [filtered.body.performance[0]],
      pending: [{
        contentId: accountA.id,
        window: "7d",
        dueAt: "2026-09-08T00:00:00.000Z",
        reason: "snapshot-unavailable",
      }],
      refreshedAt: "2026-09-10T00:00:00.000Z",
    });
    const refreshed = await dispatch("POST", "/api/growth/performance/refresh", { repository: "acme/repo" });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body).toMatchObject({ ok: true, refreshedAt: "2026-09-10T00:00:00.000Z" });
    expect(state.refreshContentPerformance).toHaveBeenCalledWith("account-a", { repository: "acme/repo" });

    state.activeAccountId = null;
    expect((await dispatch("POST", "/api/growth/performance/refresh", {})).status).toBe(401);
    expect(state.refreshContentPerformance).toHaveBeenCalledTimes(1);
  });

  it("returns account-scoped performance summaries with strict inclusive filters", async () => {
    const media = [{ kind: "image" as const, url: "https://example.com/card.png", alt: "Card" }];
    const fromEdge = growthStore.createContentItem({
      accountId: "account-a",
      repository: "acme/repo",
      channel: "x",
      format: "x-thread",
      pillar: "product",
      status: "published",
      publishedAt: "2026-09-01T00:00:00.000Z",
      media,
    });
    const toEdge = growthStore.createContentItem({
      accountId: "account-a",
      repository: "acme/repo",
      channel: "linkedin",
      format: "linkedin-post",
      pillar: "community",
      status: "published",
      publishedAt: "2026-09-03T00:00:00.000Z",
      media,
    });
    const otherAccount = growthStore.createContentItem({
      accountId: "account-b",
      repository: "acme/repo",
      channel: "x",
      format: "x-thread",
      status: "published",
      publishedAt: "2026-09-02T00:00:00.000Z",
      media,
    });
    growthStore.upsertContentPerformance("account-a", {
      contentId: fromEdge.id,
      window: "48h",
      measuredAt: "2026-09-10T00:00:00.000Z",
      metrics: { starsDelta: 4, forksDelta: -1 },
    });
    growthStore.upsertContentPerformance("account-a", {
      contentId: toEdge.id,
      window: "7d",
      measuredAt: "2026-09-10T00:00:00.000Z",
      metrics: { starsDelta: -2 },
    });
    growthStore.upsertContentPerformance("account-b", {
      contentId: otherAccount.id,
      window: "48h",
      measuredAt: "2026-09-10T00:00:00.000Z",
      metrics: { starsDelta: 100 },
    });

    const query = new URLSearchParams({
      repo: "acme/repo",
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-09-03T00:00:00.000Z",
    });
    const response = await dispatch("GET", `/api/growth/performance/summary?${query}`);
    expect(response.status).toBe(200);
    expect(response.body.summary.windows).toEqual([
      expect.objectContaining({
        window: "48h",
        measuredItems: 1,
        metrics: expect.objectContaining({ starsDelta: 4, forksDelta: -1 }),
        channels: [expect.objectContaining({ key: "x", measuredItems: 1 })],
        pillars: [expect.objectContaining({ key: "product", measuredItems: 1 })],
      }),
      expect.objectContaining({
        window: "7d",
        measuredItems: 1,
        metrics: expect.objectContaining({ starsDelta: -2, forksDelta: 0 }),
        channels: [expect.objectContaining({ key: "linkedin", measuredItems: 1 })],
        pillars: [expect.objectContaining({ key: "community", measuredItems: 1 })],
      }),
    ]);
    expect(state.refreshContentPerformance).not.toHaveBeenCalled();

    state.activeAccountId = "account-b";
    expect((await dispatch("GET", `/api/growth/performance/summary?${query}`)).body.summary.windows[0])
      .toMatchObject({ measuredItems: 1, metrics: { starsDelta: 100 } });
    state.activeAccountId = "account-a";

    const malformedFilters = [
      "/api/growth/performance/summary?unknown=1",
      "/api/growth/performance/summary?repo=invalid",
      "/api/growth/performance/summary?repo=acme%2Frepo&repo=acme%2Fother",
      "/api/growth/performance/summary?from=2026-09-01T00%3A00%3A00%2B00%3A00",
      "/api/growth/performance/summary?to=not-a-date",
      "/api/growth/performance/summary?from=2026-09-03T00%3A00%3A00.000Z&to=2026-09-01T00%3A00%3A00.000Z",
    ];
    for (const path of malformedFilters) {
      expect((await dispatch("GET", path)).status, path).toBe(400);
    }

    state.activeAccountId = null;
    expect((await dispatch("GET", "/api/growth/performance/summary")).status).toBe(401);
  });

  it("returns strict read-only repository and global weekly reviews", async () => {
    const ranges = buildUtcIsoReviewWeekRanges(() => new Date());
    const publishedAt = new Date(Date.parse(ranges.reviewPeriod.start) + 10 * 60 * 60 * 1_000).toISOString();
    const repositoryItem = growthStore.createContentItem({
      accountId: "account-a",
      repository: "acme/repo",
      channel: "x",
      format: "x-thread",
      pillar: "product",
      title: "Repository result",
      status: "published",
      scheduledFor: publishedAt,
      publishedAt,
      media: [{ kind: "image", url: "https://example.com/result.png", alt: "Result" }],
    });
    growthStore.createContentItem({
      accountId: "account-a",
      repository: "acme/other",
      channel: "linkedin",
      format: "linkedin-post",
      pillar: "community",
      title: "Other result",
      status: "published",
      scheduledFor: publishedAt,
      publishedAt,
      media: [{ kind: "image", url: "https://example.com/other-result.png", alt: "Result" }],
    });
    growthStore.createContentItem({
      accountId: "account-b",
      repository: "acme/repo",
      channel: "mastodon",
      format: "mastodon-post",
      title: "Private result",
      status: "published",
      scheduledFor: publishedAt,
      publishedAt,
      media: [{ kind: "image", url: "https://example.com/private.png", alt: "Private" }],
    });
    growthStore.upsertContentPerformance("account-a", {
      contentId: repositoryItem.id,
      window: "48h",
      measuredAt: new Date().toISOString(),
      metrics: { starsDelta: 6 },
    });

    const repositoryReview = await dispatch("GET", "/api/growth/review?repo=acme%2Frepo");
    expect(repositoryReview.status).toBe(200);
    expect(repositoryReview.body.review).toMatchObject({
      repository: "acme/repo",
      aiEnabled: false,
      usedFallback: true,
      publishedItems: [expect.objectContaining({ id: repositoryItem.id, repository: "acme/repo" })],
    });
    expect(repositoryReview.body.review.performance.windows[0]).toMatchObject({
      window: "48h",
      measuredItems: 1,
      metrics: { starsDelta: 6 },
    });
    expect(repositoryReview.body.review.recommendations).toHaveLength(3);

    const globalReview = await dispatch("GET", "/api/growth/review");
    expect(globalReview.body.review.repository).toBeNull();
    expect(globalReview.body.review.publishedItems.map((item: { title: string }) => item.title))
      .toEqual(["Other result", "Repository result"]);
    expect(state.refreshContentPerformance).not.toHaveBeenCalled();
    expect(state.collectSignals).not.toHaveBeenCalled();
    expect(state.generateStructured).not.toHaveBeenCalled();

    for (const path of [
      "/api/growth/review?repo=invalid",
      "/api/growth/review?unknown=1",
      "/api/growth/review?repo=acme%2Frepo&repo=acme%2Fother",
    ]) {
      expect((await dispatch("GET", path)).status, path).toBe(400);
    }

    state.activeAccountId = "account-b";
    expect((await dispatch("GET", "/api/growth/review?repo=acme%2Frepo")).body.review.publishedItems)
      .toEqual([expect.objectContaining({ title: "Private result" })]);
    state.activeAccountId = null;
    expect((await dispatch("GET", "/api/growth/review")).status).toBe(401);
  });

  it("deduplicates repeated manual interventions without resetting their status", async () => {
    const first = await dispatch("POST", "/api/growth/interventions", {
      repository: "acme/repo",
      category: "community",
      title: "Welcome contributors",
      action: "Document the contribution path.",
    });
    const id = first.body.intervention.id as string;
    await dispatch("PATCH", `/api/growth/interventions/${id}`, { status: "accepted" });

    const repeated = await dispatch("POST", "/api/growth/interventions", {
      repository: "acme/repo",
      category: "community",
      title: " WELCOME contributors! ",
      action: "Document one clear contribution path.",
    });
    expect(repeated.body.intervention).toMatchObject({
      id,
      status: "accepted",
      action: "Document one clear contribution path.",
    });
    expect(growthStore.listGrowthInterventions("account-a", { repository: "acme/repo" })).toHaveLength(1);
  });

  it("drafts intervention content idempotently and refreshes only editable items", async () => {
    const interventionResponse = await dispatch("POST", "/api/growth/interventions", {
      repository: "acme/repo",
      category: "marketing",
      title: "Announce the release",
      action: "Draft a verified release campaign.",
    });
    const interventionId = interventionResponse.body.intervention.id as string;

    const first = await dispatch("POST", "/api/growth/content/draft", { interventionId });
    expect(first.status).toBe(200);
    expect(first.body.cached).toBe(false);
    expect(first.body.contentItems).toHaveLength(3);
    expect(first.body.contentItems[0]).toMatchObject({
      interventionId,
      goalIds: [],
      channel: "x",
      format: "x-thread",
      status: "draft",
      generationVersion: 4,
    });
    expect(first.body.contentItems[0].media).toEqual([
      expect.objectContaining({ url: "https://example.com/release.png", alt: "Release" }),
    ]);
    expect(state.generateProposals).toHaveBeenCalledWith(
      { accountId: "account-a", repository: "acme/repo" },
      expect.objectContaining({ title: "Announce the release", category: "marketing" }),
      [],
    );

    const cached = await dispatch("POST", "/api/growth/content/draft", { interventionId });
    expect(cached.body.cached).toBe(true);
    expect(cached.body.contentItems.map((item: { id: string }) => item.id))
      .toEqual(first.body.contentItems.map((item: { id: string }) => item.id));
    expect(state.generateProposals).toHaveBeenCalledTimes(1);

    state.generateProposals.mockResolvedValueOnce(state.generateProposals.mock.results[0].value.then(
      (proposals: Array<Record<string, unknown>>) => proposals.map((proposal) => ({ ...proposal, title: `${proposal.title} refreshed` })),
    ));
    const refreshed = await dispatch("POST", "/api/growth/content/draft", { interventionId, refresh: true });
    expect(refreshed.body.cached).toBe(false);
    expect(refreshed.body.contentItems.map((item: { id: string }) => item.id))
      .toEqual(first.body.contentItems.map((item: { id: string }) => item.id));
    expect(refreshed.body.contentItems[0].title).toBe("Release thread refreshed");
    expect(growthStore.listContentItems("account-a", { repository: "acme/repo" })).toHaveLength(3);

    const protectedId = refreshed.body.contentItems[0].id as string;
    expect((await dispatch("PATCH", `/api/growth/content/${protectedId}`, { status: "ready" })).status).toBe(200);
    const refreshWithProtectedItem = await dispatch("POST", "/api/growth/content/draft", { interventionId, refresh: true });
    expect(refreshWithProtectedItem.body.contentItems[0].id).not.toBe(protectedId);
    expect(growthStore.getContentItem("account-a", protectedId)).toMatchObject({
      status: "ready",
      title: "Release thread refreshed",
    });
    expect(growthStore.listContentItems("account-a", { repository: "acme/repo" })).toHaveLength(4);

    const latestCached = await dispatch("POST", "/api/growth/content/draft", { interventionId });
    expect(latestCached.body.contentItems).toHaveLength(3);
    expect(latestCached.body.contentItems.map((item: { id: string }) => item.id))
      .toEqual(refreshWithProtectedItem.body.contentItems.map((item: { id: string }) => item.id));
  });

  it("returns the existing AI-not-configured response without creating drafts", async () => {
    const intervention = await dispatch("POST", "/api/growth/interventions", {
      repository: "acme/repo",
      category: "marketing",
      title: "Draft a campaign",
      action: "Use verified repository signals.",
    });
    state.generateProposals.mockRejectedValueOnce(new AiNotConfiguredError());

    const response = await dispatch("POST", "/api/growth/content/draft", {
      interventionId: intervention.body.intervention.id,
    });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ ok: false, aiEnabled: false });
    expect(growthStore.listContentItems("account-a", { repository: "acme/repo" })).toEqual([]);
  });

  it("keeps intervention drafting account-scoped and validates its body", async () => {
    const intervention = await dispatch("POST", "/api/growth/interventions", {
      repository: "acme/private",
      category: "marketing",
      title: "Private campaign",
      action: "Draft it.",
    });
    const id = intervention.body.intervention.id as string;
    expect((await dispatch("POST", "/api/growth/content/draft", { interventionId: "" })).status).toBe(400);
    expect((await dispatch("POST", "/api/growth/content/draft", { interventionId: id, unknown: true })).status).toBe(400);
    state.activeAccountId = "account-b";
    expect((await dispatch("POST", "/api/growth/content/draft", { interventionId: id })).status).toBe(404);
    expect(state.generateProposals).not.toHaveBeenCalled();
  });

  it("drafts one planned item with strict validation, account scope, refresh, and status protection", async () => {
    const created = await dispatch("POST", "/api/growth/content", {
      repository: "acme/repo",
      channel: "linkedin",
      format: "linkedin-post",
      status: "idea",
      angle: "Explain the verified repository",
      summary: "Try it and share feedback",
    });
    const id = created.body.contentItem.id as string;

    expect((await dispatch("POST", `/api/growth/content/${id}/draft`, { unknown: true })).status).toBe(400);
    expect((await dispatch("POST", `/api/growth/content/${id}/draft`, { refresh: "yes" })).status).toBe(400);
    state.activeAccountId = "account-b";
    expect((await dispatch("POST", `/api/growth/content/${id}/draft`, {})).status).toBe(404);
    expect(state.collectSignals).not.toHaveBeenCalled();

    state.activeAccountId = "account-a";
    const drafted = await dispatch("POST", `/api/growth/content/${id}/draft`);
    expect(drafted.status).toBe(200);
    expect(drafted.body).toMatchObject({
      ok: true,
      aiEnabled: false,
      usedFallback: true,
      cached: false,
      mediaRequired: true,
      contentItem: { id, status: "draft" },
    });
    expect(drafted.body.contentItem.body).not.toBe("");

    const cached = await dispatch("POST", `/api/growth/content/${id}/draft`, {});
    expect(cached.body).toMatchObject({ cached: true, contentItem: { id } });
    const refreshed = await dispatch("POST", `/api/growth/content/${id}/draft`, { refresh: true });
    expect(refreshed.body).toMatchObject({ cached: false, contentItem: { id } });
    expect(state.collectSignals).toHaveBeenCalledTimes(2);

    expect((await dispatch("PATCH", `/api/growth/content/${id}`, {
      media: [{ kind: "image", url: "https://example.com/release.png", alt: "Release" }],
      status: "ready",
    })).status).toBe(200);
    const protectedResponse = await dispatch("POST", `/api/growth/content/${id}/draft`, { refresh: true });
    expect(protectedResponse.status).toBe(409);
    expect(growthStore.getContentItem("account-a", id)).toMatchObject({ status: "ready", body: drafted.body.contentItem.body });
  });

  it("serves a strict account-scoped unified calendar without changing the ICS route", async () => {
    await dispatch("PUT", "/api/growth/profiles/acme/profile-only", {
      ...profileInput(),
      color: "#BE123C",
      timezone: "Europe/Rome",
    });
    const fromEdge = growthStore.createContentItem({
      accountId: "account-a",
      repository: "acme/content-only",
      channel: "x",
      format: "x-thread",
      title: "Inclusive edge",
      status: "idea",
      scheduledFor: "2026-10-14T08:00:00.000Z",
    });
    growthStore.createContentItem({
      accountId: "account-a",
      repository: "acme/content-only",
      channel: "x",
      format: "x-thread",
      title: "Skipped item",
      status: "skipped",
      scheduledFor: "2026-10-14T08:30:00.000Z",
    });
    growthStore.createContentItem({
      accountId: "account-b",
      repository: "private/repo",
      channel: "x",
      format: "x-thread",
      title: "Private item",
      status: "idea",
      scheduledFor: "2026-10-14T08:30:00.000Z",
    });

    const response = await dispatch(
      "GET",
      "/api/growth/calendar?scheduledFrom=2026-10-14T08%3A00%3A00Z&scheduledTo=2026-10-14T09%3A00%3A00Z",
    );
    expect(response).toMatchObject({
      status: 200,
      body: {
        ok: true,
        calendar: {
          repositories: [
            {
              repository: "acme/content-only",
              timezone: "UTC",
              contentItems: [{ id: fromEdge.id }],
            },
            {
              repository: "acme/profile-only",
              color: "#BE123C",
              timezone: "Europe/Rome",
              contentItems: [],
            },
          ],
        },
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("Skipped item");
    expect(JSON.stringify(response.body)).not.toContain("Private item");

    const malformed = [
      "/api/growth/calendar",
      "/api/growth/calendar?scheduledFrom=2026-10-14T08%3A00%3A00Z",
      "/api/growth/calendar?scheduledTo=2026-10-14T09%3A00%3A00Z",
      "/api/growth/calendar?scheduledFrom=2026-10-14T08%3A00%3A00Z&scheduledTo=2026-10-14T09%3A00%3A00Z&unknown=1",
      "/api/growth/calendar?scheduledFrom=2026-10-14T08%3A00%3A00Z&scheduledFrom=2026-10-14T08%3A30%3A00Z&scheduledTo=2026-10-14T09%3A00%3A00Z",
      "/api/growth/calendar?scheduledFrom=2026-10-14T08%3A00%3A00%2B00%3A00&scheduledTo=2026-10-14T09%3A00%3A00Z",
      "/api/growth/calendar?scheduledFrom=2026-02-30T08%3A00%3A00Z&scheduledTo=2026-10-14T09%3A00%3A00Z",
      "/api/growth/calendar?scheduledFrom=2026-10-14T10%3A00%3A00Z&scheduledTo=2026-10-14T09%3A00%3A00Z",
    ];
    for (const path of malformed) {
      expect((await dispatch("GET", path)).status, path).toBe(400);
    }

    state.activeAccountId = null;
    expect((await dispatch(
      "GET",
      "/api/growth/calendar?scheduledFrom=2026-10-14T08%3A00%3A00Z&scheduledTo=2026-10-14T09%3A00%3A00Z",
    ))).toEqual({
      status: 401,
      body: { ok: false, needsAuth: true, error: "authentication required" },
    });

    state.activeAccountId = "account-a";
    const ics = await dispatchRaw(
      "GET",
      "/api/growth/calendar.ics?from=2026-10-14T08%3A00%3A00Z&to=2026-10-14T09%3A00%3A00Z",
    );
    expect(ics.status).toBe(200);
    expect(ics.headers["content-type"]).toBe("text/calendar; charset=utf-8");
  });

  it("exports only the active account's scheduled content with validated repository and UTC bounds", async () => {
    const scheduled = await dispatch("POST", "/api/growth/content", {
      repository: "acme/repo",
      channel: "x",
      format: "x-thread",
      pillar: "product",
      title: "Account A launch",
      sources: ["https://example.com/releases/launch"],
      status: "scheduled",
      scheduledFor: "2026-10-14T08:30:00.000Z",
      media: [{ kind: "image", url: "https://example.com/launch.png", alt: "Launch" }],
    });
    await dispatch("POST", "/api/growth/content", {
      repository: "acme/other",
      channel: "linkedin",
      format: "linkedin-post",
      title: "Other repository",
      status: "scheduled",
      scheduledFor: "2026-10-14T08:45:00.000Z",
      media: [{ kind: "image", url: "https://example.com/other.png", alt: "Other" }],
    });
    await dispatch("POST", "/api/growth/content", {
      repository: "acme/repo",
      channel: "x",
      format: "x-thread",
      title: "Draft content",
      status: "draft",
      scheduledFor: "2026-10-14T08:40:00.000Z",
    });
    await dispatch("POST", "/api/growth/content", {
      repository: "acme/repo",
      channel: "x",
      format: "x-thread",
      title: "Outside range",
      status: "scheduled",
      scheduledFor: "2026-10-14T10:00:00.000Z",
      media: [{ kind: "image", url: "https://example.com/outside.png", alt: "Outside" }],
    });

    const filtered = await dispatchRaw(
      "GET",
      "/api/growth/calendar.ics?repo=acme%2Frepo&from=2026-10-14T08%3A00%3A00Z&to=2026-10-14T09%3A00%3A00Z",
    );
    expect(filtered.status).toBe(200);
    expect(filtered.headers["content-type"]).toBe("text/calendar; charset=utf-8");
    expect(filtered.headers["content-disposition"]).toBe('attachment; filename="gitdeck-growth-calendar.ics"');
    expect(filtered.body).toContain(`UID:${scheduled.body.contentItem.id}@growth.gitdeck\r\n`);
    expect(filtered.body).toContain("SUMMARY:Account A launch\r\n");
    expect(filtered.body).toContain("DESCRIPTION:Repository: acme/repo\\nChannel: x\\nPillar: product\r\n");
    expect(filtered.body).toContain("URL:https://example.com/releases/launch\r\n");
    expect(filtered.body).not.toContain("Other repository");
    expect(filtered.body).not.toContain("Draft content");
    expect(filtered.body).not.toContain("Outside range");
    expect(filtered.body).not.toContain("account-a");

    const unified = await dispatchRaw(
      "GET",
      "/api/growth/calendar.ics?from=2026-10-14T08%3A00%3A00.000Z&to=2026-10-14T09%3A00%3A00.000Z",
    );
    expect(unified.body).toContain("Account A launch");
    expect(unified.body).toContain("Other repository");

    state.activeAccountId = "account-b";
    await dispatch("POST", "/api/growth/content", {
      repository: "acme/repo",
      channel: "mastodon",
      format: "mastodon-post",
      title: "Account B launch",
      status: "scheduled",
      scheduledFor: "2026-10-14T08:30:00.000Z",
      media: [{ kind: "image", url: "https://example.com/b.png", alt: "Launch B" }],
    });
    const accountB = await dispatchRaw(
      "GET",
      "/api/growth/calendar.ics?repo=acme%2Frepo&from=2026-10-14T08%3A00%3A00Z&to=2026-10-14T09%3A00%3A00Z",
    );
    expect(accountB.body).toContain("Account B launch");
    expect(accountB.body).not.toContain("Account A launch");

    const malformed = [
      "/api/growth/calendar.ics?unknown=1",
      "/api/growth/calendar.ics?repo=invalid",
      "/api/growth/calendar.ics?from=2026-10-14T08%3A00%3A00%2B02%3A00",
      "/api/growth/calendar.ics?from=2026-02-30T08%3A00%3A00Z",
      "/api/growth/calendar.ics?from=2026-10-15T08%3A00%3A00Z&to=2026-10-14T08%3A00%3A00Z",
      "/api/growth/calendar.ics?from=2026-10-14T08%3A00%3A00Z&from=2026-10-14T09%3A00%3A00Z",
    ];
    for (const path of malformed) {
      expect((await dispatch("GET", path)).status, path).toBe(400);
    }
  });

  it("enforces generic account-scoped asset attachment validation across content gates", async () => {
    const owned = growthStore.createGrowthAsset({
      accountId: "account-a",
      repository: "acme/repo",
      kind: "image",
      origin: "upload",
      path: "owned.png",
      title: "Owned card",
      alt: "Owned release card",
    });
    const otherRepository = growthStore.createGrowthAsset({
      accountId: "account-a",
      repository: "acme/other",
      kind: "image",
      origin: "upload",
      path: "other.png",
      title: "Other card",
      alt: "Other card",
    });
    const otherAccount = growthStore.createGrowthAsset({
      accountId: "account-b",
      repository: "acme/repo",
      kind: "image",
      origin: "upload",
      path: "private.png",
      title: "Private card",
      alt: "Private card",
    });
    const created = await dispatch("POST", "/api/growth/content", {
      repository: "acme/repo",
      channel: "x",
      format: "x-thread",
      status: "draft",
    });
    const id = created.body.contentItem.id as string;

    for (const assetId of ["missing", otherRepository.id, otherAccount.id]) {
      const media = [{ assetId, kind: "image", alt: "Untrusted media" }];
      const invalidCreate = await dispatch("POST", "/api/growth/content", {
        repository: "acme/repo",
        channel: "x",
        format: "x-thread",
        status: "draft",
        media,
      });
      const invalidPatch = await dispatch("PATCH", `/api/growth/content/${id}`, { media });
      for (const invalid of [invalidCreate, invalidPatch]) {
        expect(invalid).toEqual({
          status: 400,
          body: { ok: false, error: "Media attachment is invalid." },
        });
      }
    }
    expect(growthStore.getContentItem("account-a", id)?.media).toEqual([]);
    const mediaGateRequests: Array<[string, string, unknown]> = [
      ["PATCH", `/api/growth/content/${id}`, { status: "ready" }],
      ["PATCH", `/api/growth/content/${id}`, { scheduledFor: "2026-09-08T10:00:00.000Z" }],
      ["POST", `/api/growth/content/${id}/published`, { url: null }],
    ];
    for (const [method, path, body] of mediaGateRequests) {
      const rejected = await dispatch(method, path, body);
      expect(rejected.status).toBe(400);
      expect(rejected.body.error).toContain("at least one media attachment");
    }
    expect(growthStore.getContentItem("account-a", id)).toMatchObject({ status: "draft", media: [] });

    for (const status of ["ready", "scheduled", "published"] as const) {
      const rejected = await dispatch("POST", "/api/growth/content", {
        repository: "acme/repo",
        channel: "x",
        format: "x-thread",
        status,
        ...(status === "scheduled" ? { scheduledFor: "2026-09-08T10:00:00.000Z" } : {}),
      });
      expect(rejected.status).toBe(400);
      expect(rejected.body.error).toContain("at least one media attachment");
    }

    const validMedia = [{ assetId: owned.id, kind: "image", alt: "Edited release card", caption: "Release v2" }];
    for (const status of ["ready", "scheduled", "published"] as const) {
      const protectedItem = await dispatch("POST", "/api/growth/content", {
        repository: "acme/repo",
        channel: "x",
        format: "x-thread",
        status,
        media: validMedia,
        ...(status === "scheduled" ? { scheduledFor: "2026-09-08T10:00:00.000Z" } : {}),
      });
      expect(protectedItem.status).toBe(201);
      const protectedId = protectedItem.body.contentItem.id as string;
      expect((await dispatch("PATCH", `/api/growth/content/${protectedId}`, { media: [] })).status).toBe(400);
      expect((await dispatch("PATCH", `/api/growth/content/${protectedId}`, { title: `${status} preserved` })).status).toBe(200);
    }

    const ready = await dispatch("PATCH", `/api/growth/content/${id}`, { media: validMedia, status: "ready" });
    expect(ready.status).toBe(200);
    expect(ready.body.contentItem).toMatchObject({ status: "ready", media: validMedia });
    let removal = await dispatch("PATCH", `/api/growth/content/${id}`, { media: [] });
    expect(removal.status).toBe(400);
    expect(growthStore.getContentItem("account-a", id)?.media).toEqual(validMedia);

    const scheduledFor = "2026-09-08T10:00:00.000Z";
    expect((await dispatch("PATCH", `/api/growth/content/${id}`, { scheduledFor })).body.contentItem.status).toBe("scheduled");
    removal = await dispatch("PATCH", `/api/growth/content/${id}`, { media: [] });
    expect(removal.status).toBe(400);

    expect((await dispatch("POST", `/api/growth/content/${id}/published`, { url: null })).body.contentItem.status).toBe("published");
    removal = await dispatch("PATCH", `/api/growth/content/${id}`, { media: [] });
    expect(removal.status).toBe(400);
    expect((await dispatch("PATCH", `/api/growth/content/${id}`, { title: "Media-preserving edit" })).body.contentItem)
      .toMatchObject({ title: "Media-preserving edit", media: validMedia });

    const legacy = await dispatch("POST", "/api/growth/content", {
      repository: "acme/repo",
      channel: "linkedin",
      format: "linkedin-post",
      status: "ready",
      media: [{ url: "https://example.com/legacy.png", kind: "image", alt: "Legacy image" }],
    });
    expect(legacy.status).toBe(201);
  });

  it("supports allowlisted updates, scheduling, publishing, and deletion", async () => {
    const interventionResponse = await dispatch("POST", "/api/growth/interventions", {
      repository: "acme/repo",
      category: "product",
      title: "Announce the release",
      action: "Draft the announcement.",
    });
    const interventionId = interventionResponse.body.intervention.id as string;
    expect((await dispatch("PATCH", `/api/growth/interventions/${interventionId}`, { status: "accepted" })).body.intervention.status)
      .toBe("accepted");

    const contentResponse = await dispatch("POST", "/api/growth/content", {
      repository: "acme/repo",
      interventionId,
      channel: "x",
      format: "x-thread",
      status: "draft",
      media: [{ kind: "image", url: "https://example.com/release.png", alt: "Release" }],
    });
    const contentId = contentResponse.body.contentItem.id as string;
    const scheduledFor = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const scheduled = await dispatch("PATCH", `/api/growth/content/${contentId}`, {
      title: "Release thread",
      scheduledFor,
    });
    expect(scheduled.body.contentItem).toMatchObject({ status: "scheduled", scheduledFor, title: "Release thread" });

    const published = await dispatch("POST", `/api/growth/content/${contentId}/published`, {
      url: "https://social.example/acme/1",
    });
    expect(published.body.contentItem).toMatchObject({
      status: "published",
      publishedUrl: "https://social.example/acme/1",
    });
    expect((await dispatch("DELETE", `/api/growth/content/${contentId}`)).status).toBe(200);
  });
});
