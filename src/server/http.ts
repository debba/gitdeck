import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { CLIENT_DIR } from "./config";

const STATIC_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

export function send(res: ServerResponse, status: number, body: string | Buffer, contentType: string): void {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf-8");
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": buffer.byteLength,
    "Cache-Control": "no-store",
  });
  res.end(buffer);
}

export function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  send(res, status, JSON.stringify(obj), "application/json; charset=utf-8");
}

export function sendJsonCacheable(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  obj: unknown,
): void {
  if (status !== 200) return sendJson(res, status, obj);
  const body = JSON.stringify(obj);
  const etag = `W/"${createHash("sha1").update(body).digest("base64url")}"`;
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, { ETag: etag, "Cache-Control": "no-store" });
    res.end();
    return;
  }
  const buffer = Buffer.from(body, "utf-8");
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": buffer.byteLength,
    "Cache-Control": "no-store",
    ETag: etag,
  });
  res.end(buffer);
}

export async function sendStaticFile(res: ServerResponse, path: string): Promise<boolean> {
  const cleanPath = path.replace(/^\/+/, "");
  const filePath = resolve(CLIENT_DIR, cleanPath);
  if (!filePath.startsWith(CLIENT_DIR)) return false;
  try {
    const body = await readFile(filePath);
    send(res, 200, body, STATIC_TYPES[extname(filePath)] ?? "application/octet-stream");
    return true;
  } catch {
    return false;
  }
}

export function sendRedirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

/** Sends a cached dashboard payload, mapping `ok`/`needsAuth` onto the HTTP status. */
export function sendPayload(
  req: IncomingMessage,
  res: ServerResponse,
  payload: { ok: boolean; needsAuth?: boolean },
): void {
  const status = payload.ok ? 200 : payload.needsAuth ? 401 : 500;
  sendJsonCacheable(req, res, status, payload);
}

export async function readJsonBody<T = unknown>(req: IncomingMessage): Promise<T> {
  let body = "";
  for await (const chunk of req) body += chunk;
  if (!body) return {} as T;
  return JSON.parse(body) as T;
}

/** Reads a JSON body, answering 400 and resolving to `null` when it cannot be parsed. */
export async function parseJsonBody<T extends object>(req: IncomingMessage, res: ServerResponse): Promise<T | null> {
  try {
    return await readJsonBody<T>(req);
  } catch {
    sendJson(res, 400, { ok: false, error: "invalid JSON" });
    return null;
  }
}
