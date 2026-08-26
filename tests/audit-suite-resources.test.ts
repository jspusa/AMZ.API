import { describe, expect, it, vi } from "vitest";
import {
  AuditSuiteCatalogResources,
  type AuditSuiteGroupingReader,
} from "../src/main/amazon/audit-suite-resources";
import type {
  AuditSuiteResourceKey,
  AuditSuiteRunControl,
} from "../src/main/amazon/audit-suite-coordinator";
import type { AuditSuiteContext } from
  "../src/main/amazon/audit-suite-context";
import type { FbaCatalogReports } from
  "../src/main/amazon/fba-catalog-reports";
import {
  createScriptedSpExecutionContextAdapter,
  type SpExecutionContextAdapter,
} from "../src/main/amazon/sp-execution-context";

const US = "ATVPDKIKX0DER" as const;
const BOUND_CONTEXT: AuditSuiteContext = {
  runId: "audit-suite-resources-run",
  marketplaceId: US,
  accountScope: "opaque-audit-suite-account",
  generation: 0,
  mode: "demo",
};

const LISTINGS = {
  fetchedAt: "2026-08-26T00:00:00.000Z",
  errors: [],
  rows: [{
    marketplace: "Amazon.com",
    sellerSku: "FBA-SKU-1",
    asin: "B000000001",
    productType: "PET_FOOD",
    title: "FBA product",
    itemHighlight: "",
    bulletPoints: [],
    productDescription: "",
    ingredients: "",
    imageUrls: [],
    status: "Active",
    updatedAt: "",
    readStatus: "complete" as const,
    readErrors: [],
  }],
};

function runControl(controller = new AbortController()): AuditSuiteRunControl {
  const resources = new Map<symbol, Promise<unknown>>();
  return {
    signal: controller.signal,
    heartbeat: vi.fn(),
    resource<T>(key: AuditSuiteResourceKey<T>, load: () => Promise<T>) {
      const existing = resources.get(key.token);
      if (existing) return existing as Promise<T>;
      const resource = Promise.resolve().then(load);
      resources.set(key.token, resource);
      return resource;
    },
  };
}

function catalog(input: Readonly<{
  ready?: boolean;
}> = {}) {
  const receipt = {
    mode: "demo" as const,
    ready: input.ready ?? true,
    reportId: "report-lease.audit-suite-listings",
    documentId: input.ready === false
      ? null
      : "report-document.audit-suite-listings",
    status: input.ready === false ? "IN_QUEUE" as const : "DONE" as const,
    notice: input.ready === false ? "queued" : "done",
  };
  return {
    begin: vi.fn(async () => receipt),
    status: vi.fn(async () => receipt),
    read: vi.fn(async () => LISTINGS),
  } as unknown as Pick<FbaCatalogReports, "begin" | "status" | "read">;
}

