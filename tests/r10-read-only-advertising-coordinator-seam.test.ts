import { describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

function request(
  method: "GET" | "POST",
  path: string,
): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method,
    path,
    query: method === "GET" ? { deliberatelyInvalidLegacyQuery: "1" } : {},
    headers: {},
    ...(method === "POST"
      ? {
          body: {
            kind: "json" as const,
            value: { deliberatelyInvalidLegacyBody: true },
          },
        }
      : {}),
  };
}

function delegated(operation: string): ApiResponse {
  return {
    status: 207,
    headers: {
      "x-r10-owner": "read-only-advertising",
      "x-r10-operation": operation,
    },
    body: {
      kind: "json",
      value: { owner: "read-only-advertising", operation },
    },
  };
}

describe("R10 read-only Amazon Ads coordinator public seam", () => {
  it("delegates status, coverage, strategy start/status and clear", async () => {
    const statusResponse = delegated("status");
    const coverageResponse = delegated("coverage");
    const strategyStartResponse = delegated("strategy-start");
    const strategyObserveResponse = delegated("strategy-observe");
    const advertisingCoordinator = {
      status: vi.fn(async () => statusResponse),
      coverage: vi.fn(async () => coverageResponse),
      startStrategy: vi.fn(async () => strategyStartResponse),
      observeStrategy: vi.fn(async () => strategyObserveResponse),
      runStandalone: vi.fn(),
      runAuditSuite: vi.fn(),
      clear: vi.fn(),
    };
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      advertisingCoordinator,
    } as unknown as ConstructorParameters<typeof ApiRouter>[0]);
    const statusRequest = request("GET", "/api/amazon-ads/status");
    const coverageRequest = request("GET", "/api/amazon-ads/coverage");
    const strategyStartRequest = request("POST", "/api/amazon-ads/strategy");
    const strategyObserveRequest = request("GET", "/api/amazon-ads/strategy");

    const responses = await Promise.all([
      router.handle(statusRequest),
      router.handle(coverageRequest),
      router.handle(strategyStartRequest),
      router.handle(strategyObserveRequest),
    ]);
    router.dispose();

    expect(advertisingCoordinator.status).toHaveBeenCalledWith(statusRequest);
    expect(advertisingCoordinator.coverage).toHaveBeenCalledWith(coverageRequest);
    expect(advertisingCoordinator.startStrategy).toHaveBeenCalledWith(
      strategyStartRequest,
    );
    expect(advertisingCoordinator.observeStrategy).toHaveBeenCalledWith(
      strategyObserveRequest,
    );
    expect(responses).toEqual([
      statusResponse,
      coverageResponse,
      strategyStartResponse,
      strategyObserveResponse,
    ]);
    expect(advertisingCoordinator.clear).toHaveBeenCalledOnce();
  });
});
