import { describe, expect, it } from "vitest";
import { isGatewayTimeoutStatus, shrinkPageSize } from "../../src/utils/graphqlPaging";

describe("graphql paging utilities", () => {
  it("detects gateway timeout statuses", () => {
    expect(isGatewayTimeoutStatus(502)).toBe(true);
    expect(isGatewayTimeoutStatus(504)).toBe(true);
    expect(isGatewayTimeoutStatus(500)).toBe(false);
    expect(isGatewayTimeoutStatus(200)).toBe(false);
  });

  it("halves the page size down to the minimum", () => {
    expect(shrinkPageSize(25, 5)).toBe(12);
    expect(shrinkPageSize(8, 5)).toBe(5);
    expect(shrinkPageSize(5, 5)).toBeNull();
  });
});
