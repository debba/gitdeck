import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_GROWTH_RASTER_DIMENSION,
  calculateBoundedOutputDimensions,
  chooseGrowthRasterSize,
  parseSvgIntrinsicDimensions,
  rasterizeGrowthImageToPng,
  sanitizeGrowthPngFilename,
} from "../../../src/utils/growth/rasterize";

const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

interface CanvasMockOptions {
  encodedBlob?: Blob | null;
  contextAvailable?: boolean;
  drawError?: unknown;
  encodingError?: unknown;
}

function mockObjectUrls() {
  const createObjectURL = vi.fn(() => "blob:growth-raster");
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
  return { createObjectURL, revokeObjectURL };
}

function mockImage(width: number, height: number, failure = false) {
  class MockImage {
    naturalWidth = width;
    naturalHeight = height;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    set src(_value: string) {
      queueMicrotask(() => {
        if (failure) this.onerror?.();
        else this.onload?.();
      });
    }
  }
  vi.stubGlobal("Image", MockImage);
  return MockImage;
}

function mockCanvas(options: CanvasMockOptions = {}) {
  const drawImage = vi.fn(() => {
    if (options.drawError) throw options.drawError;
  });
  const context = {
    clearRect: vi.fn(),
    drawImage,
    fillRect: vi.fn(),
    fillStyle: "",
  };
  const encodedBlob = options.encodedBlob === undefined
    ? new Blob(["png"], { type: "image/png" })
    : options.encodedBlob;
  const canvas = {
    height: 0,
    width: 0,
    getContext: vi.fn(() => options.contextAvailable === false ? null : context),
    toBlob: vi.fn((callback: BlobCallback) => {
      if (options.encodingError) throw options.encodingError;
      callback(encodedBlob ?? null);
    }),
  };
  vi.spyOn(document, "createElement").mockReturnValue(canvas as unknown as HTMLCanvasElement);
  return { canvas, context, encodedBlob };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalCreateObjectUrl) Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrl);
  else delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
  if (originalRevokeObjectUrl) Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectUrl);
  else delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
});

describe("growth image dimensions", () => {
  it("parses explicit SVG dimensions before the viewBox", () => {
    expect(parseSvgIntrinsicDimensions(
      `<svg viewBox="0 0 10 10" width="1200px" height='675'></svg>`,
    )).toEqual({ width: 1200, height: 675 });
  });

  it("uses finite positive viewBox dimensions when explicit dimensions are absent", () => {
    expect(parseSvgIntrinsicDimensions(
      `<?xml version="1.0"?><svg viewBox="-20, -10, 640.5, 360"></svg>`,
    )).toEqual({ width: 640.5, height: 360 });
  });

  it("rejects malformed, zero, and non-finite SVG dimensions", () => {
    for (const svg of [
      `<svg width="100"></svg>`,
      `<svg width="0" height="20"></svg>`,
      `<svg width="Infinity" height="20"></svg>`,
      `<svg viewBox="0 0 nope 20"></svg>`,
      `<svg viewBox="0,,0,20,20"></svg>`,
      `<svg viewBox="0 0 20 0"></svg>`,
      `<div></div>`,
    ]) {
      expect(() => parseSvgIntrinsicDimensions(svg)).toThrowError(
        expect.objectContaining({ code: "dimensions" }),
      );
    }
  });

  it("chooses an exact 2x raster size while preserving aspect ratio", () => {
    const output = chooseGrowthRasterSize({ width: 1600, height: 900 });
    expect(output).toEqual({ width: 3200, height: 1800 });
    expect(output.width / output.height).toBe(16 / 9);
  });

  it("enforces dimension and total-pixel caps", () => {
    expect(calculateBoundedOutputDimensions(
      { width: 100, height: 100 },
      2,
      { maxDimension: 200, maxPixels: 40_000 },
    )).toEqual({ width: 200, height: 200 });
    expect(() => calculateBoundedOutputDimensions(
      { width: 101, height: 100 },
      2,
      { maxDimension: 200, maxPixels: 50_000 },
    )).toThrowError(expect.objectContaining({ code: "dimensions" }));
    expect(() => calculateBoundedOutputDimensions(
      { width: 100, height: 100 },
      2,
      { maxDimension: 500, maxPixels: 39_999 },
    )).toThrowError(expect.objectContaining({ code: "dimensions" }));
    expect(() => chooseGrowthRasterSize({ width: MAX_GROWTH_RASTER_DIMENSION, height: 1 }))
      .toThrowError(expect.objectContaining({ code: "dimensions" }));
  });

  it("rejects zero and non-finite sizing inputs", () => {
    for (const dimensions of [
      { width: 0, height: 10 },
      { width: 10, height: Number.NaN },
      { width: Number.POSITIVE_INFINITY, height: 10 },
    ]) {
      expect(() => chooseGrowthRasterSize(dimensions))
        .toThrowError(expect.objectContaining({ code: "dimensions" }));
    }
  });
});

