import { describe, expect, it } from "vitest";
import { extractWebsiteEvidence } from "../../../src/utils/growth/websiteEvidence";

describe("website evidence extraction", () => {
  it("extracts article substance instead of navigation, scripts and footer boilerplate", () => {
    const text = "The driver speaks JSON-RPC over stdin and stdout. Process isolation contains crashes, but introduces serialization overhead. ";
    const result = extractWebsiteEvidence(`<!doctype html><html><head><title>Driver isolation</title></head><body>
      <nav>${"Buy now. ".repeat(200)}</nav><article><h1>Driver isolation</h1>
      <p>${text.repeat(8)}</p><p>Run the documented example before choosing a driver.</p>
      <img src="./driver.png"></article><footer>Subscribe to the newsletter</footer>
      <script>globalThis.compromised = true</script><div hidden>Hidden promotion</div></body></html>`, "https://example.com/docs/design");
    expect(result.title).toContain("Driver isolation");
    expect(result.excerpt).toContain("serialization overhead");
    expect(result.excerpt).not.toMatch(/Buy now|Subscribe|compromised|Hidden promotion/);
    expect(result.mediaUrls).toEqual(["https://example.com/docs/driver.png"]);
    expect((globalThis as Record<string, unknown>).compromised).toBeUndefined();
  });

  it("retains short product pages, decodes entities and bounds excerpts", () => {
    const result = extractWebsiteEvidence("<html><head><title>A &amp; B</title></head><body><main><p>Small &amp; useful CLI.</p></main></body></html>", "https://example.com", true, 14);
    expect(result.title).toBe("A & B");
    expect(result.excerpt).toBe("Small & useful");
  });

  it("preserves paragraph boundaries and indentation in technical examples", () => {
    const result = extractWebsiteEvidence("<html><body><main><p>Configure the driver.</p><pre>driver:\n  transport: stdio\n  timeout: 30</pre><p>Then restart it.</p></main></body></html>", "https://example.com");
    expect(result.excerpt).toContain("driver:\n  transport: stdio\n  timeout: 30");
    expect(result.excerpt).toMatch(/Configure the driver\.\n+driver:/);
    expect(result.excerpt).toMatch(/timeout: 30\n+Then restart it\./);
  });

  it("does not interpret plain text examples as HTML", () => {
    expect(extractWebsiteEvidence("Use <driver> & config\nnext line", "https://example.com", false)).toEqual({
      title: null, excerpt: "Use <driver> & config\nnext line", mediaUrls: [],
    });
  });
});
