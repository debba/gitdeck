import type { GhBoard, GhIssue } from "../types/github";

export interface ProjectItemRef {
  project?: {
    id: string;
    number: number;
    title: string;
    closed: boolean;
    owner?: { login?: string } | null;
  } | null;
}

export function openBoards(items: Array<ProjectItemRef | null> | null | undefined): GhBoard[] {
  const boards = new Map<string, GhBoard>();
  for (const item of items ?? []) {
    const project = item?.project;
    if (!project || project.closed) continue;
    boards.set(project.id, {
      id: project.id,
      number: project.number,
      name: project.owner?.login ? `${project.owner.login}/${project.title}` : project.title,
    });
  }
  return [...boards.values()];
}

export function hasBoards(issues: GhIssue[]): boolean {
  return issues.some((issue) => Boolean(issue.boards?.length));
}

export function isProjectsAccessError(message: string): boolean {
  return /not accessible by personal access token|not been granted the required scopes|requires one of the following scopes|resource not accessible by integration|insufficient.*scope/i.test(message);
}
