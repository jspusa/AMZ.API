import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdvertisingApiError,
  AdvertisingReportAcceptedError,
  SP_ADVERTISED_PRODUCT_REPORT_CONFIGURATION_ID,
  type AdvertisingGateway,
  type SponsoredProductsAdvertisedProductReportReference,
} from "../src/main/amazon/ads-api";
import {
  FixedReportBroker,
  type AdvertisedProductReportPlan,
} from "../src/main/amazon/report-broker";
import {
  createScriptedReportsAdapter,
  type ReportsAdapter,
} from "../src/main/amazon/reports-runtime";
import { createScriptedSpExecutionContextAdapter } from
  "../src/main/amazon/sp-execution-context";
import { LocalStore } from "../src/main/local-store";

const MARKETPLACE_ID = "ATVPDKIKX0DER";
const START_DATE = "2026-07-01";
const END_DATE = "2026-07-30";

const unusedReportsAdapter: ReportsAdapter = {
  async create() {
    throw new Error("SP adapter must not be called by an Ads broker test.");
  },
  async status() {
    throw new Error("SP adapter must not be called by an Ads broker test.");
  },
  async readDocument() {
    throw new Error("SP adapter must not be called by an Ads broker test.");
  },
};

function plan(signal?: AbortSignal): AdvertisedProductReportPlan {
  return {
    intent: "ads-sp-advertised-product",
    marketplaceId: MARKETPLACE_ID,
    startDate: START_DATE,
    endDate: END_DATE,
    signal,
  };
}

function reference(
  combinedAccountScope: string,
  overrides: Partial<SponsoredProductsAdvertisedProductReportReference> = {},
): SponsoredProductsAdvertisedProductReportReference {
  return {
    reportId: "ads-report-fixed-1",
    marketplaceId: MARKETPLACE_ID,
    combinedAccountScope,
    startDate: START_DATE,
    endDate: END_DATE,
    configurationId: SP_ADVERTISED_PRODUCT_REPORT_CONFIGURATION_ID,
    ...overrides,
  };
}

