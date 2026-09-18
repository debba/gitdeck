import type { GrowthSettings } from "../../types/growth";
import {
  createDefaultGrowthSettings,
  normalizeGrowthSettings,
} from "../../utils/growth/settings";
import { deletePreference, getPreference, setPreference } from "../preferenceStore";

const GROWTH_SETTINGS_SCOPE = "growth";

export function growthSettingsPreferenceKey(accountId: string): string {
  return `settings:${accountId}`;
}

export function getGrowthSettings(accountId: string): GrowthSettings {
  const stored = getPreference<unknown>(
    GROWTH_SETTINGS_SCOPE,
    growthSettingsPreferenceKey(accountId),
    null,
  );
  if (stored === null) return createDefaultGrowthSettings();
  try {
    return normalizeGrowthSettings(stored);
  } catch {
    return createDefaultGrowthSettings();
  }
}

export function saveGrowthSettings(accountId: string, value: unknown): GrowthSettings {
  const settings = normalizeGrowthSettings(value);
  setPreference(GROWTH_SETTINGS_SCOPE, growthSettingsPreferenceKey(accountId), settings);
  return normalizeGrowthSettings(settings);
}

export function resetGrowthSettings(accountId: string): GrowthSettings {
  deletePreference(GROWTH_SETTINGS_SCOPE, growthSettingsPreferenceKey(accountId));
  return createDefaultGrowthSettings();
}
