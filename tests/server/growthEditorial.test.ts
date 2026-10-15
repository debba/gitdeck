import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("../../src/server/ai/client", async (actual) => ({
  ...await actual<typeof import("../../src/server/ai/client")>(), generateStructured: mocks.generate,
}));
import { generateEditorial } from "../../src/server/growth/editorial";
import { AiRequestError } from "../../src/server/ai/client";

const request = {
  instructions: "Draft a technical post in Italian.",
  input: JSON.stringify({ readme: "Drivers use JSON-RPC over stdin/stdout.", openPR: "Reduce latency" }),
  schemaName: "test_draft",
  schema: { type: "object" as const, properties: { body: { type: "string" } }, required: ["body"] },
  maxOutputTokens: 1000,
};
const good = { scores: { grounding: 5, specificity: 4, readerValue: 4, structure: 4 }, issues: [], blockingIssues: [] };
const weak = { scores: { grounding: 2, specificity: 2, readerValue: 2, structure: 3 }, issues: [], blockingIssues: ["'10x faster' is unsupported. Explain the documented protocol instead."] };
const usable = { scores: { grounding: 4, specificity: 3, readerValue: 3, structure: 3 }, issues: ["Use a more distinctive opening."], blockingIssues: [] };
const validate = (answer: { body: string }) => answer?.body?.trim() ? null : "Missing body";

beforeEach(() => mocks.generate.mockReset());

describe("bounded editorial generation", () => {
  it("reviews a valid first draft against the same evidence and requirements", async () => {
    mocks.generate.mockResolvedValueOnce({ data: { body: "A useful supported explanation" } }).mockResolvedValueOnce({ data: good });
    await expect(generateEditorial(request, validate)).resolves.toEqual({ body: "A useful supported explanation" });
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    const reviewRequest = mocks.generate.mock.calls[1][0];
    expect(JSON.parse(reviewRequest.input)).toMatchObject({ evidence: request.input, requirements: request.instructions });
    expect(reviewRequest.instructions).toContain("untrusted data");
  });

  it("passes specific feedback and the previous draft to a single revision, then re-reviews", async () => {
    mocks.generate.mockResolvedValueOnce({ data: { body: "10x faster" } })
      .mockResolvedValueOnce({ data: weak })
      .mockResolvedValueOnce({ data: { body: "JSON-RPC isolates the driver protocol." } })
      .mockResolvedValueOnce({ data: good });
    await expect(generateEditorial(request, validate)).resolves.toEqual({ body: "JSON-RPC isolates the driver protocol." });
    expect(mocks.generate).toHaveBeenCalledTimes(4);
    expect(JSON.parse(mocks.generate.mock.calls[2][0].input)).toEqual({
      originalInput: request.input, previousDraft: { body: "10x faster" }, editorialFeedback: weak,
    });
  });

  it("rejects persistent weak content instead of silently returning it or a generic fallback", async () => {
    mocks.generate.mockResolvedValueOnce({ data: { body: "Weak" } }).mockResolvedValueOnce({ data: weak })
      .mockResolvedValueOnce({ data: { body: "Still weak" } }).mockResolvedValueOnce({ data: weak });
    await expect(generateEditorial(request, validate)).rejects.toThrow(/Unresolved review issues: '10x faster' is unsupported/);
    expect(mocks.generate).toHaveBeenCalledTimes(4);
  });

  it("repairs invalid format before spending a call on review", async () => {
    mocks.generate.mockResolvedValueOnce({ data: { body: "" } })
      .mockResolvedValueOnce({ data: { body: "Repaired" } }).mockResolvedValueOnce({ data: good });
    await expect(generateEditorial(request, validate)).resolves.toEqual({ body: "Repaired" });
    expect(mocks.generate.mock.calls.map(([req]) => req.schemaName)).toEqual(["test_draft", "test_draft", "growth_editorial_review"]);
    expect(JSON.parse(mocks.generate.mock.calls[1][0].input).editorialFeedback.issues).toEqual(["Missing body"]);
  });

  it("returns a grounded revision despite non-perfect scores and remaining stylistic feedback", async () => {
    mocks.generate.mockResolvedValueOnce({ data: { body: "Grounded explanation" } }).mockResolvedValueOnce({ data: usable })
      .mockResolvedValueOnce({ data: { body: "Improved grounded explanation" } }).mockResolvedValueOnce({ data: usable });
    await expect(generateEditorial(request, validate)).resolves.toEqual({ body: "Improved grounded explanation" });
    expect(mocks.generate).toHaveBeenCalledTimes(4);
  });

  it.each(["format", "grounding"])("retains a grounded initial draft if the revision regresses in %s", async (failure) => {
    mocks.generate.mockResolvedValueOnce({ data: { body: "Usable initial draft" } }).mockResolvedValueOnce({ data: usable })
      .mockResolvedValueOnce({ data: { body: failure === "format" ? "" : "10x faster" } });
    if (failure === "grounding") mocks.generate.mockResolvedValueOnce({ data: weak });
    await expect(generateEditorial(request, validate)).resolves.toEqual({ body: "Usable initial draft" });
  });

  it("rejects explicit blockers even when the reviewer assigns perfect scores", async () => {
    mocks.generate.mockResolvedValueOnce({ data: { body: "Wrong language" } })
      .mockResolvedValueOnce({ data: { ...good, blockingIssues: ["The text must be in Italian."] } })
      .mockResolvedValueOnce({ data: { body: "Still wrong" } })
      .mockResolvedValueOnce({ data: { ...good, blockingIssues: ["The text must be in Italian."] } });
    await expect(generateEditorial(request, validate)).rejects.toThrow("The text must be in Italian.");
  });

  it("reports the actual format failure rather than suggesting richer sources", async () => {
    mocks.generate.mockResolvedValue({ data: { body: "" } });
    await expect(generateEditorial(request, validate)).rejects.toThrow("Invalid format: Missing body");
    expect(mocks.generate).toHaveBeenCalledTimes(2);
  });

  it("fails closed on malformed review or provider error", async () => {
    mocks.generate.mockResolvedValueOnce({ data: { body: "Draft" } }).mockResolvedValueOnce({ data: { approved: true } });
    await expect(generateEditorial(request, validate)).rejects.toBeInstanceOf(AiRequestError);
    mocks.generate.mockResolvedValueOnce({ data: { body: "Draft" } }).mockRejectedValueOnce(new AiRequestError("offline"));
    await expect(generateEditorial(request, validate)).rejects.toThrow("offline");
  });
});
