import type { GhIssue } from "../types/github";

export interface ProjectItemRef {
  project?: {
    title: string;
    closed: boolean;
    owner?: { login?: string } | null;
  } | null;
}

export function openBoardNames(items: Array<ProjectItemRef | null> | null | undefined): string[] {
  const names = new Set<string>();
  for (const item of items ?? []) {
    const project = item?.project;
    if (!project || project.closed) continue;
    names.add(project.owner?.login ? `${project.owner.login}/${project.title}` : project.title);
  }
  return [...names];
}

export function hasBoards(issues: GhIssue[]): boolean {
  return issues.some((issue) => Boolean(issue.boards?.length));
}
