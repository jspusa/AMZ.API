import { describe, expect, it } from "vitest";
import {
  AplusContentReads,
  type AplusContentPageAdapter,
  type AplusContentPagePlan,
} from "../src/main/amazon/a-plus-content-reads";
import {
  createScriptedSpExecutionContextAdapter,
  SpExecutionContextError,
  type SpExecutionContextAdapter,
} from "../src/main/amazon/sp-execution-context";
import { parseAplusAuditSnapshot } from "../src/renderer/src/a-plus-audit";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;

function publicPlan(plan: AplusContentPagePlan) {
  return {
    operation: plan.operation,
    marketplaceId: plan.marketplaceId,
    ...(plan.operation === "publish-records" ? { asin: plan.asin } : {}),
    ...(plan.operation === "document-relations"
      ? { contentReferenceKey: plan.contentReferenceKey }
      : {}),
    pageToken: plan.pageToken ?? null,
  };
}

describe("bounded A+ Content reads", () => {
  it("preserves exact published evidence while incomplete relationship seeds skip direct publish requests", async () => {
    const calls: ReturnType<typeof publicPlan>[] = [];
    const adapter: AplusContentPageAdapter = {
      async read(plan) {
        calls.push(publicPlan(plan));
        if (plan.operation === "publish-records") {
          if (!plan.pageToken) {
            return {
              status: 200,
              payload: {
                publishRecordList: [{
                  marketplaceId: MARKETPLACE_ID,
                  asin: plan.asin,
                  contentReferenceKey: "document-direct",
                  contentType: "EBC",
                  locale: "en-US",
                }],
                nextPageToken: "publish-next",
              },
              requestId: "request-publish-1",
            };
          }
          return {
            status: 503,
            payload: null,
            requestId: "request-publish-2",
          };
        }
        if (plan.operation === "content-documents") {
          return {
            status: 200,
            payload: {
              contentMetadataRecords: [{
                contentReferenceKey: "document-related",
                contentMetadata: {
                  name: "Published related document",
                  marketplaceId: MARKETPLACE_ID,
                  status: "APPROVED",
                  badgeSet: ["STANDARD"],
                  updateTime: "2026-08-24T00:00:00Z",
                },
              }],
            },
            requestId: "request-documents",
          };
        }
        return {
          status: 200,
          payload: {
            asinMetadataSet: [{
              asin: "B000000002",
              badgeSet: ["CONTENT_PUBLISHED"],
              contentReferenceKeySet: [plan.contentReferenceKey],
            }],
          },
          requestId: "request-relations",
        };
      },
    };
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      accountScope: "s13-account-scope",
    }));
    const expectedContext = await context.capture(MARKETPLACE_ID);
    const reads = new AplusContentReads({ context, live: adapter });

    const snapshot = await reads.read({
      marketplaceId: MARKETPLACE_ID,
      expectedContext,
      fetchedAt: "2026-08-24T00:00:00Z",
      fbaSnapshotId: "fba-snapshot-s13",
      rows: [
        { sellerSku: "DIRECT-SKU", asin: "B000000001", title: "Direct" },
        {
          sellerSku: "INCOMPLETE-RELATIONSHIP-SKU",
          asin: "B000000002",
          title: "Incomplete relationship",
          incompleteReasonCode: "FBA_RELATIONSHIP_INCOMPLETE",
        },
      ],
    });

    expect(snapshot.rows.map((row) => ({
      sellerSku: row.sellerSku,
      status: row.status,
      sourceCompleteness: row.sourceCompleteness,
      reasonCode: row.reasonCode,
    }))).toEqual([
      {
        sellerSku: "DIRECT-SKU",
        status: "published",
        sourceCompleteness: "partial",
        reasonCode: "PUBLISHED_RECORD_FOUND",
      },
      {
        sellerSku: "INCOMPLETE-RELATIONSHIP-SKU",
        status: "published",
        sourceCompleteness: "partial",
        reasonCode: "PUBLISHED_DOCUMENT_RELATION_FOUND",
      },
    ]);
    expect(calls.filter((call) => call.operation === "publish-records"))
      .toEqual([
        {
          operation: "publish-records",
          marketplaceId: MARKETPLACE_ID,
          asin: "B000000001",
          pageToken: null,
        },
        {
          operation: "publish-records",
          marketplaceId: MARKETPLACE_ID,
          asin: "B000000001",
          pageToken: "publish-next",
        },
      ]);
    expect(calls.some((call) =>
      call.operation === "publish-records" &&
      "asin" in call &&
      call.asin === "B000000002"
    )).toBe(false);
  });

  it("caps total page fanout while preserving seen positives and failing negative evidence closed", async () => {
    let pageCalls = 0;
    const adapter: AplusContentPageAdapter = {
      async read(plan) {
        pageCalls += 1;
        if (plan.operation === "publish-records") {
          return {
            status: 200,
            payload: {
              publishRecordList: plan.asin === "B000000000"
                ? [{
                    marketplaceId: MARKETPLACE_ID,
                    asin: plan.asin,
                    contentReferenceKey: "bounded-positive",
                    contentType: "EBC",
                    locale: "en-US",
                  }]
                : [],
            },
            requestId: null,
          };
        }
        return {
          status: 200,
          payload: plan.operation === "content-documents"
            ? { contentMetadataRecords: [] }
            : { asinMetadataSet: [] },
          requestId: null,
        };
      },
    };
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      accountScope: "s13-bounded-account-scope",
    }));
    const expectedContext = await context.capture(MARKETPLACE_ID);
    const reads = new AplusContentReads({ context, live: adapter });
    const rows = Array.from({ length: 25_000 }, (_, index) => ({
      sellerSku: `BOUND-${index}`,
      asin: `B${String(index).padStart(9, "0")}`,
      title: `Bounded ${index}`,
    }));

    const snapshot = await reads.read({
      marketplaceId: MARKETPLACE_ID,
      expectedContext,
      fetchedAt: "2026-08-24T00:00:00Z",
      fbaSnapshotId: "fba-snapshot-bounded",
      rows,
    });

    expect(pageCalls).toBe(25_000);
    expect(snapshot.rows[0]).toMatchObject({
      status: "published",
      reasonCode: "PUBLISHED_RECORD_FOUND",
    });
    expect(snapshot.rows.at(-1)).toMatchObject({
      status: "incomplete",
      sourceCompleteness: "partial",
    });
    expect(snapshot.summary.missing).toBe(0);
  });

  it("caps aggregate decoded response bytes across the whole audit", async () => {
    let pageCalls = 0;
    const adapter: AplusContentPageAdapter = {
      async read(plan) {
        pageCalls += 1;
        if (plan.operation !== "publish-records") {
          throw new Error("The response-byte budget should stop before document reads.");
        }
        return {
          status: 200,
          payload: {
            publishRecordList: plan.asin === "B000000000"
              ? [{
                  marketplaceId: MARKETPLACE_ID,
                  asin: plan.asin,
                  contentReferenceKey: "byte-budget-positive",
                  contentType: "EBC",
                  locale: "en-US",
                }]
              : [],
          },
          requestId: null,
          responseBytes: 16 * 1_024 * 1_024,
        };
      },
    };
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      accountScope: "s13-response-byte-budget-account-scope",
    }));
    const expectedContext = await context.capture(MARKETPLACE_ID);
    const reads = new AplusContentReads({ context, live: adapter });

    const snapshot = await reads.read({
      marketplaceId: MARKETPLACE_ID,
      expectedContext,
      fetchedAt: "2026-08-24T00:00:00Z",
      fbaSnapshotId: "fba-snapshot-response-byte-budget",
      rows: Array.from({ length: 17 }, (_, index) => ({
        sellerSku: `BYTE-${index}`,
        asin: `B${String(index).padStart(9, "0")}`,
        title: `Byte ${index}`,
      })),
    });

    expect(pageCalls).toBe(16);
    expect(snapshot.rows[0]).toMatchObject({
      status: "published",
      reasonCode: "PUBLISHED_RECORD_FOUND",
    });
    expect(snapshot.rows.at(-1)).toMatchObject({
      status: "incomplete",
      sourceCompleteness: "partial",
    });
    expect(snapshot.summary.missing).toBe(0);
  });

  it("charges failed page reads against the reserved aggregate response budget", async () => {
    let pageCalls = 0;
    const adapter: AplusContentPageAdapter = {
      async read() {
        pageCalls += 1;
        throw new Error("Simulated oversized or stalled page read.");
      },
    };
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      accountScope: "s13-failed-response-budget-account-scope",
    }));
    const expectedContext = await context.capture(MARKETPLACE_ID);
    const snapshot = await new AplusContentReads({ context, live: adapter }).read({
      marketplaceId: MARKETPLACE_ID,
      expectedContext,
      fetchedAt: "2026-08-24T00:00:00Z",
      fbaSnapshotId: "fba-snapshot-failed-response-budget",
      rows: Array.from({ length: 17 }, (_, index) => ({
        sellerSku: `FAILED-BYTE-${index}`,
        asin: `B${String(index).padStart(9, "0")}`,
        title: `Failed byte ${index}`,
      })),
    });

    expect(pageCalls).toBe(16);
    expect(snapshot.summary).toMatchObject({
      missing: 0,
      incomplete: 17,
    });
  });

  it("bounds relationship edges across documents without losing an already seen exact positive", async () => {
    let pageCalls = 0;
    const asins = Array.from(
      { length: 25_000 },
      (_, index) => `B${String(index).padStart(9, "0")}`,
    );
    const relationPage = (
      contentReferenceKey: string,
      pageToken?: string,
    ) => {
      const page = pageToken === "page-2" ? 1 : pageToken === "page-3" ? 2 : 0;
      const start = page * 10_000;
      const values = asins.slice(start, start + 10_000).map((asin, index) => ({
        asin,
        badgeSet: asin === "B000000000" && contentReferenceKey === "document-one"
          ? ["CONTENT_PUBLISHED"]
          : ["CONTENT_NOT_PUBLISHED"],
        contentReferenceKeySet: [contentReferenceKey],
        index,
      }));
      return {
        asinMetadataSet: values.map(({ index: _index, ...value }) => value),
        ...(page < 2 ? { nextPageToken: `page-${page + 2}` } : {}),
      };
    };
    const adapter: AplusContentPageAdapter = {
      async read(plan) {
        pageCalls += 1;
        if (plan.operation === "publish-records") {
          throw new Error("Relationship-incomplete seeds must not query publish records.");
        }
        if (plan.operation === "content-documents") {
          return {
            status: 200,
            payload: {
              contentMetadataRecords: ["document-one", "document-two"].map(
                (contentReferenceKey) => ({
                  contentReferenceKey,
                  contentMetadata: {
                    name: contentReferenceKey,
                    marketplaceId: MARKETPLACE_ID,
                    status: "APPROVED",
                    badgeSet: ["STANDARD"],
                    updateTime: "2026-08-24T00:00:00Z",
                  },
                }),
              ),
            },
            requestId: null,
          };
        }
        return {
          status: 200,
          payload: relationPage(plan.contentReferenceKey, plan.pageToken),
          requestId: null,
        };
      },
    };
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      accountScope: "s13-edge-budget-account-scope",
    }));
    const expectedContext = await context.capture(MARKETPLACE_ID);
    const reads = new AplusContentReads({ context, live: adapter });

    const snapshot = await reads.read({
      marketplaceId: MARKETPLACE_ID,
      expectedContext,
      fetchedAt: "2026-08-24T00:00:00Z",
      fbaSnapshotId: "fba-snapshot-edge-budget",
      rows: asins.map((asin, index) => ({
        sellerSku: `EDGE-${index}`,
        asin,
        title: `Edge ${index}`,
        incompleteReasonCode: "FBA_RELATIONSHIP_INCOMPLETE",
      })),
    });

    expect(pageCalls).toBe(4);
    expect(snapshot.rows[0]).toMatchObject({
      status: "published",
      reasonCode: "PUBLISHED_DOCUMENT_RELATION_FOUND",
    });
    expect(snapshot.rows[1]).toMatchObject({
      status: "incomplete",
      sourceCompleteness: "partial",
    });
    expect(snapshot.summary.missing).toBe(0);
  });

  it("charges non-target duplicate relation rows against the audit-wide row budget", async () => {
    let pageCalls = 0;
    const adapter: AplusContentPageAdapter = {
      async read(plan) {
        pageCalls += 1;
        if (plan.operation === "publish-records") {
          throw new Error("Relationship-incomplete seeds must not query publish records.");
        }
        if (plan.operation === "content-documents") {
          return {
            status: 200,
            payload: {
              contentMetadataRecords: [{
                contentReferenceKey: "duplicate-non-target-document",
                contentMetadata: {
                  name: "Duplicate non-target relations",
                  marketplaceId: MARKETPLACE_ID,
                  status: "APPROVED",
                  badgeSet: ["STANDARD"],
                  updateTime: "2026-08-24T00:00:00Z",
                },
              }],
            },
            requestId: null,
          };
        }
        const page = Number(plan.pageToken ?? "0");
        return {
          status: 200,
          payload: {
            asinMetadataSet: Array.from({ length: 10_000 }, (_, index) =>
              index === 0 && page === 0
                ? {
                    asin: "B000000001",
                    badgeSet: ["CONTENT_PUBLISHED"],
                    contentReferenceKeySet: [plan.contentReferenceKey],
                  }
                : {
                    asin: "B999999999",
                    badgeSet: ["CONTENT_NOT_PUBLISHED"],
                    contentReferenceKeySet: [plan.contentReferenceKey],
                  }
            ),
            nextPageToken: String(page + 1),
          },
          requestId: null,
        };
      },
    };
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      accountScope: "s13-relation-row-budget-account-scope",
    }));
    const expectedContext = await context.capture(MARKETPLACE_ID);
    const reads = new AplusContentReads({ context, live: adapter });

    const snapshot = await reads.read({
      marketplaceId: MARKETPLACE_ID,
      expectedContext,
      fetchedAt: "2026-08-24T00:00:00Z",
      fbaSnapshotId: "fba-snapshot-relation-row-budget",
      rows: [{
        sellerSku: "ROW-BUDGET",
        asin: "B000000001",
        title: "Row budget",
        incompleteReasonCode: "FBA_RELATIONSHIP_INCOMPLETE",
      }],
    });

    expect(pageCalls).toBe(4);
    expect(snapshot.rows[0]).toMatchObject({
      status: "published",
      sourceCompleteness: "partial",
      reasonCode: "PUBLISHED_DOCUMENT_RELATION_FOUND",
    });
  });

  it("follows relation pagination but never promotes an APPROVED-only document to published", async () => {
    const calls: ReturnType<typeof publicPlan>[] = [];
    const adapter: AplusContentPageAdapter = {
      async read(plan) {
        calls.push(publicPlan(plan));
        if (plan.operation === "publish-records") {
          throw new Error("Relationship-incomplete seeds must not query publish records.");
        }
        if (plan.operation === "content-documents") {
          return {
            status: 200,
            payload: {
              contentMetadataRecords: [
                {
                  contentReferenceKey: "approved-only-document",
                  contentMetadata: {
                    name: "Approved is not published",
                    marketplaceId: MARKETPLACE_ID,
                    status: "APPROVED",
                    badgeSet: ["STANDARD"],
                    updateTime: "2026-08-24T00:00:00Z",
                  },
                },
                {
                  contentReferenceKey: "paginated-published-document",
                  contentMetadata: {
                    name: "Published on relation page two",
                    marketplaceId: MARKETPLACE_ID,
                    status: "APPROVED",
                    badgeSet: ["STANDARD"],
                    updateTime: "2026-08-24T00:00:00Z",
                  },
                },
              ],
            },
            requestId: null,
          };
        }
        if (plan.contentReferenceKey === "approved-only-document") {
          return {
            status: 200,
            payload: {
              asinMetadataSet: [{
                asin: "B000000001",
                badgeSet: ["CONTENT_NOT_PUBLISHED"],
                contentReferenceKeySet: [plan.contentReferenceKey],
              }],
            },
            requestId: null,
          };
        }
        return plan.pageToken === "relation-next"
          ? {
              status: 200,
              payload: {
                asinMetadataSet: [{
                  asin: "B000000002",
                  badgeSet: ["CONTENT_PUBLISHED"],
                  contentReferenceKeySet: [plan.contentReferenceKey],
                }],
              },
              requestId: null,
            }
          : {
              status: 200,
              payload: {
                asinMetadataSet: [],
                nextPageToken: "relation-next",
              },
              requestId: null,
            };
      },
    };
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      accountScope: "s13-relation-pagination-account-scope",
    }));
    const expectedContext = await context.capture(MARKETPLACE_ID);
    const reads = new AplusContentReads({ context, live: adapter });

    const snapshot = await reads.read({
      marketplaceId: MARKETPLACE_ID,
      expectedContext,
      fetchedAt: "2026-08-24T00:00:00Z",
      fbaSnapshotId: "fba-snapshot-relation-pagination",
      rows: [
        {
          sellerSku: "APPROVED-ONLY",
          asin: "B000000001",
          title: "Approved only",
          incompleteReasonCode: "FBA_RELATIONSHIP_INCOMPLETE",
        },
        {
          sellerSku: "PUBLISHED-PAGE-TWO",
          asin: "B000000002",
          title: "Published page two",
          incompleteReasonCode: "FBA_RELATIONSHIP_INCOMPLETE",
        },
      ],
    });

    expect(snapshot.rows).toMatchObject([
      {
        sellerSku: "APPROVED-ONLY",
        status: "incomplete",
        reasonCode: "FBA_RELATIONSHIP_INCOMPLETE",
      },
      {
        sellerSku: "PUBLISHED-PAGE-TWO",
        status: "published",
        reasonCode: "PUBLISHED_DOCUMENT_RELATION_FOUND",
      },
    ]);
    expect(calls.filter((call) =>
      call.operation === "document-relations" &&
      "contentReferenceKey" in call &&
      call.contentReferenceKey === "paginated-published-document"
    )).toEqual([
      {
        operation: "document-relations",
        marketplaceId: MARKETPLACE_ID,
        contentReferenceKey: "paginated-published-document",
        pageToken: null,
      },
      {
        operation: "document-relations",
        marketplaceId: MARKETPLACE_ID,
        contentReferenceKey: "paginated-published-document",
        pageToken: "relation-next",
      },
    ]);
  });

  it("retains exact relation-positive evidence when the public document list is bounded", async () => {
    const positiveKey = "document-positive-sorts-last";
    const negativeKeys = Array.from(
      { length: 100 },
      (_, index) => `document-negative-${String(index).padStart(3, "0")}`,
    );
    const adapter: AplusContentPageAdapter = {
      async read(plan) {
        if (plan.operation === "publish-records") {
          throw new Error("Relationship-incomplete seeds must not query publish records.");
        }
        if (plan.operation === "content-documents") {
          return {
            status: 200,
            payload: {
              contentMetadataRecords: [...negativeKeys, positiveKey].map(
                (contentReferenceKey) => ({
                  contentReferenceKey,
                  contentMetadata: {
                    name: contentReferenceKey === positiveKey
                      ? "ZZZ published document"
                      : `AAA ${contentReferenceKey}`,
                    marketplaceId: MARKETPLACE_ID,
                    status: "APPROVED",
                    badgeSet: ["STANDARD"],
                    updateTime: "2026-08-24T00:00:00Z",
                  },
                }),
              ),
            },
            requestId: null,
          };
        }
        return {
          status: 200,
          payload: {
            asinMetadataSet: [{
              asin: "B000000001",
              badgeSet: [plan.contentReferenceKey === positiveKey
                ? "CONTENT_PUBLISHED"
                : "CONTENT_NOT_PUBLISHED"],
              contentReferenceKeySet: [plan.contentReferenceKey],
            }],
          },
          requestId: null,
        };
      },
    };
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      accountScope: "s13-public-bound-account-scope",
    }));
    const expectedContext = await context.capture(MARKETPLACE_ID);
    const reads = new AplusContentReads({ context, live: adapter });

    const snapshot = await reads.read({
      marketplaceId: MARKETPLACE_ID,
      expectedContext,
      fetchedAt: "2026-08-24T00:00:00Z",
      fbaSnapshotId: "fba-snapshot-public-bound",
      rows: [{
        sellerSku: "PUBLIC-BOUND",
        asin: "B000000001",
        title: "Public bound",
        incompleteReasonCode: "FBA_RELATIONSHIP_INCOMPLETE",
      }],
    });
    const { fbaSnapshotId: _internalSnapshotId, ...publicSnapshot } = snapshot;

    expect(snapshot.rows[0]).toMatchObject({
      status: "published",
      reasonCode: "PUBLISHED_DOCUMENT_RELATION_FOUND",
      documents: expect.arrayContaining([expect.objectContaining({
        name: "ZZZ published document",
        relationState: "published",
        evidence: "relation_badge",
      })]),
    });
    expect(snapshot.rows[0]?.documents).toHaveLength(100);
    expect(() => parseAplusAuditSnapshot(
      publicSnapshot,
      MARKETPLACE_ID,
      "live",
    )).not.toThrow();
  });

  it("reuses the bounded evidence projection for Seller SKUs sharing one ASIN and evidence class", async () => {
    const adapter: AplusContentPageAdapter = {
      async read(plan) {
        if (plan.operation === "publish-records") {
          return { status: 200, payload: { publishRecordList: [] }, requestId: null };
        }
        if (plan.operation === "content-documents") {
          return {
            status: 200,
            payload: {
              contentMetadataRecords: [{
                contentReferenceKey: "shared-projection-document",
                contentMetadata: {
                  name: "Shared projection",
                  marketplaceId: MARKETPLACE_ID,
                  status: "APPROVED",
                  badgeSet: ["STANDARD"],
                  updateTime: "2026-08-24T00:00:00Z",
                },
              }],
            },
            requestId: null,
          };
        }
        return { status: 200, payload: { asinMetadataSet: [] }, requestId: null };
      },
    };
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      accountScope: "s13-shared-projection-account-scope",
    }));
    const expectedContext = await context.capture(MARKETPLACE_ID);
    const snapshot = await new AplusContentReads({ context, live: adapter }).read({
      marketplaceId: MARKETPLACE_ID,
      expectedContext,
      fetchedAt: "2026-08-24T00:00:00Z",
      fbaSnapshotId: "fba-snapshot-shared-projection",
      rows: [
        { sellerSku: "SHARED-ONE", asin: "B000000001", title: "Shared one" },
        { sellerSku: "SHARED-TWO", asin: "B000000001", title: "Shared two" },
      ],
    });

    expect(snapshot.rows[0]?.documents).toBe(snapshot.rows[1]?.documents);
  });

  it("propagates a post-adapter context fence immediately instead of degrading it to partial evidence", async () => {
    let adapterCalls = 0;
    const pageAdapter: AplusContentPageAdapter = {
      async read(plan) {
        adapterCalls += 1;
        return {
          status: 200,
          payload: plan.operation === "publish-records"
            ? { publishRecordList: [] }
            : plan.operation === "content-documents"
              ? { contentMetadataRecords: [] }
              : { asinMetadataSet: [] },
          requestId: null,
        };
      },
    };
    const baseContext = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      accountScope: "s13-context-fence-account-scope",
    }));
    let assertions = 0;
    const context: SpExecutionContextAdapter = {
      capture: (marketplaceId) => baseContext.capture(marketplaceId),
      async assertCurrent(expected) {
        assertions += 1;
        if (assertions === 3) {
          throw new SpExecutionContextError(
            "ACCOUNT_SCOPE_CHANGED",
            "Amazon 帳號範圍已改變；本次操作已停止。",
          );
        }
        await baseContext.assertCurrent(expected);
      },
      invalidate: (reason) => baseContext.invalidate(reason),
    };
    const expectedContext = await context.capture(MARKETPLACE_ID);
    const reads = new AplusContentReads({ context, live: pageAdapter });

    await expect(reads.read({
      marketplaceId: MARKETPLACE_ID,
      expectedContext,
      fetchedAt: "2026-08-24T00:00:00Z",
      fbaSnapshotId: "fba-snapshot-context-fence",
      rows: [
        { sellerSku: "FENCE-ONE", asin: "B000000001", title: "Fence one" },
        { sellerSku: "FENCE-TWO", asin: "B000000002", title: "Fence two" },
      ],
    })).rejects.toMatchObject({ code: "ACCOUNT_SCOPE_CHANGED" });
    expect(adapterCalls).toBe(1);
  });
});
