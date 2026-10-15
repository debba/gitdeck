import type { CreateGrowthCardInput, GrowthCardTemplate } from "../../types/growth";

export interface GrowthCardFormFields {
  title: string;
  alt: string;
  version: string;
  highlights: string;
  milestoneValue: string;
  milestoneLabel: string;
  milestoneDetail: string;
  stats: string;
  quote: string;
  attribution: string;
  whatsNewItems: string;
}

export const EMPTY_GROWTH_CARD_FORM: GrowthCardFormFields = {
  title: "",
  alt: "",
  version: "",
  highlights: "",
  milestoneValue: "",
  milestoneLabel: "",
  milestoneDetail: "",
  stats: "",
  quote: "",
  attribution: "",
  whatsNewItems: "",
};

function nonEmptyLines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

/** Converts the template-specific Library form into the shared API contract. */
export function createGrowthCardInputFromForm(
  repository: string,
  template: GrowthCardTemplate,
  fields: GrowthCardFormFields,
): CreateGrowthCardInput | null {
  const common = {
    repository,
    title: fields.title.trim(),
    alt: fields.alt.trim(),
  };
  if (!common.title || !common.alt) return null;
  switch (template) {
    case "release": {
      const highlights = nonEmptyLines(fields.highlights);
      if (!fields.version.trim() || highlights.length === 0 || highlights.length > 4) return null;
      return { ...common, template, data: { version: fields.version.trim(), highlights } };
    }
    case "milestone": {
      const value = Number(fields.milestoneValue);
      if (
        !fields.milestoneValue.trim()
        || !fields.milestoneLabel.trim()
        || !fields.milestoneDetail.trim()
        || !Number.isSafeInteger(value)
        || value < 0
        || value > 999_999_999
      ) return null;
      return {
        ...common,
        template,
        data: {
          value,
          label: fields.milestoneLabel.trim(),
          detail: fields.milestoneDetail.trim(),
        },
      };
    }
    case "stats": {
      const stats = nonEmptyLines(fields.stats).map((line) => {
        const separator = line.lastIndexOf(":");
        const label = separator < 0 ? "" : line.slice(0, separator).trim();
        const value = Number(separator < 0 ? "" : line.slice(separator + 1).trim());
        return { label, value };
      });
      if (
        stats.length === 0
        || stats.length > 4
        || stats.some(({ label, value }) => (
          !label || !Number.isFinite(value) || value < -1_000_000_000_000 || value > 1_000_000_000_000
        ))
      ) return null;
      return { ...common, template, data: { stats } };
    }
    case "quote":
      if (!fields.quote.trim() || !fields.attribution.trim()) return null;
      return {
        ...common,
        template,
        data: { quote: fields.quote.trim(), attribution: fields.attribution.trim() },
      };
    case "whats-new": {
      const items = nonEmptyLines(fields.whatsNewItems);
      if (items.length === 0 || items.length > 5) return null;
      return { ...common, template, data: { items } };
    }
  }
}
