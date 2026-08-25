import { readFileSync } from "node:fs";
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
    });
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
    expect(advertisingCoordinator.status).toHaveBeenCalledOnce();
    expect(advertisingCoordinator.coverage).toHaveBeenCalledWith(coverageRequest);
    expect(advertisingCoordinator.coverage).toHaveBeenCalledOnce();
    expect(advertisingCoordinator.startStrategy).toHaveBeenCalledWith(
      strategyStartRequest,
    );
    expect(advertisingCoordinator.startStrategy).toHaveBeenCalledOnce();
    expect(advertisingCoordinator.observeStrategy).toHaveBeenCalledWith(
      strategyObserveRequest,
    );
    expect(advertisingCoordinator.observeStrategy).toHaveBeenCalledOnce();
    expect(responses).toEqual([
      statusResponse,
      coverageResponse,
      strategyStartResponse,
      strategyObserveResponse,
    ]);
    expect(advertisingCoordinator.clear).toHaveBeenCalledOnce();
  });

  it("keeps every Ads hook on the owner and clears the shared broker first", () => {
    const routerSource = readFileSync(
      new URL("../src/main/api-router.ts", import.meta.url),
      "utf8",
    );
    const coordinatorSource = readFileSync(
      new URL("../src/main/advertising-read-coordinator.ts", import.meta.url),
      "utf8",
    );
    const standaloneSource = readFileSync(
      new URL("../src/main/standalone-audit-coordinator.ts", import.meta.url),
      "utf8",
    );
    const clearStart = routerSource.indexOf(
      "private clearContextBoundState(): void",
    );
    const clearEnd = routerSource.indexOf(
      "private invalidateContextBoundState(",
      clearStart,
    );
    const clearBody = routerSource.slice(clearStart, clearEnd);
    const brokerClear = clearBody.indexOf("this.reportBroker.clear()");
    const coordinatorClear = clearBody.indexOf(
      "this.advertisingCoordinator.clear()",
    );

    expect(clearStart).toBeGreaterThan(-1);
    expect(brokerClear).toBeGreaterThan(-1);
    expect(coordinatorClear).toBeGreaterThan(-1);
    expect(brokerClear).toBeLessThan(coordinatorClear);
    expect(coordinatorSource).not.toContain("this.reportBroker.clear()");
    expect(standaloneSource).toContain(
      "return this.advertising.runStandalone(input)",
    );
    expect(routerSource).not.toContain(
      "this.advertisingCoordinator.runStandalone(input)",
    );
    expect(routerSource).toContain(
      "this.advertisingCoordinator.runAuditSuite(context, control)",
    );
  });
});
