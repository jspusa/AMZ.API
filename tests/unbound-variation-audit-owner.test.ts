import { describe, expect, it, vi } from "vitest";
import {
  UnboundVariationAuditOwner,
  type UnboundVariationAuditSource,
} from "../src/main/amazon/unbound-variation-audit-owner";
import {
  createScriptedSpExecutionContextAdapter,
} from "../src/main/amazon/sp-execution-context";
import type { UnboundVariationAuditSnapshot } from
  "../src/main/amazon/variation-catalog-reads";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const US = "ATVPDKIKX0DER" as const;
const DIRECT_EXPORT_ID = "55555555-5555-4555-8555-555555555555";
const STANDALONE_EXPORT_ID = "66666666-6666-4666-8666-666666666666";
const LATE_EXPORT_ID = "77777777-7777-4777-8777-777777777777";

function request(input: Readonly<{
  method: "GET" | "POST";
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}>): ApiRequest {
  return {
    requestId: `variation-owner-${input.method.toLowerCase()}-001`,
    method: input.method,
    path: "/api/sp-api/variation-audit",
    query: input.query ?? {},
    headers: {},
    body: input.body
      ? { kind: "json", value: input.body }
      : undefined,
  };
}

function jsonValue(response: ApiResponse): Record<string, unknown> {
  expect(response.body.kind).toBe("json");
  if (response.body.kind !== "json") throw new Error("Expected JSON response");
  return response.body.value as Record<string, unknown>;
}

function snapshot(): UnboundVariationAuditSnapshot {
  return {
    mode: "demo",
    marketplaceId: US,
    fetchedAt: "2026-08-26T00:00:00.000Z",
    rows: [{
      sellerSku: "UNBOUND-OWNER-SKU",
      asin: "B000000001",
      title: "Standalone product",
      productType: "PET_FOOD",
      relationshipEvidence: "relationships",
      notice: "Amazon relationships prove no parent.",
    }],
    incompleteRows: [{
      sellerSku: "INCOMPLETE-OWNER-SKU",
      asin: "B000000002",
      title: "Incomplete product",
      code: "RELATIONSHIPS_NOT_RETURNED",
      message: "Relationships remain unknown.",
      requestId: null,
    }],
    allVariationRows: [{
      familySku: "PARENT-OWNER-SKU",
      role: "parent",
      sellerSku: "PARENT-OWNER-SKU",
      title: "Parent product",
      productType: "PET_FOOD",
      variationTheme: "SIZE",
      evidence: "verified-parent",
    }],
    summary: {
      totalFbaListings: 3,
      completed: 2,
      unbound: 1,
      boundChildren: 0,
      parentContainers: 1,
      incomplete: 1,
    },
    notice: "FBA relationships only.",
  };
}

function readyReceipt() {
  return {
    mode: "demo" as const,
    ready: true,
    reportId: "report-lease.owner",
    documentId: "report-document.owner",
    status: "DONE" as const,
    notice: "Amazon 報表已就緒。",
  };
}

