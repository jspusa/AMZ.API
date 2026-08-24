import { describe, expect, it } from "vitest";
import {
  throwListingsReadError,
} from "../src/main/amazon/listings-response-error";
import type { ListingItemReadResult } from "../src/main/amazon/listings-reads";

const US = "ATVPDKIKX0DER" as const;

function itemResult(
  status: number,
  envelope: unknown,
): ListingItemReadResult {
  return {
    identity: {
      operation: "item",
      intent: "variation-evidence",
      marketplaceId: US,
      sellerSku: "EXACT-SKU",
    },
    status,
    envelope,
    requestId: "safe-request-id",
    rateLimit: null,
    retryAfter: "1",
    profile: "relationships",
  };
}

describe("Listings response error seam", () => {
  it("preserves the canonical read error descriptor and normalized issues", () => {
    expect(() => throwListingsReadError(itemResult(400, {
      errors: [{ code: "InvalidInput", message: "invalid fixture" }],
      issues: [{
        code: "ISSUE",
        severity: "warning",
        message: "fixture issue",
        attributeName: "item_name",
      }],
    }), "getListingsItem")).toThrowError(expect.objectContaining({
      name: "SpApiError",
      status: 400,
      code: "INVALID_LISTING_REQUEST",
      requestId: "safe-request-id",
      retryAfter: "1",
      operation: "getListingsItem",
      upstreamCode: "InvalidInput",
      issues: [{
        code: "ISSUE",
        severity: "WARNING",
        message: "fixture issue",
        attributeNames: ["item_name"],
        categories: [],
        marketplaceIds: [],
      }],
    }));
  });

  it("maps a malformed upstream errors field without leaking a native TypeError", () => {
    expect(() => throwListingsReadError(itemResult(503, {
      errors: { message: "not an array" },
    }), "getListingsItem")).toThrowError(expect.objectContaining({
      name: "SpApiError",
      status: 503,
      code: "UPSTREAM_UNAVAILABLE",
      operation: "getListingsItem",
      upstreamCode: null,
    }));
  });
});
