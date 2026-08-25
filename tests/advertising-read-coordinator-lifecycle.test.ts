import { describe, expect, it, vi } from "vitest";
import {
  ReadOnlyAdvertisingCoordinator,
  type AdvertisingCoordinatorDependencies,
  type AdvertisingCoordinatorPort,
} from "../src/main/advertising-read-coordinator";
import {
  SP_ADVERTISED_PRODUCT_REPORT_CONFIGURATION_ID,
  type AdvertisingGateway,
} from "../src/main/amazon/ads-api";
import type {
  SpExecutionContext,
  SpExecutionContextAdapter,
} from "../src/main/amazon/sp-execution-context";
import { SpExecutionContextError } from
  "../src/main/amazon/sp-execution-context";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";
import type { AuditSuiteRunControl } from
  "../src/main/amazon/audit-suite-coordinator";

const US = "ATVPDKIKX0DER" as const;
const START_DATE = "2026-08-01";
const END_DATE = "2026-08-20";
const JOB_ID = "r10-read-only-job-001";
const BASE_NOW = Date.parse("2026-08-21T12:00:00.000Z");

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
      (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;

const PORT_SURFACE_IS_EXACT: Equal<
  keyof AdvertisingCoordinatorPort,
  | "status"
  | "coverage"
  | "startStrategy"
  | "observeStrategy"
  | "runStandalone"
  | "runAuditSuite"
  | "clear"
> = true;

type Deferred<Value> = Readonly<{
  promise: Promise<Value>;
  resolve(value: Value): void;
  reject(reason: unknown): void;
}>;

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function eventually(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }
  throw lastError;
}

function executionContext(): SpExecutionContext {
  return Object.freeze({
    marketplaceId: US,
    region: "na",
    mode: "live",
    accountScope: "opaque-r10-sp-scope",
    generation: 17,
  }) as SpExecutionContext;
}

function request(input: Readonly<{
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}>): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method: input.method,
    path: input.path,
    query: input.query ?? {},
    headers: {},
    ...(input.body
      ? { body: { kind: "json" as const, value: input.body } }
      : {}),
  };
}

function startRequest(): ApiRequest {
  return request({
    method: "POST",
    path: "/api/amazon-ads/strategy",
    body: {
      marketplaceId: US,
      startDate: START_DATE,
      endDate: END_DATE,
    },
  });
}

function observeRequest(jobId = JOB_ID): ApiRequest {
  return request({
    method: "GET",
    path: "/api/amazon-ads/strategy",
    query: {
      marketplaceId: US,
      jobId,
      startDate: START_DATE,
      endDate: END_DATE,
    },
  });
}

function jsonValue(response: ApiResponse): Record<string, unknown> {
  if (
    response.body.kind !== "json" ||
    !response.body.value ||
    typeof response.body.value !== "object"
  ) {
    throw new Error("Expected JSON object response.");
  }
  return response.body.value as Record<string, unknown>;
}

type DependencyOverrides = Readonly<{
  capture?: SpExecutionContextAdapter["capture"];
  assertCurrent?: SpExecutionContextAdapter["assertCurrent"];
  bind?: AdvertisingCoordinatorDependencies["reports"]["bindAdvertisedProductAccount"];
  assertBinding?: AdvertisingCoordinatorDependencies["reports"]["assertAdvertisedProductBinding"];
  catalogRead?: AdvertisingCoordinatorDependencies["strategySources"] extends infer _Ignored
    ? (input: Record<string, unknown>) => Promise<unknown>
    : never;
  runStandalone?: AdvertisingCoordinatorDependencies["listingsExport"]["runStandalone"];
  loadAuditSuiteListings?: AdvertisingCoordinatorDependencies["loadAuditSuiteListings"];
  now?: () => number;
}>;

