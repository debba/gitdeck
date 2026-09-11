import type {
  GrowthCadence,
  GrowthChannelSelection,
  GrowthPillar,
  GrowthProfile,
  GrowthSettings,
} from "../../types/growth";

const PROFILE_COLORS = [
  "#2563EB",
  "#7C3AED",
  "#BE123C",
  "#047857",
  "#0369A1",
  "#C2410C",
  "#4338CA",
  "#0F766E",
] as const;

export const DEFAULT_GROWTH_CHANNELS: GrowthChannelSelection = {
  x: true,
  linkedin: true,
  mastodon: true,
  bluesky: false,
  discussion: false,
  blog: false,
};

export const DEFAULT_GROWTH_CADENCE: GrowthCadence = {
  x: 3,
  linkedin: 1,
  mastodon: 3,
  bluesky: 0,
  discussion: 0,
  blog: 0,
};

export const DEFAULT_GROWTH_PILLARS: readonly GrowthPillar[] = [
  { id: "product", label: "Product value", weight: 20, description: "Show what the project helps people achieve." },
  { id: "releases", label: "Releases", weight: 20, description: "Explain new releases, features, and improvements." },
  { id: "education", label: "Education", weight: 20, description: "Teach practical workflows and project concepts." },
  { id: "community", label: "Community", weight: 20, description: "Highlight contributors, discussions, and participation." },
  { id: "engineering", label: "Engineering", weight: 20, description: "Share technical decisions and behind-the-scenes work." },
];

export function growthProfileColor(repository: string): string {
  let hash = 2166136261;
  for (const character of repository) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return PROFILE_COLORS[(hash >>> 0) % PROFILE_COLORS.length];
}

export function createDefaultGrowthProfile(
  accountId: string,
  repository: string,
  settings?: GrowthSettings,
): GrowthProfile {
  return {
    accountId,
    repository,
    language: "en",
    voice: "",
    audience: "",
    channels: { ...DEFAULT_GROWTH_CHANNELS },
    cadence: { ...(settings?.cadence ?? DEFAULT_GROWTH_CADENCE) },
    pillars: (settings?.pillars ?? DEFAULT_GROWTH_PILLARS).map((pillar) => ({ ...pillar })),
    hashtags: [],
    avoid: "",
    timezone: settings?.timezone ?? "UTC",
    postingWindows: [],
    color: growthProfileColor(repository),
    updatedAt: "1970-01-01T00:00:00.000Z",
  };
}
