import {
  GROWTH_CARD_TEMPLATES,
  type GrowthCardData,
  type GrowthCardDataByTemplate,
  type GrowthCardTemplate,
} from "../../types/growth";
import { parseRepositoryName } from "../../utils/repository";

export const GROWTH_CARD_WIDTH = 1200;
export const GROWTH_CARD_HEIGHT = 675;

const TEMPLATE_LABELS: Record<GrowthCardTemplate, string> = {
  release: "Release",
  milestone: "Milestone",
  stats: "Project stats",
  quote: "Community voice",
  "whats-new": "What's new",
};

export class GrowthCardValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrowthCardValidationError";
  }
}

export interface NormalizedGrowthCard {
  template: GrowthCardTemplate;
  data: GrowthCardData;
}

export interface RenderGrowthCardInput {
  repository: string;
  color: string;
  template: unknown;
  title: unknown;
  alt: unknown;
  data: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function requiredText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") throw new GrowthCardValidationError(`${field} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new GrowthCardValidationError(`${field} must contain 1 through ${maximum} safe characters`);
  }
  return normalized;
}

function boundedStringArray(
  value: unknown,
  field: string,
  maximumItems: number,
  maximumLength: number,
): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumItems) {
    throw new GrowthCardValidationError(`${field} must contain 1 through ${maximumItems} items`);
  }
  return value.map((entry, index) => requiredText(entry, `${field}.${index}`, maximumLength));
}

function boundedNumber(value: unknown, field: string, options: { integer?: boolean; minimum: number; maximum: number }): number {
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || (options.integer === true && !Number.isSafeInteger(value))
    || value < options.minimum
    || value > options.maximum
  ) {
    throw new GrowthCardValidationError(`${field} must be a bounded number`);
  }
  return value;
}

export function normalizeGrowthCard(template: unknown, data: unknown): NormalizedGrowthCard {
  if (typeof template !== "string" || !GROWTH_CARD_TEMPLATES.includes(template as GrowthCardTemplate)) {
    throw new GrowthCardValidationError("invalid card template");
  }
  if (!isRecord(data)) throw new GrowthCardValidationError("card data must be an object");

  switch (template as GrowthCardTemplate) {
    case "release": {
      if (!hasExactKeys(data, ["version", "highlights"])) {
        throw new GrowthCardValidationError("invalid release card data");
      }
      const normalized: GrowthCardDataByTemplate["release"] = {
        version: requiredText(data.version, "data.version", 80),
        highlights: boundedStringArray(data.highlights, "data.highlights", 4, 120),
      };
      return { template: "release", data: normalized };
    }
    case "milestone": {
      if (!hasExactKeys(data, ["value", "label", "detail"])) {
        throw new GrowthCardValidationError("invalid milestone card data");
      }
      const normalized: GrowthCardDataByTemplate["milestone"] = {
        value: boundedNumber(data.value, "data.value", { integer: true, minimum: 0, maximum: 999_999_999 }),
        label: requiredText(data.label, "data.label", 80),
        detail: requiredText(data.detail, "data.detail", 160),
      };
      return { template: "milestone", data: normalized };
    }
    case "stats": {
      if (!hasExactKeys(data, ["stats"]) || !Array.isArray(data.stats) || data.stats.length < 1 || data.stats.length > 4) {
        throw new GrowthCardValidationError("data.stats must contain 1 through 4 items");
      }
      const stats = data.stats.map((entry, index) => {
        if (!isRecord(entry) || !hasExactKeys(entry, ["label", "value"])) {
          throw new GrowthCardValidationError(`data.stats.${index} is invalid`);
        }
        return {
          label: requiredText(entry.label, `data.stats.${index}.label`, 40),
          value: boundedNumber(entry.value, `data.stats.${index}.value`, {
            minimum: -1_000_000_000_000,
            maximum: 1_000_000_000_000,
          }),
        };
      });
      return { template: "stats", data: { stats } };
    }
    case "quote": {
      if (!hasExactKeys(data, ["quote", "attribution"])) {
        throw new GrowthCardValidationError("invalid quote card data");
      }
      const normalized: GrowthCardDataByTemplate["quote"] = {
        quote: requiredText(data.quote, "data.quote", 280),
        attribution: requiredText(data.attribution, "data.attribution", 100),
      };
      return { template: "quote", data: normalized };
    }
    case "whats-new": {
      if (!hasExactKeys(data, ["items"])) {
        throw new GrowthCardValidationError("invalid what's-new card data");
      }
      const normalized: GrowthCardDataByTemplate["whats-new"] = {
        items: boundedStringArray(data.items, "data.items", 5, 120),
      };
      return { template: "whats-new", data: normalized };
    }
  }
}

export function escapeGrowthCardXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function truncate(value: string, maximum: number): string {
  const characters = Array.from(value);
  return characters.length <= maximum ? value : `${characters.slice(0, maximum - 1).join("")}…`;
}

function wrapText(value: string, maximumCharacters: number, maximumLines: number): string[] {
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const sourceWord of words) {
    let word = sourceWord;
    while (Array.from(word).length > maximumCharacters) {
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(Array.from(word).slice(0, maximumCharacters).join(""));
      word = Array.from(word).slice(maximumCharacters).join("");
    }
    if (!word) continue;
    const candidate = line ? `${line} ${word}` : word;
    if (Array.from(candidate).length <= maximumCharacters) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maximumLines) return lines;
  return [...lines.slice(0, maximumLines - 1), truncate(lines[maximumLines - 1], maximumCharacters - 1) + "…"];
}

