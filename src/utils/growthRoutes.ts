import { parseRepositoryName } from "./repository";

export const GROWTH_WORKSPACE_PANELS = [
  "missions",
  "interventions",
  "calendar",
  "library",
  "review",
] as const;

export type GrowthWorkspacePanel = (typeof GROWTH_WORKSPACE_PANELS)[number];

export interface GrowthWorkspaceRoute {
  repository: string;
  panel: GrowthWorkspacePanel | null;
}

const PANEL_SET = new Set<string>(GROWTH_WORKSPACE_PANELS);
const WORKSPACE_PATH_PATTERN = /^\/growth\/r\/([^/]+)\/([^/]+)(?:\/([^/]+))?\/?$/;

function decodePathSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export function parseGrowthWorkspacePath(pathname: string): GrowthWorkspaceRoute | null {
  const match = WORKSPACE_PATH_PATTERN.exec(pathname);
  if (!match) return null;

  const owner = decodePathSegment(match[1]);
  const name = decodePathSegment(match[2]);
  const panelSegment = match[3] ? decodePathSegment(match[3]) : null;
  if (!owner || !name || (panelSegment !== null && !PANEL_SET.has(panelSegment))) return null;

  const repository = `${owner}/${name}`;
  if (!parseRepositoryName(repository)) return null;

  return {
    repository,
    panel: panelSegment as GrowthWorkspacePanel | null,
  };
}

export function growthRepositoryPath(
  repository: string,
  panel: GrowthWorkspacePanel | null = null,
): string | null {
  const parts = parseRepositoryName(repository);
  if (!parts) return null;
  const [owner, name] = parts;
  const base = `/growth/r/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  return panel ? `${base}/${panel}` : base;
}

export function growthRepositorySwitchPath(repository: string, currentPathname: string): string | null {
  const currentWorkspace = parseGrowthWorkspacePath(currentPathname);
  return growthRepositoryPath(repository, currentWorkspace?.panel ?? null);
}
