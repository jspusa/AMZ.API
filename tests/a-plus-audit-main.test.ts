import { describe, expect, it } from "vitest";
import {
  buildAplusAuditSeedsFromFbaGrouping,
  runAplusAudit,
  type AplusContentDocumentRelationFetchInput,
  type AplusPublishRecordFetchInput,
} from "../src/main/amazon/a-plus-audit";
import { parseAplusAuditSnapshot } from "../src/renderer/src/a-plus-audit";

const MARKETPLACE_ID = "ATVPDKIKX0DER";

describe("A+ FBA audit core", () => {
  it("uses exact document relations for relationship-incomplete FBA ASINs without direct publish queries", async () => {
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
      {
        sellerSku: "UNKNOWN-WITHOUT-RELATION",
        asin: "B000000105",
        title: "Relationship unavailable without A plus relation",
        role: "unknown",
        status: "incomplete",
      },
    ]);
    const calls: string[] = [];
    const progress: Array<{ completedAsins: number; totalAsins: number }> = [];
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "strict-fba-snapshot",
      rows: seeds,
      fetchContentDocuments: async () => ({
        status: 200,
        payload: {
          contentMetadataRecords: [{
            contentReferenceKey: "relationship-incomplete-reference",
            contentMetadata: {
              name: "Relationship incomplete product detail",
              marketplaceId: MARKETPLACE_ID,
              status: "APPROVED",
              badgeSet: ["STANDARD"],
              updateTime: "2026-08-22T07:00:00Z",
            },
          }],
        },
      }),
      fetchContentDocumentAsinRelations: async () => ({
        status: 200,
        payload: {
          asinMetadataSet: [{
            asin: "B000000104",
            badgeSet: ["CONTENT_PUBLISHED"],
            contentReferenceKeySet: ["relationship-incomplete-reference"],
          }],
        },
      }),
      fetchPublishRecords: async ({ asin }) => {
        calls.push(asin);
        return { status: 200, payload: { publishRecordList: [] } };
      },
      onProgress: (value) => {
        progress.push({ ...value });
      },
    });

    expect(calls).toEqual(["B000000101", "B000000102"]);
    expect(progress).toEqual([
      { completedAsins: 1, totalAsins: 4 },
      { completedAsins: 2, totalAsins: 4 },
      { completedAsins: 4, totalAsins: 4 },
    ]);
    expect(snapshot.rows).toMatchObject([
      { sellerSku: "CHILD-SKU", asin: "B000000101", status: "missing" },
      { sellerSku: "STANDALONE-SKU", asin: "B000000102", status: "missing" },
      {
        sellerSku: "UNKNOWN-RELATIONSHIP",
        asin: "B000000104",
        status: "published",
        reasonCode: "PUBLISHED_DOCUMENT_RELATION_FOUND",
        documents: [{
          name: "Relationship incomplete product detail",
          relationState: "published",
          evidence: "relation_badge",
        }],
      },
      {
        sellerSku: "UNKNOWN-WITHOUT-RELATION",
        asin: "B000000105",
        status: "incomplete",
        reasonCode: "FBA_RELATIONSHIP_INCOMPLETE",
      },
    ]);
    expect(snapshot.summary.uniqueAsins).toBe(4);
    expect(snapshot.rows.some(({ sellerSku }) => sellerSku === "PARENT-SKU")).toBe(false);
    const { fbaSnapshotId: _fbaSnapshotId, ...publicSnapshot } = snapshot;
    expect(() => parseAplusAuditSnapshot(
      publicSnapshot,
      MARKETPLACE_ID,
      "live",
    )).not.toThrow();
  });

  it("keeps direct and relationship-conservative evidence distinct for Seller SKUs sharing an ASIN", async () => {
    const calls: string[] = [];
    const seeds = buildAplusAuditSeedsFromFbaGrouping([
      {
        sellerSku: "DIRECT-CHILD",
        asin: "B000000106",
        title: "Direct child",
        role: "child",
        status: "complete",
      },
      {
        sellerSku: "CONSERVATIVE-UNKNOWN",
        asin: "B000000106",
        title: "Conservative unknown",
        role: "unknown",
        status: "incomplete",
      },
    ]);
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "mixed-direct-conservative-evidence",
      rows: seeds,
      fetchPublishRecords: async ({ asin }) => {
        calls.push(asin);
        return {
          status: 200,
          payload: {
            publishRecordList: [{
              marketplaceId: MARKETPLACE_ID,
              asin,
              contentReferenceKey: "mixed-evidence-reference",
              contentType: "EBC",
              locale: "en-US",
            }],
          },
        };
      },
      fetchContentDocuments: async () => ({
        status: 200,
        payload: {
          contentMetadataRecords: [{
            contentReferenceKey: "mixed-evidence-reference",
            contentMetadata: {
              name: "Mixed evidence product detail",
              marketplaceId: MARKETPLACE_ID,
              status: "APPROVED",
              badgeSet: ["STANDARD"],
              updateTime: "2026-08-22T08:00:00Z",
            },
          }],
        },
      }),
      fetchContentDocumentAsinRelations: async () => ({
        status: 200,
        payload: {
          asinMetadataSet: [{
            asin: "B000000106",
            badgeSet: ["CONTENT_PUBLISHED"],
            contentReferenceKeySet: ["mixed-evidence-reference"],
          }],
        },
      }),
    });

    expect(calls).toEqual(["B000000106"]);
    expect(snapshot.rows).toMatchObject([
      {
        sellerSku: "DIRECT-CHILD",
        status: "published",
        reasonCode: "PUBLISHED_RECORD_FOUND",
        documents: [{ evidence: "publish_record", relationState: "published" }],
      },
      {
        sellerSku: "CONSERVATIVE-UNKNOWN",
        status: "published",
        reasonCode: "PUBLISHED_DOCUMENT_RELATION_FOUND",
        documents: [{ evidence: "relation_badge", relationState: "published" }],
      },
    ]);
    const { fbaSnapshotId: _fbaSnapshotId, ...publicSnapshot } = snapshot;
    expect(() => parseAplusAuditSnapshot(
      publicSnapshot,
      MARKETPLACE_ID,
      "live",
    )).not.toThrow();
  });

  it("joins official Content Manager documents to publish records without exposing reference keys", async () => {
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-document-index-001",
      rows: [{ sellerSku: "DOCUMENT-NAME", asin: "B000000201", title: "Document name" }],
      fetchContentDocuments: async () => ({
        status: 200,
        payload: {
          contentMetadataRecords: [{
            contentReferenceKey: "private-reference-one",
            contentMetadata: {
              name: "Buffalo Treats Brand Story",
              marketplaceId: MARKETPLACE_ID,
              status: "APPROVED",
              badgeSet: ["STANDARD"],
              updateTime: "2026-08-22T09:00:00Z",
            },
          }],
        },
      }),
      fetchContentDocumentAsinRelations: async () => ({
        status: 200,
        payload: {
          asinMetadataSet: [{
            asin: "B000000201",
            badgeSet: ["CONTENT_PUBLISHED"],
            contentReferenceKeySet: ["private-reference-one"],
          }],
        },
      }),
      fetchPublishRecords: async () => ({
        status: 200,
        payload: {
          publishRecordList: [{
            marketplaceId: MARKETPLACE_ID,
            asin: "B000000201",
            contentReferenceKey: "private-reference-one",
            contentType: "EBC",
            locale: "en-US",
          }],
        },
      }),
    } as never);

    expect(snapshot.rows[0]).toMatchObject({
      status: "published",
      documentEvidenceCompleteness: "complete",
      documents: [{
        name: "Buffalo Treats Brand Story",
        documentStatus: "APPROVED",
        badges: ["STANDARD"],
        relationState: "published",
        evidence: "publish_record",
        completeness: "complete",
      }],
    });
    expect(JSON.stringify(snapshot)).not.toContain("private-reference-one");
  });

  it("uses an exact CONTENT_PUBLISHED relation as positive evidence when publish records fail", async () => {
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-document-index-002",
      rows: [{ sellerSku: "RELATION-PUBLISHED", asin: "B000000202", title: "Relation published" }],
      fetchContentDocuments: async () => ({
        status: 200,
        payload: {
          contentMetadataRecords: [{
            contentReferenceKey: "private-reference-two",
            contentMetadata: {
              name: "Premium Product Detail",
              marketplaceId: MARKETPLACE_ID,
              status: "APPROVED",
              badgeSet: ["PREMIUM"],
              updateTime: "2026-08-22T10:00:00Z",
            },
          }],
        },
      }),
      fetchContentDocumentAsinRelations: async () => ({
        status: 200,
        payload: {
          asinMetadataSet: [{
            asin: "B000000202",
            badgeSet: ["CONTENT_PUBLISHED"],
            contentReferenceKeySet: ["private-reference-two"],
          }],
        },
      }),
      fetchPublishRecords: async () => ({ status: 500, payload: null }),
    } as never);

    expect(snapshot.rows[0]).toMatchObject({
      status: "published",
      sourceCompleteness: "partial",
      publishedRecordCount: null,
      reasonCode: "PUBLISHED_DOCUMENT_RELATION_FOUND",
      documentEvidenceCompleteness: "complete",
      documents: [{
        name: "Premium Product Detail",
        relationState: "published",
        evidence: "relation_badge",
      }],
    });
  });

  it("keeps an exact published relation when a duplicate schema-valid row only has contextual brand badges", async () => {
    let relationCalls = 0;
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-document-index-live-duplicate-relation",
      rows: [{
        sellerSku: "LIVE-DUPLICATE-RELATION",
        asin: "B0G11WRYBF",
        title: "Live duplicate relation shape",
        incompleteReasonCode: "FBA_RELATIONSHIP_INCOMPLETE",
      }],
      fetchContentDocuments: async () => ({
        status: 200,
        payload: {
          contentMetadataRecords: [{
            contentReferenceKey: "live-duplicate-relation-reference",
            contentMetadata: {
              name: "Live product detail",
              marketplaceId: MARKETPLACE_ID,
              status: "APPROVED",
              badgeSet: ["STANDARD"],
              updateTime: "2026-08-22T10:00:00Z",
            },
          }],
        },
      }),
      fetchContentDocumentAsinRelations: async () => {
        relationCalls += 1;
        return {
          status: 200,
          payload: {
            asinMetadataSet: [
              {
                asin: "B0G11WRYBF",
                badgeSet: ["CONTENT_PUBLISHED"],
                contentReferenceKeySet: ["live-duplicate-relation-reference"],
              },
              {
                asin: "B0G11WRYBF",
                badgeSet: ["BRAND_NOT_ELIGIBLE"],
                contentReferenceKeySet: ["another-contextual-reference"],
              },
            ],
          },
        };
      },
      fetchPublishRecords: async () => {
        throw new Error("Relationship-incomplete rows must not issue a publish-record request.");
      },
    });

    expect(relationCalls).toBe(1);
    expect(snapshot.rows[0]).toMatchObject({
      status: "published",
      sourceCompleteness: "partial",
      publishedRecordCount: null,
      reasonCode: "PUBLISHED_DOCUMENT_RELATION_FOUND",
      documents: [{
        name: "Live product detail",
        relationState: "published",
        evidence: "relation_badge",
        completeness: "partial",
      }],
      documentEvidenceCompleteness: "partial",
    });
  });

  it("deduplicates repeated document keys without dropping relation traversal when display metadata changes", async () => {
    const relationKeys: string[] = [];
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-document-index-live-duplicate-document",
      rows: [{ sellerSku: "LIVE-DUPLICATE-DOCUMENT", asin: "B0HCV7MHZ4", title: "Live duplicate document" }],
      fetchPublishRecords: async () => ({
        status: 200,
        payload: { publishRecordList: [] },
      }),
      fetchContentDocuments: async () => ({
        status: 200,
        payload: {
          contentMetadataRecords: [
            {
              contentReferenceKey: "live-duplicate-document-reference",
              contentMetadata: {
                name: "Older product detail name",
                marketplaceId: MARKETPLACE_ID,
                status: "SUBMITTED",
                badgeSet: ["STANDARD"],
                updateTime: "2026-08-21T10:00:00Z",
              },
            },
            {
              contentReferenceKey: "live-duplicate-document-reference",
              contentMetadata: {
                name: "Current product detail name",
                marketplaceId: MARKETPLACE_ID,
                status: "APPROVED",
                badgeSet: ["STANDARD"],
                updateTime: "2026-08-22T10:00:00Z",
              },
            },
          ],
        },
      }),
      fetchContentDocumentAsinRelations: async ({ contentReferenceKey }) => {
        relationKeys.push(contentReferenceKey);
        return {
          status: 200,
          payload: {
            asinMetadataSet: [{
              asin: "B0HCV7MHZ4",
              badgeSet: ["CONTENT_PUBLISHED"],
              contentReferenceKeySet: [contentReferenceKey],
            }],
          },
        };
      },
    });

    expect(relationKeys).toEqual(["live-duplicate-document-reference"]);
    expect(snapshot.rows[0]).toMatchObject({
      status: "published",
      reasonCode: "PUBLISHED_DOCUMENT_RELATION_FOUND",
      documents: [{
        name: "Current product detail name",
        documentStatus: "APPROVED",
        relationState: "published",
        evidence: "relation_badge",
        completeness: "partial",
      }],
      documentEvidenceCompleteness: "partial",
    });
  });

  it("does not let a malformed exact non-target relation invalidate complete target coverage", async () => {
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-document-index-non-target-malformed",
      rows: [{ sellerSku: "TARGET-COMPLETE", asin: "B000000212", title: "Target complete" }],
      fetchPublishRecords: async () => ({
        status: 200,
        payload: { publishRecordList: [] },
      }),
      fetchContentDocuments: async () => ({
        status: 200,
        payload: {
          contentMetadataRecords: [{
            contentReferenceKey: "non-target-malformed-reference",
            contentMetadata: {
              name: "Unrelated product detail",
              marketplaceId: MARKETPLACE_ID,
              status: "APPROVED",
              badgeSet: ["STANDARD"],
              updateTime: "2026-08-22T10:00:00Z",
            },
          }],
        },
      }),
      fetchContentDocumentAsinRelations: async () => ({
        status: 200,
        payload: {
          asinMetadataSet: [{
            asin: "B000000999",
            badgeSet: ["NOT_AN_AMAZON_BADGE"],
          }],
        },
      }),
    });

    expect(snapshot.rows[0]).toMatchObject({
      status: "missing",
      sourceCompleteness: "complete",
      publishedRecordCount: 0,
      reasonCode: "NO_PUBLISHED_RECORD",
      documentEvidenceCompleteness: "complete",
    });
  });

  it("keeps every target negative partial when a malformed relation has no exact ASIN identity", async () => {
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-document-index-unknown-malformed-asin",
      rows: [{ sellerSku: "TARGET-UNKNOWN-COVERAGE", asin: "B000000213", title: "Unknown coverage" }],
      fetchPublishRecords: async () => ({
        status: 200,
        payload: { publishRecordList: [] },
      }),
      fetchContentDocuments: async () => ({
        status: 200,
        payload: {
          contentMetadataRecords: [{
            contentReferenceKey: "unknown-malformed-asin-reference",
            contentMetadata: {
              name: "Unknown ASIN relation",
              marketplaceId: MARKETPLACE_ID,
              status: "APPROVED",
              badgeSet: ["STANDARD"],
              updateTime: "2026-08-22T10:00:00Z",
            },
          }],
        },
      }),
      fetchContentDocumentAsinRelations: async () => ({
        status: 200,
        payload: {
          asinMetadataSet: [{
            asin: null,
            badgeSet: ["CONTENT_PUBLISHED"],
          }],
        },
      }),
    });

    expect(snapshot.rows[0]).toMatchObject({
      status: "incomplete",
      sourceCompleteness: "partial",
      publishedRecordCount: null,
      reasonCode: "A_PLUS_READ_FAILED",
      documentEvidenceCompleteness: "partial",
    });
  });

  it("does not call an empty publish-record result missing when a later document relation read fails", async () => {
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-document-relation-partial",
      rows: [{
        sellerSku: "RELATION-PAGE-FAILED",
        asin: "B000000208",
        title: "Relation page failed",
      }],
      fetchPublishRecords: async () => ({
        status: 200,
        payload: { publishRecordList: [] },
      }),
      fetchContentDocuments: async () => ({
        status: 200,
        payload: {
          contentMetadataRecords: [
            {
              contentReferenceKey: "first-empty-relation",
              contentMetadata: {
                name: "First empty relation",
                marketplaceId: MARKETPLACE_ID,
                status: "APPROVED",
                badgeSet: ["STANDARD"],
                updateTime: "2026-08-22T15:00:00Z",
              },
            },
            {
              contentReferenceKey: "second-failed-relation",
              contentMetadata: {
                name: "Second failed relation",
                marketplaceId: MARKETPLACE_ID,
                status: "APPROVED",
                badgeSet: ["STANDARD"],
                updateTime: "2026-08-22T15:01:00Z",
              },
            },
          ],
        },
      }),
      fetchContentDocumentAsinRelations: async ({ contentReferenceKey }) =>
        contentReferenceKey === "first-empty-relation"
          ? { status: 200, payload: { asinMetadataSet: [] } }
          : { status: 500, payload: null },
    });

    expect(snapshot.rows[0]).toMatchObject({
      status: "incomplete",
      sourceCompleteness: "partial",
      publishedRecordCount: null,
      reasonCode: "A_PLUS_READ_FAILED",
      documents: [],
      documentEvidenceCompleteness: "partial",
    });
    expect(snapshot.summary).toMatchObject({ published: 0, missing: 0, incomplete: 1 });
  });

  it("fails closed when content-document pagination stops before coverage completes", async () => {
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-document-pagination-partial",
      rows: [{
        sellerSku: "DOCUMENT-PAGE-FAILED",
        asin: "B000000209",
        title: "Document page failed",
      }],
      fetchPublishRecords: async () => ({
        status: 200,
        payload: { publishRecordList: [] },
      }),
      fetchContentDocuments: async ({ pageToken }) => pageToken
        ? { status: 500, payload: null }
        : {
            status: 200,
            payload: {
              contentMetadataRecords: [],
              nextPageToken: "document-page-two",
            },
          },
      fetchContentDocumentAsinRelations: async () => {
        throw new Error("No document relation should be requested without a document.");
      },
    });

    expect(snapshot.rows[0]).toMatchObject({
      status: "incomplete",
      sourceCompleteness: "partial",
      publishedRecordCount: null,
      reasonCode: "A_PLUS_READ_FAILED",
      documentEvidenceCompleteness: "partial",
    });
  });

  it("requires document-relation coverage for a negative result but preserves an exact publish positive", async () => {
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-document-index-unavailable",
      rows: [
        { sellerSku: "EMPTY-WITHOUT-INDEX", asin: "B000000210", title: "Empty" },
        { sellerSku: "POSITIVE-WITHOUT-INDEX", asin: "B000000211", title: "Positive" },
      ],
      fetchPublishRecords: async ({ asin }) => ({
        status: 200,
        payload: {
          publishRecordList: asin === "B000000211"
            ? [{
                marketplaceId: MARKETPLACE_ID,
                asin,
                contentReferenceKey: "exact-positive-without-index",
                contentType: "EBC",
                locale: "en-US",
              }]
            : [],
        },
      }),
    });

    expect(snapshot.rows).toMatchObject([
      {
        sellerSku: "EMPTY-WITHOUT-INDEX",
        status: "incomplete",
        reasonCode: "A_PLUS_READ_FAILED",
        documentEvidenceCompleteness: "unavailable",
      },
      {
        sellerSku: "POSITIVE-WITHOUT-INDEX",
        status: "published",
        reasonCode: "PUBLISHED_RECORD_FOUND",
        publishedRecordCount: 1,
        documents: [{ evidence: "publish_record", completeness: "partial" }],
        documentEvidenceCompleteness: "unavailable",
      },
    ]);
    expect(snapshot.summary).toMatchObject({ published: 1, missing: 0, incomplete: 1 });
  });

  it("shows non-published document associations without promoting them to published", async () => {
    const documents = [
      {
        contentReferenceKey: "not-published-reference",
        contentMetadata: {
          name: "Draft product detail",
          marketplaceId: MARKETPLACE_ID,
          status: "DRAFT",
          badgeSet: ["STANDARD"],
          updateTime: "2026-08-22T11:00:00Z",
        },
      },
      {
        contentReferenceKey: "related-reference",
        contentMetadata: {
          name: "Submitted brand story",
          marketplaceId: MARKETPLACE_ID,
          status: "SUBMITTED",
          badgeSet: ["STANDARD"],
          updateTime: "2026-08-22T12:00:00Z",
        },
      },
    ];
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-document-index-non-published",
      rows: [
        { sellerSku: "NOT-PUBLISHED", asin: "B000000203", title: "Not published" },
        { sellerSku: "RELATED-ONLY", asin: "B000000204", title: "Related only" },
      ],
      fetchContentDocuments: async () => ({
        status: 200,
        payload: { contentMetadataRecords: documents },
      }),
      fetchContentDocumentAsinRelations: async (
        { contentReferenceKey }: AplusContentDocumentRelationFetchInput,
      ) => ({
        status: 200,
        payload: {
          asinMetadataSet: contentReferenceKey === "not-published-reference"
            ? [{
                asin: "B000000203",
                badgeSet: ["CONTENT_NOT_PUBLISHED"],
                contentReferenceKeySet: [contentReferenceKey],
              }]
            : [{
                asin: "B000000204",
                badgeSet: [],
                contentReferenceKeySet: [contentReferenceKey],
              }],
        },
      }),
      fetchPublishRecords: async () => ({
        status: 200,
        payload: { publishRecordList: [] },
      }),
    } as never);

    expect(snapshot.rows).toMatchObject([
      {
        sellerSku: "NOT-PUBLISHED",
        status: "missing",
        sourceCompleteness: "complete",
        reasonCode: "NO_PUBLISHED_RECORD",
        documentEvidenceCompleteness: "complete",
        documents: [{
          name: "Draft product detail",
          documentStatus: "DRAFT",
          relationState: "not_published",
          evidence: "relation_only",
          completeness: "complete",
        }],
      },
      {
        sellerSku: "RELATED-ONLY",
        status: "missing",
        sourceCompleteness: "complete",
        reasonCode: "NO_PUBLISHED_RECORD",
        documentEvidenceCompleteness: "complete",
        documents: [{
          name: "Submitted brand story",
          documentStatus: "SUBMITTED",
          relationState: "related",
          evidence: "relation_only",
          completeness: "complete",
        }],
      },
    ]);
    expect(snapshot.summary).toMatchObject({ published: 0, missing: 2, incomplete: 0 });
  });

  it("fails closed when one A+ relation claims both published and not published", async () => {
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-document-index-conflict",
      rows: [{ sellerSku: "RELATION-CONFLICT", asin: "B000000205", title: "Conflict" }],
      fetchContentDocuments: async () => ({
        status: 200,
        payload: {
          contentMetadataRecords: [{
            contentReferenceKey: "conflicting-reference",
            contentMetadata: {
              name: "Conflicting content",
              marketplaceId: MARKETPLACE_ID,
              status: "APPROVED",
              badgeSet: ["STANDARD"],
              updateTime: "2026-08-22T13:00:00Z",
            },
          }],
        },
      }),
      fetchContentDocumentAsinRelations: async () => ({
        status: 200,
        payload: {
          asinMetadataSet: [{
            asin: "B000000205",
            badgeSet: ["CONTENT_PUBLISHED", "CONTENT_NOT_PUBLISHED"],
            contentReferenceKeySet: ["conflicting-reference"],
          }],
        },
      }),
      fetchPublishRecords: async () => ({
        status: 200,
        payload: { publishRecordList: [] },
      }),
    } as never);

    expect(snapshot.rows[0]).toMatchObject({
      status: "incomplete",
      sourceCompleteness: "partial",
      publishedRecordCount: null,
      reasonCode: "A_PLUS_RESPONSE_INVALID",
      documents: [],
      documentEvidenceCompleteness: "partial",
    });
    expect(snapshot.summary).toMatchObject({ published: 0, missing: 0, incomplete: 1 });
  });

  it("drops duplicate relation positives after a malformed conflict but preserves an exact publish record", async () => {
    const snapshot = await runAplusAudit({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "fba-document-index-duplicate-conflict",
      rows: [
        {
          sellerSku: "RELATION-ONLY-CONFLICT",
          asin: "B000000206",
          title: "Relation only conflict",
        },
        {
          sellerSku: "EXACT-PUBLISH-CONFLICT",
          asin: "B000000207",
          title: "Exact publish conflict",
        },
      ],
      fetchContentDocuments: async () => ({
        status: 200,
        payload: {
          contentMetadataRecords: [{
            contentReferenceKey: "duplicate-conflicting-reference",
            contentMetadata: {
              name: "Duplicate conflicting content",
              marketplaceId: MARKETPLACE_ID,
              status: "APPROVED",
              badgeSet: ["STANDARD"],
              updateTime: "2026-08-22T14:00:00Z",
            },
          }],
        },
      }),
      fetchContentDocumentAsinRelations: async () => ({
        status: 200,
        payload: {
          asinMetadataSet: [
            {
              asin: "B000000206",
              badgeSet: ["CONTENT_PUBLISHED"],
              contentReferenceKeySet: ["duplicate-conflicting-reference"],
            },
            {
              asin: "B000000206",
              badgeSet: ["CONTENT_PUBLISHED"],
              contentReferenceKeySet: ["duplicate-conflicting-reference"],
            },
            {
              asin: "B000000206",
              badgeSet: ["CONTENT_PUBLISHED", "CONTENT_NOT_PUBLISHED"],
              contentReferenceKeySet: ["duplicate-conflicting-reference"],
            },
            {
              asin: "B000000207",
              badgeSet: ["CONTENT_PUBLISHED"],
              contentReferenceKeySet: ["duplicate-conflicting-reference"],
            },
            {
              asin: "B000000207",
              badgeSet: ["CONTENT_PUBLISHED", "CONTENT_NOT_PUBLISHED"],
              contentReferenceKeySet: ["duplicate-conflicting-reference"],
            },
          ],
        },
      }),
      fetchPublishRecords: async ({ asin }: AplusPublishRecordFetchInput) => ({
        status: 200,
        payload: {
          publishRecordList: asin === "B000000207"
            ? [{
                marketplaceId: MARKETPLACE_ID,
                asin,
                contentReferenceKey: "duplicate-conflicting-reference",
                contentType: "EBC",
                locale: "en-US",
              }]
            : [],
        },
      }),
    } as never);

    expect(snapshot.rows).toMatchObject([
      {
        sellerSku: "RELATION-ONLY-CONFLICT",
        status: "incomplete",
        sourceCompleteness: "partial",
        publishedRecordCount: null,
        reasonCode: "A_PLUS_RESPONSE_INVALID",
        documents: [],
        documentEvidenceCompleteness: "partial",
      },
      {
        sellerSku: "EXACT-PUBLISH-CONFLICT",
        status: "published",
        sourceCompleteness: "partial",
        publishedRecordCount: null,
        reasonCode: "PUBLISHED_RECORD_FOUND",
        documents: [{
          name: "Duplicate conflicting content",
          relationState: "published",
          evidence: "publish_record",
          completeness: "partial",
        }],
        documentEvidenceCompleteness: "partial",
      },
    ]);
    expect(snapshot.summary).toMatchObject({ published: 1, missing: 0, incomplete: 1 });
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
      fetchContentDocuments: async () => ({
        status: 200,
        payload: { contentMetadataRecords: [] },
      }),
      fetchContentDocumentAsinRelations: async () => ({
        status: 200,
        payload: { asinMetadataSet: [] },
      }),
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
      fetchContentDocuments: async () => ({
        status: 200,
        payload: { contentMetadataRecords: [] },
      }),
      fetchContentDocumentAsinRelations: async () => ({
        status: 200,
        payload: { asinMetadataSet: [] },
      }),
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
      fetchContentDocuments: async () => ({
        status: 200,
        payload: { contentMetadataRecords: [] },
      }),
      fetchContentDocumentAsinRelations: async () => ({
        status: 200,
        payload: { asinMetadataSet: [] },
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