describe("UnboundVariationAuditOwner", () => {
  it("uses one source and captured context across direct and standalone publish paths", async () => {
    let now = 100;
    const ids = [DIRECT_EXPORT_ID, STANDALONE_EXPORT_ID];
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "demo",
      accountScope: "variation-owner-account",
    }));
    const source = {
      begin: vi.fn(async (
        _input: Parameters<UnboundVariationAuditSource["begin"]>[0],
      ) => readyReceipt()),
      status: vi.fn(async (
        _input: Parameters<UnboundVariationAuditSource["status"]>[0],
      ) => readyReceipt()),
      read: vi.fn(async (
        _input: Parameters<UnboundVariationAuditSource["read"]>[0],
      ) => snapshot()),
    } satisfies UnboundVariationAuditSource;
    const createWorkbook = vi.fn(() => new Uint8Array([7, 8, 9]));
    const owner = new UnboundVariationAuditOwner({
      context,
      source,
      createWorkbook,
      directTtlMs: 10,
      standaloneTtlMs: 30,
      now: () => now,
      createId: () => ids.shift() ?? "99999999-9999-4999-8999-999999999999",
    });

    const started = await owner.start(request({
      method: "POST",
      body: { marketplaceId: US },
    }));
    expect(started.status).toBe(200);
    expect(jsonValue(started)).toMatchObject({
      ready: true,
      reportId: "report-lease.owner",
      documentId: "report-document.owner",
      message: "Amazon 報表已就緒。",
    });

    const data = await owner.statusDataOrDownload(request({
      method: "GET",
      query: {
        marketplaceId: US,
        reportId: "report-lease.owner",
        documentId: "report-document.owner",
        data: "1",
      },
    }));
    expect(data.status).toBe(200);
    expect(jsonValue(data)).toMatchObject({
      marketplaceId: US,
      exportId: DIRECT_EXPORT_ID,
      rows: [{ sellerSku: "UNBOUND-OWNER-SKU" }],
      incompleteRows: [{ sellerSku: "INCOMPLETE-OWNER-SKU" }],
    });

    const standalone = await owner.runStandalone({
      marketplaceId: US,
      signal: new AbortController().signal,
    });
    expect(standalone).toMatchObject({
      marketplaceId: US,
      exportId: STANDALONE_EXPORT_ID,
    });
    expect(source.read).toHaveBeenCalledTimes(2);
    const standaloneBegin = source.begin.mock.calls[1]?.[0];
    const standaloneRead = source.read.mock.calls[1]?.[0];
    expect(standaloneBegin?.expectedContext).toBe(
      standaloneRead?.expectedContext,
    );

    now = 111;
    const expiredDirect = await owner.statusDataOrDownload(request({
      method: "GET",
      query: {
        marketplaceId: US,
        exportId: DIRECT_EXPORT_ID,
        download: "1",
      },
    }));
    expect(expiredDirect.status).toBe(410);
    expect(jsonValue(expiredDirect)).toEqual({
      code: "SNAPSHOT_EXPIRED",
      message: "未綁變體健檢快照已過期或站點不符，請重新掃描。",
    });

    const exported = await owner.statusDataOrDownload(request({
      method: "GET",
      query: {
        marketplaceId: US,
        exportId: STANDALONE_EXPORT_ID,
        download: "1",
      },
    }));
    expect(exported.status).toBe(200);
    expect(exported.body).toEqual({
      kind: "bytes",
      value: new Uint8Array([7, 8, 9]),
    });
    expect(exported.headers).toMatchObject({
      "cache-control": "private, no-store, max-age=0",
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "x-content-type-options": "nosniff",
      "x-exported-unbound-fba-sku-count": "1",
      "x-exported-incomplete-sku-count": "1",
    });
    expect(createWorkbook).toHaveBeenCalledWith(expect.objectContaining({
      rows: [expect.objectContaining({ sellerSku: "UNBOUND-OWNER-SKU" })],
      incompleteRows: [expect.objectContaining({
        sellerSku: "INCOMPLETE-OWNER-SKU",
      })],
      allVariationRows: [expect.objectContaining({
        sellerSku: "PARENT-OWNER-SKU",
      })],
    }));
  });

  it("status and data reads never imply report creation", async () => {
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "demo",
      accountScope: "variation-owner-account",
    }));
    const source = {
      begin: vi.fn(async (
        _input: Parameters<UnboundVariationAuditSource["begin"]>[0],
      ) => readyReceipt()),
      status: vi.fn(async (
        _input: Parameters<UnboundVariationAuditSource["status"]>[0],
      ) => readyReceipt()),
      read: vi.fn(async (
        _input: Parameters<UnboundVariationAuditSource["read"]>[0],
      ) => snapshot()),
    } satisfies UnboundVariationAuditSource;
    const owner = new UnboundVariationAuditOwner({ context, source });

    const status = await owner.statusDataOrDownload(request({
      method: "GET",
      query: { marketplaceId: US, reportId: "report-lease.owner" },
    }));
    expect(status.status).toBe(200);
    const data = await owner.statusDataOrDownload(request({
      method: "GET",
      query: {
        marketplaceId: US,
        reportId: "report-lease.owner",
        documentId: "report-document.owner",
        data: "1",
      },
    }));
    expect(data.status).toBe(200);

    expect(source.begin).not.toHaveBeenCalled();
    expect(source.status).toHaveBeenCalledOnce();
    expect(source.status.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal);
    expect(source.read).toHaveBeenCalledOnce();
  });

  it("aborts a direct relationship read on clear and starts fresh afterward", async () => {
    let firstSignal: AbortSignal | undefined;
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "demo",
      accountScope: "variation-owner-account",
    }));
    const source = {
      begin: vi.fn(async (
        _input: Parameters<UnboundVariationAuditSource["begin"]>[0],
      ) => readyReceipt()),
      status: vi.fn(async (
        _input: Parameters<UnboundVariationAuditSource["status"]>[0],
      ) => readyReceipt()),
      read: vi.fn((
        input: Parameters<UnboundVariationAuditSource["read"]>[0],
      ): Promise<UnboundVariationAuditSnapshot> => {
        firstSignal ??= input.signal;
        if (source.read.mock.calls.length > 1) return Promise.resolve(snapshot());
        return new Promise((_resolve, reject) => {
          input.signal?.addEventListener("abort", () => {
            reject(input.signal?.reason);
          }, { once: true });
        });
      }),
    } satisfies UnboundVariationAuditSource;
    const owner = new UnboundVariationAuditOwner({
      context,
      source,
      createId: () => DIRECT_EXPORT_ID,
    });

    const reading = owner.statusDataOrDownload(request({
      method: "GET",
      query: {
        marketplaceId: US,
        reportId: "report-lease.owner",
        documentId: "report-document.owner",
        data: "1",
      },
    }));
    await vi.waitFor(() => expect(source.read).toHaveBeenCalledOnce());

    expect(firstSignal).toBeInstanceOf(AbortSignal);
    owner.clear();
    expect(firstSignal?.aborted).toBe(true);
    expect(firstSignal?.reason).toMatchObject({
      code: "SP_CONTEXT_INVALIDATED",
    });
    await expect(reading).resolves.toMatchObject({ status: 409 });

    const fresh = await owner.statusDataOrDownload(request({
      method: "GET",
      query: {
        marketplaceId: US,
        reportId: "report-lease.owner",
        documentId: "report-document.owner",
        data: "1",
      },
    }));
    expect(fresh.status).toBe(200);
    expect(source.read.mock.calls[1]?.[0].signal).not.toBe(firstSignal);
    expect(source.read.mock.calls[1]?.[0].signal?.aborted).toBe(false);
  });

  it("aborts an in-flight direct report start when its owner is cleared", async () => {
    let startSignal: AbortSignal | undefined;
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "demo",
      accountScope: "variation-owner-account",
    }));
    const source = {
      begin: vi.fn((
        input: Parameters<UnboundVariationAuditSource["begin"]>[0],
      ): Promise<ReturnType<typeof readyReceipt>> => {
        startSignal = input.signal;
        return new Promise((_resolve, reject) => {
          input.signal?.addEventListener("abort", () => {
            reject(input.signal?.reason);
          }, { once: true });
        });
      }),
      status: vi.fn(async (
        _input: Parameters<UnboundVariationAuditSource["status"]>[0],
      ) => readyReceipt()),
      read: vi.fn(async (
        _input: Parameters<UnboundVariationAuditSource["read"]>[0],
      ) => snapshot()),
    } satisfies UnboundVariationAuditSource;
    const owner = new UnboundVariationAuditOwner({ context, source });

    const starting = owner.start(request({
      method: "POST",
      body: { marketplaceId: US },
    }));
    await vi.waitFor(() => expect(source.begin).toHaveBeenCalledOnce());

    expect(startSignal).toBeInstanceOf(AbortSignal);
    owner.clear();
    expect(startSignal?.aborted).toBe(true);
    await expect(starting).resolves.toMatchObject({ status: 409 });
  });

  it("independently aborts standalone report work without aborting its caller", async () => {
    let ownerSignal: AbortSignal | undefined;
    const caller = new AbortController();
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "demo",
      accountScope: "variation-owner-account",
    }));
    const source = {
      begin: vi.fn((
        input: Parameters<UnboundVariationAuditSource["begin"]>[0],
      ): Promise<ReturnType<typeof readyReceipt>> => {
        ownerSignal = input.signal;
        return new Promise((_resolve, reject) => {
          input.signal?.addEventListener("abort", () => {
            reject(input.signal?.reason);
          }, { once: true });
        });
      }),
      status: vi.fn(async (
        _input: Parameters<UnboundVariationAuditSource["status"]>[0],
      ) => readyReceipt()),
      read: vi.fn(async (
        _input: Parameters<UnboundVariationAuditSource["read"]>[0],
      ) => snapshot()),
    } satisfies UnboundVariationAuditSource;
    const owner = new UnboundVariationAuditOwner({ context, source });

    const running = owner.runStandalone({
      marketplaceId: US,
      signal: caller.signal,
    });
    await vi.waitFor(() => expect(source.begin).toHaveBeenCalledOnce());

    expect(ownerSignal).toBeInstanceOf(AbortSignal);
    expect(ownerSignal).not.toBe(caller.signal);
    owner.clear();
    expect(ownerSignal?.aborted).toBe(true);
    expect(caller.signal.aborted).toBe(false);
    await expect(running).rejects.toMatchObject({
      code: "SP_CONTEXT_INVALIDATED",
    });
  });

  it("polls a fixed existing report and does not publish after clear wins", async () => {
    let release: ((value: UnboundVariationAuditSnapshot) => void) | undefined;
    const pendingRead = new Promise<UnboundVariationAuditSnapshot>((resolve) => {
      release = resolve;
    });
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "demo",
      accountScope: "variation-owner-account",
    }));
    const source = {
      begin: vi.fn(async (
        _input: Parameters<UnboundVariationAuditSource["begin"]>[0],
      ) => ({
        ...readyReceipt(),
        ready: false,
        documentId: null,
        status: "IN_QUEUE" as const,
      })),
      status: vi.fn(async (
        _input: Parameters<UnboundVariationAuditSource["status"]>[0],
      ) => readyReceipt()),
      read: vi.fn(async (
        _input: Parameters<UnboundVariationAuditSource["read"]>[0],
      ) => pendingRead),
    } satisfies UnboundVariationAuditSource;
    const createId = vi.fn(() => LATE_EXPORT_ID);
    const wait = vi.fn(async () => undefined);
    const owner = new UnboundVariationAuditOwner({
      context,
      source,
      createId,
      wait,
    });

    const running = owner.runStandalone({
      marketplaceId: US,
      signal: new AbortController().signal,
    });
    await vi.waitFor(() => expect(source.read).toHaveBeenCalledOnce());
    owner.clear();
    release?.(snapshot());

    await expect(running).rejects.toMatchObject({
      status: 409,
      code: "SP_CONTEXT_INVALIDATED",
    });
    expect(wait).toHaveBeenCalledWith(1_000, expect.any(AbortSignal));
    expect(source.status).toHaveBeenCalledOnce();
    expect(createId).not.toHaveBeenCalled();
  });
});
