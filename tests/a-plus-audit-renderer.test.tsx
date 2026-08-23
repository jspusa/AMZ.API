import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  aplusAuditRowMatchesFilter,
  parseAplusAuditJobReceipt,
  parseAplusAuditJobTerminal,
  parseAplusAuditSnapshot,
} from "../src/renderer/src/a-plus-audit";
import AplusAuditPanel, {
  requestAplusAuditJob,
} from "../src/renderer/src/components/a-plus-audit-panel";
import AplusAuditDrawer from "../src/renderer/src/components/a-plus-audit-drawer";
import {
  openAplusManagerHandoff,
} from "../src/renderer/src/seller-central-handoff";

const MARKETPLACE_ID = "ATVPDKIKX0DER";

function payload(): Record<string, unknown> {
  return {
    mode: "live",
    marketplaceId: MARKETPLACE_ID,
    fetchedAt: "2026-08-23T08:00:00.000Z",
    rows: [
      {
        sellerSku: "PUBLISHED",
        asin: "B000000001",
        title: "Published A plus",
        marketplaceId: MARKETPLACE_ID,
        status: "published",
        sourceCompleteness: "complete",
        publishedRecordCount: 1,
        contentTypes: ["EBC"],
        locales: ["en-US"],
        documents: [],
        documentEvidenceCompleteness: "unavailable",
        reasonCode: "PUBLISHED_RECORD_FOUND",
        reason: "Amazon publish record 已證明目前 ASIN 有已發布 A+。",
      },
      {
        sellerSku: "MISSING",
        asin: "B000000002",
        title: "Missing A plus",
        marketplaceId: MARKETPLACE_ID,
        status: "missing",
        sourceCompleteness: "complete",
        publishedRecordCount: 0,
        contentTypes: [],
        locales: [],
        documents: [],
        documentEvidenceCompleteness: "unavailable",
        reasonCode: "NO_PUBLISHED_RECORD",
        reason: "Amazon 完整查詢沒有找到目前 ASIN 的已發布 A+。",
      },
      {
        sellerSku: "INCOMPLETE",
        asin: null,
        title: "Incomplete identity",
        marketplaceId: MARKETPLACE_ID,
        status: "incomplete",
        sourceCompleteness: "partial",
        publishedRecordCount: null,
        contentTypes: [],
        locales: [],
        documents: [],
        documentEvidenceCompleteness: "unavailable",
        reasonCode: "FBA_IDENTITY_INCOMPLETE",
        reason: "FBA 商品缺少可安全核對的 ASIN，未發出 A+ request。",
      },
    ],
    totals: {
      eligibleFbaSkus: 3,
      uniqueAsins: 2,
      published: 1,
      missing: 1,
      incomplete: 1,
      unavailable: 0,
    },
    summary: {
      eligibleFbaSkus: 3,
      uniqueAsins: 2,
      published: 1,
      missing: 1,
      incomplete: 1,
      unavailable: 0,
    },
    notice: "只讀取目前 FBA 商品的官方 A+ publish records；不會修改 Amazon 商品頁。",
  };
}

function documentEvidence(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: "Premium Pet Treat Detail Page",
    documentStatus: "APPROVED",
    badges: ["PREMIUM"],
    relationState: "published",
    evidence: "publish_record",
    completeness: "complete",
    ...overrides,
  };
}

