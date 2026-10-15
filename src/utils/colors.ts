import type { CSSProperties } from "react";

export function getContrastColor(hex: string): "#0a0c12" | "#e7eaf3" {
  if (!hex || hex.length < 6) return "#e7eaf3";
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return 0.299 * red + 0.587 * green + 0.114 * blue > 140 ? "#0a0c12" : "#e7eaf3";
}

export function getLanguageColor(name: string): string {
  if (!name) return "#6e7280";
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 68% 56%)`;
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness * 100];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue: number;
  if (max === rn) hue = (gn - bn) / delta + (gn < bn ? 6 : 0);
  else if (max === gn) hue = (bn - rn) / delta + 2;
  else hue = (rn - gn) / delta + 4;
  return [hue * 60, saturation * 100, lightness * 100];
}

export function getLabelCssVars(hex: string): CSSProperties | undefined {
  const cleaned = (hex || "").replace("#", "").trim();
  if (cleaned.length < 6) return undefined;
  const r = Number.parseInt(cleaned.slice(0, 2), 16);
  const g = Number.parseInt(cleaned.slice(2, 4), 16);
  const b = Number.parseInt(cleaned.slice(4, 6), 16);
  if ([r, g, b].some((value) => Number.isNaN(value))) return undefined;
  const [h, s, l] = rgbToHsl(r, g, b);
  return {
    "--label-r": String(r),
    "--label-g": String(g),
    "--label-b": String(b),
    "--label-h": Math.round(h).toString(),
    "--label-s": Math.round(s).toString(),
    "--label-l": Math.round(l).toString(),
  } as CSSProperties;
}
