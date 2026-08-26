import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import type {
  CatalogExportRow,
  FbaCatalogExport,
} from "../src/main/amazon/catalog-report-reads";
import {
  ContentAuditOwner,
  type ContentAuditEvidencePort,
} from "../src/main/amazon/content-audit-owner";
import type {
  AuditSuiteResourceKey,
  AuditSuiteRunControl,
} from "../src/main/amazon/audit-suite-coordinator";
import type { AuditSuiteContext } from
  "../src/main/amazon/audit-suite-context";
import type { AuditSuiteListingsResource } from
  "../src/main/amazon/audit-suite-resources";
import { parseContentAuditWorkbook } from
  "../src/main/amazon/content-audit-workbook-parser";
import { ContextBoundAuditSnapshotStore } from
  "../src/main/amazon/context-bound-audit-snapshot";
import { ImageAuditOwner } from "../src/main/amazon/image-audit-owner";
import {
  createScriptedSpExecutionContextAdapter,
} from "../src/main/amazon/sp-execution-context";
import type {
  FbaVariationGroupingData,
} from "../src/main/amazon/variation-catalog-reads";

const US = "ATVPDKIKX0DER" as const;
const FETCHED_AT = "2030-01-02T03:04:05.000Z";
const ACCOUNT_SCOPE = "a".repeat(64);
const CONTENT_EXPORT_ID = "11111111-1111-4111-8111-111111111111";
const IMAGE_EXPORT_ID = "22222222-2222-4222-8222-222222222222";
const SHARED_EXPORT_ID = "33333333-3333-4333-8333-333333333333";

function listingRow(
  sellerSku: string,
  overrides: Partial<CatalogExportRow> = {},
): CatalogExportRow {
  return {
    marketplace: "Amazon.com",
    sellerSku,
    asin: sellerSku === "SOLO" ? "B000SOLO00" : `B0${sellerSku.padEnd(8, "0")}`,
    productType: "PET_FOOD",
    title: sellerSku === "SOLO" ? "Solo cocount" : `${sellerSku} title`,
    itemHighlight: "",
    bulletPoints: [],
    productDescription: sellerSku === "SOLO" ? "Visible\u200bHidden" : "",
    ingredients: "",
    imageUrls: [],
    status: "BUYABLE",
    updatedAt: "2030-01-01T00:00:00.000Z",
    readStatus: "complete",
    readErrors: [],
    ...overrides,
  };
}

function catalogFixture(): Readonly<{
  listings: FbaCatalogExport;
  grouping: FbaVariationGroupingData<CatalogExportRow>;
}> {
  const parent = listingRow("PARENT");
  const child = listingRow("CHILD", {
    readStatus: "incomplete",
    readErrors: [{
      code: "LISTING_CONTENT_NOT_RETURNED",
      message: "Amazon did not return content.",
    }],
    imageUrls: ["https://images.example.invalid/unknown.jpg"],
  });
  const solo = listingRow("SOLO");
  const listings: FbaCatalogExport = {
    fetchedAt: FETCHED_AT,
    errors: [],
    rows: [parent, child, solo],
  };
  return {
    listings,
    grouping: {
      marketplaceId: US,
      fetchedAt: "2030-01-02T03:04:06.000Z",
      notice: "Amazon relationship evidence.",
      rows: [
        {
          ...parent,
          role: "parent",
          parentSku: null,
          familyKey: "PARENT",
          theme: "Size",
          status: "complete",
          message: "Verified parent.",
        },
        {
          ...child,
          role: "child",
          parentSku: "PARENT",
          familyKey: "PARENT",
          theme: "Size",
          status: "complete",
          message: "Verified child.",
        },
        {
          ...solo,
          role: "standalone",
          parentSku: null,
          familyKey: "SOLO",
          theme: null,
          status: "complete",
          message: "Verified standalone.",
        },
      ],
    },
  };
}

function workbookXml(bytes: Uint8Array): string {
  return Object.entries(unzipSync(bytes))
    .filter(([name]) => name.endsWith(".xml"))
    .map(([, value]) => strFromU8(value))
    .join("\n");
}

