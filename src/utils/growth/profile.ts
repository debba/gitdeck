import {
  GROWTH_CHANNELS,
  type GrowthCadence,
  type GrowthChannelSelection,
  type GrowthPillar,
  type GrowthPostingWindow,
  type GrowthProfileInput,
} from "../../types/growth";

const PROFILE_FIELDS = [
  "language",
  "voice",
  "audience",
  "channels",
  "cadence",
  "pillars",
  "hashtags",
  "avoid",
  "timezone",
  "postingWindows",
  "color",
] as const;

export function createGrowthPillarId(pillars: readonly GrowthPillar[]): string {
  let suffix = pillars.length + 1;
  while (pillars.some(({ id }) => id === `pillar-${suffix}`)) suffix += 1;
  return `pillar-${suffix}`;
}

export class GrowthProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrowthProfileValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function requiredString(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== "string") throw new GrowthProfileValidationError(`${field} must be a string`);
  const normalized = value.trim();
  if (!allowEmpty && normalized.length === 0) {
    throw new GrowthProfileValidationError(`${field} must not be empty`);
  }
  return normalized;
}

function normalizeChannels(value: unknown): GrowthChannelSelection {
  if (!isRecord(value) || !hasExactKeys(value, GROWTH_CHANNELS)) {
    throw new GrowthProfileValidationError("channels must contain every supported channel");
  }
  for (const channel of GROWTH_CHANNELS) {
    if (typeof value[channel] !== "boolean") {
      throw new GrowthProfileValidationError(`channels.${channel} must be a boolean`);
    }
  }
  return Object.fromEntries(GROWTH_CHANNELS.map((channel) => [channel, value[channel]])) as GrowthChannelSelection;
}

export function normalizeGrowthCadence(value: unknown): GrowthCadence {
  if (!isRecord(value) || !hasExactKeys(value, GROWTH_CHANNELS)) {
    throw new GrowthProfileValidationError("cadence must contain every supported channel");
  }
  for (const channel of GROWTH_CHANNELS) {
    const cadence = value[channel];
    if (!Number.isInteger(cadence) || (cadence as number) < 0 || (cadence as number) > 14) {
      throw new GrowthProfileValidationError(`cadence.${channel} must be an integer from 0 through 14`);
    }
  }
  return Object.fromEntries(GROWTH_CHANNELS.map((channel) => [channel, value[channel]])) as GrowthCadence;
}

export function normalizeGrowthPillars(value: unknown): GrowthPillar[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new GrowthProfileValidationError("pillars must contain at least one pillar");
  }
  const ids = new Set<string>();
  const pillars = value.map((entry, index) => {
    if (!isRecord(entry) || !hasExactKeys(entry, ["id", "label", "weight", "description"])) {
      throw new GrowthProfileValidationError(`pillars.${index} is invalid`);
    }
    const id = requiredString(entry.id, `pillars.${index}.id`).toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || ids.has(id)) {
      throw new GrowthProfileValidationError("pillar IDs must be unique non-empty slugs");
    }
    ids.add(id);
    if (!Number.isInteger(entry.weight) || (entry.weight as number) < 0 || (entry.weight as number) > 100) {
      throw new GrowthProfileValidationError(`pillars.${index}.weight must be an integer from 0 through 100`);
    }
    return {
      id,
      label: requiredString(entry.label, `pillars.${index}.label`),
      weight: entry.weight as number,
      description: requiredString(entry.description, `pillars.${index}.description`, true),
    };
  });
  if (!pillars.some(({ weight }) => weight > 0)) {
    throw new GrowthProfileValidationError("at least one pillar must have a positive weight");
  }
  return pillars;
}

function normalizeHashtags(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((hashtag) => typeof hashtag !== "string")) {
    throw new GrowthProfileValidationError("hashtags must be an array of strings");
  }
  const seen = new Set<string>();
  return value.flatMap((hashtag) => {
    const normalized = hashtag.trim();
    const key = normalized.toLocaleLowerCase("en-US");
    if (!normalized || seen.has(key)) return [];
    seen.add(key);
    return [normalized];
  });
}

function normalizePostingWindows(value: unknown): GrowthPostingWindow[] {
  if (!Array.isArray(value)) {
    throw new GrowthProfileValidationError("postingWindows must be an array");
  }
  return value.map((entry, index) => {
    if (!isRecord(entry) || !hasExactKeys(entry, ["weekday", "hour"])) {
      throw new GrowthProfileValidationError(`postingWindows.${index} is invalid`);
    }
    if (!Number.isInteger(entry.weekday) || (entry.weekday as number) < 1 || (entry.weekday as number) > 7) {
      throw new GrowthProfileValidationError(`postingWindows.${index}.weekday must be an integer from 1 through 7`);
    }
    if (!Number.isInteger(entry.hour) || (entry.hour as number) < 0 || (entry.hour as number) > 23) {
      throw new GrowthProfileValidationError(`postingWindows.${index}.hour must be an integer from 0 through 23`);
    }
    return { weekday: entry.weekday as number, hour: entry.hour as number };
  });
}

export function normalizeGrowthTimezone(value: unknown): string {
  const timezone = requiredString(value, "timezone");
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    throw new GrowthProfileValidationError("timezone must be a valid IANA timezone");
  }
  return timezone;
}

export function normalizeGrowthProfileInput(value: unknown): GrowthProfileInput {
  if (!isRecord(value) || !hasExactKeys(value, PROFILE_FIELDS)) {
    throw new GrowthProfileValidationError("profile must be a complete document without unknown fields");
  }
  const color = requiredString(value.color, "color").toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(color)) {
    throw new GrowthProfileValidationError("color must use #RRGGBB format");
  }
  return {
    language: requiredString(value.language, "language"),
    voice: requiredString(value.voice, "voice", true),
    audience: requiredString(value.audience, "audience", true),
    channels: normalizeChannels(value.channels),
    cadence: normalizeGrowthCadence(value.cadence),
    pillars: normalizeGrowthPillars(value.pillars),
    hashtags: normalizeHashtags(value.hashtags),
    avoid: requiredString(value.avoid, "avoid", true),
    timezone: normalizeGrowthTimezone(value.timezone),
    postingWindows: normalizePostingWindows(value.postingWindows),
    color,
  };
}
