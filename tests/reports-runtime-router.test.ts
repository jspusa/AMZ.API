import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import {
  createScriptedReportsAdapter,
  reportsAdapterIdentity,
  type ReportsAdapter,
} from "../src/main/amazon/reports-runtime";
import {
  createScriptedSpExecutionContextAdapter,
  SpExecutionContextError,
  type SpExecutionContextAdapter,
} from "../src/main/amazon/sp-execution-context";
import type { CredentialVault } from "../src/main/credential-vault";
import { LocalStore } from "../src/main/local-store";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const US = "ATVPDKIKX0DER";

function request(input: {
  method: "GET" | "POST";
  path?: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method: input.method,
    path: input.path ?? "/api/sp-api/variation-audit",
    query: input.query ?? {},
    headers: {},
    ...(input.body
      ? { body: { kind: "json" as const, value: input.body } }
      : {}),
  };
}

function body(response: ApiResponse): Record<string, unknown> {
  if (response.body.kind !== "json") throw new Error("Expected JSON response");
  return response.body.value as Record<string, unknown>;
}

async function seedCompletedBusinessPricingReports(
  store: LocalStore,
  accountScope: string,
): Promise<Readonly<{
  allListingsReportId: string;
  allListingsDocumentId: string;
  activeListingsReportId: string;
  activeListingsDocumentId: string;
}>> {
  const now = Date.now();
  const allListingsLeaseId = "router-context-all-listings";
  const activeListingsLeaseId = "router-context-active-listings";
  await store.createSharedReportIfAbsent({
    leaseId: allListingsLeaseId,
    accountScope,
    marketplaceId: US,
    mode: "live",
    reportType: "GET_MERCHANT_LISTINGS_ALL_DATA",
    optionsKey: "preferredReportDocumentLocale=en_US",
    report: {
      reportId: "AMAZON-RAW-ALL-LISTINGS",
      documentId: "AMAZON-RAW-ALL-LISTINGS-DOCUMENT",
      status: "DONE",
      createdAt: now - 2_000,
      terminal: null,
      terminalAt: null,
    },
    createdAt: now - 2_000,
    updatedAt: now - 1_000,
    expiresAt: now + 60_000,
  }, now);
  await store.createSharedReportIfAbsent({
    leaseId: activeListingsLeaseId,
    accountScope,
    marketplaceId: US,
    mode: "live",
    reportType: "GET_MERCHANT_LISTINGS_DATA",
    optionsKey: "preferredReportDocumentLocale=en_US",
    report: {
      reportId: "AMAZON-RAW-ACTIVE-LISTINGS",
      documentId: "AMAZON-RAW-ACTIVE-LISTINGS-DOCUMENT",
      status: "DONE",
      createdAt: now - 2_000,
      terminal: null,
      terminalAt: null,
    },
    createdAt: now - 2_000,
    updatedAt: now - 1_000,
    expiresAt: now + 60_000,
  }, now);
  return {
    allListingsReportId: `report-lease.${allListingsLeaseId}`,
    allListingsDocumentId: `report-document.${allListingsLeaseId}`,
    activeListingsReportId: `report-lease.${activeListingsLeaseId}`,
    activeListingsDocumentId: `report-document.${activeListingsLeaseId}`,
  };
}

function businessPricingDocumentAdapter(
  onDocument?: (
    intent: "all-listings" | "active-business-listings",
    signal: AbortSignal,
  ) => void | Promise<void>,
): ReportsAdapter {
  return {
    async create() {
      throw new Error("create must not run from a data GET");
    },
    async status() {
      throw new Error("status must not run from a data GET");
    },
    async readDocument(request) {
      if (
        request.intent !== "all-listings" &&
        request.intent !== "active-business-listings"
      ) {
        throw new Error("unexpected Reports intent");
      }
      await onDocument?.(request.intent, request.signal);
      return {
        identity: reportsAdapterIdentity(request, request.mode),
        reportId: request.reportId,
        documentId: request.documentId,
        text: request.intent === "all-listings"
          ? "seller-sku\tasin\titem-name\tfulfillment-channel\tbusiness-price"
          : "seller-sku\tasin1\tfulfillment-channel\tbusiness-price",
      };
    },
  };
}

