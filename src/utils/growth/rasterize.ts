export const GROWTH_RASTER_SCALE = 2;
export const MAX_GROWTH_RASTER_DIMENSION = 8_192;
export const MAX_GROWTH_RASTER_PIXELS = 32_000_000;

export interface GrowthImageDimensions {
  width: number;
  height: number;
}

export interface GrowthRasterLimits {
  maxDimension: number;
  maxPixels: number;
}

export type GrowthRasterBackground = "transparent" | "white";

export type GrowthRasterizeErrorCode =
  | "unsupported-type"
  | "decode"
  | "dimensions"
  | "canvas"
  | "taint"
  | "png-encoding";

export class GrowthRasterizeError extends Error {
  readonly code: GrowthRasterizeErrorCode;

  constructor(code: GrowthRasterizeErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrowthRasterizeError";
    this.code = code;
  }
}

export interface GrowthRasterizeOptions {
  background: GrowthRasterBackground;
}

const DEFAULT_LIMITS: GrowthRasterLimits = {
  maxDimension: MAX_GROWTH_RASTER_DIMENSION,
  maxPixels: MAX_GROWTH_RASTER_PIXELS,
};
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
]);
const PNG_BASENAME_LIMIT = 100;

function dimensionsError(message: string): GrowthRasterizeError {
  return new GrowthRasterizeError("dimensions", message);
}

function parseSvgLength(value: string): number {
  const normalized = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:px)?$/i.test(normalized)) {
    throw dimensionsError("SVG dimensions must be unitless numbers or pixel values");
  }
  const parsed = Number(normalized.replace(/px$/i, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw dimensionsError("SVG dimensions must be finite positive numbers");
  }
  return parsed;
}

function readSvgAttribute(attributes: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, "is").exec(attributes);
  return match?.[2] ?? null;
}

/** Parse intrinsic dimensions from a trusted SVG root element. */
export function parseSvgIntrinsicDimensions(svg: string): GrowthImageDimensions {
  const root = /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg\b([^>]*)>/i.exec(svg);
  if (!root) throw dimensionsError("SVG root element is malformed or missing");

  const widthValue = readSvgAttribute(root[1], "width");
  const heightValue = readSvgAttribute(root[1], "height");
  if (widthValue !== null || heightValue !== null) {
    if (widthValue === null || heightValue === null) {
      throw dimensionsError("SVG width and height must be provided together");
    }
    return {
      width: parseSvgLength(widthValue),
      height: parseSvgLength(heightValue),
    };
  }

  const viewBoxValue = readSvgAttribute(root[1], "viewBox");
  if (viewBoxValue === null) throw dimensionsError("SVG has no intrinsic dimensions");
  const number = "([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?)";
  const separator = "(?:\\s*,\\s*|\\s+)";
  const viewBox = new RegExp(`^\\s*${number}${separator}${number}${separator}${number}${separator}${number}\\s*$`, "i")
    .exec(viewBoxValue);
  if (!viewBox) throw dimensionsError("SVG viewBox must contain four numbers");
  const values = viewBox.slice(1).map(Number);
  if (values.some((value) => !Number.isFinite(value)) || values[2] <= 0 || values[3] <= 0) {
    throw dimensionsError("SVG viewBox dimensions must be finite positive numbers");
  }
  return { width: values[2], height: values[3] };
}

export function calculateBoundedOutputDimensions(
  dimensions: GrowthImageDimensions,
  scale: number,
  limits: GrowthRasterLimits = DEFAULT_LIMITS,
): GrowthImageDimensions {
  const values = [dimensions.width, dimensions.height, scale, limits.maxDimension, limits.maxPixels];
  if (values.some((value) => !Number.isFinite(value))) {
    throw dimensionsError("Raster dimensions and limits must be finite");
  }
  if (
    dimensions.width <= 0
    || dimensions.height <= 0
    || scale <= 0
    || limits.maxDimension <= 0
    || limits.maxPixels <= 0
  ) {
    throw dimensionsError("Raster dimensions and limits must be positive");
  }

  const width = Math.round(dimensions.width * scale);
  const height = Math.round(dimensions.height * scale);
  const pixels = width * height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw dimensionsError("Raster dimensions cannot be represented safely");
  }
  if (width > limits.maxDimension || height > limits.maxDimension || pixels > limits.maxPixels) {
    throw dimensionsError("Raster output exceeds the canvas limits");
  }
  return { width, height };
}

export function chooseGrowthRasterSize(dimensions: GrowthImageDimensions): GrowthImageDimensions {
  return calculateBoundedOutputDimensions(dimensions, GROWTH_RASTER_SCALE);
}

