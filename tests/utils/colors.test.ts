import { describe, expect, it } from "vitest";
import { getContrastColor, getLabelCssVars, getLanguageColor, rgbToHsl } from "../../src/utils/colors";

describe("color utilities", () => {
  it("selects readable contrast colors", () => {
    expect(getContrastColor("ffffff")).toBe("#0a0c12");
    expect(getContrastColor("000000")).toBe("#e7eaf3");
    expect(getContrastColor("")).toBe("#e7eaf3");
  });

  it("returns stable language colors", () => {
    expect(getLanguageColor("TypeScript")).toBe(getLanguageColor("TypeScript"));
    expect(getLanguageColor("")).toBe("#6e7280");
  });

  it("converts RGB to HSL", () => {
    expect(rgbToHsl(255, 0, 0)).toEqual([0, 100, 50]);
    expect(rgbToHsl(0, 255, 0)).toEqual([120, 100, 50]);
    expect(rgbToHsl(0, 0, 255)).toEqual([240, 100, 50]);
    expect(rgbToHsl(255, 255, 255)).toEqual([0, 0, 100]);
    expect(rgbToHsl(0, 0, 0)).toEqual([0, 0, 0]);
  });

  it("emits Primer-style CSS variables for label colors", () => {
    const vars = getLabelCssVars("fbca04");
    expect(vars).toBeDefined();
    expect(vars).toMatchObject({
      "--label-r": "251",
      "--label-g": "202",
      "--label-b": "4",
    });
    expect(vars && vars["--label-h"]).toMatch(/^\d+$/);
    expect(vars && vars["--label-s"]).toMatch(/^\d+$/);
    expect(vars && vars["--label-l"]).toMatch(/^\d+$/);
  });

  it("accepts hex colors with leading hash", () => {
    expect(getLabelCssVars("#0e8a16")).toMatchObject({
      "--label-r": "14",
      "--label-g": "138",
      "--label-b": "22",
    });
  });

  it("returns undefined for invalid hex inputs", () => {
    expect(getLabelCssVars("")).toBeUndefined();
    expect(getLabelCssVars("abc")).toBeUndefined();
    expect(getLabelCssVars("zzzzzz")).toBeUndefined();
  });
});