function auditSuiteContext(): AuditSuiteContext {
  return {
    runId: "r08-owner-audit-suite-run",
    marketplaceId: US,
    accountScope: ACCOUNT_SCOPE,
    generation: 0,
    mode: "demo",
  };
}

function auditSuiteControl(
  controller = new AbortController(),
): AuditSuiteRunControl {
  return {
    signal: controller.signal,
    heartbeat: vi.fn(),
    resource: async <T>(
      _key: AuditSuiteResourceKey<T>,
      _load: () => Promise<T>,
    ): Promise<T> => {
      throw new Error("Audit owner must use the supplied Listings resource.");
    },
  };
}

describe("R08 content audit owner", () => {
  it("projects the legacy Content section from supplied shared Listings without creating owner state", async () => {
    const contextAdapter = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "demo",
      accountScope: ACCOUNT_SCOPE,
    }));
    const readGrouping = vi.fn();
    const saveContentAuditSnapshotEvidence = vi.fn(async () => undefined);
    const createId = vi.fn(() => CONTENT_EXPORT_ID);
    const owner = new ContentAuditOwner({
      context: contextAdapter,
      evidence: { saveContentAuditSnapshotEvidence },
      readGrouping,
      createId,
    });
    const title = `cocount ${"a".repeat(60)}`;
    const listings: AuditSuiteListingsResource = {
      reportId: "report-lease.r08-content-owner",
      documentId: "report-document.r08-content-owner",
      data: {
        fetchedAt: FETCHED_AT,
        errors: [],
        rows: [listingRow("LEGACY-CONTENT", {
          title,
          itemHighlight: "h".repeat(110),
          bulletPoints: Array.from({ length: 5 }, () => "b".repeat(150)),
          productDescription: "d".repeat(1_800),
          ingredients: "Chicken",
        })],
      },
    };
    const context = auditSuiteContext();

    const result = await owner.runAuditSuite({
      context,
      control: auditSuiteControl(),
      listings,
    });

    expect(result).toEqual({
      ...context,
      status: "partial",
      fetchedAt: FETCHED_AT,
      notice:
        "Amazon 基礎文案欄位已完成讀取。 本機字典錯字結果需個別文案健檢補充",
      payload: [{
        sellerSku: "LEGACY-CONTENT",
        title,
        asin: "B0LEGACY-CONTENT",
        problemType: "疑似錯字",
        field: "產品名稱",
        originalText: title,
        description:
          "發現明確的常見拼字「cocount」，請人工確認。 建議：coconut",
      }],
    });
    expect(readGrouping).not.toHaveBeenCalled();
    expect(saveContentAuditSnapshotEvidence).not.toHaveBeenCalled();
    expect(createId).not.toHaveBeenCalled();
  });

  it("aborts relationship acquisition on clear and starts fresh without publishing the stale flight", async () => {
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "demo",
      accountScope: ACCOUNT_SCOPE,
    }));
    const source = catalogFixture();
    let releaseGrouping: (() => void) | undefined;
    let observedSignal: AbortSignal | undefined;
    let invocation = 0;
    const continuedAfterGate = vi.fn();
    const readGrouping = vi.fn(async (input: {
      signal: AbortSignal;
    }) => {
      invocation += 1;
      if (invocation === 1) {
        observedSignal = input.signal;
        await new Promise<void>((resolve) => {
          releaseGrouping = resolve;
        });
        if (input.signal.aborted) throw input.signal.reason;
        continuedAfterGate();
      }
      return source.grouping;
    });
    const saveContentAuditSnapshotEvidence = vi.fn(async () => undefined);
    const createId = vi.fn(() => CONTENT_EXPORT_ID);
    const owner = new ContentAuditOwner({
      context,
      evidence: { saveContentAuditSnapshotEvidence },
      readGrouping,
      createId,
    });
    const executionContext = await context.capture(US);

    const stale = owner.captureFromListings({
      context: executionContext,
      marketplaceId: US,
      listings: source.listings,
    });
    await vi.waitFor(() => expect(observedSignal).toBeDefined());
    owner.clear();
    expect(observedSignal?.aborted).toBe(true);
    expect(observedSignal?.reason).toMatchObject({
      code: "SP_CONTEXT_INVALIDATED",
    });
    releaseGrouping?.();
    await expect(stale).rejects.toMatchObject({
      code: "SP_CONTEXT_INVALIDATED",
    });
    expect(continuedAfterGate).not.toHaveBeenCalled();
    expect(createId).not.toHaveBeenCalled();
    expect(saveContentAuditSnapshotEvidence).not.toHaveBeenCalled();

    await expect(owner.captureFromListings({
      context: executionContext,
      marketplaceId: US,
      listings: source.listings,
    })).resolves.toMatchObject({ exportId: CONTENT_EXPORT_ID });
    expect(readGrouping).toHaveBeenCalledTimes(2);
    expect(saveContentAuditSnapshotEvidence).toHaveBeenCalledOnce();
  });

  it("keeps the shared en_US dictionary findings in the main-owned snapshot and workbook", async () => {
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "demo",
      accountScope: ACCOUNT_SCOPE,
    }));
    const source = catalogFixture();
    const compliantBullet =
      "Natural treats provide a simple texture and satisfying chewing experience for dogs while the resealable package helps keep every serving ready at home.";
    const dictionaryOnlyRow = {
      title:
        "Trukey sourced dog treats with natural texture for a satisfying daily chewing experience",
      itemHighlight:
        "Natural dog treats provide a simple and satisfying chewing experience with a resealable package for convenient daily serving at home.",
      bulletPoints: Array.from({ length: 5 }, () => compliantBullet),
      productDescription: "Natural dog treats provide a satisfying chewing experience. ".repeat(40),
      ingredients: "Chicken",
    };
    const listings = {
      ...source.listings,
      rows: source.listings.rows.map((item) =>
        item.sellerSku === "SOLO"
          ? { ...item, ...dictionaryOnlyRow }
          : item),
    };
    const grouping = {
      ...source.grouping,
      rows: source.grouping.rows.map((item) =>
        item.sellerSku === "SOLO"
          ? { ...item, ...dictionaryOnlyRow }
          : item),
    };
    const owner = new ContentAuditOwner({
      context,
      evidence: { saveContentAuditSnapshotEvidence: async () => undefined },
      readGrouping: async () => grouping,
      createId: () => CONTENT_EXPORT_ID,
    });

    const snapshot = await owner.captureFromListings({
      context: await context.capture(US),
      marketplaceId: US,
      listings,
    });
    expect(snapshot.rows.find((item) => item.sellerSku === "SOLO")?.issues)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: "SUSPECTED_TYPO",
          field: "title",
          token: "Trukey",
          suggestion: "Turkey",
          source: "pages-dictionary",
        }),
      ]));
    expect(snapshot.summary).toMatchObject({
      withIssues: 1,
      suspectedTypos: 1,
    });

    const response = await owner.download({
      marketplaceId: US,
      exportId: CONTENT_EXPORT_ID,
    });
    expect(response.headers).toMatchObject({
      "x-exported-fba-sku-count": "2",
      "x-content-audit-with-issues-count": "1",
    });
    if (response.body.kind !== "bytes") throw new Error("Expected workbook");
    expect(workbookXml(response.body.value)).toContain("可檢查是否為「Turkey」");
  });

  it("shares one parent-safe capture path, persists only digests, and owns its workbook", async () => {
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "demo",
      accountScope: ACCOUNT_SCOPE,
    }));
    const saveContentAuditSnapshotEvidence = vi.fn<
      ContentAuditEvidencePort["saveContentAuditSnapshotEvidence"]
    >(async () => undefined);
    const source = catalogFixture();
    const owner = new ContentAuditOwner({
      context,
      evidence: { saveContentAuditSnapshotEvidence },
      readGrouping: async () => source.grouping,
      createId: () => CONTENT_EXPORT_ID,
      now: () => Date.parse(FETCHED_AT),
    });
    const executionContext = await context.capture(US);

    const snapshot = await owner.captureFromListings({
      context: executionContext,
      marketplaceId: US,
      listings: source.listings,
    });

    expect(snapshot.exportId).toBe(CONTENT_EXPORT_ID);
    expect(snapshot.rows.map((row) => row.sellerSku)).toEqual(["CHILD", "SOLO"]);
    expect(snapshot.rows[0]).toMatchObject({
      readStatus: "incomplete",
      issues: [],
      variationRole: "child",
      variationParentSku: "PARENT",
      variationFamilyKey: "PARENT",
      variationTheme: "Size",
      relationshipStatus: "complete",
      relationshipMessage: "Verified child.",
    });
    expect(snapshot.summary).toMatchObject({
      total: 2,
      completed: 1,
      incomplete: 1,
      withIssues: 1,
    });
    expect(saveContentAuditSnapshotEvidence).toHaveBeenCalledOnce();
    expect(saveContentAuditSnapshotEvidence).toHaveBeenCalledWith({
      exportId: CONTENT_EXPORT_ID,
      marketplaceId: US,
      accountScope: ACCOUNT_SCOPE,
      mode: "demo",
      fetchedAt: FETCHED_AT,
      rowDigests: expect.arrayContaining([
        "f68339e36b047a233a57e10305af570d4d47c40c547109c46b5ba53fcf86f336",
      ]),
    });
    const durablePayload = JSON.stringify(
      saveContentAuditSnapshotEvidence.mock.calls[0]?.[0],
    );
    expect(durablePayload).not.toContain("SOLO");
    expect(durablePayload).not.toContain("B000SOLO00");
    expect(durablePayload).not.toContain("Solo cocount");
    expect(durablePayload).not.toContain("Visible");

    const response = await owner.download({
      marketplaceId: US,
      exportId: CONTENT_EXPORT_ID,
    });
    expect(response.status).toBe(200);
    expect(response.headers).toMatchObject({
      "cache-control": "private, no-store, max-age=0",
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": expect.stringContaining(
        "amazon-fba-content-audit-us-2030-01-02.xlsx",
      ),
      "x-exported-fba-sku-count": "2",
      "x-content-audit-incomplete-count": "1",
      "x-content-audit-with-issues-count": "1",
    });
    if (response.body.kind !== "bytes") throw new Error("Expected workbook");
    const xml = workbookXml(response.body.value);
    expect(xml).toContain(CONTENT_EXPORT_ID);
    expect(xml).toContain("CHILD");
    expect(xml).toContain("SOLO");
    expect(xml).not.toContain("PARENT title");
    expect(xml).toContain("讀取未完成");
    expect(xml).toContain("⟦U+200B 零寬空格⟧");
    const roundTrip = parseContentAuditWorkbook({
      bytes: response.body.value,
      fileName: "content-audit.xlsx",
      mediaType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    expect(roundTrip.rows.find((row) => row.sellerSku === "SOLO")?.original)
      .toMatchObject({ productDescription: "Visible\u200bHidden" });

    owner.clear();
    await expect(owner.read({
      marketplaceId: US,
      exportId: CONTENT_EXPORT_ID,
    })).rejects.toMatchObject({ status: 410, code: "SNAPSHOT_EXPIRED" });
    expect(saveContentAuditSnapshotEvidence).toHaveBeenCalledOnce();
  });

  it("rejects SKU coverage drift before publishing durable evidence", async () => {
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "demo",
      accountScope: ACCOUNT_SCOPE,
    }));
    const saveContentAuditSnapshotEvidence = vi.fn<
      ContentAuditEvidencePort["saveContentAuditSnapshotEvidence"]
    >(async () => undefined);
    const source = catalogFixture();
    const owner = new ContentAuditOwner({
      context,
      evidence: { saveContentAuditSnapshotEvidence },
      readGrouping: async () => ({
        ...source.grouping,
        rows: source.grouping.rows.slice(1),
      }),
      createId: () => CONTENT_EXPORT_ID,
    });

    await expect(owner.captureFromListings({
      context: await context.capture(US),
      marketplaceId: US,
      listings: source.listings,
    })).rejects.toMatchObject({ status: 409, code: "SNAPSHOT_INVALID" });
    expect(saveContentAuditSnapshotEvidence).not.toHaveBeenCalled();
  });
});