async function buildBroker(input: Readonly<{
  create?: NonNullable<AdvertisingGateway["createSponsoredProductsAdvertisedProductReport"]>;
  status?: NonNullable<AdvertisingGateway["getSponsoredProductsAdvertisedProductReportStatus"]>;
  download?: NonNullable<AdvertisingGateway["downloadSponsoredProductsAdvertisedProductReport"]>;
  readSpAccountScope?: () => string;
  readAdsCombinedAccountScope?: () => string;
  readAdsProfileFingerprint?: () => string;
  now?: () => Date;
}> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "amz-fixed-report-broker-"));
  const store = new LocalStore(join(directory, "data.json"));
  await store.initialize();
  const combinedAccountScope = "combined-main-only-scope";
  const accepted = reference(combinedAccountScope);
  const create = vi.fn(input.create ?? (async () => accepted));
  const status = vi.fn(input.status ?? (async (actual) => ({
    reference: actual,
    status: "COMPLETED" as const,
    ready: true,
    updatedAt: "2026-08-25T00:00:00.000Z",
  })));
  const download = vi.fn(input.download ?? (async (actual) => ({
    reference: actual,
    rows: [{
      campaignId: "campaign-1",
      campaignName: "Synthetic campaign",
      adGroupId: "group-1",
      adGroupName: "Synthetic group",
      advertisedSku: "SAFE-SKU",
      advertisedAsin: "B000000001",
      impressions: 10,
      clicks: 2,
      cost: 1.5,
      sales14d: 8,
      purchases14d: 1,
    }],
  })));
  const advertising: AdvertisingGateway = {
    getCredentialSummary: vi.fn(async () => ({
      encryptionAvailable: true,
      hasVault: true,
      configured: true,
      lwaConfigured: true,
      refreshTokenConfigured: true,
      oauthRegion: "na" as const,
      updatedAt: null,
    })),
    getCombinedAccountIdentity: vi.fn(async () => ({
      combinedAccountScope: input.readAdsCombinedAccountScope?.() ?? combinedAccountScope,
      adsProfileFingerprint: input.readAdsProfileFingerprint?.() ?? "a".repeat(64),
    })),
    probeMarketplace: vi.fn(),
    listEnabledSponsoredProductCampaigns: vi.fn(),
    createSponsoredProductsAdvertisedProductReport: create,
    getSponsoredProductsAdvertisedProductReportStatus: status,
    downloadSponsoredProductsAdvertisedProductReport: download,
    invalidate: vi.fn(),
  };
  const context = createScriptedSpExecutionContextAdapter(() => ({
    marketplaceId: MARKETPLACE_ID,
    mode: "live",
    accountScope: input.readSpAccountScope?.() ?? "sp-main-only-scope",
  }));
  const broker = new FixedReportBroker({
    store,
    context,
    reportsAdapter: unusedReportsAdapter,
    advertising,
    now: input.now ?? (() => new Date("2026-08-25T12:00:00.000Z")),
  });
  const captured = await context.capture(MARKETPLACE_ID);
  const binding = await broker.bindAdvertisedProductAccount({
    marketplaceId: MARKETPLACE_ID,
    expectedContext: captured,
  });
  return {
    broker,
    store,
    captured,
    binding,
    combinedAccountScope,
    create,
    status,
    download,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fixed Report Broker SP handles", () => {
  it("invalidates old handles on clear while reissuing preserved durable evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amz-fixed-report-broker-sp-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    const adapter = createScriptedReportsAdapter([
      {
        operation: "create",
        result: {
          mode: "live",
          ready: true,
          reportId: "sp-raw-report-1",
          documentId: "sp-raw-document-1",
          status: "DONE",
          notice: "done",
        },
      },
      {
        operation: "document",
        result: { text: "seller-sku\tasin\nSAFE-SKU\tB000000001" },
      },
    ]);
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      accountScope: "sp-main-only-scope",
    }));
    const broker = new FixedReportBroker({
      store,
      context,
      reportsAdapter: adapter,
    });
    const captured = await context.capture(MARKETPLACE_ID);
    const spPlan = {
      intent: "all-listings" as const,
      marketplaceId: MARKETPLACE_ID,
    } as const;
    const before = await broker.start(spPlan, {
      explicitRetry: false,
      expectedContext: captured,
    });
    expect(before.reportId).toMatch(
      /^report-lease\.broker\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(before.documentId).toMatch(
      /^report-document\.broker\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(before).not.toHaveProperty("leaseBinding");
    expect(before).not.toHaveProperty("handleBinding");

    broker.clear();
    await expect(broker.readDocument(spPlan, {
      reportId: before.reportId,
      documentId: before.documentId!,
    }, captured)).rejects.toMatchObject({ code: "REPORT_MISMATCH" });
    const forgedReportId = `report-lease.broker-g1.${before.reportId.slice("report-lease.".length)}`;
    const forgedDocumentId = `report-document.broker-g1.${before.documentId!.slice("report-document.".length)}`;
    await expect(broker.readDocument(spPlan, {
      reportId: forgedReportId,
      documentId: forgedDocumentId,
    }, captured)).rejects.toMatchObject({ code: "REPORT_MISMATCH" });
    const replaceLastHex = (value: string) =>
      value.slice(0, -1) + (value.endsWith("0") ? "1" : "0");
    const unknownReportId = replaceLastHex(before.reportId);
    const unknownDocumentId = replaceLastHex(before.documentId!);
    expect(unknownReportId).toMatch(
      /^report-lease\.broker\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(unknownDocumentId).toMatch(
      /^report-document\.broker\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    await expect(broker.readDocument(spPlan, {
      reportId: unknownReportId,
      documentId: unknownDocumentId,
    }, captured)).rejects.toMatchObject({ code: "REPORT_MISMATCH" });

    const rebound = await broker.start(spPlan, {
      explicitRetry: false,
      expectedContext: captured,
    });
    expect(rebound).toMatchObject({ ready: true, status: "DONE" });
    expect(rebound.reportId).not.toBe(before.reportId);
    expect(rebound.documentId).not.toBe(before.documentId);
    await expect(broker.readDocument(spPlan, {
      reportId: rebound.reportId,
      documentId: rebound.documentId!,
    }, captured)).resolves.toEqual({
      mode: "live",
      text: "seller-sku\tasin\nSAFE-SKU\tB000000001",
    });
    expect(adapter.requests.map(({ operation }) => operation)).toEqual([
      "create",
      "document",
    ]);
  });
});

