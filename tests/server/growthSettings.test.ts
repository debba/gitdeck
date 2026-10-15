import { rm } from "node:fs/promises";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { TMP_DIR } = vi.hoisted(() => {
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { resolve } = require("node:path") as typeof import("node:path");
  return { TMP_DIR: resolve(tmpdir(), `gitdeck-growth-settings-${process.pid}-${Date.now()}`) };
});

vi.mock("../../src/server/config", () => ({ DATA_DIR: TMP_DIR }));

const settings = await import("../../src/server/growth/settings");
const growthStore = await import("../../src/server/growth/store");
const { closeDatabase, getDatabase } = await import("../../src/server/sqlite");

function settingsInput(label = "Product value") {
  return {
    timezone: " Europe/Rome ",
    cadence: { x: 4, linkedin: 2, mastodon: 1, bluesky: 0, discussion: 0, blog: 0 },
    pillars: [{ id: "Product", label: ` ${label} `, weight: 100, description: " Outcomes " }],
  };
}

beforeEach(async () => {
  closeDatabase();
  await rm(TMP_DIR, { recursive: true, force: true });
});

afterAll(async () => {
  closeDatabase();
  await rm(TMP_DIR, { recursive: true, force: true });
});

describe("Growth settings persistence", () => {
  it("returns defensive defaults without inserting an override", () => {
    const first = settings.getGrowthSettings("account-a");
    const second = settings.getGrowthSettings("account-a");

    first.cadence.x = 0;
    first.pillars[0].label = "Changed";
    expect(second).toMatchObject({ timezone: "UTC", cadence: { x: 3 } });
    expect(second.pillars[0].label).toBe("Product value");
    expect(getDatabase().prepare(
      "SELECT COUNT(*) AS count FROM preferences WHERE scope = 'growth' AND key = ?",
    ).get(settings.growthSettingsPreferenceKey("account-a"))).toEqual({ count: 0 });
  });

  it("normalizes writes and isolates save and reset by account", () => {
    expect(settings.growthSettingsPreferenceKey("account-a")).toBe("settings:account-a");
    const savedA = settings.saveGrowthSettings("account-a", settingsInput());
    const savedB = settings.saveGrowthSettings("account-b", {
      ...settingsInput("Community italiana"),
      timezone: "America/New_York",
    });

    expect(savedA).toEqual({
      timezone: "Europe/Rome",
      cadence: settingsInput().cadence,
      pillars: [{ id: "product", label: "Product value", weight: 100, description: "Outcomes" }],
    });
    expect(JSON.parse((getDatabase().prepare(
      "SELECT value FROM preferences WHERE scope = 'growth' AND key = ?",
    ).get(settings.growthSettingsPreferenceKey("account-a")) as { value: string }).value)).toEqual(savedA);
    savedA.pillars[0].label = "Changed";
    expect(settings.getGrowthSettings("account-a").pillars[0].label).toBe("Product value");

    expect(settings.resetGrowthSettings("account-a").timezone).toBe("UTC");
    expect(settings.getGrowthSettings("account-a").timezone).toBe("UTC");
    expect(settings.getGrowthSettings("account-b")).toEqual(savedB);
    expect(settings.getGrowthSettings("account-b").pillars[0].label).toBe("Community italiana");
  });

  it("fails closed to defaults for corrupt JSON and invalid stored documents", () => {
    settings.getGrowthSettings("account-a");
    const database = getDatabase();
    const insert = database.prepare(
      "INSERT OR REPLACE INTO preferences (scope, key, value, updated_at) VALUES ('growth', ?, ?, ?)",
    );
    insert.run(settings.growthSettingsPreferenceKey("account-a"), "{broken", "2026-09-04T00:00:00.000Z");
    insert.run(
      settings.growthSettingsPreferenceKey("account-b"),
      JSON.stringify({ timezone: "Mars/Olympus", cadence: {}, pillars: [] }),
      "2026-09-04T00:00:00.000Z",
    );

    expect(settings.getGrowthSettings("account-a").timezone).toBe("UTC");
    expect(settings.getGrowthSettings("account-b").timezone).toBe("UTC");
  });

  it("reuses the preference schema without changing repository profiles or other preferences", () => {
    growthStore.ensureGrowthSchema();
    const profile = growthStore.upsertGrowthProfile("account-a", "acme/repo", {
      language: "it",
      voice: "Diretta",
      audience: "Maintainer",
      channels: { x: true, linkedin: true, mastodon: true, bluesky: false, discussion: false, blog: false },
      cadence: { x: 1, linkedin: 1, mastodon: 1, bluesky: 0, discussion: 0, blog: 0 },
      pillars: [{ id: "release", label: "Rilasci", weight: 100, description: "Novità" }],
      hashtags: ["#opensource"],
      avoid: "Hype",
      timezone: "UTC",
      postingWindows: [],
      color: "#2563EB",
    });
    const database = getDatabase();
    database.prepare(
      "INSERT OR REPLACE INTO preferences (scope, key, value, updated_at) VALUES (?, ?, ?, ?)",
    ).run("other", "retained", JSON.stringify({ enabled: true }), "2026-09-04T00:00:00.000Z");

    settings.saveGrowthSettings("account-a", settingsInput("Valore prodotto"));
    settings.saveGrowthSettings("account-a", settingsInput("Valore prodotto"));
    settings.resetGrowthSettings("account-a");

    expect(growthStore.getGrowthProfile("account-a", "acme/repo")).toEqual(profile);
    expect(database.prepare("SELECT value FROM preferences WHERE scope = ? AND key = ?")
      .get("other", "retained")).toEqual({ value: JSON.stringify({ enabled: true }) });
    expect(database.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'preferences'",
    ).get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM growth_profiles").get()).toEqual({ count: 1 });
  });
});
