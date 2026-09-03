import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { CLIENT_INDEX_PATH, SOURCE_INDEX_PATH } from "./config";
import { send } from "./http";

const APP_ROUTES = new Set([
  "/",
  "/index.html",
  "/inbox",
  "/repositories",
  "/issues",
  "/pull-requests",
  "/insights",
  "/alerts",
  "/ci",
  "/daily",
  "/board",
  "/goals",
  "/preferences",
  "/alert",
]);

export function isAppRoute(pathname: string): boolean {
  return APP_ROUTES.has(pathname);
}

/** Paths whose last segment has no extension are client-side routes, not assets. */
export function isClientRoutePath(pathname: string): boolean {
  const lastSlash = pathname.lastIndexOf("/");
  const fileName = lastSlash >= 0 ? pathname.slice(lastSlash + 1) : pathname;
  return !fileName.includes(".");
}

export async function sendClientIndex(res: ServerResponse): Promise<void> {
  try {
    const html = await readFile(CLIENT_INDEX_PATH, "utf-8").catch(() => readFile(SOURCE_INDEX_PATH, "utf-8"));
    send(res, 200, html, "text/html; charset=utf-8");
  } catch {
    send(res, 500, "index.html not found", "text/plain; charset=utf-8");
  }
}