describe("fixed Report Broker Ads intent", () => {
  it("enforces the fixed Ads date policy before any create adapter call", async () => {
    const built = await buildBroker({
      now: () => new Date("2026-08-25T12:00:00.000Z"),
    });
    const invalidPlans: AdvertisedProductReportPlan[] = [
      {
        intent: "ads-sp-advertised-product",
        marketplaceId: MARKETPLACE_ID,
        startDate: "2026-06-01",
        endDate: "2026-07-02",
      },
      {
        intent: "ads-sp-advertised-product",
        marketplaceId: MARKETPLACE_ID,
        startDate: "2026-05-01",
        endDate: "2026-05-30",
      },
    ];

    for (const invalidPlan of invalidPlans) {
      await expect(built.broker.startAdvertisedProduct(invalidPlan, {
        binding: built.binding,
        explicitRetry: false,
        expectedContext: built.captured,
      })).rejects.toMatchObject({ code: "ADS_REPORT_DATE_INVALID" });
    }
    expect(built.create).not.toHaveBeenCalled();
  });

  it("revalidates the bound Ads account before dispatching scripted create", async () => {
    let identityReads = 0;
    const built = await buildBroker({
      readAdsCombinedAccountScope: () => {
        identityReads += 1;
        return identityReads <= 2
          ? "combined-main-only-scope"
          : "combined-changed-before-create";
      },
    });

    await expect(built.broker.startAdvertisedProduct(plan(), {
      binding: built.binding,
      explicitRetry: false,
      expectedContext: built.captured,
    })).rejects.toMatchObject({ code: "ADS_REPORT_ACCOUNT_CHANGED" });
    expect(built.create).not.toHaveBeenCalled();
  });

  it("keeps an in-flight create unknown when broker clear aborts the adapter", async () => {
    let rejectCreate!: (reason: unknown) => void;
    const createGate = new Promise<never>((_resolve, reject) => {
      rejectCreate = reject;
    });
    const built = await buildBroker({
      create: async () => createGate,
    });
    const pending = built.broker.startAdvertisedProduct(plan(), {
      binding: built.binding,
      explicitRetry: false,
      expectedContext: built.captured,
    });
    await vi.waitFor(() => expect(built.create).toHaveBeenCalledTimes(1));

    built.broker.clear();
    rejectCreate(new DOMException("broker cleared", "AbortError"));
    await expect(pending).rejects.toMatchObject({
      code: "SP_CONTEXT_INVALIDATED",
    });
    const rebound = await built.broker.bindAdvertisedProductAccount({
      marketplaceId: MARKETPLACE_ID,
      expectedContext: built.captured,
    });

    await expect(built.broker.startAdvertisedProduct(plan(), {
      binding: rebound,
      explicitRetry: true,
      expectedContext: built.captured,
    })).rejects.toMatchObject({ code: "REPORT_RETRY_WAIT" });
    expect(built.create).toHaveBeenCalledTimes(1);
  });

  it("revalidates Ads identity after durable reuse and absent reads", async () => {
    let currentScope = "combined-main-only-scope";
    const built = await buildBroker({
      readAdsCombinedAccountScope: () => currentScope,
    });
    await built.broker.startAdvertisedProduct(plan(), {
      binding: built.binding,
      explicitRetry: false,
      expectedContext: built.captured,
    });
    const originalRead = built.store.getSharedReport.bind(built.store);
    let flipAfterRead = false;
    vi.spyOn(built.store, "getSharedReport").mockImplementation(async (identity) => {
      const result = await originalRead(identity);
      if (flipAfterRead) {
        flipAfterRead = false;
        currentScope = "combined-changed-during-store-read";
      }
      return result;
    });

    flipAfterRead = true;
    await expect(built.broker.startAdvertisedProduct(plan(), {
      binding: built.binding,
      explicitRetry: false,
      expectedContext: built.captured,
    })).rejects.toMatchObject({ code: "ADS_REPORT_ACCOUNT_CHANGED" });
    expect(built.create).toHaveBeenCalledTimes(1);

    currentScope = "combined-main-only-scope";
    flipAfterRead = true;
    await expect(built.broker.readAdvertisedProduct({
      ...plan(),
      startDate: "2026-07-02",
    }, {
      binding: built.binding,
      expectedContext: built.captured,
    })).rejects.toMatchObject({ code: "ADS_REPORT_ACCOUNT_CHANGED" });
    expect(built.create).toHaveBeenCalledTimes(1);
  });

  it("reads an absent semantic selection without implying create", async () => {
    const built = await buildBroker();

    await expect(
      built.broker.readAdvertisedProduct(plan(), {
        binding: built.binding,
        expectedContext: built.captured,
      }),
    ).resolves.toBeNull();
    await expect(built.broker.statusAdvertisedProduct(
      plan(),
      "report-broker.ads.0.foreign",
      { binding: built.binding, expectedContext: built.captured },
    )).rejects.toMatchObject({ code: "REPORT_MISMATCH" });
    expect(built.create).not.toHaveBeenCalled();
    expect(built.status).not.toHaveBeenCalled();
    expect(built.download).not.toHaveBeenCalled();
  });

  it("single-flights fixed creates and exposes only broker handles", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const built = await buildBroker({
      create: async () => {
        await gate;
        return reference("combined-main-only-scope");
      },
    });

    const left = built.broker.startAdvertisedProduct(plan(), {
      binding: built.binding,
      explicitRetry: false,
      expectedContext: built.captured,
    });
    const right = built.broker.startAdvertisedProduct(plan(), {
      binding: built.binding,
      explicitRetry: false,
      expectedContext: built.captured,
    });
    await vi.waitFor(() => expect(built.create).toHaveBeenCalledTimes(1));
    release();
    const [leftReceipt, rightReceipt] = await Promise.all([left, right]);

    expect(leftReceipt).toEqual(rightReceipt);
    expect(leftReceipt.reportId).toMatch(
      /^report-broker\.ads\.broker\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(leftReceipt.reportId).not.toContain("ads-report-fixed-1");
    expect(JSON.stringify(leftReceipt)).not.toContain(built.combinedAccountScope);
    expect(built.create).toHaveBeenCalledTimes(1);
  });

  it("binds exact dates while reusing the same A selection after A to B to A", async () => {
    const built = await buildBroker({
      create: async (input) => reference("combined-main-only-scope", {
        reportId: `ads-${input.startDate}-${input.endDate}`,
        startDate: input.startDate,
        endDate: input.endDate,
      }),
    });
    const range = (
      startDate: string,
      endDate: string,
    ): AdvertisedProductReportPlan => ({
      intent: "ads-sp-advertised-product" as const,
      marketplaceId: MARKETPLACE_ID,
      startDate,
      endDate,
    });
    const options = {
      binding: built.binding,
      explicitRetry: false,
      expectedContext: built.captured,
    };

    const firstA = await built.broker.startAdvertisedProduct(
      range("2026-07-01", "2026-07-30"),
      options,
    );
    const firstB = await built.broker.startAdvertisedProduct(
      range("2026-06-01", "2026-06-30"),
      options,
    );
    const secondA = await built.broker.startAdvertisedProduct(
      range("2026-07-01", "2026-07-30"),
      options,
    );

    expect(secondA.reportId).toBe(firstA.reportId);
    expect(firstB.reportId).not.toBe(firstA.reportId);
    expect(built.create).toHaveBeenCalledTimes(2);
  });

  it("persists an accepted mismatched create as guarded unknown evidence", async () => {
    const built = await buildBroker({
      create: async () => reference("combined-main-only-scope", {
        startDate: "2026-07-02",
      }),
    });

    await expect(built.broker.startAdvertisedProduct(plan(), {
      binding: built.binding,
      explicitRetry: false,
      expectedContext: built.captured,
    })).rejects.toMatchObject({ code: "REPORT_MISMATCH" });
    await expect(built.broker.readAdvertisedProduct(
      plan(),
      { binding: built.binding, expectedContext: built.captured },
    )).rejects.toMatchObject({ code: "SHARED_REPORT_RETRY_REQUIRED" });
    await expect(built.broker.startAdvertisedProduct(plan(), {
      binding: built.binding,
      explicitRetry: true,
      expectedContext: built.captured,
    })).rejects.toMatchObject({ code: "REPORT_RETRY_WAIT" });
    expect(built.create).toHaveBeenCalledTimes(1);
  });

  it("preserves a post-dispatch account fence and never repeats its POST", async () => {
    const built = await buildBroker({
      create: async () => {
        throw new AdvertisingReportAcceptedError(
          reference("combined-main-only-scope"),
          new AdvertisingApiError("account changed", {
            status: 409,
            code: "ADS_REPORT_ACCOUNT_CHANGED",
          }),
        );
      },
    });

    await expect(built.broker.startAdvertisedProduct(plan(), {
      binding: built.binding,
      explicitRetry: false,
      expectedContext: built.captured,
    })).rejects.toMatchObject({ code: "ADS_REPORT_ACCOUNT_CHANGED" });
    await expect(built.broker.startAdvertisedProduct(plan(), {
      binding: built.binding,
      explicitRetry: true,
      expectedContext: built.captured,
    })).rejects.toMatchObject({ code: "REPORT_RETRY_WAIT" });
    expect(built.create).toHaveBeenCalledTimes(1);
  });

  it("prioritizes a context fence over an upstream create failure and keeps unknown evidence", async () => {
    let spAccountScope = "sp-main-only-scope";
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const built = await buildBroker({
      readSpAccountScope: () => spAccountScope,
      create: async () => {
        await gate;
        throw new AdvertisingApiError("temporary upstream ambiguity", {
          status: 503,
          code: "ADS_UPSTREAM_FAILED",
        });
      },
    });
    const pending = built.broker.startAdvertisedProduct(plan(), {
      binding: built.binding,
      explicitRetry: false,
      expectedContext: built.captured,
    });
    await vi.waitFor(() => expect(built.create).toHaveBeenCalledTimes(1));

    spAccountScope = "sp-changed-during-create";
    release();
    await expect(pending).rejects.toMatchObject({
      code: "ACCOUNT_SCOPE_CHANGED",
    });

    spAccountScope = "sp-main-only-scope";
    await expect(built.broker.startAdvertisedProduct(plan(), {
      binding: built.binding,
      explicitRetry: true,
      expectedContext: built.captured,
    })).rejects.toMatchObject({ code: "REPORT_RETRY_WAIT" });
    expect(built.create).toHaveBeenCalledTimes(1);
  });

  it("validates exact status and data references without creating again", async () => {
    const built = await buildBroker();
    const started = await built.broker.startAdvertisedProduct(plan(), {
      binding: built.binding,
      explicitRetry: false,
      expectedContext: built.captured,
    });
    const completed = await built.broker.statusAdvertisedProduct(
      plan(),
      started.reportId,
      { binding: built.binding, expectedContext: built.captured },
    );
    expect(completed).toMatchObject({ ready: true, status: "DONE" });
    expect(completed.documentId).toMatch(/^report-broker\.ads-document\./u);

    const data = await built.broker.readAdvertisedProductData(
      plan(),
      { reportId: completed.reportId, documentId: completed.documentId! },
      { binding: built.binding, expectedContext: built.captured },
    );
    expect(data.rows).toHaveLength(1);
    expect(built.create).toHaveBeenCalledTimes(1);
    expect(built.create).toHaveBeenCalledWith(expect.objectContaining({
      expectedCombinedAccountScope: built.combinedAccountScope,
    }));
    expect(built.status).toHaveBeenCalledTimes(1);
    expect(built.download).toHaveBeenCalledTimes(1);
  });

  it("keeps a completed report monotonic when a later poll reports failure", async () => {
    let pollCount = 0;
    const built = await buildBroker({
      status: async (actual) => {
        pollCount += 1;
        return pollCount === 1
          ? {
              reference: actual,
              status: "COMPLETED" as const,
              ready: true,
              updatedAt: "2026-08-25T00:00:00.000Z",
            }
          : {
              reference: actual,
              status: "FAILURE" as const,
              ready: false,
              updatedAt: "2026-08-25T00:01:00.000Z",
            };
      },
    });
    const started = await built.broker.startAdvertisedProduct(plan(), {
      binding: built.binding,
      explicitRetry: false,
      expectedContext: built.captured,
    });
    const first = await built.broker.statusAdvertisedProduct(
      plan(),
      started.reportId,
      { binding: built.binding, expectedContext: built.captured },
    );

    const second = await built.broker.statusAdvertisedProduct(
      plan(),
      started.reportId,
      { binding: built.binding, expectedContext: built.captured },
    );

    expect(first).toMatchObject({ ready: true, status: "DONE" });
    expect(second).toEqual(first);
    expect(built.status).toHaveBeenCalledTimes(2);
  });

  it("revalidates Ads identity after status before persisting completion", async () => {
    let currentScope = "combined-main-only-scope";
    const built = await buildBroker({
      readAdsCombinedAccountScope: () => currentScope,
      status: async (actual) => {
        currentScope = "combined-changed-during-status";
        return {
          reference: actual,
          status: "COMPLETED",
          ready: true,
          updatedAt: "2026-08-25T00:00:00.000Z",
        };
      },
    });
    const started = await built.broker.startAdvertisedProduct(plan(), {
      binding: built.binding,
      explicitRetry: false,
      expectedContext: built.captured,
    });

    await expect(built.broker.statusAdvertisedProduct(
      plan(),
      started.reportId,
      { binding: built.binding, expectedContext: built.captured },
    )).rejects.toMatchObject({ code: "ADS_REPORT_ACCOUNT_CHANGED" });

    currentScope = "combined-main-only-scope";
    await expect(built.broker.readAdvertisedProduct(
      plan(),
      { binding: built.binding, expectedContext: built.captured },
    )).resolves.toMatchObject({ ready: false, status: "IN_QUEUE" });
  });

  it("revalidates Ads profile after download before returning rows", async () => {
    let currentFingerprint = "a".repeat(64);
    const built = await buildBroker({
      readAdsProfileFingerprint: () => currentFingerprint,
      download: async (actual) => {
        currentFingerprint = "b".repeat(64);
        return { reference: actual, rows: [] };
      },
    });
    const started = await built.broker.startAdvertisedProduct(plan(), {
      binding: built.binding,
      explicitRetry: false,
      expectedContext: built.captured,
    });
    const completed = await built.broker.statusAdvertisedProduct(
      plan(),
      started.reportId,
      { binding: built.binding, expectedContext: built.captured },
    );

    await expect(built.broker.readAdvertisedProductData(
      plan(),
      { reportId: completed.reportId, documentId: completed.documentId! },
      { binding: built.binding, expectedContext: built.captured },
    )).rejects.toMatchObject({ code: "ADS_REPORT_ACCOUNT_CHANGED" });
  });

  it("rejects unknown scripted status instead of persisting it as fatal", async () => {
    const built = await buildBroker({
      status: async (actual) => ({
        reference: actual,
        status: "UNKNOWN" as "FAILURE",
        ready: false,
        updatedAt: null,
      }),
    });
    const started = await built.broker.startAdvertisedProduct(plan(), {
      binding: built.binding,
      explicitRetry: false,
      expectedContext: built.captured,
    });

    await expect(built.broker.statusAdvertisedProduct(
      plan(),
      started.reportId,
      { binding: built.binding, expectedContext: built.captured },
    )).rejects.toMatchObject({ code: "REPORT_MISMATCH" });
  });

  it("projects scripted download rows through the production row parser", async () => {
    const built = await buildBroker({
      download: async (actual) => ({
        reference: actual,
        rows: [{
          campaignId: "campaign-1",
          campaignName: "Synthetic campaign",
          adGroupId: "group-1",
          adGroupName: "Synthetic group",
          advertisedSku: "SAFE-SKU",
          advertisedAsin: "B000000001",
          impressions: 10,
          clicks: 2,
          cost: 1.5,
          sales14d: 8,
          purchases14d: 1,
          private: "must-not-cross-broker",
        }],
      }),
    });
    const started = await built.broker.startAdvertisedProduct(plan(), {
      binding: built.binding,
      explicitRetry: false,
      expectedContext: built.captured,
    });
    const completed = await built.broker.statusAdvertisedProduct(
      plan(),
      started.reportId,
      { binding: built.binding, expectedContext: built.captured },
    );

    const result = await built.broker.readAdvertisedProductData(
      plan(),
      { reportId: completed.reportId, documentId: completed.documentId! },
      { binding: built.binding, expectedContext: built.captured },
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).not.toHaveProperty("private");
  });

  it("rejects a download reference that drifts after a completed status", async () => {
    const built = await buildBroker({
      download: async (actual) => ({
        reference: { ...actual, combinedAccountScope: "wrong-scope" },
        rows: [],
      }),
    });
    const started = await built.broker.startAdvertisedProduct(plan(), {
      binding: built.binding,
      explicitRetry: false,
      expectedContext: built.captured,
    });
    const completed = await built.broker.statusAdvertisedProduct(
      plan(),
      started.reportId,
      { binding: built.binding, expectedContext: built.captured },
    );

    await expect(built.broker.readAdvertisedProductData(
      plan(),
      { reportId: completed.reportId, documentId: completed.documentId! },
      { binding: built.binding, expectedContext: built.captured },
    )).rejects.toMatchObject({ code: "REPORT_MISMATCH" });
    expect(built.create).toHaveBeenCalledTimes(1);
  });

  it("rejects status reference drift and tombstones a fatal result", async () => {
    const drift = await buildBroker({
      status: async (actual) => ({
        reference: { ...actual, reportId: "wrong-report" },
        status: "COMPLETED",
        ready: true,
        updatedAt: null,
      }),
    });
    const driftStarted = await drift.broker.startAdvertisedProduct(plan(), {
      binding: drift.binding,
      explicitRetry: false,
      expectedContext: drift.captured,
    });
    await expect(drift.broker.statusAdvertisedProduct(
      plan(),
      driftStarted.reportId,
      { binding: drift.binding, expectedContext: drift.captured },
    )).rejects.toMatchObject({ code: "REPORT_MISMATCH" });

    const fatal = await buildBroker({
      status: async (actual) => ({
        reference: actual,
        status: "FAILURE",
        ready: false,
        updatedAt: null,
      }),
    });
    const fatalStarted = await fatal.broker.startAdvertisedProduct(plan(), {
      binding: fatal.binding,
      explicitRetry: false,
      expectedContext: fatal.captured,
    });
    await expect(fatal.broker.statusAdvertisedProduct(
      plan(),
      fatalStarted.reportId,
      { binding: fatal.binding, expectedContext: fatal.captured },
    )).rejects.toMatchObject({ code: "REPORT_FATAL" });
    await expect(fatal.broker.startAdvertisedProduct(plan(), {
      binding: fatal.binding,
      explicitRetry: true,
      expectedContext: fatal.captured,
    })).rejects.toMatchObject({ code: "REPORT_RETRY_WAIT" });
    expect(fatal.create).toHaveBeenCalledTimes(1);
  });

  it("invalidates old Ads handles on clear while reusing durable active evidence", async () => {
    const built = await buildBroker();
    const before = await built.broker.startAdvertisedProduct(plan(), {
      binding: built.binding,
      explicitRetry: false,
      expectedContext: built.captured,
    });

    built.broker.clear();
    await expect(built.broker.statusAdvertisedProduct(
      plan(),
      before.reportId,
      { binding: built.binding, expectedContext: built.captured },
    )).rejects.toMatchObject({ code: "REPORT_MISMATCH" });
    const reboundBinding = await built.broker.bindAdvertisedProductAccount({
      marketplaceId: MARKETPLACE_ID,
      expectedContext: built.captured,
    });
    await expect(built.broker.statusAdvertisedProduct(
      plan(),
      before.reportId,
      { binding: built.binding, expectedContext: built.captured },
    )).rejects.toMatchObject({ code: "REPORT_MISMATCH" });
    const stalePayload = before.reportId.startsWith("report-broker.ads.0.")
      ? before.reportId.slice("report-broker.ads.0.".length)
      : before.reportId.slice("report-broker.ads.".length);
    const forgedReportId = `report-broker.ads.1.${stalePayload}`;
    expect(forgedReportId).not.toBe(before.reportId);
    await expect(built.broker.statusAdvertisedProduct(
      plan(),
      forgedReportId,
      { binding: reboundBinding, expectedContext: built.captured },
    )).rejects.toMatchObject({ code: "REPORT_MISMATCH" });
    const rebound = await built.broker.startAdvertisedProduct(plan(), {
      binding: reboundBinding,
      explicitRetry: false,
      expectedContext: built.captured,
    });

    expect(rebound.reportId).not.toBe(before.reportId);
    expect(built.create).toHaveBeenCalledTimes(1);
  });

  it("does not return downloaded rows across a broker clear", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const built = await buildBroker({
      download: async (actual) => {
        await gate;
        return { reference: actual, rows: [] };
      },
    });
    const started = await built.broker.startAdvertisedProduct(plan(), {
      binding: built.binding,
      explicitRetry: false,
      expectedContext: built.captured,
    });
    const completed = await built.broker.statusAdvertisedProduct(
      plan(),
      started.reportId,
      { binding: built.binding, expectedContext: built.captured },
    );
    const pendingData = built.broker.readAdvertisedProductData(
      plan(),
      { reportId: completed.reportId, documentId: completed.documentId! },
      { binding: built.binding, expectedContext: built.captured },
    );
    await vi.waitFor(() => expect(built.download).toHaveBeenCalledTimes(1));

    built.broker.clear();
    release();

    await expect(pendingData).rejects.toMatchObject({
      code: "SP_CONTEXT_INVALIDATED",
    });
  });

  it("does not return a receipt when context changes during the final durable read", async () => {
    let spAccountScope = "sp-main-only-scope";
    const built = await buildBroker({
      readSpAccountScope: () => spAccountScope,
    });
    await built.broker.startAdvertisedProduct(plan(), {
      binding: built.binding,
      explicitRetry: false,
      expectedContext: built.captured,
    });
    const originalRead = built.store.getSharedReport.bind(built.store);
    let readCount = 0;
    let signalFinalRead!: () => void;
    const finalReadStarted = new Promise<void>((resolve) => {
      signalFinalRead = resolve;
    });
    let releaseFinalRead!: () => void;
    const finalReadReleased = new Promise<void>((resolve) => {
      releaseFinalRead = resolve;
    });
    vi.spyOn(built.store, "getSharedReport").mockImplementation(async (identity) => {
      const result = await originalRead(identity);
      readCount += 1;
      if (readCount === 2) {
        signalFinalRead();
        await finalReadReleased;
      }
      return result;
    });
    const pending = built.broker.readAdvertisedProduct(plan(), {
      binding: built.binding,
      expectedContext: built.captured,
    });
    await finalReadStarted;

    spAccountScope = "sp-changed-during-final-read";
    releaseFinalRead();

    await expect(pending).rejects.toMatchObject({
      code: "ACCOUNT_SCOPE_CHANGED",
    });
  });
});
