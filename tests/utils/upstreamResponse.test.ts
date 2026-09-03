import { describe, expect, it } from "vitest";
import { interpretUpstreamJson, looksLikeHtml } from "../../src/utils/upstreamResponse";

const NGINX_502 = "<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body><h1>502 Bad Gateway</h1></body></html>";

describe("interpretUpstreamJson", () => {
  it("returns parsed JSON for a successful response", () => {
    const result = interpretUpstreamJson<{ login: string }>("GitHub", { status: 200, text: '{"login":"octocat"}' });

    expect(result).toEqual({ ok: true, status: 200, data: { login: "octocat" } });
  });

  it("treats an empty successful body as null data", () => {
    expect(interpretUpstreamJson("GitHub", { status: 204, text: "" })).toEqual({ ok: true, status: 204, data: null });
  });

  it("passes JSON error bodies through untouched", () => {
    const text = '{"message":"Not Found","documentation_url":"https://docs.github.com"}';

    expect(interpretUpstreamJson("GitHub", { status: 404, text })).toEqual({ ok: false, status: 404, error: text });
  });

  it("describes an HTML error page instead of leaking a SyntaxError", () => {
    const result = interpretUpstreamJson("GitHub", {
      status: 502,
      statusText: "Bad Gateway",
      contentType: "text/html",
      text: NGINX_502,
    });

    expect(result).toEqual({
      ok: false,
      status: 502,
      error: "GitHub returned HTTP 502 Bad Gateway with an HTML page instead of JSON",
    });
  });

  it("detects HTML by body when the content type is missing", () => {
    const result = interpretUpstreamJson("Codeberg", { status: 503, text: NGINX_502 });

    expect(result).toMatchObject({ ok: false, error: "Codeberg returned HTTP 503 with an HTML page instead of JSON" });
  });

  it("flags a successful status with a non-JSON body", () => {
    const result = interpretUpstreamJson("GitLab", { status: 200, statusText: "OK", text: "Service temporarily unavailable" });

    expect(result).toEqual({
      ok: false,
      status: 200,
      error: "GitLab returned HTTP 200 OK with a non-JSON response instead of JSON",
    });
  });
});

describe("looksLikeHtml", () => {
  it("recognises doctype, html tag and content type", () => {
    expect(looksLikeHtml("<!DOCTYPE html><html>")).toBe(true);
    expect(looksLikeHtml("  <html lang=\"en\">")).toBe(true);
    expect(looksLikeHtml("plain text", "text/html; charset=utf-8")).toBe(true);
    expect(looksLikeHtml('{"a":1}', "application/json")).toBe(false);
    expect(looksLikeHtml("<svg></svg>")).toBe(false);
  });
});
