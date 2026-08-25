import { describe, expect, it, vi } from "vitest";
import {
  ReadOnlyAdvertisingCoordinator,
  type AdvertisingCoordinatorDependencies,
} from "../src/main/advertising-read-coordinator";
import {
  AdvertisingApiError,
  type AdvertisingGateway,
} from "../src/main/amazon/ads-api";
import { AdvertisingCoverageInputError } from
  "../src/main/amazon/advertising-coverage";
import { createScriptedSpExecutionContextAdapter } from
  "../src/main/amazon/sp-execution-context";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const US = "ATVPDKIKX0DER" as const;
const JSON_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};

function request(path: string): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method: "GET",
    path,
    query: { marketplaceId: US },
    headers: {},
  };
}

function jsonValue(response: ApiResponse): Record<string, unknown> {
  if (response.body.kind !== "json") throw new Error("Expected JSON response");
  return response.body.value as Record<string, unknown>;
}

function coordinatorThatThrows(input: Readonly<{
  statusError?: unknown;
  coverageError?: unknown;
}>): ReadOnlyAdvertisingCoordinator {
  const unreachable = async (): Promise<never> => {
    throw new Error("unused dependency must not run");
  };
  const advertising = {
    getCredentialSummary: input.statusError
      ? async () => { throw input.statusError; }
      : async () => ({
          encryptionAvailable: true,
          hasVault: true,
          configured: true,
          lwaConfigured: true,
          refreshTokenConfigured: true,
          oauthRegion: "na" as const,
          updatedAt: "2026-08-26T00:00:00.000Z",
        }),
    probeMarketplace: unreachable,
    listEnabledSponsoredProductCampaigns: unreachable,
    invalidate: vi.fn(),
  } satisfies AdvertisingGateway;
  const dependencies = {
    context: createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "live",
      accountScope: "opaque-ads-error-test",
    })),
    advertising,
    reports: {
      bindAdvertisedProductAccount: unreachable,
      assertAdvertisedProductBinding: unreachable,
      startAdvertisedProduct: unreachable,
      statusAdvertisedProduct: unreachable,
      readAdvertisedProductData: unreachable,
    },
    catalog: {
      begin: unreachable,
      status: unreachable,
      read: unreachable,
      readExistingExport: input.coverageError
        ? async () => { throw input.coverageError; }
        : async () => ({ state: "missing" as const }),
    },
    salesAndTraffic: {
      begin: unreachable,
      status: unreachable,
      read: unreachable,
    },
    listingsExport: { runStandalone: unreachable },
    loadAuditSuiteListings: unreachable,
  } satisfies AdvertisingCoordinatorDependencies;
  return new ReadOnlyAdvertisingCoordinator(dependencies);
}

describe("read-only Amazon Ads coordinator error mapping", () => {
  it("preserves safe Ads and coverage error envelopes at their local owner", async () => {
    const ads = coordinatorThatThrows({
      statusError: new AdvertisingApiError("Amazon Ads 暫時無法使用。", {
        status: 503,
        code: "ADS_UPSTREAM_FAILED",
        requestId: "ads-request.safe:001",
      }),
    });
    const coverage = coordinatorThatThrows({
      coverageError: new AdvertisingCoverageInputError(
        "廣告覆蓋證據不完整。",
      ),
    });

    const adsResponse = await ads.status(request("/api/amazon-ads/status"));
    const coverageResponse = await coverage.coverage(
      request("/api/amazon-ads/coverage"),
    );
    ads.clear();
    coverage.clear();

    expect(adsResponse).toEqual({
      status: 503,
      headers: JSON_HEADERS,
      body: {
        kind: "json",
        value: {
          code: "ADS_UPSTREAM_FAILED",
          message: "Amazon Ads 暫時無法使用。",
          requestId: "ads-request.safe:001",
        },
      },
    });
    expect(coverageResponse).toEqual({
      status: 422,
      headers: JSON_HEADERS,
      body: {
        kind: "json",
        value: {
          code: "ADS_LISTING_COVERAGE_INCOMPLETE",
          message: "廣告覆蓋證據不完整。",
        },
      },
    });
  });

  it("fails hostile Ads and coverage metadata closed at their local owner", async () => {
    const hostile = [
      "Bearer example-access-value",
      "accountScope=example-private-scope",
      "reportId=example-private-report",
      "https://example.invalid/private?client_secret=example-secret",
      "hostile-text\u202e\u0000",
    ].join(" ");
    const ads = coordinatorThatThrows({
      statusError: new AdvertisingApiError(hostile, {
        status: 302,
        code: "BAD\nCODE",
        requestId: "Atza|example-access-value",
      }),
    });
    const coverage = coordinatorThatThrows({
      coverageError: new AdvertisingCoverageInputError(hostile),
    });

    const responses = [
      await ads.status(request("/api/amazon-ads/status")),
      await coverage.coverage(request("/api/amazon-ads/coverage")),
    ];
    ads.clear();
    coverage.clear();

    expect(responses.map((response) => ({
      status: response.status,
      value: jsonValue(response),
    }))).toEqual([
      {
        status: 500,
        value: {
          code: "UPSTREAM_UNAVAILABLE",
          message: "執行本機 Amazon 操作時發生未預期的錯誤。",
          requestId: null,
        },
      },
      {
        status: 422,
        value: {
          code: "ADS_LISTING_COVERAGE_INCOMPLETE",
          message: "執行 Amazon Ads 覆蓋健檢時發生未預期錯誤。",
        },
      },
    ]);
    for (const response of responses) {
      expect(response.headers).toEqual(JSON_HEADERS);
      expect(JSON.stringify(response)).not.toMatch(
        /Bearer|Atza|access.?value|client.?secret|accountScope|reportId|https?:|hostile-text|[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/iu,
      );
    }
  });
});
