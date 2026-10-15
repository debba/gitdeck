import type { AppRouter } from "../router";
import { registerAccountRoutes } from "./accounts";
import { registerAuthRoutes } from "./auth";
import { registerDashboardRoutes } from "./dashboard";
import { registerMentionRoutes } from "./mentions";
import { registerNotificationRoutes } from "./notifications";
import { registerProjectRoutes } from "./projects";
import { registerRepositoryRoutes } from "./repository";

export function registerApiRoutes(router: AppRouter): void {
  registerAuthRoutes(router);
  registerAccountRoutes(router);
  registerDashboardRoutes(router);
  registerRepositoryRoutes(router);
  registerMentionRoutes(router);
  registerProjectRoutes(router);
  registerNotificationRoutes(router);
}
