import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { AppRouter } from "../../src/server/router";

function fakeRequest(method: string, url: string): IncomingMessage {
  return { method, url, headers: {} } as unknown as IncomingMessage;
}

function fakeResponse() {
  const headers: Record<string, string> = {};
  let status = 0;
  let body = "";
  const res = {
    setHeader: vi.fn((name: string, value: string) => { headers[name] = value; }),
    writeHead: vi.fn((code: number) => { status = code; }),
    end: vi.fn((chunk?: Buffer | string) => { if (chunk) body = chunk.toString(); }),
  } as unknown as ServerResponse;
  return { res, headers, status: () => status, json: () => JSON.parse(body) };
}

async function dispatch(router: AppRouter, method: string, path: string) {
  const req = fakeRequest(method, path);
  const out = fakeResponse();
  const handled = await router.dispatch(req, out.res, new URL(path, "http://localhost"));
  return { handled, ...out };
}

describe("AppRouter", () => {
  it("matches routes by method and exact path", () => {
    const handler = vi.fn();
    const router = new AppRouter().get("/api/repos", handler);

    expect(router.match("GET", "/api/repos")).toMatchObject({ kind: "matched", handler });
    expect(router.match("GET", "/api/repos/")).toMatchObject({ kind: "matched" });
    expect(router.match("GET", "/api/repositories")).toEqual({ kind: "not-found" });
    expect(router.match("GET", "/api/repos/extra")).toEqual({ kind: "not-found" });
  });

  it("reports the allowed methods when only the verb differs", () => {
    const router = new AppRouter()
      .get("/api/repo-aliases", vi.fn())
      .post("/api/repo-aliases", vi.fn());

    expect(router.match("DELETE", "/api/repo-aliases")).toEqual({
      kind: "method-not-allowed",
      allowed: ["GET", "POST"],
    });
  });

  it("passes the parsed URL and path params to the handler", async () => {
    const seen: unknown[] = [];
    const router = new AppRouter().get("/api/items/:id", (ctx) => {
      seen.push({ id: ctx.params.id, fresh: ctx.url.searchParams.get("fresh") });
    });

    const result = await dispatch(router, "GET", "/api/items/42?fresh=1");

    expect(result.handled).toBe(true);
    expect(seen).toEqual([{ id: "42", fresh: "1" }]);
  });

  it("answers 405 with an Allow header for a wrong verb", async () => {
    const router = new AppRouter().post("/api/auth/start", vi.fn());

    const result = await dispatch(router, "GET", "/api/auth/start");

    expect(result.handled).toBe(true);
    expect(result.status()).toBe(405);
    expect(result.headers.Allow).toBe("POST");
    expect(result.json()).toEqual({ ok: false, error: "POST required" });
  });

  it("leaves unknown paths to the caller", async () => {
    const router = new AppRouter().get("/api/repos", vi.fn());

    const result = await dispatch(router, "GET", "/assets/app.js");

    expect(result.handled).toBe(false);
    expect(result.status()).toBe(0);
  });

  it("propagates handler rejections", async () => {
    const router = new AppRouter().get("/api/boom", async () => { throw new Error("boom"); });

    await expect(dispatch(router, "GET", "/api/boom")).rejects.toThrow("boom");
  });
});