describe("growth PNG filenames", () => {
  it("normalizes paths, accents, extensions, and unsafe separators", () => {
    expect(sanitizeGrowthPngFilename(" ../../Résumé launch!.svg ")).toBe("Resume-launch.png");
    expect(sanitizeGrowthPngFilename("weekly.report.jpeg")).toBe("weekly.report.png");
    expect(sanitizeGrowthPngFilename("...///")).toBe("growth-image.png");
  });
});

describe("browser growth image rasterization", () => {
  it("decodes a raster image, draws a transparent 2x canvas, and returns PNG", async () => {
    const urls = mockObjectUrls();
    const MockImage = mockImage(1200, 675);
    const { canvas, context, encodedBlob } = mockCanvas();
    const input = new Blob(["raster"], { type: "image/png" });

    const result = await rasterizeGrowthImageToPng(input, { background: "transparent" });

    expect(result).toBe(encodedBlob);
    expect(canvas).toMatchObject({ width: 2400, height: 1350 });
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 2400, 1350);
    expect(context.fillRect).not.toHaveBeenCalled();
    expect(context.drawImage).toHaveBeenCalledWith(expect.any(MockImage), 0, 0, 2400, 1350);
    expect(urls.createObjectURL).toHaveBeenCalledWith(input);
    expect(urls.revokeObjectURL).toHaveBeenCalledWith("blob:growth-raster");
  });

  it("uses SVG intrinsic dimensions and paints a white background", async () => {
    const urls = mockObjectUrls();
    mockImage(300, 150);
    const { canvas, context } = mockCanvas();
    const input = new Blob([
      `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675" />`,
    ], { type: "image/svg+xml" });

    await rasterizeGrowthImageToPng(input, { background: "white" });

    expect(canvas).toMatchObject({ width: 2400, height: 1350 });
    expect(context.fillStyle).toBe("#ffffff");
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 2400, 1350);
    expect(urls.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it("rejects unsupported input before creating an object URL", async () => {
    const urls = mockObjectUrls();

    await expect(rasterizeGrowthImageToPng(
      new Blob(["video"], { type: "video/mp4" }),
      { background: "transparent" },
    )).rejects.toMatchObject({ code: "unsupported-type" });
    expect(urls.createObjectURL).not.toHaveBeenCalled();
    expect(urls.revokeObjectURL).not.toHaveBeenCalled();
  });

  it("returns a decode error and revokes the object URL after image failure", async () => {
    const urls = mockObjectUrls();
    mockImage(0, 0, true);

    await expect(rasterizeGrowthImageToPng(
      new Blob(["broken"], { type: "image/webp" }),
      { background: "transparent" },
    )).rejects.toMatchObject({ name: "GrowthRasterizeError", code: "decode" });
    expect(urls.revokeObjectURL).toHaveBeenCalledWith("blob:growth-raster");
  });

  it("rejects oversized decoded images and revokes the object URL", async () => {
    const urls = mockObjectUrls();
    mockImage((MAX_GROWTH_RASTER_DIMENSION / 2) + 1, 1);

    await expect(rasterizeGrowthImageToPng(
      new Blob(["image"], { type: "image/png" }),
      { background: "transparent" },
    )).rejects.toMatchObject({ name: "GrowthRasterizeError", code: "dimensions" });
    expect(urls.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it("returns a canvas error when a 2D context is unavailable", async () => {
    const urls = mockObjectUrls();
    mockImage(100, 50);
    mockCanvas({ contextAvailable: false });

    await expect(rasterizeGrowthImageToPng(
      new Blob(["image"], { type: "image/jpeg" }),
      { background: "white" },
    )).rejects.toMatchObject({ name: "GrowthRasterizeError", code: "canvas" });
    expect(urls.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it("returns a taint error when canvas drawing raises a security error", async () => {
    const urls = mockObjectUrls();
    mockImage(100, 50);
    mockCanvas({ drawError: new DOMException("Tainted", "SecurityError") });

    await expect(rasterizeGrowthImageToPng(
      new Blob(["image"], { type: "image/gif" }),
      { background: "transparent" },
    )).rejects.toMatchObject({ name: "GrowthRasterizeError", code: "taint" });
    expect(urls.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it("returns an encoding error for a null PNG and still revokes the object URL", async () => {
    const urls = mockObjectUrls();
    mockImage(100, 50);
    mockCanvas({ encodedBlob: null });

    await expect(rasterizeGrowthImageToPng(
      new Blob(["image"], { type: "image/png" }),
      { background: "transparent" },
    )).rejects.toMatchObject({ name: "GrowthRasterizeError", code: "png-encoding" });
    expect(urls.revokeObjectURL).toHaveBeenCalledWith("blob:growth-raster");
  });
});