describe("Reports runtime router wiring", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the injected production seam for live create/status and never the legacy gateway", async () => {
    const directory = await mkdtemp(join(tmpdir(), "reports-router-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    const reportsAdapter = createScriptedReportsAdapter([
      {
        operation: "create",
        result: {
          mode: "live",
          ready: false,
          reportId: "AMAZON-RAW-LISTINGS-REPORT",
          documentId: null,
          status: "IN_QUEUE",
          notice: "queued",
        },
      },
      {
        operation: "status",
        result: {
          mode: "live",
          ready: true,
          reportId: "AMAZON-RAW-LISTINGS-REPORT",
          documentId: "AMAZON-RAW-LISTINGS-DOCUMENT",
          status: "DONE",
          notice: "done",
        },
      },
    ]);
    const legacyStart = vi.fn(async () => {
      throw new Error("legacy Reports gateway must not run in live production wiring");
    });
    const legacyStatus = vi.fn(async () => {
      throw new Error("legacy Reports gateway must not run in live production wiring");
    });
    const router = new ApiRouter({
      store,
      vault: {
        getAccountScope: async () => "opaque-live-account",
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
      spExecutionContext: createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: US,
        mode: "live",
        accountScope: "opaque-live-account",
      })),
      reportsAdapter,
      allListingsDemoReports: {
        start: legacyStart as never,
        status: legacyStatus as never,
      },
    });

    const started = await router.handle(request({
      method: "POST",
      body: { marketplaceId: US },
    }));
    expect(started.status).toBe(202);
    expect(body(started).reportId).toMatch(/^report-lease\./u);
    expect(JSON.stringify(body(started))).not.toContain("AMAZON-RAW");

    const completed = await router.handle(request({
      method: "GET",
      query: {
        marketplaceId: US,
        reportId: String(body(started).reportId),
      },
    }));
    expect(completed.status).toBe(200);
    expect(body(completed).documentId).toMatch(/^report-document\./u);
    expect(JSON.stringify(body(completed))).not.toContain("AMAZON-RAW");
    expect(reportsAdapter.requests.map(({ operation }) => operation)).toEqual([
      "create",
      "status",
    ]);
    expect(legacyStart).not.toHaveBeenCalled();
    expect(legacyStatus).not.toHaveBeenCalled();
  });

  it("reads completed report data through the injected document seam", async () => {
    vi.stubEnv("SP_API_MODE", "live");
    const directory = await mkdtemp(join(tmpdir(), "reports-router-document-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    const aisKeys = [
      "181-210",
      "211-240",
      "241-270",
      "271-300",
      "301-330",
      "331-365",
      "366-455",
      "456-plus",
    ] as const;
    const headers = [
      "seller-sku",
      "fnsku",
      "asin",
      "product-name",
      "condition",
      "available",
      "inv-age-0-to-90-days",
      "inv-age-91-to-180-days",
      "inv-age-181-to-270-days",
      "inv-age-271-to-365-days",
      "inv-age-366-to-455-days",
      "inv-age-456-plus-days",
      "estimated-excess-quantity",
      "currency",
      "storage-volume",
      "estimated-storage-cost-next-month",
      ...aisKeys.flatMap((key) => [
        `quantity-to-be-charged-ais-${key}-days`,
        `estimated-ais-${key}-days`,
      ]),
    ];
    const known: Record<string, string> = {
      "seller-sku": "AGED-FBA-KNOWN",
      fnsku: "X001AGED01",
      asin: "B0AGED0001",
      "product-name": "Aged FBA known evidence",
      condition: "New",
      available: "1",
      "inv-age-0-to-90-days": "0",
      "inv-age-91-to-180-days": "0",
      "inv-age-181-to-270-days": "1",
      "inv-age-271-to-365-days": "0",
      "inv-age-366-to-455-days": "0",
      "inv-age-456-plus-days": "0",
      "estimated-excess-quantity": "7",
      currency: "USD",
      "storage-volume": "1",
      "estimated-storage-cost-next-month": "2.5",
    };
    const missing: Record<string, string> = {
      "seller-sku": "AGED-FBA-MISSING",
      fnsku: "X001AGED02",
      asin: "B0AGED0002",
      "product-name": "Aged FBA missing evidence",
      condition: "New",
      available: "1",
      "inv-age-0-to-90-days": "0",
      "inv-age-91-to-180-days": "0",
      "inv-age-181-to-270-days": "1",
      "inv-age-271-to-365-days": "0",
      "inv-age-366-to-455-days": "0",
      "inv-age-456-plus-days": "0",
      currency: "USD",
      "storage-volume": "1",
    };
    aisKeys.forEach((key, index) => {
      known[`quantity-to-be-charged-ais-${key}-days`] = index === 0 ? "1" : "0";
      known[`estimated-ais-${key}-days`] = index === 0 ? "1.2" : "0";
      missing[`quantity-to-be-charged-ais-${key}-days`] = index === 0 ? "1" : "0";
    });
    const document = [
      headers.join("\t"),
      headers.map((header) => known[header] ?? "").join("\t"),
      headers.map((header) => missing[header] ?? "").join("\t"),
    ].join("\n");
    const reportsAdapter = createScriptedReportsAdapter([
      {
        operation: "create",
        result: {
          mode: "live",
          ready: false,
          reportId: "AMAZON-RAW-AGED-REPORT",
          documentId: null,
          status: "IN_QUEUE",
          notice: "queued",
        },
      },
      {
        operation: "status",
        result: {
          mode: "live",
          ready: true,
          reportId: "AMAZON-RAW-AGED-REPORT",
          documentId: "AMAZON-RAW-AGED-DOCUMENT",
          status: "DONE",
          notice: "done",
        },
      },
      { operation: "document", result: { text: document } },
    ]);
    const router = new ApiRouter({
      store,
      vault: {
        getAccountScope: async () => "opaque-live-account",
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
      spExecutionContext: createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: US,
        mode: "live",
        accountScope: "opaque-live-account",
      })),
      reportsAdapter,
    });

    const started = await router.handle(request({
      method: "POST",
      path: "/api/sp-api/aged-inventory",
      body: { marketplaceId: US },
    }));
    const completed = await router.handle(request({
      method: "GET",
      path: "/api/sp-api/aged-inventory",
      query: {
        marketplaceId: US,
        reportId: String(body(started).reportId),
      },
    }));
    const data = await router.handle(request({
      method: "GET",
      path: "/api/sp-api/aged-inventory",
      query: {
        marketplaceId: US,
        reportId: String(body(completed).reportId),
        documentId: String(body(completed).documentId),
        data: "1",
      },
    }));

    expect(data.status, JSON.stringify(body(data))).toBe(200);
    expect(body(data)).toMatchObject({
      mode: "live",
      marketplaceId: US,
      rows: [
        expect.objectContaining({
          sellerSku: "AGED-FBA-KNOWN",
          estimatedExcessQuantity: 7,
          estimatedStorageCostNextMonth: 2.5,
          estimatedAgedSurcharge: 1.2,
        }),
        expect.objectContaining({
          sellerSku: "AGED-FBA-MISSING",
          estimatedExcessQuantity: null,
          estimatedStorageCostNextMonth: null,
          estimatedAgedSurcharge: null,
        }),
      ],
      summary: {
        skuCount: 2,
        agedOver180: 2,
        excessAvailability: "partial",
        estimatedExcessQuantity: null,
        excessReportedSkuCount: 1,
        storageCostAvailability: "partial",
        estimatedStorageCostNextMonth: null,
        storageCostReportedSkuCount: 1,
        agedSurchargeAvailability: "partial",
        estimatedAgedSurcharge: null,
        agedSurchargeReportedSkuCount: 1,
      },
    });
    expect(JSON.stringify(body(data))).not.toContain("AMAZON-RAW");
    expect(reportsAdapter.requests.map(({ operation }) => operation)).toEqual([
      "create",
      "status",
      "document",
    ]);
  });

  it("fails closed when the account changes during the optional Active Business document read", async () => {
    const directory = await mkdtemp(join(tmpdir(), "reports-router-account-race-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    let accountScope = "opaque-live-account-a";
    const handles = await seedCompletedBusinessPricingReports(store, accountScope);
    const router = new ApiRouter({
      store,
      vault: {
        getAccountScope: async () => accountScope,
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
      spExecutionContext: createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: US,
        mode: "live",
        accountScope,
      })),
      reportsAdapter: businessPricingDocumentAdapter((intent) => {
        if (intent === "active-business-listings") {
          accountScope = "opaque-live-account-b";
        }
      }),
    });

    const response = await router.handle(request({
      method: "GET",
      path: "/api/sp-api/business-pricing-audit",
      query: {
        marketplaceId: US,
        reportId: handles.allListingsReportId,
        documentId: handles.allListingsDocumentId,
        data: "1",
      },
    }));

    expect(response.status).toBe(409);
    expect(body(response)).toMatchObject({ code: "ACCOUNT_SCOPE_CHANGED" });
  });

  it("keeps the Reports context fence ahead of AbortError during Active Business cleanup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "reports-router-abort-race-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    const accountScope = "opaque-live-account-a";
    const handles = await seedCompletedBusinessPricingReports(store, accountScope);
    let markActiveStarted!: () => void;
    const activeStarted = new Promise<void>((resolve) => {
      markActiveStarted = resolve;
    });
    const router = new ApiRouter({
      store,
      vault: {
        getAccountScope: async () => accountScope,
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
      spExecutionContext: createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: US,
        mode: "live",
        accountScope,
      })),
      reportsAdapter: businessPricingDocumentAdapter(async (intent, signal) => {
        if (intent !== "active-business-listings") return;
        markActiveStarted();
        await new Promise<never>((_resolve, reject) => {
          const rejectFromAbort = () => reject(
            signal.reason ?? new DOMException("Aborted", "AbortError"),
          );
          if (signal.aborted) {
            rejectFromAbort();
            return;
          }
          signal.addEventListener("abort", rejectFromAbort, { once: true });
        });
      }),
    });
    const controller = new AbortController();
    const getAuditData = (router as unknown as {
      getSharedBusinessPricingAuditData(input: Readonly<{
        marketplaceId: typeof US;
        reportId: string;
        documentId: string;
        activeListingsReport: Readonly<{
          reportId: string;
          documentId: string;
        }>;
        signal: AbortSignal;
      }>): Promise<unknown>;
    }).getSharedBusinessPricingAuditData.bind(router);

    const pending = getAuditData({
      marketplaceId: US,
      reportId: handles.allListingsReportId,
      documentId: handles.allListingsDocumentId,
      activeListingsReport: {
        reportId: handles.activeListingsReportId,
        documentId: handles.activeListingsDocumentId,
      },
      signal: controller.signal,
    });
    await activeStarted;
    router.invalidateContext("account-changed");
    controller.abort(new Error("context cleanup aborted the document read"));

    await expect(pending).rejects.toMatchObject({
      status: 409,
      code: "SP_CONTEXT_INVALIDATED",
    });
  });

  it("does not degrade a Reports context invalidation to missing Active Business evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "reports-router-invalidation-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    const accountScope = "opaque-live-account-a";
    const handles = await seedCompletedBusinessPricingReports(store, accountScope);
    const baseContext = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "live",
      accountScope,
    }));
    let invalidateActiveEvidenceRead = true;
    const spExecutionContext: SpExecutionContextAdapter = {
      capture: (marketplaceId) => baseContext.capture(marketplaceId),
      async assertCurrent(context) {
        if (invalidateActiveEvidenceRead) {
          invalidateActiveEvidenceRead = false;
          throw new SpExecutionContextError(
            "SP_CONTEXT_INVALIDATED",
            "Amazon execution context changed during the read.",
          );
        }
        await baseContext.assertCurrent(context);
      },
      invalidate: (reason) => baseContext.invalidate(reason),
    };
    const router = new ApiRouter({
      store,
      vault: {
        getAccountScope: async () => accountScope,
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
      spExecutionContext,
      reportsAdapter: businessPricingDocumentAdapter(),
    });

    const response = await router.handle(request({
      method: "GET",
      path: "/api/sp-api/business-pricing-audit",
      query: {
        marketplaceId: US,
        reportId: handles.allListingsReportId,
        documentId: handles.allListingsDocumentId,
        data: "1",
      },
    }));

    expect(response.status).toBe(409);
    expect(body(response)).toMatchObject({ code: "SP_CONTEXT_INVALIDATED" });
  });
});
