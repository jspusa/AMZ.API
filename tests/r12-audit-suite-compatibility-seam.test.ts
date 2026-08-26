import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

function request(method: "GET" | "POST", path: string): ApiRequest {
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
      "x-r12-owner": "legacy-audit-suite-compatibility",
      "x-r12-operation": operation,
    },
    body: {
      kind: "json",
      value: { owner: "legacy-audit-suite-compatibility", operation },
    },
  };
}

describe("R12 legacy Audit Suite compatibility public seam", () => {
  it("delegates start, status, export and clear to one injected owner", async () => {
    const startResponse = delegated("start");
    const observeResponse = delegated("observe");
    const downloadResponse = delegated("download");
    const legacyAuditSuiteCompatibility = {
      start: vi.fn(async () => startResponse),
      observe: vi.fn(async () => observeResponse),
      download: vi.fn(async () => downloadResponse),
      clear: vi.fn(),
    };
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      legacyAuditSuiteCompatibility,
    } as unknown as ConstructorParameters<typeof ApiRouter>[0]);
    const startRequest = request("POST", "/api/sp-api/audit-suite");
    const observeRequest = request("GET", "/api/sp-api/audit-suite");
    const downloadRequest = request(
      "GET",
      "/api/sp-api/audit-suite/export",
    );

    const responses = await Promise.all([
      router.handle(startRequest),
      router.handle(observeRequest),
      router.handle(downloadRequest),
    ]);
    router.dispose();

    expect(legacyAuditSuiteCompatibility.start).toHaveBeenCalledWith(
      startRequest,
    );
    expect(legacyAuditSuiteCompatibility.observe).toHaveBeenCalledWith(
      observeRequest,
    );
    expect(legacyAuditSuiteCompatibility.download).toHaveBeenCalledWith(
      downloadRequest,
    );
    expect(responses).toEqual([
      startResponse,
      observeResponse,
      downloadResponse,
    ]);
    expect(legacyAuditSuiteCompatibility.clear).toHaveBeenCalledOnce();
  });

  it("keeps the fixed seven-section legacy implementation out of Router", () => {
    const routerSource = readFileSync(
      new URL("../src/main/api-router.ts", import.meta.url),
      "utf8",
    );
    const compatibilitySource = readFileSync(
      new URL(
        "../src/main/audit-suite-compatibility-coordinator.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const legacyRouterSymbols = [
      "AuditSuiteCoordinator",
      "AuditSuiteCoordinatorError",
      "AuditSuiteRunControl",
      "createAuditSuiteResourceKey",
      "createAuditSuiteWorkbook",
      "ValidatedAuditSuiteSnapshot",
      "assertAuditSuiteActive",
      "suiteSnapshot",
      "buildAplusAuditSuiteResult",
      "buildSubscriptionAuditSuiteRows",
      "AUDIT_SUITE_LISTINGS_RESOURCE",
      "AUDIT_SUITE_FBA_GROUPING_RESOURCE",
      "auditSuiteListings",
      "auditSuiteFbaGrouping",
      "runAuditSuiteContent",
      "runAuditSuiteImage",
      "runAuditSuiteAplus",
      "runAuditSuiteVariation",
      "runAuditSuiteSubscription",
      "runAuditSuiteBusinessPricing",
    ] as const;

    for (const symbol of legacyRouterSymbols) {
      expect(routerSource, `${symbol} must be owned outside Router`).not.toMatch(
        new RegExp(`\\b${symbol}\\b`, "u"),
      );
    }

    const runners = compatibilitySource.match(
      /runners:\s*\{(?<body>[\s\S]*?)^\s*\},\s*\n\s*ttlMs:/mu,
    );
    expect(runners?.groups?.body).toBeDefined();
    const sectionIds = [...(runners?.groups?.body ?? "").matchAll(
      /^\s{8}([A-Za-z]+):/gmu,
    )].map((match) => match[1]);
    expect(sectionIds).toEqual([
      "content",
      "image",
      "aplus",
      "variation",
      "subscription",
      "businessPricing",
      "advertising",
    ]);

    for (const owner of [
      "content",
      "image",
      "aplus",
      "variation",
      "subscription",
      "businessPricing",
      "advertising",
    ] as const) {
      expect(
        compatibilitySource,
        `${owner} must delegate to its semantic owner`,
      ).toContain(`this.${owner}.runAuditSuite(`);
    }

    for (const binding of [
      "content: this.contentAuditOwner",
      "image: this.imageAuditOwner",
      "aplus: this.aPlusAuditCoordinator",
      "variation: this.unboundVariationAuditOwner",
      "subscription: this.subscriptionAuditOwner",
      "businessPricing: this.businessPricingAuditOwner",
      "advertising: this.advertisingCoordinator",
    ] as const) {
      expect(
        routerSource,
        `${binding} must be wired into the production compatibility owner`,
      ).toContain(binding);
    }

    const importSpecifiers = [...compatibilitySource.matchAll(
      /\bfrom\s+["']([^"']+)["']/gmu,
    )].map((match) => match[1]);
    expect(
      importSpecifiers.filter((specifier) =>
        /(?:api-router|vault|store|write)/iu.test(specifier) ||
        /(?:^|\/)sp-api$/u.test(specifier)
      ),
    ).toEqual([]);
  });
});
