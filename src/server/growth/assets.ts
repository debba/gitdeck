import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import type { IncomingMessage } from "node:http";
import {
  GROWTH_ASSET_MIME_TYPES,
  MAX_GROWTH_ASSET_BYTES,
  type GrowthAsset,
  type GrowthAssetImportCandidate,
  type GrowthAssetImportOrigin,
  type GrowthAssetKind,
  type GrowthAssetMetadata,
  type GrowthAssetMimeType,
} from "../../types/growth";
import {
  normalizeGrowthAssetImportCandidates,
  normalizeGrowthAssetImportUrl,
  type GrowthAssetImportSource,
} from "../../utils/growth/importCandidates";
import { parseRepositoryName } from "../../utils/repository";
import { DATA_DIR } from "../config";
import { getRepositoryContentSources } from "../goalStore";
import {
  fetchAdditionalSourceSignals,
  fetchReadmeSignal,
  PublicMediaTooLargeError,
  readPublicMedia,
  UnsupportedPublicMediaTypeError,
} from "./signals";
import {
  GROWTH_CARD_HEIGHT,
  GROWTH_CARD_WIDTH,
  normalizeGrowthCard,
  renderGrowthCard,
} from "./cards";
import { createGrowthAsset, findGrowthAssetByUrl, getGrowthAsset, getGrowthProfile } from "./store";

export { GROWTH_ASSET_MIME_TYPES, MAX_GROWTH_ASSET_BYTES } from "../../types/growth";
export type { GrowthAssetMimeType } from "../../types/growth";

const MIME_DETAILS: Record<GrowthAssetMimeType, { extension: string; kind: GrowthAssetKind }> = {
  "image/png": { extension: ".png", kind: "image" },
  "image/jpeg": { extension: ".jpg", kind: "image" },
  "image/webp": { extension: ".webp", kind: "image" },
  "image/gif": { extension: ".gif", kind: "image" },
  "video/mp4": { extension: ".mp4", kind: "video" },
  "video/webm": { extension: ".webm", kind: "video" },
};
const MIME_BY_EXTENSION: Record<string, GrowthAssetMimeType> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

export class GrowthAssetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrowthAssetValidationError";
  }
}

export class UnsupportedGrowthAssetTypeError extends Error {
  constructor() {
    super("unsupported asset content type");
    this.name = "UnsupportedGrowthAssetTypeError";
  }
}

export class GrowthAssetTooLargeError extends Error {
  constructor() {
    super("asset exceeds the 25 MiB limit");
    this.name = "GrowthAssetTooLargeError";
  }
}

export interface GrowthAssetUploadMetadata {
  filename: string;
  title: string;
  alt: string;
  width?: number;
  height?: number;
}

export interface UploadGrowthAssetOptions extends GrowthAssetUploadMetadata {
  accountId: string;
  repository: string;
  contentType: string | undefined;
  contentLength?: number;
  body: IncomingMessage | AsyncIterable<Uint8Array | string>;
}

export interface GrowthAssetFile {
  body: Buffer;
  contentType: GrowthAssetMimeType | "image/svg+xml";
  length: number;
}

export interface GenerateGrowthCardOptions {
  accountId: string;
  repository: string;
  template: unknown;
  title: string;
  alt: string;
  data: unknown;
}

export interface ImportGrowthAssetOptions {
  accountId: string;
  repository: string;
  origin: GrowthAssetImportOrigin;
  url: string;
  title: string;
  alt: string;
}

export interface ImportedGrowthAssetResult {
  asset: GrowthAsset;
  duplicate: boolean;
}

export function getGrowthAssetRoot(): string {
  return resolve(DATA_DIR, "growth-assets");
}

function normalizeMimeType(value: string | undefined): GrowthAssetMimeType {
  const mimeType = value?.split(";", 1)[0].trim().toLowerCase();
  if (!GROWTH_ASSET_MIME_TYPES.includes(mimeType as GrowthAssetMimeType)) {
    throw new UnsupportedGrowthAssetTypeError();
  }
  return mimeType as GrowthAssetMimeType;
}

function normalizeText(value: string, field: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new GrowthAssetValidationError(`invalid ${field}`);
  }
  return normalized;
}

function normalizeFilename(value: string): string {
  const filename = normalizeText(value, "filename", 255);
  if (basename(filename) !== filename || filename.includes("/") || filename.includes("\\")) {
    throw new GrowthAssetValidationError("invalid filename");
  }
  return filename;
}

function normalizeDimension(value: number | undefined, field: string): number | null {
  if (value === undefined) return null;
  if (!Number.isSafeInteger(value) || value <= 0 || value > 100_000) {
    throw new GrowthAssetValidationError(`invalid ${field}`);
  }
  return value;
}