function textLines(
  lines: readonly string[],
  options: { x: number; y: number; size: number; lineHeight: number; weight?: number; fill?: string },
): string {
  return lines.map((line, index) => (
    `<text x="${options.x}" y="${options.y + index * options.lineHeight}" fill="${options.fill ?? "#F8FAFC"}"`
    + ` font-family="system-ui, sans-serif" font-size="${options.size}" font-weight="${options.weight ?? 500}">`
    + `${escapeGrowthCardXml(line)}</text>`
  )).join("");
}

function releaseContent(data: GrowthCardDataByTemplate["release"]): string {
  return textLines([`Version ${truncate(data.version, 42)}`], { x: 72, y: 300, size: 28, lineHeight: 34, weight: 750, fill: "#CBD5E1" })
    + data.highlights.map((highlight, index) => (
      `<circle cx="84" cy="${367 + index * 62}" r="6" fill="#F8FAFC"/>`
      + textLines(wrapText(highlight, 62, 1), { x: 108, y: 376 + index * 62, size: 25, lineHeight: 30 })
    )).join("");
}

function milestoneContent(data: GrowthCardDataByTemplate["milestone"]): string {
  return textLines([String(data.value)], { x: 72, y: 410, size: 126, lineHeight: 130, weight: 850 })
    + textLines(wrapText(data.label, 34, 2), { x: 72, y: 474, size: 34, lineHeight: 42, weight: 750 })
    + textLines(wrapText(data.detail, 62, 2), { x: 72, y: 568, size: 23, lineHeight: 30, fill: "#CBD5E1" });
}

function statsContent(data: GrowthCardDataByTemplate["stats"]): string {
  const width = 1048 / data.stats.length;
  return data.stats.map((stat, index) => {
    const x = 72 + width * index;
    return `<rect x="${x}" y="318" width="${Math.max(180, width - 22)}" height="190" rx="24" fill="#111C31"/>`
      + textLines([truncate(String(stat.value), 16)], { x: x + 26, y: 405, size: 54, lineHeight: 60, weight: 850 })
      + textLines(wrapText(stat.label, 18, 2), { x: x + 26, y: 458, size: 21, lineHeight: 27, fill: "#CBD5E1" });
  }).join("");
}

function quoteContent(data: GrowthCardDataByTemplate["quote"]): string {
  return textLines(["“"], { x: 65, y: 342, size: 112, lineHeight: 116, weight: 850 })
    + textLines(wrapText(data.quote, 54, 4), { x: 128, y: 338, size: 33, lineHeight: 43, weight: 650 })
    + textLines([`— ${truncate(data.attribution, 70)}`], { x: 128, y: 550, size: 23, lineHeight: 28, fill: "#CBD5E1" });
}

function whatsNewContent(data: GrowthCardDataByTemplate["whats-new"]): string {
  return data.items.map((item, index) => (
    `<rect x="72" y="${323 + index * 55}" width="9" height="34" rx="4" fill="#F8FAFC"/>`
    + textLines(wrapText(item, 67, 1), { x: 105, y: 349 + index * 55, size: 25, lineHeight: 30 })
  )).join("");
}

/** Renders a validated, deterministic SVG card. It never embeds scripts, remote resources, or raster bytes. */
export function renderGrowthCard(input: RenderGrowthCardInput): string {
  if (!parseRepositoryName(input.repository)) throw new GrowthCardValidationError("invalid repository");
  if (typeof input.color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(input.color)) {
    throw new GrowthCardValidationError("invalid profile color");
  }
  const title = requiredText(input.title, "title", 500);
  const alt = requiredText(input.alt, "alt", 2_000);
  const normalized = normalizeGrowthCard(input.template, input.data);
  let content: string;
  switch (normalized.template) {
    case "release":
      content = releaseContent(normalized.data as GrowthCardDataByTemplate["release"]);
      break;
    case "milestone":
      content = milestoneContent(normalized.data as GrowthCardDataByTemplate["milestone"]);
      break;
    case "stats":
      content = statsContent(normalized.data as GrowthCardDataByTemplate["stats"]);
      break;
    case "quote":
      content = quoteContent(normalized.data as GrowthCardDataByTemplate["quote"]);
      break;
    case "whats-new":
      content = whatsNewContent(normalized.data as GrowthCardDataByTemplate["whats-new"]);
      break;
  }

  const visibleTitle = wrapText(title, 42, 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${GROWTH_CARD_WIDTH}" height="${GROWTH_CARD_HEIGHT}" viewBox="0 0 ${GROWTH_CARD_WIDTH} ${GROWTH_CARD_HEIGHT}" role="img" aria-labelledby="card-title card-description">`
    + `<title id="card-title">${escapeGrowthCardXml(title)}</title>`
    + `<desc id="card-description">${escapeGrowthCardXml(alt)}</desc>`
    + `<rect width="1200" height="675" fill="#0B1220"/>`
    + `<rect width="18" height="675" fill="${input.color.toUpperCase()}"/>`
    + `<circle cx="1080" cy="120" r="210" fill="${input.color.toUpperCase()}" opacity="0.22"/>`
    + textLines([input.repository], { x: 72, y: 72, size: 24, lineHeight: 28, weight: 700, fill: "#CBD5E1" })
    + textLines([TEMPLATE_LABELS[normalized.template]], { x: 72, y: 116, size: 18, lineHeight: 22, weight: 800, fill: input.color.toUpperCase() })
    + textLines(visibleTitle, { x: 72, y: 190, size: 46, lineHeight: 55, weight: 850 })
    + content
    + textLines(["GitDeck Growth Studio"], { x: 914, y: 632, size: 17, lineHeight: 20, weight: 700, fill: "#94A3B8" })
    + "</svg>";
}