function buildHarness(overrides: DependencyOverrides = {}) {
  const context = executionContext();
  let currentNow = BASE_NOW;
  const capture = vi.fn<SpExecutionContextAdapter["capture"]>(
    overrides.capture ?? (async () => context),
  );
  const assertCurrent = vi.fn<SpExecutionContextAdapter["assertCurrent"]>(
    overrides.assertCurrent ?? (async () => undefined),
  );
  const contextPort: SpExecutionContextAdapter = {
    capture,
    assertCurrent,
    invalidate: vi.fn(),
  };

  const advertising: AdvertisingGateway = {
    getCredentialSummary: vi.fn(async () => ({
      encryptionAvailable: true,
      hasVault: true,
      configured: true,
      lwaConfigured: true,
      refreshTokenConfigured: true,
      oauthRegion: "na" as const,
      updatedAt: "2026-08-21T00:00:00.000Z",
    })),
    getCombinedAccountIdentity: vi.fn(async () => ({
      combinedAccountScope: "opaque-r10-ads-scope",
      adsProfileFingerprint: "opaque-r10-profile-fingerprint",
    })),
    probeMarketplace: vi.fn(async () => ({
      ok: true,
      testedAt: "2026-08-21T00:00:00.000Z",
      marketplaceId: US,
      marketplaceCode: "US",
      accountType: "seller" as const,
      message: "verified",
      requestId: null,
    })),
    listEnabledSponsoredProductCampaigns: vi.fn(async () => []),
    createSponsoredProductsAdvertisedProductReport: vi.fn(async (input) => ({
      reportId: "ads-report-internal-only",
      marketplaceId: input.marketplaceId,
      combinedAccountScope: "opaque-r10-ads-scope",
      startDate: input.startDate,
      endDate: input.endDate,
      configurationId: SP_ADVERTISED_PRODUCT_REPORT_CONFIGURATION_ID as
        typeof SP_ADVERTISED_PRODUCT_REPORT_CONFIGURATION_ID,
    })),
    getSponsoredProductsAdvertisedProductReportStatus: vi.fn(async (reference) => ({
      reference,
      status: "COMPLETED" as const,
      ready: true,
      updatedAt: "2026-08-21T12:00:01.000Z",
    })),
    downloadSponsoredProductsAdvertisedProductReport: vi.fn(async (reference) => ({
      reference,
      rows: [],
    })),
    invalidate: vi.fn(),
  };

  const binding = "opaque-r10-binding-internal-only" as Awaited<ReturnType<
    AdvertisingCoordinatorDependencies["reports"]["bindAdvertisedProductAccount"]
  >>;
  const bind = vi.fn<
    AdvertisingCoordinatorDependencies["reports"]["bindAdvertisedProductAccount"]
  >(overrides.bind ?? (async () => binding));
  const assertBinding = vi.fn<
    AdvertisingCoordinatorDependencies["reports"]["assertAdvertisedProductBinding"]
  >(overrides.assertBinding ?? (async () => undefined));
  const startAdvertisedProduct = vi.fn(async () => ({
    mode: "live" as const,
    ready: false,
    reportId: "ads-report-handle-internal-only",
    documentId: null,
    status: "IN_QUEUE" as const,
    notice: "pending",
  }));
  const statusAdvertisedProduct = vi.fn(async () => ({
    mode: "live" as const,
    ready: true,
    reportId: "ads-report-handle-internal-only",
    documentId: "ads-document-handle-internal-only",
    status: "DONE" as const,
    notice: "ready",
  }));
  const readAdvertisedProductData = vi.fn(async () => ({
    rows: [{
      campaignId: "campaign-internal-only",
      campaignName: "Synthetic ProductAI campaign",
      adGroupId: "ad-group-internal-only",
      adGroupName: "Synthetic ad group",
      advertisedSku: "SAFE-SKU-1",
      advertisedAsin: "B000000001",
      impressions: 100,
      clicks: 4,
      cost: 12,
      sales14d: 60,
      purchases14d: 2,
    }],
  }));

  const catalogBegin = vi.fn(async () => ({
    mode: "live" as const,
    ready: false,
    reportId: "catalog-report-handle-internal-only",
    documentId: null,
    status: "IN_QUEUE" as const,
    notice: "pending",
  }));
  const catalogStatus = vi.fn(async () => ({
    mode: "live" as const,
    ready: true,
    reportId: "catalog-report-handle-internal-only",
    documentId: "catalog-document-handle-internal-only",
    status: "DONE" as const,
    notice: "ready",
  }));
  const defaultCatalogRead = async () => ({
    mode: "live" as const,
    marketplaceId: US,
    fetchedAt: "2026-08-21T12:00:02.000Z",
    rows: [{
      sellerSku: "SAFE-SKU-1",
      asin: "B000000001",
      title: "Synthetic FBA item",
    }],
    notice: "synthetic FBA identity",
  });
  const catalogRead = vi.fn(
    overrides.catalogRead ?? defaultCatalogRead,
  );
  const readExistingExport = vi.fn(async () => ({
    state: "missing" as const,
  }));

  const salesBegin = vi.fn(async () => ({
    mode: "live" as const,
    ready: false,
    reportId: "sales-report-handle-internal-only",
    documentId: null,
    status: "IN_QUEUE" as const,
    notice: "pending",
  }));
  const salesStatus = vi.fn(async () => ({
    mode: "live" as const,
    ready: true,
    reportId: "sales-report-handle-internal-only",
    documentId: "sales-document-handle-internal-only",
    status: "DONE" as const,
    notice: "ready",
  }));
  const salesRead = vi.fn(async () => ({
    mode: "live" as const,
    marketplaceId: US,
    startDate: START_DATE,
    endDate: END_DATE,
    fetchedAt: "2026-08-21T12:00:03.000Z",
    rows: [{
      sellerSku: "SAFE-SKU-1",
      childAsin: "B000000001",
      unitsOrdered: 10,
      orderedProductSales: 100,
      currencyCode: "USD",
    }],
    notice: "synthetic sales",
  }));

  const dependencies = {
    context: contextPort,
    advertising,
    reports: {
      bindAdvertisedProductAccount: bind,
      assertAdvertisedProductBinding: assertBinding,
      startAdvertisedProduct,
      statusAdvertisedProduct,
      readAdvertisedProductData,
    },
    catalog: {
      begin: catalogBegin,
      status: catalogStatus,
      read: catalogRead,
      readExistingExport,
    },
    salesAndTraffic: {
      begin: salesBegin,
      status: salesStatus,
      read: salesRead,
    },
    listingsExport: {
      runStandalone: vi.fn(overrides.runStandalone ?? (async () => {
        throw new Error("Unexpected standalone advertising audit.");
      })),
    },
    loadAuditSuiteListings: vi.fn(overrides.loadAuditSuiteListings ?? (async () => {
      throw new Error("Unexpected Audit Suite advertising audit.");
    })),
    wait: async (_milliseconds: number, signal?: AbortSignal) => {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    },
    createId: () => JOB_ID,
    now: overrides.now ?? (() => currentNow),
  } as unknown as AdvertisingCoordinatorDependencies;
  const coordinator = new ReadOnlyAdvertisingCoordinator(dependencies);

  return {
    coordinator,
    context,
    capture,
    assertCurrent,
    advertising,
    bind,
    assertBinding,
    startAdvertisedProduct,
    statusAdvertisedProduct,
    readAdvertisedProductData,
    catalogBegin,
    catalogStatus,
    catalogRead,
    salesBegin,
    salesStatus,
    salesRead,
    setNow(value: number) {
      currentNow = value;
    },
  };
}