function validateContentLength(value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value < 0) throw new GrowthAssetValidationError("invalid content length");
  if (value > MAX_GROWTH_ASSET_BYTES) throw new GrowthAssetTooLargeError();
}

async function writeBoundedBody(
  body: AsyncIterable<Uint8Array | string>,
  path: string,
  expectedLength: number | undefined,
): Promise<number> {
  const file = await open(path, "wx", 0o600);
  let length = 0;
  try {
    for await (const chunk of body) {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
      length += buffer.byteLength;
      if (length > MAX_GROWTH_ASSET_BYTES) throw new GrowthAssetTooLargeError();
      let offset = 0;
      while (offset < buffer.byteLength) {
        const result = await file.write(buffer, offset, buffer.byteLength - offset, null);
        offset += result.bytesWritten;
      }
    }
  } finally {
    await file.close();
  }
  if (length === 0) throw new GrowthAssetValidationError("asset body must not be empty");
  if (expectedLength !== undefined && length !== expectedLength) {
    throw new GrowthAssetValidationError("asset content length does not match its body");
  }
  return length;
}

/** Streams one upload to a temporary file, atomically installs it, then persists its account-scoped row. */
export async function persistUploadedGrowthAsset(options: UploadGrowthAssetOptions): Promise<GrowthAsset> {
  if (!options.accountId.trim()) throw new GrowthAssetValidationError("invalid account");
  if (!parseRepositoryName(options.repository)) throw new GrowthAssetValidationError("invalid repository");
  const mimeType = normalizeMimeType(options.contentType);
  validateContentLength(options.contentLength);
  normalizeFilename(options.filename);
  const title = normalizeText(options.title, "title", 500);
  const alt = normalizeText(options.alt, "alt", 2_000);
  const width = normalizeDimension(options.width, "width");
  const height = normalizeDimension(options.height, "height");
  const details = MIME_DETAILS[mimeType];
  const root = getGrowthAssetRoot();
  const fileId = randomUUID();
  const relativePath = `${fileId}${details.extension}`;
  const temporaryPath = resolve(root, `.${fileId}.tmp`);
  const finalPath = resolve(root, relativePath);
  let installed = false;

  await mkdir(root, { recursive: true });
  try {
    await writeBoundedBody(options.body, temporaryPath, options.contentLength);
    await rename(temporaryPath, finalPath);
    installed = true;
    return createGrowthAsset({
      accountId: options.accountId,
      repository: options.repository,
      kind: details.kind,
      origin: "upload",
      path: relativePath,
      title,
      alt,
      width,
      height,
    });
  } catch (error) {
    await rm(temporaryPath, { force: true });
    if (installed) await rm(finalPath, { force: true });
    throw error;
  }
}

export function toGrowthAssetMetadata(asset: GrowthAsset): GrowthAssetMetadata {
  const { path: _storedPath, ...metadata } = asset;
  return metadata;
}

function isContainedPath(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child.length > 0 && !child.startsWith("..") && !isAbsolute(child);
}

function signalMediaUrls(value: unknown): unknown[] {
  if (!value || typeof value !== "object") return [];
  const mediaUrls = (value as { mediaUrls?: unknown }).mediaUrls;
  return Array.isArray(mediaUrls) ? mediaUrls : [];
}

function signalTitle(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const title = (value as { title?: unknown }).title;
  return typeof title === "string" ? title : null;
}

/** Discovers repository and configured-source media without persisting or exposing its bytes. */
export async function discoverGrowthAssetImportCandidates(
  accountId: string,
  repository: string,
): Promise<GrowthAssetImportCandidate[]> {
  if (!accountId.trim()) throw new GrowthAssetValidationError("invalid account");
  if (!parseRepositoryName(repository)) throw new GrowthAssetValidationError("invalid repository");
  const sources = getRepositoryContentSources(accountId, repository);
  const [readme, additionalSignals] = await Promise.all([
    fetchReadmeSignal(repository),
    fetchAdditionalSourceSignals(sources),
  ]);
  const importSources: GrowthAssetImportSource[] = [];
  if (readme) {
    importSources.push({
      origin: "readme",
      source: `${repository} README`,
      title: null,
      mediaUrls: readme.mediaUrls,
    });
  }
  sources.forEach((source, index) => {
    const signal = additionalSignals[index];
    importSources.push({
      origin: source.type === "website" ? "website" : "readme",
      source: source.value,
      title: signalTitle(signal),
      baseUrl: source.type === "website" ? source.value : null,
      mediaUrls: signalMediaUrls(signal),
    });
  });
  return normalizeGrowthAssetImportCandidates(importSources);
}

