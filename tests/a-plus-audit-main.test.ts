import { describe, expect, it } from "vitest";
import {
  buildAplusAuditSeedsFromFbaGrouping,
  runAplusAudit,
  type AplusPublishRecordFetchInput,
} from "../src/main/amazon/a-plus-audit";
import { parseAplusAuditSnapshot } from "../src/renderer/src/a-plus-audit";

const MARKETPLACE_ID = "ATVPDKIKX0DER";

describe("A+ FBA audit core", () => {
  it("only turns relationship-proven non-parent listings into queryable A+ seeds", async () => {
    const seeds = buildAplusAuditSeedsFromFbaGrouping([
      {
        sellerSku: "CHILD-SKU",
        asin: "B000000101",
        title: "Verified child",
        role: "child",
        status: "complete",
      },
      {
        sellerSku: "STANDALONE-SKU",
        asin: "B000000102",
        title: "Verified standalone",
        role: "standalone",
        status: "complete",
      },
      {
        sellerSku: "PARENT-SKU",
        asin: "B000000103",
        title: "Verified parent container",
        role: "parent",
        status: "complete",
      },
      {
        sellerSku: "UNKNOWN-RELATIONSHIP",
        asin: "B000000104",
        title: "Relationship unavailable",
        role: "unknown",
        status: "incomplete",
      },
    ]);
    const calls: string[] = [];
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "strict-fba-snapshot",
      rows: seeds,
      fetchPublishRecords: async ({ asin }) => {
        calls.push(asin);
        return { status: 200, payload: { publishRecordList: [] } };
      },
    });

    expect(calls).toEqual(["B000000101", "B000000102"]);
    expect(snapshot.rows).toMatchObject([
      { sellerSku: "CHILD-SKU", asin: "B000000101", status: "missing" },
      { sellerSku: "STANDALONE-SKU", asin: "B000000102", status: "missing" },
      {
        sellerSku: "UNKNOWN-RELATIONSHIP",
        asin: null,
        status: "incomplete",
        reasonCode: "FBA_RELATIONSHIP_INCOMPLETE",
      },
    ]);
    expect(snapshot.rows.some(({ sellerSku }) => sellerSku === "PARENT-SKU")).toBe(false);
  });

  it("queries each exact ASIN once and fans the result out to every FBA Seller SKU", async () => {
    const calls: AplusPublishRecordFetchInput[] = [];
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-snapshot-001",
      rows: [
        { sellerSku: "SKU-A-ONE", asin: "B000000001", title: "Shared ASIN one" },
        { sellerSku: "SKU-A-TWO", asin: "B000000001", title: "Shared ASIN two" },
        { sellerSku: "SKU-B", asin: "B000000002", title: "No A plus" },
      ],
      fetchPublishRecords: async (input) => {
        calls.push(input);
        if (input.asin === "B000000001") {
          return {
            status: 200,
            payload: {
              publishRecordList: [{
                marketplaceId: MARKETPLACE_ID,
                asin: "B000000001",
                contentReferenceKey: "content-reference-one",
                contentType: "EBC",
                locale: "en-US",
              }],
            },
          };
        }
        return { status: 200, payload: { publishRecordList: [] } };
      },
    });

    expect(calls.map(({ marketplaceId, asin, pageToken }) => ({
      marketplaceId,
      asin,
      pageToken,
    }))).toEqual([
      { marketplaceId: MARKETPLACE_ID, asin: "B000000001", pageToken: undefined },
      { marketplaceId: MARKETPLACE_ID, asin: "B000000002", pageToken: undefined },
    ]);
    expect(snapshot.rows).toMatchObject([
      {
        sellerSku: "SKU-A-ONE",
        asin: "B000000001",
        title: "Shared ASIN one",
        status: "published",
        sourceCompleteness: "complete",
        publishedRecordCount: 1,
        contentTypes: ["EBC"],
        locales: ["en-US"],
        reasonCode: "PUBLISHED_RECORD_FOUND",
      },
      {
        sellerSku: "SKU-A-TWO",
        asin: "B000000001",
        status: "published",
      },
      {
        sellerSku: "SKU-B",
        asin: "B000000002",
        status: "missing",
        sourceCompleteness: "complete",
        publishedRecordCount: 0,
        contentTypes: [],
        locales: [],
        reasonCode: "NO_PUBLISHED_RECORD",
      },
    ]);
    expect(snapshot.summary).toEqual({
      eligibleFbaSkus: 3,
      uniqueAsins: 2,
      published: 2,
      missing: 1,
      incomplete: 0,
      unavailable: 0,
    });
  });

  it("follows an empty page token before deciding whether A+ is missing", async () => {
    const pageTokens: Array<string | undefined> = [];
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-snapshot-002",
      rows: [{ sellerSku: "PAGED", asin: "B000000003", title: "Paged A plus" }],
      fetchPublishRecords: async ({ pageToken }) => {
        pageTokens.push(pageToken);
        return pageToken === undefined
          ? {
              status: 200,
              payload: {
                publishRecordList: [],
                nextPageToken: "opaque-next-page",
              },
            }
          : {
              status: 200,
              payload: {
                publishRecordList: [{
                  marketplaceId: MARKETPLACE_ID,
                  asin: "B000000003",
                  contentReferenceKey: "content-reference-page-two",
                  contentType: "EMC",
                  locale: "en-US",
                }],
              },
            };
      },
    });

    expect(pageTokens).toEqual([undefined, "opaque-next-page"]);
    expect(snapshot.rows[0]).toMatchObject({
      status: "published",
      sourceCompleteness: "complete",
      publishedRecordCount: 1,
      contentTypes: ["EMC"],
    });
  });

  it("never turns a warning into negative proof but preserves an exact positive record", async () => {
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-snapshot-003",
      rows: [
        { sellerSku: "WARN-EMPTY", asin: "B000000004", title: "Warning empty" },
        { sellerSku: "WARN-POSITIVE", asin: "B000000005", title: "Warning positive" },
      ],
      fetchPublishRecords: async ({ asin }) => ({
        status: 200,
        payload: {
          publishRecordList: asin === "B000000005"
            ? [{
                marketplaceId: MARKETPLACE_ID,
                asin,
                contentReferenceKey: "content-reference-warning",
                contentType: "EBC",
                locale: "en-US",
              }]
            : [],
          warnings: [{ code: "PARTIAL_SUCCESS", message: "Partial result" }],
        },
      }),
    });

    expect(snapshot.rows[0]).toMatchObject({
      status: "incomplete",
      sourceCompleteness: "partial",
      publishedRecordCount: null,
      reasonCode: "A_PLUS_WARNING_PRESENT",
    });
    expect(snapshot.rows[0]).not.toHaveProperty("fromTheBrandStatus");
    expect(snapshot.rows[1]).toMatchObject({
      status: "published",
      sourceCompleteness: "partial",
      publishedRecordCount: null,
      contentTypes: ["EBC"],
      locales: ["en-US"],
      reasonCode: "PUBLISHED_RECORD_FOUND",
    });
    expect(snapshot.rows[1]).not.toHaveProperty("fromTheBrandStatus");
  });

  it("follows a warning-only page token and preserves a later exact publish record", async () => {
    const pageTokens: Array<string | undefined> = [];
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-snapshot-warning-pagination",
      rows: [{ sellerSku: "WARN-NEXT", asin: "B000000054", title: "Warning then positive" }],
      fetchPublishRecords: async ({ asin, pageToken }) => {
        pageTokens.push(pageToken);
        if (pageToken === undefined) {
          return {
            status: 200,
            payload: {
              publishRecordList: [],
              warnings: [{ code: "PARTIAL_SUCCESS", message: "Continue to next page" }],
              nextPageToken: "warning-next-page",
            },
          };
        }
        return {
          status: 200,
          payload: {
            publishRecordList: [{
              marketplaceId: MARKETPLACE_ID,
              asin,
              contentReferenceKey: "content-reference-after-warning",
              contentType: "EBC",
              locale: "en-US",
            }],
          },
        };
      },
    });

    expect(pageTokens).toEqual([undefined, "warning-next-page"]);
    expect(snapshot.rows[0]).toMatchObject({
      status: "published",
      sourceCompleteness: "partial",
      publishedRecordCount: null,
      contentTypes: ["EBC"],
      locales: ["en-US"],
      reasonCode: "PUBLISHED_RECORD_FOUND",
    });
  });

  it("keeps an exact positive record even when Amazon's optional warnings envelope is malformed", async () => {
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-snapshot-warning-envelope",
      rows: [{ sellerSku: "WARN-SHAPE", asin: "B000000055", title: "Warning shape" }],
      fetchPublishRecords: async ({ asin }) => ({
        status: 200,
        payload: {
          publishRecordList: [{
            marketplaceId: MARKETPLACE_ID,
            asin,
            contentReferenceKey: "content-reference-warning-shape",
            contentType: "EBC",
            locale: "en-US",
          }],
          warnings: { code: "UPSTREAM_DRIFT", message: "Unexpected envelope" },
        },
      }),
    });

    expect(snapshot.rows[0]).toMatchObject({
      status: "published",
      sourceCompleteness: "partial",
      publishedRecordCount: null,
      reasonCode: "PUBLISHED_RECORD_FOUND",
    });
  });

  it("treats a null optional content subtype as absent without accepting other malformed types", async () => {
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-snapshot-null-content-subtype",
      rows: [
        { sellerSku: "NULL-SUBTYPE", asin: "B000000056", title: "Null subtype" },
        { sellerSku: "OBJECT-SUBTYPE", asin: "B000000057", title: "Object subtype" },
        { sellerSku: "NUMBER-SUBTYPE", asin: "B000000058", title: "Number subtype" },
      ],
      fetchPublishRecords: async ({ asin }) => ({
        status: 200,
        payload: {
          publishRecordList: [{
            marketplaceId: MARKETPLACE_ID,
            asin,
            contentReferenceKey: `content-reference-${asin}`,
            contentType: "EBC",
            contentSubType: asin === "B000000056"
              ? null
              : asin === "B000000057"
                ? { unexpected: true }
                : 1,
            locale: "en-US",
          }],
        },
      }),
    });

    expect(snapshot.rows.map((row) => ({
      sellerSku: row.sellerSku,
      status: row.status,
      sourceCompleteness: row.sourceCompleteness,
      publishedRecordCount: row.publishedRecordCount,
      reasonCode: row.reasonCode,
    }))).toEqual([
      {
        sellerSku: "NULL-SUBTYPE",
        status: "published",
        sourceCompleteness: "complete",
        publishedRecordCount: 1,
        reasonCode: "PUBLISHED_RECORD_FOUND",
      },
      {
        sellerSku: "OBJECT-SUBTYPE",
        status: "incomplete",
        sourceCompleteness: "partial",
        publishedRecordCount: null,
        reasonCode: "A_PLUS_RESPONSE_INVALID",
      },
      {
        sellerSku: "NUMBER-SUBTYPE",
        status: "incomplete",
        sourceCompleteness: "partial",
        publishedRecordCount: null,
        reasonCode: "A_PLUS_RESPONSE_INVALID",
      },
    ]);
  });

  it("treats mismatched or malformed publish records as incomplete instead of missing", async () => {
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-snapshot-004",
      rows: [
        { sellerSku: "WRONG-ASIN", asin: "B000000006", title: "Wrong ASIN" },
        { sellerSku: "BAD-TYPE", asin: "B000000007", title: "Bad type" },
      ],
      fetchPublishRecords: async ({ asin }) => ({
        status: 200,
        payload: {
          publishRecordList: asin === "B000000006"
            ? [{
                marketplaceId: MARKETPLACE_ID,
                asin: "B000000099",
                contentReferenceKey: "wrong-identity",
                contentType: "EBC",
                locale: "en-US",
              }]
            : [{
                marketplaceId: MARKETPLACE_ID,
                asin,
                contentReferenceKey: "unknown-content-type",
                contentType: "BRAND_STORY",
                locale: "en-US",
              }],
        },
      }),
    });

    expect(snapshot.rows.map((row) => ({
      status: row.status,
      sourceCompleteness: row.sourceCompleteness,
      publishedRecordCount: row.publishedRecordCount,
      reasonCode: row.reasonCode,
    }))).toEqual([
      {
        status: "incomplete",
        sourceCompleteness: "partial",
        publishedRecordCount: null,
        reasonCode: "A_PLUS_RESPONSE_INVALID",
      },
      {
        status: "incomplete",
        sourceCompleteness: "partial",
        publishedRecordCount: null,
        reasonCode: "A_PLUS_RESPONSE_INVALID",
      },
    ]);
  });

  it("stops a repeated page token without leaking it or treating the partial result as missing", async () => {
    let calls = 0;
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-snapshot-005",
      rows: [{ sellerSku: "TOKEN-LOOP", asin: "B000000008", title: "Token loop" }],
      fetchPublishRecords: async () => {
        calls += 1;
        return {
          status: 200,
          payload: {
            publishRecordList: [],
            nextPageToken: "same-opaque-token",
          },
        };
      },
    });

    expect(calls).toBe(2);
    expect(snapshot.rows[0]).toMatchObject({
      status: "incomplete",
      sourceCompleteness: "partial",
      publishedRecordCount: null,
      reasonCode: "A_PLUS_PAGINATION_INCOMPLETE",
    });
    expect(JSON.stringify(snapshot)).not.toContain("same-opaque-token");
  });

  it("does not request A+ for a missing or malformed FBA ASIN", async () => {
    let calls = 0;
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-snapshot-006",
      rows: [
        { sellerSku: "NO-ASIN", asin: null, title: "No ASIN" },
        { sellerSku: "BAD-ASIN", asin: "not-an-asin", title: "Malformed ASIN" },
      ],
      fetchPublishRecords: async () => {
        calls += 1;
        return { status: 200, payload: { publishRecordList: [] } };
      },
    });

    expect(calls).toBe(0);
    expect(snapshot.rows).toMatchObject([
      {
        sellerSku: "NO-ASIN",
        asin: null,
        status: "incomplete",
        reasonCode: "FBA_IDENTITY_INCOMPLETE",
      },
      {
        sellerSku: "BAD-ASIN",
        asin: null,
        status: "incomplete",
        reasonCode: "FBA_IDENTITY_INCOMPLETE",
      },
    ]);
    expect(snapshot.summary.uniqueAsins).toBe(0);
  });

  it("rejects duplicate or unsafe FBA Seller SKU identity instead of merging rows", async () => {
    const base = {
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-snapshot-007",
      fetchPublishRecords: async () => ({
        status: 200,
        payload: { publishRecordList: [] },
      }),
    } as const;

    await expect(runAplusAudit({
      ...base,
      rows: [
        { sellerSku: "DUPLICATE", asin: "B000000009", title: "One" },
        { sellerSku: "DUPLICATE", asin: "B000000010", title: "Two" },
      ],
    })).rejects.toThrow(/重複 Seller SKU/u);
    await expect(runAplusAudit({
      ...base,
      rows: [{ sellerSku: " UNSAFE ", asin: "B000000009", title: "Unsafe" }],
    })).rejects.toThrow(/Seller SKU/u);
  });

  it("short-circuits an explicit A+ access denial across the remaining ASINs", async () => {
    const calls: string[] = [];
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-snapshot-008",
      rows: [
        { sellerSku: "DENIED-ONE", asin: "B000000011", title: "Denied one" },
        { sellerSku: "DENIED-TWO", asin: "B000000012", title: "Denied two" },
      ],
      fetchPublishRecords: async ({ asin }) => {
        calls.push(asin);
        return { status: 403, payload: null, requestId: "safe-request-id" };
      },
    });

    expect(calls).toEqual(["B000000011"]);
    expect(snapshot.rows.map((row) => ({
      status: row.status,
      reasonCode: row.reasonCode,
    }))).toEqual([
      { status: "unavailable", reasonCode: "A_PLUS_ACCESS_UNAVAILABLE" },
      { status: "unavailable", reasonCode: "A_PLUS_ACCESS_UNAVAILABLE" },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("safe-request-id");
  });

  it("isolates a thrown read failure and continues the remaining unique ASINs", async () => {
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-snapshot-009",
      rows: [
        { sellerSku: "NETWORK-FAIL", asin: "B000000013", title: "Network fail" },
        { sellerSku: "STILL-READ", asin: "B000000014", title: "Still read" },
      ],
      fetchPublishRecords: async ({ asin }) => {
        if (asin === "B000000013") throw new Error("raw upstream detail");
        return { status: 200, payload: { publishRecordList: [] } };
      },
    });

    expect(snapshot.rows.map((row) => ({
      status: row.status,
      reasonCode: row.reasonCode,
    }))).toEqual([
      { status: "incomplete", reasonCode: "A_PLUS_READ_FAILED" },
      { status: "missing", reasonCode: "NO_PUBLISHED_RECORD" },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("raw upstream detail");
  });

  it("deduplicates the same publish record across pages without losing distinct evidence", async () => {
    const repeated = {
      marketplaceId: MARKETPLACE_ID,
      asin: "B000000015",
      contentReferenceKey: "same-reference",
      contentType: "EBC",
      contentSubType: "opaque-subtype",
      locale: "en-US",
    } as const;
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-snapshot-010",
      rows: [{ sellerSku: "DUPLICATE-RECORD", asin: repeated.asin, title: "Duplicate record" }],
      fetchPublishRecords: async ({ pageToken }) => pageToken === undefined
        ? {
            status: 200,
            payload: {
              publishRecordList: [repeated],
              nextPageToken: "page-two",
            },
          }
        : {
            status: 200,
            payload: {
              publishRecordList: [
                repeated,
                {
                  ...repeated,
                  contentReferenceKey: "second-reference",
                  contentType: "EMC",
                  locale: "fr-CA",
                },
              ],
            },
          },
    });

    expect(snapshot.rows[0]).toMatchObject({
      status: "published",
      sourceCompleteness: "complete",
      publishedRecordCount: 2,
      contentTypes: ["EBC", "EMC"],
      locales: ["en-US", "fr-CA"],
    });
    expect(JSON.stringify(snapshot)).not.toContain("same-reference");
  });

  it("keeps accumulated publish-record evidence inside the public DTO bound", async () => {
    const asin = "B000000024";
    const records = (start: number, length: number) => Array.from(
      { length },
      (_, offset) => ({
        marketplaceId: MARKETPLACE_ID,
        asin,
        contentReferenceKey: `bounded-reference-${start + offset}`,
        contentType: "EBC" as const,
        locale: "en-US",
      }),
    );
    let calls = 0;
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-snapshot-record-bound",
      rows: [{ sellerSku: "RECORD-BOUND", asin, title: "Record bound" }],
      fetchPublishRecords: async ({ pageToken }) => {
        calls += 1;
        if (pageToken === undefined) {
          return {
            status: 200,
            payload: {
              publishRecordList: records(0, 10_000),
              nextPageToken: "page-two",
            },
          };
        }
        if (pageToken === "page-two") {
          return {
            status: 200,
            payload: {
              publishRecordList: records(10_000, 10_000),
              nextPageToken: "page-three",
            },
          };
        }
        return {
          status: 200,
          payload: { publishRecordList: records(20_000, 5_001) },
        };
      },
    });

    expect(calls).toBe(3);
    expect(snapshot.rows[0]).toMatchObject({
      status: "published",
      sourceCompleteness: "partial",
      publishedRecordCount: null,
      contentTypes: ["EBC"],
      locales: ["en-US"],
      reasonCode: "PUBLISHED_RECORD_FOUND",
    });
    const { fbaSnapshotId: _internalSnapshotId, ...publicSnapshot } = snapshot;
    expect(() => parseAplusAuditSnapshot(publicSnapshot, MARKETPLACE_ID, "live"))
      .not.toThrow();
  });

  it("keeps distinct locale evidence inside the public DTO bound", async () => {
    const asin = "B000000025";
    const locales = Array.from({ length: 101 }, (_, index) => {
      const first = String.fromCharCode(97 + Math.floor(index / 26));
      const second = String.fromCharCode(97 + (index % 26));
      return `${first}${second}-US`;
    });
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-snapshot-locale-bound",
      rows: [{ sellerSku: "LOCALE-BOUND", asin, title: "Locale bound" }],
      fetchPublishRecords: async () => ({
        status: 200,
        payload: {
          publishRecordList: locales.map((locale, index) => ({
            marketplaceId: MARKETPLACE_ID,
            asin,
            contentReferenceKey: `locale-reference-${index}`,
            contentType: "EBC",
            locale,
          })),
        },
      }),
    });

    expect(snapshot.rows[0]).toMatchObject({
      status: "published",
      sourceCompleteness: "partial",
      publishedRecordCount: null,
      contentTypes: ["EBC"],
      reasonCode: "PUBLISHED_RECORD_FOUND",
    });
    expect(snapshot.rows[0]!.locales).toHaveLength(100);
    expect(snapshot.rows[0]!.locales).not.toContain(locales[100]);
    const { fbaSnapshotId: _internalSnapshotId, ...publicSnapshot } = snapshot;
    expect(() => parseAplusAuditSnapshot(publicSnapshot, MARKETPLACE_ID, "live"))
      .not.toThrow();
  });

  it("keeps an exact published record when a later page becomes invalid", async () => {
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-snapshot-011",
      rows: [{ sellerSku: "POSITIVE-THEN-FAIL", asin: "B000000016", title: "Positive then fail" }],
      fetchPublishRecords: async ({ pageToken }) => pageToken === undefined
        ? {
            status: 200,
            payload: {
              publishRecordList: [{
                marketplaceId: MARKETPLACE_ID,
                asin: "B000000016",
                contentReferenceKey: "positive-before-failure",
                contentType: "EBC",
                locale: "en-US",
              }],
              nextPageToken: "broken-page",
            },
          }
        : { status: 200, payload: { publishRecordList: "not-an-array" } },
    });

    expect(snapshot.rows[0]).toMatchObject({
      status: "published",
      sourceCompleteness: "partial",
      publishedRecordCount: null,
      contentTypes: ["EBC"],
      locales: ["en-US"],
      reasonCode: "PUBLISHED_RECORD_FOUND",
    });
  });

  it("reports identity-free progress after each unique ASIN settles without changing audit truth", async () => {
    const progress: Array<{ completedAsins: number; totalAsins: number }> = [];
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-snapshot-012",
      rows: [
        { sellerSku: "PROGRESS-ONE", asin: "B000000017", title: "Progress one" },
        { sellerSku: "PROGRESS-ONE-ALIAS", asin: "B000000017", title: "Progress alias" },
        { sellerSku: "PROGRESS-TWO", asin: "B000000018", title: "Progress two" },
      ],
      fetchPublishRecords: async () => ({
        status: 200,
        payload: { publishRecordList: [] },
      }),
      onProgress: async (update) => {
        progress.push(update);
        if (update.completedAsins === 1) throw new Error("observer failed");
      },
    });

    expect(progress).toEqual([
      { completedAsins: 1, totalAsins: 2 },
      { completedAsins: 2, totalAsins: 2 },
    ]);
    expect(Object.keys(progress[0]!)).toEqual(["completedAsins", "totalAsins"]);
    expect(snapshot.summary).toMatchObject({
      eligibleFbaSkus: 3,
      uniqueAsins: 2,
      missing: 3,
    });
    expect(snapshot.mode).toBe("live");
  });

  it("rejects an oversized publish-record page instead of trusting truncated or abusive evidence", async () => {
    const record = {
      marketplaceId: MARKETPLACE_ID,
      asin: "B000000019",
      contentReferenceKey: "bounded-reference",
      contentType: "EBC",
      locale: "en-US",
    } as const;
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-snapshot-013",
      rows: [{ sellerSku: "OVERSIZED", asin: record.asin, title: "Oversized page" }],
      fetchPublishRecords: async () => ({
        status: 200,
        payload: { publishRecordList: Array.from({ length: 10_001 }, () => record) },
      }),
    });

    expect(snapshot.rows[0]).toMatchObject({
      status: "incomplete",
      sourceCompleteness: "partial",
      publishedRecordCount: null,
      reasonCode: "A_PLUS_RESPONSE_INVALID",
    });
  });

  it("accepts only the official A+ LanguageTag pattern", async () => {
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-snapshot-language-tag",
      rows: [{ sellerSku: "BAD-LANGUAGE-TAG", asin: "B000000020", title: "Bad language tag" }],
      fetchPublishRecords: async () => ({
        status: 200,
        payload: {
          publishRecordList: [{
            marketplaceId: MARKETPLACE_ID,
            asin: "B000000020",
            contentReferenceKey: "invalid-language-tag",
            contentType: "EBC",
            locale: "EN-us-extra",
          }],
        },
      }),
    });

    expect(snapshot.rows[0]).toMatchObject({
      status: "incomplete",
      sourceCompleteness: "partial",
      publishedRecordCount: null,
      reasonCode: "A_PLUS_RESPONSE_INVALID",
    });
  });

  it("stops the lifecycle immediately when the main-owned job signal is aborted", async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    const audit = runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-snapshot-014",
      rows: [
        { sellerSku: "ABORT-ONE", asin: "B000000020", title: "Abort one" },
        { sellerSku: "ABORT-TWO", asin: "B000000021", title: "Abort two" },
      ],
      signal: controller.signal,
      fetchPublishRecords: async ({ asin }) => {
        calls.push(asin);
        controller.abort();
        throw new DOMException("upstream abort detail", "AbortError");
      },
    });

    await expect(audit).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toEqual(["B000000020"]);
  });

  it("propagates a gateway AbortError used for an account or mode fence", async () => {
    const calls: string[] = [];
    const audit = runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-snapshot-015",
      rows: [
        { sellerSku: "FENCE-ONE", asin: "B000000022", title: "Fence one" },
        { sellerSku: "FENCE-TWO", asin: "B000000023", title: "Fence two" },
      ],
      fetchPublishRecords: async ({ asin }) => {
        calls.push(asin);
        throw new DOMException("context changed", "AbortError");
      },
    });

    await expect(audit).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toEqual(["B000000022"]);
  });
});
