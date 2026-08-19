import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

export const HOST = process.env.HOST ?? "127.0.0.1";
export const PORT = Number(process.env.PORT ?? 8765);

export const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(SERVER_DIR, "..");
export const CLIENT_DIR = resolve(PROJECT_ROOT, "dist", "client");
export const CLIENT_INDEX_PATH = resolve(CLIENT_DIR, "index.html");
export const SOURCE_INDEX_PATH = resolve(PROJECT_ROOT, "index.html");

export const DATA_DIR = resolve(homedir(), ".gitdeck");
export const LEGACY_DATA_DIR = resolve(homedir(), ".gh-issues-dashboard");
export const SNAPSHOTS_PATH = resolve(DATA_DIR, "snapshots.json");
export const DIGESTS_PATH = resolve(DATA_DIR, "daily-digests.json");

export const ISSUE_FIELDS =
  "repository,title,url,number,createdAt,updatedAt,author,labels,commentsCount,assignees";

export const REPO_FIELDS =
  "nameWithOwner,name,owner,description,stargazerCount,forkCount,primaryLanguage,updatedAt,pushedAt,visibility,isPrivate,isArchived,isFork,isTemplate,viewerPermission,url";