/** Verifies a current source candidate and persists one URL-backed repository asset. */
export async function persistImportedGrowthAsset(
  options: ImportGrowthAssetOptions,
): Promise<ImportedGrowthAssetResult> {
  if (!options.accountId.trim()) throw new GrowthAssetValidationError("invalid account");
  if (!parseRepositoryName(options.repository)) throw new GrowthAssetValidationError("invalid repository");
  if (options.origin !== "readme" && options.origin !== "website") {
    throw new GrowthAssetValidationError("invalid import origin");
  }
  const url = normalizeGrowthAssetImportUrl(options.url);
  if (!url) throw new GrowthAssetValidationError("invalid asset URL");
  const title = normalizeText(options.title, "title", 500);
  const alt = normalizeText(options.alt, "alt", 2_000);
  const candidates = await discoverGrowthAssetImportCandidates(options.accountId, options.repository);
  if (!candidates.some((candidate) => candidate.origin === options.origin && candidate.url === url)) {
    throw new GrowthAssetValidationError("asset URL is not a current import candidate");
  }
  const existing = findGrowthAssetByUrl(options.accountId, options.repository, url);
  if (existing) return { asset: existing, duplicate: true };

  let media;
  try {
    media = await readPublicMedia(url);
  } catch (error) {
    if (error instanceof PublicMediaTooLargeError) throw new GrowthAssetTooLargeError();
    if (error instanceof UnsupportedPublicMediaTypeError) throw new UnsupportedGrowthAssetTypeError();
    throw error;
  }
  const duplicate = findGrowthAssetByUrl(options.accountId, options.repository, url);
  if (duplicate) return { asset: duplicate, duplicate: true };
  return {
    asset: createGrowthAsset({
      accountId: options.accountId,
      repository: options.repository,
      kind: MIME_DETAILS[media.contentType].kind,
      origin: options.origin,
      url,
      title,
      alt,
    }),
    duplicate: false,
  };
}

/** Persists validated card metadata without writing SVG or raster bytes to disk. */
export function persistGeneratedGrowthCard(options: GenerateGrowthCardOptions): GrowthAsset {
  if (!options.accountId.trim()) throw new GrowthAssetValidationError("invalid account");
  if (!parseRepositoryName(options.repository)) throw new GrowthAssetValidationError("invalid repository");
  const title = normalizeText(options.title, "title", 500);
  const alt = normalizeText(options.alt, "alt", 2_000);
  const normalized = normalizeGrowthCard(options.template, options.data);
  return createGrowthAsset({
    accountId: options.accountId,
    repository: options.repository,
    kind: "image",
    origin: "generated",
    title,
    alt,
    width: GROWTH_CARD_WIDTH,
    height: GROWTH_CARD_HEIGHT,
    cardTemplate: normalized.template,
    cardData: { ...normalized.data },
  });
}

/** Reads an account-owned upload, remote import, or safely rendered generated card. */
export async function readGrowthAssetFile(accountId: string, id: string): Promise<GrowthAssetFile | null> {
  const asset = getGrowthAsset(accountId, id);
  if (!asset) return null;
  if (
    asset.origin === "generated"
    && asset.kind === "image"
    && asset.path === null
    && asset.url === null
    && asset.cardTemplate !== null
    && asset.cardData !== null
  ) {
    try {
      const profile = getGrowthProfile(accountId, asset.repository);
      const body = Buffer.from(renderGrowthCard({
        repository: asset.repository,
        color: profile.color,
        template: asset.cardTemplate,
        title: asset.title,
        alt: asset.alt,
        data: asset.cardData,
      }), "utf8");
      return { body, contentType: "image/svg+xml", length: body.byteLength };
    } catch {
      return null;
    }
  }
  if ((asset.origin === "readme" || asset.origin === "website") && asset.path === null && asset.url !== null) {
    try {
      const media = await readPublicMedia(asset.url);
      if (MIME_DETAILS[media.contentType].kind !== asset.kind) return null;
      return { body: media.body, contentType: media.contentType, length: media.length };
    } catch {
      return null;
    }
  }
  if (asset.origin !== "upload" || asset.path === null || asset.url !== null) return null;

  const root = getGrowthAssetRoot();
  const candidate = resolve(root, asset.path);
  if (!isContainedPath(root, candidate)) return null;
  const mimeType = MIME_BY_EXTENSION[extname(candidate).toLowerCase()];
  if (!mimeType || MIME_DETAILS[mimeType].kind !== asset.kind) return null;

  try {
    const fileInfo = await lstat(candidate);
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) return null;
    const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
    if (!isContainedPath(realRoot, realCandidate)) return null;
    const beforeRead = await stat(realCandidate);
    if (!beforeRead.isFile() || beforeRead.size > MAX_GROWTH_ASSET_BYTES) return null;
    const body = await readFile(realCandidate);
    if (body.byteLength > MAX_GROWTH_ASSET_BYTES || body.byteLength !== beforeRead.size) return null;
    return { body, contentType: mimeType, length: body.byteLength };
  } catch {
    return null;
  }
}