describe("R08 image audit owner", () => {
  it("projects the legacy Image section from supplied shared Listings without creating owner state", async () => {
    const contextAdapter = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "demo",
      accountScope: ACCOUNT_SCOPE,
    }));
    const readGrouping = vi.fn();
    const createId = vi.fn(() => IMAGE_EXPORT_ID);
    const owner = new ImageAuditOwner({
      context: contextAdapter,
      readGrouping,
      createId,
    });
    const listings: AuditSuiteListingsResource = {
      reportId: "report-lease.r08-image-owner",
      documentId: "report-document.r08-image-owner",
      data: {
        fetchedAt: FETCHED_AT,
        errors: [],
        rows: [
          listingRow("IMAGE-INCOMPLETE", {
            imageUrls: ["https://images.example.invalid/unverified.jpg"],
            readStatus: "incomplete",
            readErrors: [{
              code: "LISTING_CONTENT_NOT_RETURNED",
              message: "Amazon image unavailable.",
            }],
          }),
          listingRow("IMAGE-LOW", {
            imageUrls: ["https://images.example.invalid/one.jpg"],
          }),
        ],
      },
    };
    const context = auditSuiteContext();

    const result = await owner.runAuditSuite({
      context,
      control: auditSuiteControl(),
      listings,
    });

    expect(result).toEqual({
      ...context,
      status: "partial",
      fetchedAt: FETCHED_AT,
      notice: "1 個 SKU 圖片讀取未完成；圖片數保持未知。",
      payload: [
        {
          sellerSku: "IMAGE-INCOMPLETE",
          title: "IMAGE-INCOMPLETE title",
          asin: "B0IMAGE-INCOMPLETE",
          imageCount: null,
          finding: "讀取未完成",
          notice: "Amazon image unavailable.",
        },
        {
          sellerSku: "IMAGE-LOW",
          title: "IMAGE-LOW title",
          asin: "B0IMAGE-LOW",
          imageCount: 1,
          finding: "少於 6 張",
          notice: "已核對圖片 1 張。",
        },
      ],
    });
    expect(readGrouping).not.toHaveBeenCalled();
    expect(createId).not.toHaveBeenCalled();
  });

  it("aborts relationship acquisition on clear and never reuses the stale flight", async () => {
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "demo",
      accountScope: ACCOUNT_SCOPE,
    }));
    const source = catalogFixture();
    let releaseGrouping: (() => void) | undefined;
    let observedSignal: AbortSignal | undefined;
    let invocation = 0;
    const continuedAfterGate = vi.fn();
    const readGrouping = vi.fn(async (input: {
      signal: AbortSignal;
    }) => {
      invocation += 1;
      if (invocation === 1) {
        observedSignal = input.signal;
        await new Promise<void>((resolve) => {
          releaseGrouping = resolve;
        });
        if (input.signal.aborted) throw input.signal.reason;
        continuedAfterGate();
      }
      return source.grouping;
    });
    const createId = vi.fn(() => IMAGE_EXPORT_ID);
    const owner = new ImageAuditOwner({ context, readGrouping, createId });
    const executionContext = await context.capture(US);

    const stale = owner.captureFromListings({
      context: executionContext,
      marketplaceId: US,
      listings: source.listings,
    });
    await vi.waitFor(() => expect(observedSignal).toBeDefined());
    owner.clear();
    expect(observedSignal?.aborted).toBe(true);
    expect(observedSignal?.reason).toMatchObject({
      code: "SP_CONTEXT_INVALIDATED",
    });
    releaseGrouping?.();
    await expect(stale).rejects.toMatchObject({
      code: "SP_CONTEXT_INVALIDATED",
    });
    expect(continuedAfterGate).not.toHaveBeenCalled();
    expect(createId).not.toHaveBeenCalled();

    await expect(owner.captureFromListings({
      context: executionContext,
      marketplaceId: US,
      listings: source.listings,
    })).resolves.toMatchObject({ exportId: IMAGE_EXPORT_ID });
    expect(readGrouping).toHaveBeenCalledTimes(2);
  });

  it("uses explicit grouping, preserves unknown image counts, and owns download identity", async () => {
    const capturedAt = Date.parse(FETCHED_AT);
    let now = capturedAt;
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "demo",
      accountScope: ACCOUNT_SCOPE,
    }));
    const source = catalogFixture();
    const owner = new ImageAuditOwner({
      context,
      readGrouping: async () => source.grouping,
      createId: () => IMAGE_EXPORT_ID,
      now: () => now,
    });
    const snapshot = await owner.captureStandaloneFromListings({
      context: await context.capture(US),
      marketplaceId: US,
      listings: source.listings,
    });

    expect(snapshot).toMatchObject({
      exportId: IMAGE_EXPORT_ID,
      minimumImages: 6,
      summary: { total: 2, completed: 1, incomplete: 1, underMinimum: 1 },
    });
    expect(snapshot.rows.map((row) => row.sellerSku)).toEqual(["CHILD", "SOLO"]);
    expect(snapshot.rows[0]).toMatchObject({
      sellerSku: "CHILD",
      readStatus: "incomplete",
      imageCount: 0,
    });

    const response = await owner.download({
      marketplaceId: US,
      exportId: IMAGE_EXPORT_ID,
    });
    expect(response.status).toBe(200);
    expect(response.headers).toMatchObject({
      "content-disposition": expect.stringContaining(
        "filename*=UTF-8''FBA-%E5%9C%96%E7%89%87%E5%81%A5%E6%AA%A2-US-2030-01-02.xlsx",
      ),
      "x-exported-fba-sku-count": "2",
      "x-image-audit-under-minimum-count": "1",
      "x-image-audit-incomplete-count": "1",
    });
    if (response.body.kind !== "bytes") throw new Error("Expected workbook");
    const xml = workbookXml(response.body.value);
    expect(xml).toContain("CHILD");
    expect(xml).toContain("SOLO");
    expect(xml).not.toContain("PARENT title");
    expect(xml).toContain("讀取未完成");

    now = capturedAt + 10 * 60 * 1_000 + 1;
    await expect(owner.read({
      marketplaceId: US,
      exportId: IMAGE_EXPORT_ID,
    })).resolves.toMatchObject({ exportId: IMAGE_EXPORT_ID });
    now = capturedAt + 30 * 60 * 1_000;
    await expect(owner.read({
      marketplaceId: US,
      exportId: IMAGE_EXPORT_ID,
    })).rejects.toMatchObject({ status: 410, code: "SNAPSHOT_EXPIRED" });
  });
});

