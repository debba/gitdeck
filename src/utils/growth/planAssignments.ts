import type {
  GrowthPillar,
  GrowthPlanAssignment,
  GrowthPlanEvidence,
  GrowthPlanSlot,
} from "../../types/growth";

export interface NormalizedGrowthPlanAssignments {
  assignments: GrowthPlanAssignment[];
  usedFallback: boolean;
}

function oneLine(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizedEvidence(evidence: readonly GrowthPlanEvidence[]): GrowthPlanEvidence[] {
  const seen = new Set<string>();
  return evidence.flatMap((entry) => {
    const label = oneLine(entry.label, 180);
    const url = entry.url === null ? null : httpUrl(entry.url);
    const key = `${label ?? ""}\n${url ?? ""}`;
    if ((!label && !url) || seen.has(key)) return [];
    seen.add(key);
    return [{ label: label ?? "Repository update", url }];
  });
}

function fallbackAssignment(
  repository: string,
  slot: GrowthPlanSlot,
  pillar: GrowthPillar,
  evidence: readonly GrowthPlanEvidence[],
  index: number,
): GrowthPlanAssignment {
  const item = evidence.length > 0 ? evidence[index % evidence.length] : null;
  return {
    slotKey: slot.key,
    pillarId: slot.pillarId,
    angle: item
      ? `Highlight ${item.label} through the ${pillar.label} pillar.`
      : `Introduce ${repository} through the ${pillar.label} pillar.`,
    sources: item?.url ? [item.url] : [],
    cta: item?.url
      ? `Explore the source and learn more about ${repository}.`
      : `Explore ${repository} and join the project community.`,
  };
}

/** Normalizes untrusted planner output and deterministically fills every missing slot. */
export function normalizeGrowthPlanAssignments(
  repository: string,
  slots: readonly GrowthPlanSlot[],
  pillars: readonly GrowthPillar[],
  evidenceInput: readonly GrowthPlanEvidence[],
  value: unknown,
): NormalizedGrowthPlanAssignments {
  const evidence = normalizedEvidence(evidenceInput);
  const allowedSources = new Set(evidence.flatMap(({ url }) => url ? [url] : []));
  const positivePillars = pillars.filter(({ weight }) => weight > 0);
  const pillarsById = new Map(positivePillars.map((pillar) => [pillar.id, pillar]));
  const candidates = Array.isArray(value) ? value : [];
  const candidatesBySlot = new Map<string, Record<string, unknown>>();

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const record = candidate as Record<string, unknown>;
    if (typeof record.slotKey !== "string" || candidatesBySlot.has(record.slotKey)) continue;
    candidatesBySlot.set(record.slotKey, record);
  }

  let usedFallback = false;
  const assignments = slots.map((slot, index) => {
    const candidate = candidatesBySlot.get(slot.key);
    const angle = oneLine(candidate?.angle, 240);
    const cta = oneLine(candidate?.cta, 200);
    if (!candidate || !angle || !cta) {
      usedFallback = true;
      const pillar = pillarsById.get(slot.pillarId) ?? positivePillars[0] ?? {
        id: slot.pillarId,
        label: slot.pillarId,
        weight: 1,
        description: "",
      };
      return fallbackAssignment(repository, slot, pillar, evidence, index);
    }

    const pillarId = typeof candidate.pillarId === "string" && pillarsById.has(candidate.pillarId)
      ? candidate.pillarId
      : slot.pillarId;
    const sources = Array.isArray(candidate.sources)
      ? [...new Set(candidate.sources.flatMap((source) => {
        const normalized = httpUrl(source);
        return normalized && allowedSources.has(normalized) ? [normalized] : [];
      }))]
      : [];
    return { slotKey: slot.key, pillarId, angle, sources, cta };
  });

  return { assignments, usedFallback };
}
