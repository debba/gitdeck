export type DashboardTab = "inbox" | "repos" | "issues" | "prs" | "kanban" | "insights" | "alerts" | "ci" | "digests";

export type DashboardResource = "repos" | "issues" | "prs";

/**
 * Returns only the base provider datasets needed to render the current view.
 * Expensive, view-specific resources (notifications, insights, CI and digests)
 * are loaded by their own effects when that view is active.
 */
export function dataRequirementsForTab(
  tab: DashboardTab,
  hasRepositoryRoute = false,
  repositoryDetail?: "issues" | "pull-requests" | string,
): Set<DashboardResource> {
  const resources = new Set<DashboardResource>();

  switch (tab) {
    case "inbox":
      resources.add("repos");
      resources.add("issues");
      resources.add("prs");
      break;
    case "repos":
      resources.add("repos");
      break;
    case "insights":
    case "alerts":
      resources.add("repos");
      resources.add("issues");
      break;
    case "issues":
      resources.add("repos");
      resources.add("issues");
      break;
    case "prs":
      resources.add("repos");
      resources.add("prs");
      break;
    case "ci":
      resources.add("repos");
      break;
    case "kanban":
    case "digests":
      break;
  }

  if (hasRepositoryRoute) resources.add("repos");
  if (repositoryDetail === "issues") resources.add("issues");
  if (repositoryDetail === "pull-requests") resources.add("prs");
  return resources;
}

export function allDashboardResources(): Set<DashboardResource> {
  return new Set(["repos", "issues", "prs"]);
}