describe("AuditSuiteCatalogResources", () => {
  it("shares one Listings snapshot and one grouping across concurrent run consumers", async () => {
    const reports = catalog();
    const readGrouping = vi.fn<AuditSuiteGroupingReader>(async () => ({
      marketplaceId: US,
      fetchedAt: "2026-08-26T00:00:01.000Z",
      rows: LISTINGS.rows.map((row) => ({
        ...row,
        role: "standalone" as const,
        parentSku: null,
        familyKey: row.sellerSku,
        theme: null,
        status: "complete" as const,
        message: "verified",
      })),
      notice: "verified",
    }));
    const dependencies = {
      context: createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: US,
        accountScope: BOUND_CONTEXT.accountScope,
        mode: BOUND_CONTEXT.mode,
      })),
      catalog: reports,
      readGrouping,
      wait: vi.fn(async () => undefined),
    } as const;
    const resources = new AuditSuiteCatalogResources(dependencies);
    const secondOwner = new AuditSuiteCatalogResources(dependencies);
    const control = runControl();

    const [firstListings, secondListings, firstGrouping, secondGrouping] =
      await Promise.all([
        resources.listings(BOUND_CONTEXT, control),
        secondOwner.listings(BOUND_CONTEXT, control),
        resources.grouping(BOUND_CONTEXT, control),
        secondOwner.grouping(BOUND_CONTEXT, control),
      ]);

    expect(firstListings).toEqual(secondListings);
    expect(firstGrouping).toEqual(secondGrouping);
    expect(firstGrouping).toMatchObject({
      reportId: "report-lease.audit-suite-listings",
      documentId: "report-document.audit-suite-listings",
      data: LISTINGS,
      grouping: { marketplaceId: US, notice: "verified" },
    });
    expect(reports.begin).toHaveBeenCalledOnce();
    expect(reports.begin).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "catalog",
      marketplaceId: US,
      explicitRetry: false,
      signal: control.signal,
    }));
    expect(reports.status).not.toHaveBeenCalled();
    expect(reports.read).toHaveBeenCalledOnce();
    expect(readGrouping).toHaveBeenCalledOnce();
    const exactContext = vi.mocked(reports.begin).mock.calls[0]![0]
      .expectedContext;
    expect(exactContext).toMatchObject({
      marketplaceId: US,
      accountScope: BOUND_CONTEXT.accountScope,
      generation: BOUND_CONTEXT.generation,
      mode: BOUND_CONTEXT.mode,
    });
    expect(vi.mocked(reports.read).mock.calls[0]![0]).toMatchObject({
      marketplaceId: US,
      signal: control.signal,
      expectedContext: exactContext,
    });
    expect(readGrouping.mock.calls[0]![0]).toMatchObject({
      marketplaceId: US,
      signal: control.signal,
    });
  });

  it("rejects a mismatched report mode before polling", async () => {
    const reports = catalog({ ready: false });
    vi.mocked(reports.begin).mockResolvedValue({
      mode: "live",
      ready: false,
      reportId: "report-lease.wrong-mode",
      documentId: null,
      status: "IN_QUEUE",
      notice: "queued under the wrong mode",
    });
    const wait = vi.fn(async () => undefined);
    const resources = new AuditSuiteCatalogResources({
      context: createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: US,
        accountScope: BOUND_CONTEXT.accountScope,
        mode: BOUND_CONTEXT.mode,
      })),
      catalog: reports,
      readGrouping: vi.fn(),
      wait,
    });

    await expect(resources.listings(BOUND_CONTEXT, runControl())).rejects
      .toMatchObject({
        code: "REPORT_MODE_CHANGED",
      });
    expect(wait).not.toHaveBeenCalled();
    expect(reports.status).not.toHaveBeenCalled();
    expect(reports.read).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "account",
      bound: { ...BOUND_CONTEXT, accountScope: "opaque-other-account" },
      code: "ACCOUNT_SCOPE_CHANGED",
    },
    {
      label: "mode",
      bound: { ...BOUND_CONTEXT, mode: "live" as const },
      code: "REPORT_MODE_CHANGED",
    },
    {
      label: "generation",
      bound: { ...BOUND_CONTEXT, generation: 1 },
      code: "SP_CONTEXT_INVALIDATED",
    },
  ])("fails closed before report work when the bound $label differs", async ({
    bound,
    code,
  }) => {
    const reports = catalog();
    const resources = new AuditSuiteCatalogResources({
      context: createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: US,
        accountScope: BOUND_CONTEXT.accountScope,
        mode: BOUND_CONTEXT.mode,
      })),
      catalog: reports,
      readGrouping: async () => {
        throw new Error("grouping must not run");
      },
    });

    await expect(resources.listings(bound, runControl())).rejects
      .toMatchObject({ code });
    expect(reports.begin).not.toHaveBeenCalled();
    expect(reports.status).not.toHaveBeenCalled();
    expect(reports.read).not.toHaveBeenCalled();
  });

  it("fails closed before report work when the context adapter returns another marketplace", async () => {
    const CA = "A2EUQ1WTGCTBG2" as const;
    const source = createScriptedSpExecutionContextAdapter(
      (marketplaceId) => ({
        marketplaceId,
        accountScope: BOUND_CONTEXT.accountScope,
        mode: BOUND_CONTEXT.mode,
      }),
    );
    const caContext = await source.capture(CA);
    const context: SpExecutionContextAdapter = {
      capture: vi.fn(async () => caContext),
      assertCurrent: vi.fn(async () => undefined),
      invalidate: vi.fn(),
    };
    const reports = catalog();
    const resources = new AuditSuiteCatalogResources({
      context,
      catalog: reports,
      readGrouping: async () => {
        throw new Error("grouping must not run");
      },
    });

    await expect(resources.listings(BOUND_CONTEXT, runControl())).rejects
      .toMatchObject({ code: "SP_CONTEXT_INVALIDATED" });
    expect(reports.begin).not.toHaveBeenCalled();
  });

  it("rejects grouping evidence returned for another marketplace", async () => {
    const reports = catalog();
    const resources = new AuditSuiteCatalogResources({
      context: createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: US,
        accountScope: BOUND_CONTEXT.accountScope,
        mode: BOUND_CONTEXT.mode,
      })),
      catalog: reports,
      readGrouping: async () => ({
        marketplaceId: "A2EUQ1WTGCTBG2",
        fetchedAt: "2026-08-26T00:00:01.000Z",
        rows: [],
        notice: "wrong marketplace",
      }),
    });

    await expect(resources.grouping(BOUND_CONTEXT, runControl())).rejects
      .toMatchObject({ code: "SP_CONTEXT_INVALIDATED" });
    expect(reports.begin).toHaveBeenCalledOnce();
    expect(reports.read).toHaveBeenCalledOnce();
  });

  it("rechecks the exact account after report work before reading data", async () => {
    let accountScope = BOUND_CONTEXT.accountScope;
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      accountScope,
      mode: BOUND_CONTEXT.mode,
    }));
    const reports = catalog();
    vi.mocked(reports.begin).mockImplementation(async () => {
      accountScope = "opaque-replacement-account";
      return {
        mode: "demo",
        ready: true,
        reportId: "report-lease.stale-account",
        documentId: "report-document.stale-account",
        status: "DONE",
        notice: "done under a stale account",
      };
    });
    const resources = new AuditSuiteCatalogResources({
      context,
      catalog: reports,
      readGrouping: async () => {
        throw new Error("grouping must not run");
      },
    });

    await expect(resources.listings(BOUND_CONTEXT, runControl())).rejects
      .toMatchObject({ code: "ACCOUNT_SCOPE_CHANGED" });
    expect(reports.begin).toHaveBeenCalledOnce();
    expect(reports.status).not.toHaveBeenCalled();
    expect(reports.read).not.toHaveBeenCalled();
  });

  it("polls at most 180 times with fixed one-second waits", async () => {
    const reports = catalog({ ready: false });
    const wait = vi.fn<(
      milliseconds: number,
      signal?: AbortSignal,
    ) => Promise<void>>(async () => undefined);
    const resources = new AuditSuiteCatalogResources({
      context: createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: US,
        accountScope: BOUND_CONTEXT.accountScope,
        mode: BOUND_CONTEXT.mode,
      })),
      catalog: reports,
      readGrouping: async () => {
        throw new Error("grouping must not run");
      },
      wait,
    });
    const control = runControl();

    await expect(resources.listings(BOUND_CONTEXT, control)).rejects
      .toThrow("Amazon FBA 全商品報表等待逾時；未建立假快照。");
    expect(wait).toHaveBeenCalledTimes(180);
    expect(wait.mock.calls.every(([milliseconds, signal]) =>
      milliseconds === 1_000 && signal === control.signal
    )).toBe(true);
    expect(reports.status).toHaveBeenCalledTimes(180);
    expect(reports.read).not.toHaveBeenCalled();
  });

  it("does not issue a status request after the shared wait is aborted", async () => {
    const reports = catalog({ ready: false });
    const controller = new AbortController();
    const stopped = new Error("audit suite stopped");
    const wait = vi.fn(async () => {
      controller.abort(stopped);
    });
    const resources = new AuditSuiteCatalogResources({
      context: createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: US,
        accountScope: BOUND_CONTEXT.accountScope,
        mode: BOUND_CONTEXT.mode,
      })),
      catalog: reports,
      readGrouping: async () => {
        throw new Error("grouping must not run");
      },
      wait,
    });

    await expect(resources.listings(
      BOUND_CONTEXT,
      runControl(controller),
    )).rejects.toBe(stopped);
    expect(wait).toHaveBeenCalledOnce();
    expect(reports.status).not.toHaveBeenCalled();
    expect(reports.read).not.toHaveBeenCalled();
  });
});
