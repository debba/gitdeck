import { describe, expect, it } from "vitest";
import {
  growthRepositoryPath,
  growthRepositorySwitchPath,
  parseGrowthWorkspacePath,
} from "../../src/utils/growthRoutes";

describe("Growth Studio routes", () => {
  it("parses validated workspace routes", () => {
    expect(parseGrowthWorkspacePath("/growth/r/openai/codex")).toEqual({
      repository: "openai/codex",
      panel: null,
    });
    expect(parseGrowthWorkspacePath("/growth/r/openai/codex/missions/")).toEqual({
      repository: "openai/codex",
      panel: "missions",
    });
  });

  it("rejects malformed repositories, panels, and extra segments", () => {
    expect(parseGrowthWorkspacePath("/growth/r/openai/codex/unknown")).toBeNull();
    expect(parseGrowthWorkspacePath("/growth/r/openai/codex/review/extra")).toBeNull();
    expect(parseGrowthWorkspacePath("/growth/r/openai%2Fother/codex")).toBeNull();
    expect(parseGrowthWorkspacePath("/growth/r/openai/%E0%A4%A")).toBeNull();
  });

  it("builds repository routes and retains a workspace panel on switch", () => {
    expect(growthRepositoryPath("openai/codex")).toBe("/growth/r/openai/codex");
    expect(growthRepositoryPath("openai/codex", "calendar")).toBe("/growth/r/openai/codex/calendar");
    expect(growthRepositoryPath("invalid")).toBeNull();
    expect(growthRepositorySwitchPath("acme/docs", "/growth/r/openai/codex/library")).toBe(
      "/growth/r/acme/docs/library",
    );
    expect(growthRepositorySwitchPath("acme/docs", "/growth/review")).toBe("/growth/r/acme/docs");
  });
});
