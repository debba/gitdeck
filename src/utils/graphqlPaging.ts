/** Statuses GitHub's edge returns when a GraphQL query exceeds its ~10s execution budget. */
const GATEWAY_TIMEOUT_STATUSES = new Set([502, 504]);

export function isGatewayTimeoutStatus(status: number): boolean {
  return GATEWAY_TIMEOUT_STATUSES.has(status);
}

/**
 * Halves a GraphQL page size after a gateway timeout so the next attempt is
 * cheaper. Returns `null` once the size cannot shrink below `minSize`.
 */
export function shrinkPageSize(size: number, minSize: number): number | null {
  if (size <= minSize) return null;
  return Math.max(minSize, Math.floor(size / 2));
}