async function terminal(
  coordinator: ReadOnlyAdvertisingCoordinator,
): Promise<ApiResponse> {
  let last: ApiResponse | null = null;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    last = await coordinator.observeStrategy(observeRequest());
    if (last.status !== 202) return last;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`Advertising coordinator did not settle: ${JSON.stringify(last)}`);
}

describe("R10 read-only advertising coordinator lifecycle", () => {
  it("keeps an exact read-only port and one captured context across all three report legs", async () => {
    expect(PORT_SURFACE_IS_EXACT).toBe(true);
    const harness = buildHarness();

    const status = await harness.coordinator.status(request({
      method: "GET",
      path: "/api/amazon-ads/status",
      query: { marketplaceId: US },
    }));
    expect(jsonValue(status)).toMatchObject({
      writeEnabled: false,
      permissionVerified: false,
    });

    const started = await harness.coordinator.startStrategy(startRequest());
    expect(started.status).toBe(202);
    const completed = await terminal(harness.coordinator);
    expect(completed.status).toBe(200);
    expect(jsonValue(completed)).toMatchObject({
      state: "completed",
      snapshot: {
        marketplaceId: US,
        rows: [{ sellerSku: "SAFE-SKU-1", spSpend: 12 }],
      },
    });

    expect(harness.bind).toHaveBeenCalledWith(expect.objectContaining({
      marketplaceId: US,
      expectedContext: harness.context,
    }));
    expect(harness.catalogBegin).toHaveBeenCalledWith(expect.objectContaining({
      marketplaceId: US,
      expectedContext: harness.context,
    }));
    expect(harness.catalogStatus).toHaveBeenCalledWith(expect.objectContaining({
      marketplaceId: US,
      expectedContext: harness.context,
    }));
    expect(harness.catalogRead).toHaveBeenCalledWith(expect.objectContaining({
      marketplaceId: US,
      expectedContext: harness.context,
    }));
    expect(harness.salesBegin).toHaveBeenCalledWith(expect.objectContaining({
      marketplaceId: US,
      expectedContext: harness.context,
    }));
    expect(harness.salesStatus).toHaveBeenCalledWith(expect.objectContaining({
      marketplaceId: US,
      expectedContext: harness.context,
    }));
    expect(harness.salesRead).toHaveBeenCalledWith(expect.objectContaining({
      marketplaceId: US,
      expectedContext: harness.context,
    }));
    expect(harness.startAdvertisedProduct).toHaveBeenCalledWith(
      expect.objectContaining({ marketplaceId: US }),
      expect.objectContaining({ expectedContext: harness.context }),
    );
    expect(harness.statusAdvertisedProduct).toHaveBeenCalledWith(
      expect.objectContaining({ marketplaceId: US }),
      "ads-report-handle-internal-only",
      expect.objectContaining({ expectedContext: harness.context }),
    );
    expect(harness.readAdvertisedProductData).toHaveBeenCalledWith(
      expect.objectContaining({ marketplaceId: US }),
      expect.objectContaining({
        reportId: "ads-report-handle-internal-only",
        documentId: "ads-document-handle-internal-only",
      }),
      expect.objectContaining({ expectedContext: harness.context }),
    );

    expect(JSON.stringify(jsonValue(completed))).not.toMatch(
      /opaque-r10|report-handle-internal|document-handle-internal|campaign-internal|ad-group-internal|profile-fingerprint/iu,
    );
    harness.coordinator.clear();
  });

  it("fences a start whose initial context capture resolves after clear", async () => {
    const context = executionContext();
    const captureGate = deferred<SpExecutionContext>();
    const harness = buildHarness({
      capture: () => captureGate.promise,
    });

    const pending = harness.coordinator.startStrategy(startRequest());
    await eventually(() => expect(harness.capture).toHaveBeenCalledOnce());
    harness.coordinator.clear();
    captureGate.resolve(context);

    const response = await pending;
    expect(response).toMatchObject({
      status: 409,
      body: {
        kind: "json",
        value: { code: "SP_CONTEXT_INVALIDATED" },
      },
    });
    expect(harness.bind).not.toHaveBeenCalled();
    expect(harness.catalogBegin).not.toHaveBeenCalled();
  });

  it("fences a start whose initial Ads binding resolves after clear", async () => {
    type Binding = Awaited<ReturnType<
      AdvertisingCoordinatorDependencies["reports"]["bindAdvertisedProductAccount"]
    >>;
    const bindingGate = deferred<Binding>();
    const harness = buildHarness({
      bind: () => bindingGate.promise,
    });

    const pending = harness.coordinator.startStrategy(startRequest());
    await eventually(() => expect(harness.bind).toHaveBeenCalledOnce());
    harness.coordinator.clear();
    expect(harness.bind.mock.calls[0]?.[0].signal?.aborted).toBe(true);
    bindingGate.resolve("late-r10-binding" as Binding);

    const response = await pending;
    expect(response).toMatchObject({
      status: 409,
      body: {
        kind: "json",
        value: { code: "SP_CONTEXT_INVALIDATED" },
      },
    });
    expect(harness.catalogBegin).not.toHaveBeenCalled();
    expect(harness.salesBegin).not.toHaveBeenCalled();
    expect(harness.startAdvertisedProduct).not.toHaveBeenCalled();
  });

  it("fences a start whose final pre-publication context check resolves after clear", async () => {
    const contextGate = deferred<void>();
    const harness = buildHarness({
      assertCurrent: () => contextGate.promise,
    });

    const pending = harness.coordinator.startStrategy(startRequest());
    await eventually(() => expect(harness.assertCurrent).toHaveBeenCalledOnce());
    harness.coordinator.clear();
    contextGate.resolve();

    const response = await pending;
    expect(response).toMatchObject({
      status: 409,
      body: {
        kind: "json",
        value: { code: "SP_CONTEXT_INVALIDATED" },
      },
    });
    expect(harness.catalogBegin).not.toHaveBeenCalled();
    expect(harness.salesBegin).not.toHaveBeenCalled();
    expect(harness.startAdvertisedProduct).not.toHaveBeenCalled();
  });

  it("keeps lifecycle invalidation ahead of a late unclassified Ads failure", async () => {
    const summaryGate = deferred<never>();
    const harness = buildHarness();
    vi.mocked(harness.advertising.getCredentialSummary)
      .mockImplementation(() => summaryGate.promise);

    const pending = harness.coordinator.status(request({
      method: "GET",
      path: "/api/amazon-ads/status",
      query: { marketplaceId: US },
    }));
    await eventually(() => {
      expect(harness.advertising.getCredentialSummary).toHaveBeenCalledOnce();
    });
    harness.coordinator.clear();
    summaryGate.reject(new Error("late private adapter failure"));

    const response = await pending;
    expect(response).toMatchObject({
      status: 409,
      body: {
        kind: "json",
        value: { code: "SP_CONTEXT_INVALIDATED" },
      },
    });
    expect(JSON.stringify(response)).not.toContain("late private adapter failure");
  });

  it("preserves an original classified context error across simultaneous clear", async () => {
    const summaryGate = deferred<never>();
    const harness = buildHarness();
    vi.mocked(harness.advertising.getCredentialSummary)
      .mockImplementation(() => summaryGate.promise);

    const pending = harness.coordinator.status(request({
      method: "GET",
      path: "/api/amazon-ads/status",
      query: { marketplaceId: US },
    }));
    await eventually(() => {
      expect(harness.advertising.getCredentialSummary).toHaveBeenCalledOnce();
    });
    harness.coordinator.clear();
    summaryGate.reject(new SpExecutionContextError(
      "ACCOUNT_SCOPE_CHANGED",
      "Amazon 帳號範圍已改變；本次操作已停止。",
    ));

    const response = await pending;
    expect(response).toMatchObject({
      status: 409,
      body: {
        kind: "json",
        value: { code: "ACCOUNT_SCOPE_CHANGED" },
      },
    });
  });

  it("keeps account drift ahead of a simultaneous Ads rejection", async () => {
    let assertions = 0;
    const harness = buildHarness({
      assertCurrent: async () => {
        assertions += 1;
        if (assertions > 1) {
          throw new SpExecutionContextError(
            "ACCOUNT_SCOPE_CHANGED",
            "Amazon 帳號範圍已改變；本次操作已停止。",
          );
        }
      },
    });
    vi.mocked(harness.advertising.getCredentialSummary)
      .mockRejectedValue(new Error("late private Ads rejection"));

    await expect(harness.coordinator.status(request({
      method: "GET",
      path: "/api/amazon-ads/status",
      query: { marketplaceId: US },
    }))).rejects.toMatchObject({
      status: 409,
      code: "ACCOUNT_SCOPE_CHANGED",
    });
    harness.coordinator.clear();
  });

  it("preserves a classified context error while observing an existing job", async () => {
    let driftOnObserve = false;
    const harness = buildHarness({
      assertBinding: async () => {
        if (driftOnObserve) {
          throw new SpExecutionContextError(
            "ACCOUNT_SCOPE_CHANGED",
            "Amazon 帳號範圍已改變；本次操作已停止。",
          );
        }
      },
    });

    expect((await harness.coordinator.startStrategy(startRequest())).status)
      .toBe(202);
    const completed = await terminal(harness.coordinator);
    expect(jsonValue(completed)).toMatchObject({ state: "completed" });

    driftOnObserve = true;
    await expect(harness.coordinator.observeStrategy(observeRequest()))
      .rejects.toMatchObject({
        status: 409,
        code: "ACCOUNT_SCOPE_CHANGED",
      });
    expect(await harness.coordinator.observeStrategy(observeRequest()))
      .toMatchObject({
        status: 404,
        body: {
          kind: "json",
          value: { code: "JOB_NOT_FOUND" },
        },
      });
    harness.coordinator.clear();
  });

  it("aborts a standalone Ads hook owned by the coordinator on clear", async () => {
    let ownedSignal: AbortSignal | undefined;
    const harness = buildHarness({
      runStandalone: (input) => new Promise((_resolve, reject) => {
        ownedSignal = input.signal;
        input.signal.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      }),
    });
    const context = harness.context;
    const pending = harness.coordinator.runStandalone({
      kind: "advertising",
      options: {},
      context: {
        accountScope: context.accountScope,
        generation: context.generation,
        marketplaceId: context.marketplaceId,
        mode: context.mode,
      },
      signal: new AbortController().signal,
      heartbeat: () => undefined,
      updateProgress: () => undefined,
    });
    await eventually(() => expect(ownedSignal).toBeDefined());

    harness.coordinator.clear();

    expect(ownedSignal?.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({
      code: "SP_CONTEXT_INVALIDATED",
    });
  });

  it("aborts an Audit Suite Ads hook owned by the coordinator on clear", async () => {
    let ownedSignal: AbortSignal | undefined;
    const harness = buildHarness({
      loadAuditSuiteListings: (_context, control) =>
        new Promise((_resolve, reject) => {
          ownedSignal = control.signal;
          control.signal.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          }, { once: true });
        }),
    });
    const context = harness.context;
    const control = {
      signal: new AbortController().signal,
      heartbeat: () => undefined,
      resource: <Value>(_key: unknown, load: () => Promise<Value>) => load(),
    } as AuditSuiteRunControl;
    const pending = harness.coordinator.runAuditSuite({
      runId: "r10-audit-suite-run",
      accountScope: context.accountScope,
      generation: context.generation,
      marketplaceId: context.marketplaceId,
      mode: context.mode,
    }, control);
    await eventually(() => expect(ownedSignal).toBeDefined());

    harness.coordinator.clear();

    expect(ownedSignal?.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({
      code: "SP_CONTEXT_INVALIDATED",
    });
  });

  it("does not let an abort catch overwrite a running job timeout", async () => {
    let capturedSignal: AbortSignal | undefined;
    let releaseCatalog!: () => void;
    const harness = buildHarness({
      catalogRead: (input) => new Promise((resolve) => {
        capturedSignal = input.signal as AbortSignal | undefined;
        releaseCatalog = () => resolve({
          mode: "live",
          marketplaceId: US,
          fetchedAt: "2026-08-21T12:00:02.000Z",
          rows: [{
            sellerSku: "SAFE-SKU-1",
            asin: "B000000001",
            title: "Synthetic FBA item",
          }],
          notice: "synthetic FBA identity",
        });
      }),
    });

    const started = await harness.coordinator.startStrategy(startRequest());
    expect(started.status).toBe(202);
    await eventually(() => expect(harness.catalogRead).toHaveBeenCalledOnce());

    harness.setNow(BASE_NOW + 4 * 60 * 60 * 1_000);
    const timedOut = await harness.coordinator.observeStrategy(observeRequest());
    expect(timedOut.status).toBe(200);
    expect(jsonValue(timedOut)).toMatchObject({
      state: "failed",
      errorCode: "STRATEGY_TIMEOUT",
    });
    expect(capturedSignal?.aborted).toBe(true);
    const bindingChecksAtTimeout = harness.assertBinding.mock.calls.length;

    releaseCatalog();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.assertBinding).toHaveBeenCalledTimes(bindingChecksAtTimeout);
    expect(harness.salesRead).not.toHaveBeenCalled();
    expect(harness.readAdvertisedProductData).not.toHaveBeenCalled();
    const afterAbortCatch = await harness.coordinator.observeStrategy(
      observeRequest(),
    );
    expect(jsonValue(afterAbortCatch)).toMatchObject({
      state: "failed",
      errorCode: "STRATEGY_TIMEOUT",
    });
    harness.coordinator.clear();
  });

  it("cannot return a stale terminal snapshot that expires during an identity await", async () => {
    const identityGate = deferred<void>();
    let blockIdentity = false;
    const assertBinding = vi.fn<
      AdvertisingCoordinatorDependencies["reports"]["assertAdvertisedProductBinding"]
    >(async () => {
      if (blockIdentity) await identityGate.promise;
    });
    const harness = buildHarness({ assertBinding });

    expect((await harness.coordinator.startStrategy(startRequest())).status)
      .toBe(202);
    const completed = await terminal(harness.coordinator);
    expect(jsonValue(completed)).toMatchObject({ state: "completed" });

    const callsBefore = harness.assertBinding.mock.calls.length;
    blockIdentity = true;
    const pendingObserve = harness.coordinator.observeStrategy(observeRequest());
    await eventually(() => {
      expect(harness.assertBinding.mock.calls.length).toBeGreaterThan(callsBefore);
    });
    harness.setNow(BASE_NOW + 31 * 60 * 1_000);
    identityGate.resolve();

    const expired = await pendingObserve;
    expect(expired).toMatchObject({
      status: 404,
      body: {
        kind: "json",
        value: { code: "JOB_NOT_FOUND" },
      },
    });
    harness.coordinator.clear();
  });
});
