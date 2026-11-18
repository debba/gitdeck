export type VulnerabilityAlertsStatus = "enabled" | "disabled" | "unknown";

export interface RepoSecurityAlertLike {
  updated_at?: string | null;
  updatedAt?: string | null;
  state?: string | null;
}

export interface RepoSecuritySummaryInput {
  dependabotAlerts: RepoSecurityAlertLike[];
  codeScanningAlerts: RepoSecurityAlertLike[];
  unavailable?: boolean;
  vulnerabilityAlertsStatus?: VulnerabilityAlertsStatus;
}

export interface RepoSecuritySummary {
  dependabotOpen: number;
  codeScanningOpen: number;
  totalOpen: number;
  latestUpdatedAt: string | null;
  unavailable: boolean;
  vulnerabilityAlertsStatus: VulnerabilityAlertsStatus;
}

function isOpenAlert(item: RepoSecurityAlertLike): boolean {
  return item.state == null || item.state === "open";
}

function latestTimestamp(items: RepoSecurityAlertLike[]): string | null {
  let latest = null as string | null;
  for (const item of items) {
    const value = item.updatedAt ?? item.updated_at ?? null;
    if (!value) continue;
    if (!latest || Date.parse(value) > Date.parse(latest)) {
      latest = value;
    }
  }
  return latest;
}

export function buildRepoSecuritySummary(input: RepoSecuritySummaryInput): RepoSecuritySummary {
  const vulnerabilityAlertsStatus = input.vulnerabilityAlertsStatus ?? "enabled";
  const dependabotAlerts = vulnerabilityAlertsStatus === "disabled"
    ? []
    : input.dependabotAlerts.filter(isOpenAlert);
  const codeScanningAlerts = input.codeScanningAlerts.filter(isOpenAlert);
  const dependabotOpen = dependabotAlerts.length;
  const codeScanningOpen = codeScanningAlerts.length;
  const latestUpdatedAt = latestTimestamp([...dependabotAlerts, ...codeScanningAlerts]);

  return {
    dependabotOpen,
    codeScanningOpen,
    totalOpen: dependabotOpen + codeScanningOpen,
    latestUpdatedAt,
    unavailable: Boolean(input.unavailable),
    vulnerabilityAlertsStatus,
  };
}