export function sanitizeGrowthPngFilename(value: string): string {
  const basename = value.trim().split(/[\\/]/).at(-1) ?? "";
  const withoutExtension = basename.replace(/\.[^.]*$/, "");
  const safe = withoutExtension
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, PNG_BASENAME_LIMIT)
    .replace(/[._-]+$/g, "");
  return `${safe || "growth-image"}.png`;
}

function normalizeMimeType(type: string): string {
  return type.split(";", 1)[0].trim().toLowerCase();
}

function decodeImage(objectUrl: string): Promise<HTMLImageElement> {
  if (typeof Image === "undefined") {
    return Promise.reject(new GrowthRasterizeError("decode", "Browser image decoding is unavailable"));
  }

  return new Promise((resolve, reject) => {
    let image: HTMLImageElement;
    try {
      image = new Image();
    } catch (error) {
      reject(new GrowthRasterizeError("decode", "Image decoder could not be created", error));
      return;
    }
    image.onload = () => {
      image.onload = null;
      image.onerror = null;
      resolve(image);
    };
    image.onerror = () => {
      image.onload = null;
      image.onerror = null;
      reject(new GrowthRasterizeError("decode", "Image could not be decoded"));
    };
    try {
      image.src = objectUrl;
    } catch (error) {
      image.onload = null;
      image.onerror = null;
      reject(new GrowthRasterizeError("decode", "Image decoding could not start", error));
    }
  });
}

function isSecurityError(error: unknown): boolean {
  return typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "SecurityError";
}

function encodeCanvasAsPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob || normalizeMimeType(blob.type) !== "image/png") {
          reject(new GrowthRasterizeError("png-encoding", "Canvas PNG encoding failed"));
          return;
        }
        resolve(blob);
      }, "image/png");
    } catch (error) {
      if (isSecurityError(error)) {
        reject(new GrowthRasterizeError("taint", "Canvas is not safe to export", error));
        return;
      }
      reject(new GrowthRasterizeError("png-encoding", "Canvas PNG encoding failed", error));
    }
  });
}

/** Rasterize a supported image entirely in the browser. */
export async function rasterizeGrowthImageToPng(
  imageBlob: Blob,
  options: GrowthRasterizeOptions,
): Promise<Blob> {
  const mimeType = normalizeMimeType(imageBlob.type);
  if (!SUPPORTED_IMAGE_TYPES.has(mimeType)) {
    throw new GrowthRasterizeError("unsupported-type", `Unsupported image type: ${mimeType || "unknown"}`);
  }
  if (
    typeof URL === "undefined"
    || typeof URL.createObjectURL !== "function"
    || typeof URL.revokeObjectURL !== "function"
  ) {
    throw new GrowthRasterizeError("decode", "Browser object URLs are unavailable");
  }

  let svgDimensions: GrowthImageDimensions | null = null;
  if (mimeType === "image/svg+xml") {
    try {
      svgDimensions = parseSvgIntrinsicDimensions(await imageBlob.text());
    } catch (error) {
      if (error instanceof GrowthRasterizeError) throw error;
      throw new GrowthRasterizeError("decode", "SVG source could not be read", error);
    }
  }

  let objectUrl = "";
  try {
    try {
      objectUrl = URL.createObjectURL(imageBlob);
    } catch (error) {
      throw new GrowthRasterizeError("decode", "Image object URL could not be created", error);
    }
    const image = await decodeImage(objectUrl);
    const dimensions = svgDimensions ?? {
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
    const output = chooseGrowthRasterSize(dimensions);

    if (typeof document === "undefined") {
      throw new GrowthRasterizeError("canvas", "Browser canvas creation is unavailable");
    }
    let canvas: HTMLCanvasElement;
    let context: CanvasRenderingContext2D | null;
    try {
      canvas = document.createElement("canvas");
      canvas.width = output.width;
      canvas.height = output.height;
      context = canvas.getContext("2d");
    } catch (error) {
      throw new GrowthRasterizeError("canvas", "Canvas could not be created", error);
    }
    if (!context) throw new GrowthRasterizeError("canvas", "Canvas 2D context is unavailable");

    try {
      if (options.background === "white") {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, output.width, output.height);
      } else {
        context.clearRect(0, 0, output.width, output.height);
      }
      context.drawImage(image, 0, 0, output.width, output.height);
    } catch (error) {
      if (isSecurityError(error)) {
        throw new GrowthRasterizeError("taint", "Image cannot be drawn to an exportable canvas", error);
      }
      throw new GrowthRasterizeError("canvas", "Image could not be drawn to the canvas", error);
    }

    return await encodeCanvasAsPng(canvas);
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
