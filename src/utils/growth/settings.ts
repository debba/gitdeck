import type { GrowthSettings } from "../../types/growth";
import {
  DEFAULT_GROWTH_CADENCE,
  DEFAULT_GROWTH_PILLARS,
} from "./profileDefaults";
import {
  GrowthProfileValidationError,
  normalizeGrowthCadence,
  normalizeGrowthPillars,
  normalizeGrowthTimezone,
} from "./profile";

const SETTINGS_FIELDS = ["timezone", "cadence", "pillars"] as const;

export class GrowthSettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrowthSettingsValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

export function createDefaultGrowthSettings(): GrowthSettings {
  return {
    timezone: "UTC",
    cadence: { ...DEFAULT_GROWTH_CADENCE },
    pillars: DEFAULT_GROWTH_PILLARS.map((pillar) => ({ ...pillar })),
  };
}

export function normalizeGrowthSettings(value: unknown): GrowthSettings {
  if (!isRecord(value) || !hasExactKeys(value, SETTINGS_FIELDS)) {
    throw new GrowthSettingsValidationError(
      "settings must be a complete document without unknown fields",
    );
  }
  try {
    return {
      timezone: normalizeGrowthTimezone(value.timezone),
      cadence: normalizeGrowthCadence(value.cadence),
      pillars: normalizeGrowthPillars(value.pillars),
    };
  } catch (error) {
    if (error instanceof GrowthProfileValidationError) {
      throw new GrowthSettingsValidationError(error.message);
    }
    throw error;
  }
}