describe("context-bound snapshot explicit capabilities", () => {
  it("rejects invalid or duplicate explicit UUIDs without replacing the first entry", async () => {
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "demo",
      accountScope: ACCOUNT_SCOPE,
    }));
    const store = new ContextBoundAuditSnapshotStore<{ marker: string }>({
      context,
      ttlMs: 60_000,
      createId: () => {
        throw new Error("Explicit capability should bypass ID generation");
      },
      expiredMessage: "Snapshot expired.",
    });
    const executionContext = await context.capture(US);
    expect(() => store.publish({
      context: executionContext,
      marketplaceId: US,
      snapshotId: "../unsafe",
      snapshot: { marker: "unsafe" },
    })).toThrow("Audit snapshot capability is invalid.");

    expect(store.publish({
      context: executionContext,
      marketplaceId: US,
      snapshotId: SHARED_EXPORT_ID,
      snapshot: { marker: "first" },
    })).toBe(SHARED_EXPORT_ID);
    expect(() => store.publish({
      context: executionContext,
      marketplaceId: US,
      snapshotId: SHARED_EXPORT_ID,
      snapshot: { marker: "replacement" },
    })).toThrow("Audit snapshot capability already exists.");
    await expect(store.read({
      marketplaceId: US,
      snapshotId: SHARED_EXPORT_ID,
    })).resolves.toEqual({ marker: "first" });
  });
});