describe("A+ FBA audit renderer", () => {
  it("does not send the new A+ destination to a legacy Pages-first Notebook Key", async () => {
    const destinations: string[] = [];
    const result = await openAplusManagerHandoff({
      version: async () => "0.1.25",
      platform: async () => "darwin",
      openExternal: async (destination) => {
        destinations.push(destination);
      },
    });

    expect(result).toBe("upgrade-required");
    expect(destinations).toEqual([]);
  });

  it("uses the fixed A+ destination only when the new desktop bridge is present", async () => {
    const destinations: string[] = [];
    const result = await openAplusManagerHandoff({
      version: async () => "0.1.26",
      platform: async () => "darwin",
      openExternal: async (destination) => {
        destinations.push(destination);
      },
      openSellerCentralInventory: async () => undefined,
    });

    expect(result).toBe("opened");
    expect(destinations).toEqual(["a-plus-content"]);
  });

  it("strictly parses a main-owned snapshot and preserves the public API boundary", () => {
    const snapshot = parseAplusAuditSnapshot(payload(), MARKETPLACE_ID, "live");

    expect(snapshot.summary).toEqual({
      eligibleFbaSkus: 3,
      uniqueAsins: 2,
      published: 1,
      missing: 1,
      incomplete: 1,
      unavailable: 0,
    });
    expect(snapshot.rows).toMatchObject([
      {
        sellerSku: "PUBLISHED",
        status: "published",
        publishedRecordCount: 1,
        contentTypes: ["EBC"],
        locales: ["en-US"],
      },
      {
        sellerSku: "MISSING",
        status: "missing",
        publishedRecordCount: 0,
      },
      {
        sellerSku: "INCOMPLETE",
        asin: null,
        status: "incomplete",
        publishedRecordCount: null,
      },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("contentReferenceKey");
    expect(JSON.stringify(snapshot)).not.toContain("pageToken");
  });

  it("strictly parses exact A+ document evidence without inventing a theme field", () => {
    const source = payload();
    const published = (source.rows as Array<Record<string, unknown>>)[0]!;
    published.documents = [{
      name: "Premium Pet Treat Detail Page",
      documentStatus: "APPROVED",
      badges: ["BULK", "PREMIUM"],
      relationState: "published",
      evidence: "publish_record",
      completeness: "complete",
    }];
    published.documentEvidenceCompleteness = "complete";

    const row = parseAplusAuditSnapshot(source, MARKETPLACE_ID, "live").rows[0]!;

    expect(row.documents).toEqual([{
      name: "Premium Pet Treat Detail Page",
      documentStatus: "APPROVED",
      badges: ["BULK", "PREMIUM"],
      relationState: "published",
      evidence: "publish_record",
      completeness: "complete",
    }]);
    expect(row.documentEvidenceCompleteness).toBe("complete");
    expect(JSON.stringify(row)).not.toContain("theme");
  });

  it("accepts exact published relation evidence when publish records are partial", () => {
    const source = payload();
    const published = (source.rows as Array<Record<string, unknown>>)[0]!;
    published.sourceCompleteness = "partial";
    published.publishedRecordCount = null;
    published.contentTypes = [];
    published.locales = [];
    published.documents = [documentEvidence({
      relationState: "published",
      evidence: "relation_badge",
    })];
    published.documentEvidenceCompleteness = "complete";
    published.reasonCode = "PUBLISHED_DOCUMENT_RELATION_FOUND";
    published.reason = "Amazon A+ 文件關聯已證明目前有已發布 A+。";

    const row = parseAplusAuditSnapshot(source, MARKETPLACE_ID, "live").rows[0]!;

    expect(row).toMatchObject({
      status: "published",
      sourceCompleteness: "partial",
      publishedRecordCount: null,
      reasonCode: "PUBLISHED_DOCUMENT_RELATION_FOUND",
    });
  });

  it("accepts an exact ASIN on relationship-incomplete evidence and a legal mixed same-ASIN result", () => {
    const source = payload();
    const rows = source.rows as Array<Record<string, unknown>>;
    const conservative = rows[2]!;
    conservative.asin = "B000000001";
    conservative.reasonCode = "FBA_RELATIONSHIP_INCOMPLETE";
    conservative.reason =
      "Amazon variation relationships 未完整；未發出逐 ASIN publish-record request。";

    const snapshot = parseAplusAuditSnapshot(source, MARKETPLACE_ID, "live");

    expect(snapshot.rows[2]).toMatchObject({
      asin: "B000000001",
      status: "incomplete",
      reasonCode: "FBA_RELATIONSHIP_INCOMPLETE",
    });
    expect(snapshot.summary.uniqueAsins).toBe(2);
  });

  it("accepts exact publish-record and promoted relation positives for the same ASIN", () => {
    const source = payload();
    const rows = source.rows as Array<Record<string, unknown>>;
    const published = rows[0]!;
    rows.push({
      ...published,
      sellerSku: "PUBLISHED-BY-RELATION",
      title: "Published by exact relation",
      sourceCompleteness: "partial",
      publishedRecordCount: null,
      contentTypes: [],
      locales: [],
      documents: [documentEvidence({
        evidence: "relation_badge",
        relationState: "published",
      })],
      documentEvidenceCompleteness: "complete",
      reasonCode: "PUBLISHED_DOCUMENT_RELATION_FOUND",
      reason: "Amazon A+ 文件關聯已證明目前有已發布 A+。",
    });
    for (const key of ["summary", "totals"] as const) {
      const summary = source[key] as Record<string, number>;
      summary.eligibleFbaSkus += 1;
      summary.published += 1;
    }

    const snapshot = parseAplusAuditSnapshot(source, MARKETPLACE_ID, "live");

    expect(snapshot.rows.filter((row) => row.asin === "B000000001"))
      .toHaveLength(2);
  });

  it("rejects unknown, oversized, duplicate or invalid A+ document evidence", () => {
    const expectInvalidDocument = (
      document: Record<string, unknown>,
      pattern: RegExp,
    ) => {
      const source = payload();
      const row = (source.rows as Array<Record<string, unknown>>)[0]!;
      row.documents = [document];
      row.documentEvidenceCompleteness = "complete";
      expect(() => parseAplusAuditSnapshot(source, MARKETPLACE_ID, "live"))
        .toThrow(pattern);
    };

    expectInvalidDocument(documentEvidence({ theme: "fabricated" }), /A\+ 文件欄位/u);
    expectInvalidDocument(documentEvidence({ name: "N".repeat(101) }), /文件名稱/u);
    expectInvalidDocument(documentEvidence({ documentStatus: "ARCHIVED" }), /文件狀態/u);
    expectInvalidDocument(documentEvidence({ badges: ["PREMIUM", "PREMIUM"] }), /重複/u);
    expectInvalidDocument(documentEvidence({ badges: ["UNKNOWN"] }), /badge/u);
    expectInvalidDocument(documentEvidence({ relationState: "detached" }), /關聯狀態/u);
    expectInvalidDocument(documentEvidence({ evidence: "theme" }), /證據類型/u);
    expectInvalidDocument(documentEvidence({ completeness: "unavailable" }), /文件完整度/u);
    expectInvalidDocument(documentEvidence({
      relationState: "related",
      evidence: "publish_record",
    }), /關聯狀態與證據類型/u);
    expectInvalidDocument(documentEvidence({
      relationState: "not_published",
      evidence: "relation_badge",
    }), /關聯狀態與證據類型/u);
    expectInvalidDocument(documentEvidence({
      relationState: "published",
      evidence: "relation_only",
    }), /關聯狀態與證據類型/u);

    const tooMany = payload();
    const tooManyRow = (tooMany.rows as Array<Record<string, unknown>>)[0]!;
    tooManyRow.documents = Array.from({ length: 101 }, () => documentEvidence());
    expect(() => parseAplusAuditSnapshot(tooMany, MARKETPLACE_ID, "live"))
      .toThrow(/文件清單/u);

    const invalidCompleteness = payload();
    (invalidCompleteness.rows as Array<Record<string, unknown>>)[0]!
      .documentEvidenceCompleteness = "unknown";
    expect(() => parseAplusAuditSnapshot(
      invalidCompleteness,
      MARKETPLACE_ID,
      "live",
    )).toThrow(/文件證據完整度/u);
  });

  it("requires identical document evidence for every Seller SKU sharing an ASIN", () => {
    const conflictingSnapshot = (change: "document" | "completeness") => {
      const source = payload();
      const rows = source.rows as Array<Record<string, unknown>>;
      const published = rows[0]!;
      published.documents = [documentEvidence()];
      published.documentEvidenceCompleteness = "complete";
      rows.push({
        ...published,
        sellerSku: `PUBLISHED-${change}`,
        title: `Second ${change}`,
        documents: [documentEvidence(
          change === "document" ? { name: "Different A+ document" } : {},
        )],
        documentEvidenceCompleteness: change === "completeness"
          ? "partial"
          : "complete",
      });
      for (const key of ["summary", "totals"] as const) {
        const summary = source[key] as Record<string, number>;
        summary.eligibleFbaSkus += 1;
        summary.published += 1;
      }
      return source;
    };

    expect(() => parseAplusAuditSnapshot(
      conflictingSnapshot("document"),
      MARKETPLACE_ID,
      "live",
    )).toThrow(/同一 ASIN.*文件/u);
    expect(() => parseAplusAuditSnapshot(
      conflictingSnapshot("completeness"),
      MARKETPLACE_ID,
      "live",
    )).toThrow(/同一 ASIN.*文件/u);
  });

  it("rejects conflicting evidence inside the same legal same-ASIN provenance class", () => {
    const source = payload();
    const rows = source.rows as Array<Record<string, unknown>>;
    const conservative = {
      ...rows[2]!,
      asin: "B000000003",
      reasonCode: "FBA_RELATIONSHIP_INCOMPLETE",
      reason: "Relationship evidence one.",
    };
    rows[2] = conservative;
    rows.push({
      ...conservative,
      sellerSku: "INCOMPLETE-SECOND",
      reason: "Relationship evidence two.",
    });
    for (const key of ["summary", "totals"] as const) {
      const summary = source[key] as Record<string, number>;
      summary.eligibleFbaSkus += 1;
      summary.uniqueAsins += 1;
      summary.incomplete += 1;
    }

    expect(() => parseAplusAuditSnapshot(source, MARKETPLACE_ID, "live"))
      .toThrow(/同一 ASIN.*文件/u);
  });

  it("requires a published relation document for relation-promoted status", () => {
    const missingDocument = payload();
    const row = (missingDocument.rows as Array<Record<string, unknown>>)[0]!;
    row.sourceCompleteness = "partial";
    row.publishedRecordCount = null;
    row.contentTypes = [];
    row.locales = [];
    row.documents = [];
    row.documentEvidenceCompleteness = "complete";
    row.reasonCode = "PUBLISHED_DOCUMENT_RELATION_FOUND";
    row.reason = "Claimed relation positive without evidence.";

    expect(() => parseAplusAuditSnapshot(
      missingDocument,
      MARKETPLACE_ID,
      "live",
    )).toThrow(/CONTENT_PUBLISHED 文件證據/u);

    const wrongDocumentType = payload();
    const wrongRow = (wrongDocumentType.rows as Array<Record<string, unknown>>)[0]!;
    wrongRow.sourceCompleteness = "partial";
    wrongRow.publishedRecordCount = null;
    wrongRow.contentTypes = [];
    wrongRow.locales = [];
    wrongRow.documents = [documentEvidence()];
    wrongRow.documentEvidenceCompleteness = "complete";
    wrongRow.reasonCode = "PUBLISHED_DOCUMENT_RELATION_FOUND";
    wrongRow.reason = "Claimed relation positive with publish-record evidence.";

    expect(() => parseAplusAuditSnapshot(
      wrongDocumentType,
      MARKETPLACE_ID,
      "live",
    )).toThrow(/CONTENT_PUBLISHED 文件證據/u);
  });

  it("rejects a locale outside the exact official A+ LanguageTag pattern", () => {
    const source = payload();
    (source.rows as Array<Record<string, unknown>>)[0]!.locales = ["EN-us-extra"];

    expect(() => parseAplusAuditSnapshot(source, MARKETPLACE_ID, "live"))
      .toThrow(/A\+ 語系/u);
  });

  it("renders only actionable A+ presence findings in a desktop drawer", () => {
    const snapshot = parseAplusAuditSnapshot(payload(), MARKETPLACE_ID, "live");
    const panelMarkup = renderToStaticMarkup(createElement(AplusAuditPanel, {
      marketplaceId: MARKETPLACE_ID,
      marketplaceShort: "US",
      mode: "live",
      initialSnapshot: snapshot,
    }));
    const drawerMarkup = renderToStaticMarkup(createElement(AplusAuditDrawer, {
      marketplaceId: MARKETPLACE_ID,
      marketplaceShort: "US",
      mode: "live",
      cachedSnapshot: snapshot,
      onClose: () => undefined,
    }));

    expect(panelMarkup).toContain("全站 FBA A+ 健檢");
    expect(panelMarkup).toContain("未找到已發布 A+");
    expect(panelMarkup).toContain("Missing A plus");
    expect(panelMarkup).toContain("前往 Amazon A+ 管理員");
    expect(panelMarkup).toContain("Notebook Key 需更新後才能安全直達 A+ 管理員");
    expect(panelMarkup).toContain("舊版不會改開 Seller Central 首頁");
    expect(panelMarkup).toContain("business-pricing-row-actions");
    expect(panelMarkup).not.toContain("A+ 類型");
    expect(panelMarkup).not.toContain("語系／筆數");
    expect(panelMarkup).not.toContain("From the brand");
    expect(panelMarkup).not.toContain("Brand Story");
    expect(drawerMarkup).toContain('role="dialog"');
    expect(drawerMarkup).toContain("全站 A+ 健檢");
  });

  it("shows A+ document names plus Chinese document and relation states", () => {
    const source = payload();
    const missing = (source.rows as Array<Record<string, unknown>>)[1]!;
    missing.documents = [{
      name: null,
      documentStatus: "DRAFT",
      badges: ["GENERATED"],
      relationState: "not_published",
      evidence: "relation_only",
      completeness: "partial",
    }];
    missing.documentEvidenceCompleteness = "partial";
    const snapshot = parseAplusAuditSnapshot(source, MARKETPLACE_ID, "live");
    const markup = renderToStaticMarkup(createElement(AplusAuditPanel, {
      marketplaceId: MARKETPLACE_ID,
      marketplaceShort: "US",
      mode: "live",
      initialSnapshot: snapshot,
    }));

    expect(markup).toContain("A+ 文件名稱");
    expect(markup).toContain("文件名稱未取得");
    expect(markup).toContain("文件狀態");
    expect(markup).toContain("草稿");
    expect(markup).toContain("關聯狀態");
    expect(markup).toContain("未發布");
    expect(markup).toContain("文件證據：部分取得");
    expect(markup).toContain("GENERATED");
    expect(markup).not.toContain("theme");
  });

  it("distinguishes a complete no-relation result from unavailable document evidence", () => {
    const source = payload();
    const rows = source.rows as Array<Record<string, unknown>>;
    rows[1]!.documentEvidenceCompleteness = "complete";
    const markup = renderToStaticMarkup(createElement(AplusAuditPanel, {
      marketplaceId: MARKETPLACE_ID,
      marketplaceShort: "US",
      mode: "live",
      initialSnapshot: parseAplusAuditSnapshot(source, MARKETPLACE_ID, "live"),
    }));

    expect(markup).toContain("未找到與此 ASIN 關聯的 A+ 文件");
    expect(markup).toContain("A+ 文件清單目前未取得");
  });

  it("uses one clickable A+ summary as the filter instead of repeating the counts", () => {
    const snapshot = parseAplusAuditSnapshot(payload(), MARKETPLACE_ID, "live");
    const markup = renderToStaticMarkup(createElement(AplusAuditPanel, {
      marketplaceId: MARKETPLACE_ID,
      marketplaceShort: "US",
      mode: "live",
      initialSnapshot: snapshot,
    }));
    const summary = markup.match(
      /<div class="business-pricing-summary is-interactive" role="group" aria-label="A\+ 健檢摘要與篩選">[\s\S]*?<\/div>/u,
    )?.[0];

    expect(summary).toBeDefined();
    expect(summary?.match(/<button\b/gu)).toHaveLength(6);
    expect(summary).toContain('aria-pressed="true"');
    expect(markup).not.toContain("business-pricing-filters");
    expect(markup.match(/A\+ 健檢摘要與篩選/gu)).toHaveLength(1);
  });

  it("filters missing and fail-visible rows without hiding unavailable capability", () => {
    const source = payload();
    (source.rows as Array<Record<string, unknown>>).push({
      sellerSku: "UNAVAILABLE",
      asin: "B000000003",
      title: "Unavailable API",
      marketplaceId: MARKETPLACE_ID,
      status: "unavailable",
      sourceCompleteness: "partial",
      publishedRecordCount: null,
      contentTypes: [],
      locales: [],
      documents: [],
      documentEvidenceCompleteness: "unavailable",
      reasonCode: "A_PLUS_ACCESS_UNAVAILABLE",
      reason: "A+ API 尚未取得讀取權限。",
    });
    for (const key of ["eligibleFbaSkus", "uniqueAsins", "unavailable"] as const) {
      const increment = key === "unavailable" || key === "eligibleFbaSkus" || key === "uniqueAsins" ? 1 : 0;
      (source.summary as Record<string, number>)[key] += increment;
      (source.totals as Record<string, number>)[key] += increment;
    }
    const rows = parseAplusAuditSnapshot(source, MARKETPLACE_ID, "live").rows;

    expect(rows.filter((row) => aplusAuditRowMatchesFilter(row, "missing"))).toHaveLength(1);
    expect(rows.filter((row) => aplusAuditRowMatchesFilter(row, "problem"))).toHaveLength(3);
    expect(rows.filter((row) => aplusAuditRowMatchesFilter(row, "unavailable"))).toHaveLength(1);
  });

  it("accepts only the exact v0.1.25 legacy field while rejecting other unknown fields", () => {
    expect(() => parseAplusAuditSnapshot(payload(), "A2EUQ1WTGCTBG2", "live"))
      .toThrow(/站點不一致/u);

    expect(() => parseAplusAuditSnapshot(payload(), MARKETPLACE_ID, "demo"))
      .toThrow(/模式不一致/u);

    const duplicate = payload();
    (duplicate.rows as Array<Record<string, unknown>>)[1]!.sellerSku = "PUBLISHED";
    expect(() => parseAplusAuditSnapshot(duplicate, MARKETPLACE_ID, "live"))
      .toThrow(/重複 Seller SKU/u);

    const legacyExtraField = payload();
    (legacyExtraField.rows as Array<Record<string, unknown>>)[0]!
      .fromTheBrandStatus = "not_verifiable_by_public_api";
    const parsedLegacy = parseAplusAuditSnapshot(
      legacyExtraField,
      MARKETPLACE_ID,
      "live",
    );
    expect(parsedLegacy.rows[0]).not.toHaveProperty("fromTheBrandStatus");

    const fabricatedLegacyValue = payload();
    (fabricatedLegacyValue.rows as Array<Record<string, unknown>>)[0]!
      .fromTheBrandStatus = "present";
    expect(() => parseAplusAuditSnapshot(fabricatedLegacyValue, MARKETPLACE_ID, "live"))
      .toThrow(/欄位無效/u);

    const unknownExtraField = payload();
    (unknownExtraField.rows as Array<Record<string, unknown>>)[0]!
      .unexpectedField = "must fail closed";
    expect(() => parseAplusAuditSnapshot(unknownExtraField, MARKETPLACE_ID, "live"))
      .toThrow(/欄位無效/u);

    const contradictory = payload();
    (contradictory.rows as Array<Record<string, unknown>>)[1]!
      .publishedRecordCount = null;
    expect(() => parseAplusAuditSnapshot(contradictory, MARKETPLACE_ID, "live"))
      .toThrow(/證據不一致/u);

    const incompleteWithPositiveEvidence = payload();
    (incompleteWithPositiveEvidence.rows as Array<Record<string, unknown>>)[2]!
      .contentTypes = ["EBC"];
    expect(() => parseAplusAuditSnapshot(
      incompleteWithPositiveEvidence,
      MARKETPLACE_ID,
      "live",
    )).toThrow(/證據不一致/u);

    const identityReasonWithAsin = payload();
    (identityReasonWithAsin.rows as Array<Record<string, unknown>>)[2]!
      .asin = "B000000003";
    expect(() => parseAplusAuditSnapshot(identityReasonWithAsin, MARKETPLACE_ID, "live"))
      .toThrow(/身分原因/u);

    const sameAsinConflict = payload();
    (sameAsinConflict.rows as Array<Record<string, unknown>>)[1]!
      .asin = "B000000001";
    expect(() => parseAplusAuditSnapshot(sameAsinConflict, MARKETPLACE_ID, "live"))
      .toThrow(/同一 ASIN/u);

    const wrongSummary = payload();
    (wrongSummary.summary as Record<string, unknown>).missing = 0;
    expect(() => parseAplusAuditSnapshot(wrongSummary, MARKETPLACE_ID, "live"))
      .toThrow(/摘要與商品列不一致/u);
  });

  it("labels warning-only A+ evidence separately and gives the seller an action", () => {
    const source = payload();
    const row = (source.rows as Array<Record<string, unknown>>)[2]!;
    row.asin = "B000000003";
    row.reasonCode = "A_PLUS_WARNING_PRESENT";
    row.reason = "Amazon A+ 回應含警告，無法確認目前是否已發布。";
    (source.summary as Record<string, number>).uniqueAsins = 3;
    (source.totals as Record<string, number>).uniqueAsins = 3;
    const snapshot = parseAplusAuditSnapshot(source, MARKETPLACE_ID, "live");
    const markup = renderToStaticMarkup(createElement(AplusAuditPanel, {
      marketplaceId: MARKETPLACE_ID,
      marketplaceShort: "US",
      mode: "live",
      initialSnapshot: snapshot,
    }));

    expect(markup).toContain("Amazon 回應警告，請到 A+ 管理員確認");
    expect(markup).toContain("前往 Amazon A+ 管理員");
  });

  it("starts and observes an exact main-owned job before accepting its completed snapshot", async () => {
    const receipt = {
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      jobId: "aplus-job-001",
      contextId: "aplus-context-001",
      ready: false,
      status: "running",
      progress: { completedAsins: 0, totalAsins: 2 },
    };
    const progress = {
      ...receipt,
      progress: { completedAsins: 1, totalAsins: 2 },
    };
    const completed = {
      jobId: receipt.jobId,
      contextId: receipt.contextId,
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      ready: true,
      status: "completed",
      progress: { completedAsins: 2, totalAsins: 2 },
      snapshot: payload(),
    };
    const responses = [
      new Response(JSON.stringify(receipt), { status: 202 }),
      new Response(JSON.stringify(progress), { status: 202 }),
      new Response(JSON.stringify(completed), { status: 200 }),
    ];
    const calls: Array<{ url: string; method: string }> = [];
    const snapshot = await requestAplusAuditJob({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      fetcher: async (url, init) => {
        calls.push({ url: String(url), method: init?.method ?? "GET" });
        return responses.shift()!;
      },
      wait: async () => undefined,
      maxPolls: 3,
    });

    expect(calls).toEqual([
      { url: "/api/sp-api/a-plus-audit", method: "POST" },
      {
        url: `/api/sp-api/a-plus-audit?marketplaceId=${MARKETPLACE_ID}&mode=live&jobId=aplus-job-001&contextId=aplus-context-001`,
        method: "GET",
      },
      {
        url: `/api/sp-api/a-plus-audit?marketplaceId=${MARKETPLACE_ID}&mode=live&jobId=aplus-job-001&contextId=aplus-context-001`,
        method: "GET",
      },
    ]);
    expect(snapshot.mode).toBe("live");
    expect(snapshot.summary.missing).toBe(1);
  });

  it("keeps observing the same main-owned job beyond the former 15-minute poll cap", async () => {
    const receipt = {
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      jobId: "aplus-job-long-running",
      contextId: "aplus-context-long-running",
      ready: false,
      status: "running",
      progress: { completedAsins: 1, totalAsins: 2 },
    } as const;
    let calls = 0;
    const snapshot = await requestAplusAuditJob({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      fetcher: async (_url, init) => {
        calls += 1;
        if (init?.method === "POST") {
          return new Response(JSON.stringify(receipt), { status: 202 });
        }
        if (calls <= 902) {
          return new Response(JSON.stringify(receipt), { status: 202 });
        }
        return new Response(JSON.stringify({
          ...receipt,
          ready: true,
          status: "completed",
          progress: { completedAsins: 2, totalAsins: 2 },
          snapshot: payload(),
        }), { status: 200 });
      },
      wait: async () => undefined,
    });

    expect(calls).toBe(903);
    expect(snapshot.summary.uniqueAsins).toBe(2);
  });

  it("reconnects to the same job after a transient observer request failure", async () => {
    const receipt = {
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      jobId: "aplus-job-reconnect",
      contextId: "aplus-context-reconnect",
      ready: false,
      status: "running",
      progress: { completedAsins: 1, totalAsins: 2 },
    } as const;
    let calls = 0;
    const snapshot = await requestAplusAuditJob({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      fetcher: async (_url, init) => {
        calls += 1;
        if (init?.method === "POST") {
          return new Response(JSON.stringify(receipt), { status: 202 });
        }
        if (calls === 2) throw new TypeError("temporary observer disconnect");
        return new Response(JSON.stringify({
          ...receipt,
          ready: true,
          status: "completed",
          progress: { completedAsins: 2, totalAsins: 2 },
          snapshot: payload(),
        }), { status: 200 });
      },
      wait: async () => undefined,
    });

    expect(calls).toBe(3);
    expect(snapshot.summary.uniqueAsins).toBe(2);
  });

  it("fails closed when a job receipt or progress response crosses mode", async () => {
    const receipt = {
      mode: "demo",
      marketplaceId: MARKETPLACE_ID,
      jobId: "aplus-job-mode",
      contextId: "aplus-context-mode",
      ready: false,
      status: "running",
      progress: { completedAsins: 0, totalAsins: 1 },
    };
    expect(() => parseAplusAuditJobReceipt(receipt, {
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    })).toThrow(/模式不一致/u);

    const liveStart = { ...receipt, mode: "live" };
    const responses = [
      new Response(JSON.stringify(liveStart), { status: 202 }),
      new Response(JSON.stringify(receipt), { status: 202 }),
    ];
    await expect(requestAplusAuditJob({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      fetcher: async () => responses.shift()!,
      wait: async () => undefined,
      maxPolls: 1,
    })).rejects.toThrow(/模式不一致/u);
  });

  it("fails closed when job identity drifts or background progress regresses", async () => {
    const receipt = {
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      jobId: "aplus-job-fenced",
      contextId: "aplus-context-fenced",
      ready: false,
      status: "running",
      progress: { completedAsins: 1, totalAsins: 2 },
    };
    const drifted = {
      ...receipt,
      contextId: "aplus-context-drifted",
    };
    const driftResponses = [
      new Response(JSON.stringify(receipt), { status: 202 }),
      new Response(JSON.stringify(drifted), { status: 202 }),
    ];
    await expect(requestAplusAuditJob({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      fetcher: async () => driftResponses.shift()!,
      wait: async () => undefined,
      maxPolls: 1,
    })).rejects.toThrow(/context identity/u);

    const responses = [
      new Response(JSON.stringify(receipt), { status: 202 }),
      new Response(JSON.stringify({
        ...receipt,
        progress: { completedAsins: 0, totalAsins: 2 },
      }), { status: 202 }),
    ];
    await expect(requestAplusAuditJob({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      fetcher: async () => responses.shift()!,
      wait: async () => undefined,
      maxPolls: 1,
    })).rejects.toThrow(/進度已回退/u);
  });

  it("accepts only the strict coordinator envelope and surfaces a fixed safe terminal error", async () => {
    const receipt = {
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      jobId: "aplus-job-failure",
      contextId: "aplus-context-failure",
      ready: false,
      status: "queued",
      progress: { completedAsins: 0, totalAsins: 2 },
    };
    expect(() => parseAplusAuditJobReceipt({
      ...receipt,
      message: "unexpected extra field",
    }, {
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    })).toThrow(/欄位無效/u);

    const failure = {
      ...receipt,
      ready: true,
      status: "failed",
      progress: { completedAsins: 1, totalAsins: 2 },
      error: {
        code: "A_PLUS_JOB_FAILED",
        message: "A+ 健檢未完成，請稍後重新執行。",
      },
    };
    const parsedFailure = parseAplusAuditJobTerminal(failure, {
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      jobId: receipt.jobId,
      contextId: receipt.contextId,
    });
    expect(parsedFailure).toMatchObject({
      ready: true,
      status: "failed",
      error: { code: "A_PLUS_JOB_FAILED" },
    });
    const failedMarkup = renderToStaticMarkup(createElement(AplusAuditPanel, {
      marketplaceId: MARKETPLACE_ID,
      marketplaceShort: "US",
      mode: "live",
      job: parsedFailure,
      cachedSnapshot: parseAplusAuditSnapshot(payload(), MARKETPLACE_ID, "live"),
    }));
    expect(failedMarkup).toContain("A+ 健檢未完成，請稍後重新執行。");
    expect(failedMarkup).not.toContain("A+ 健檢摘要與篩選");

    const responses = [
      new Response(JSON.stringify(receipt), { status: 202 }),
      new Response(JSON.stringify(failure), { status: 200 }),
    ];
    await expect(requestAplusAuditJob({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      fetcher: async () => responses.shift()!,
      wait: async () => undefined,
      maxPolls: 1,
    })).rejects.toThrow("A+ 健檢未完成，請稍後重新執行。");
  });

  it("turns an old Notebook Key 404 into a direct upgrade message", async () => {
    await expect(requestAplusAuditJob({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      fetcher: async () => new Response(JSON.stringify({
        code: "NOT_FOUND",
        message: "此 App 版本不支援這個操作。",
      }), { status: 404 }),
      wait: async () => undefined,
      maxPolls: 1,
    })).rejects.toThrow(/更新.*Notebook 鑰匙/u);
  });
});
