import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ContentAuditPanel, {
  parseContentAuditSnapshot,
} from "../src/renderer/src/components/content-audit-panel";
import ImageAuditPanel from "../src/renderer/src/components/image-audit-panel";
import { parseImageAuditSnapshot } from "../src/renderer/src/image-audit";
import {
  parseStandaloneAuditJob,
  type StandaloneAuditKind,
} from "../src/renderer/src/standalone-audit";

const MARKETPLACE_ID = "ATVPDKIKX0DER";

function failedJob(kind: Extract<StandaloneAuditKind, "content" | "image">) {
  const label = kind === "content" ? "文案" : "圖片";
  return parseStandaloneAuditJob({
    jobId: kind === "content"
      ? "84ec9cda-e878-4e87-984e-65c8c5652cee"
      : "74ec9cda-e878-4e87-984e-65c8c5652ced",
    contextId: kind === "content"
      ? "94ec9cda-e878-4e87-984e-65c8c5652cef"
      : "64ec9cda-e878-4e87-984e-65c8c5652cec",
    kind,
    marketplaceId: MARKETPLACE_ID,
    mode: "live",
    options: {},
    ready: true,
    status: "failed",
    progress: {
      stage: "failed",
      message: `${label}健檢未完成`,
      completedUnits: 1,
      totalUnits: 2,
    },
    error: {
      code: `${kind.toUpperCase()}_AUDIT_FAILED`,
      message: `本次${label}健檢未完成。`,
    },
  }, {
    kind,
    marketplaceId: MARKETPLACE_ID,
    mode: "live",
  });
}

describe("standalone audit panels keep terminal failures newer than cached results", () => {
  it("does not render an older content summary or Excel actions for a newer failed job", () => {
    const cachedSnapshot = parseContentAuditSnapshot({
      marketplaceId: MARKETPLACE_ID,
      exportId: "stale-content-export-001",
      fetchedAt: "2026-08-22T08:00:00.000Z",
      rows: [{
        sellerSku: "STALE-CONTENT-SKU",
        asin: "B000000001",
        productType: "PET_FOOD",
        title: "Cached content result",
        bulletPoints: ["Only one point"],
        ingredients: "Turkey",
        readStatus: "complete",
        readErrors: [],
        issues: [{
          kind: "MISSING_BULLETS",
          field: "bulletPoints",
          message: "舊快照只有 1 個賣點。",
        }],
      }],
      summary: { total: 1 },
    });
    const markup = renderToStaticMarkup(createElement(ContentAuditPanel, {
      marketplaceId: MARKETPLACE_ID,
      marketplaceShort: "US",
      onOpenSku: () => undefined,
      cachedResult: {
        snapshot: cachedSnapshot,
        filter: "all",
        query: "",
        spellcheckNote: "舊快照字典檢查已完成。",
      },
      initialJob: failedJob("content"),
    }));

    expect(markup).not.toContain("文案健檢摘要與問題篩選");
    expect(markup).not.toContain("content-audit-export-primary");
    expect(markup).not.toContain("回傳同一份 Excel 批次更新");
    expect(markup).not.toContain("STALE-CONTENT-SKU");
    expect(markup).toContain("本次文案健檢未完成。");
  });

  it("does not render an older image summary or Excel action for a newer failed job", () => {
    const cachedSnapshot = parseImageAuditSnapshot({
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-22T08:00:00.000Z",
      minimumImages: 6,
      rows: [{
        sellerSku: "STALE-IMAGE-SKU",
        asin: "B000000002",
        productType: "PET_FOOD",
        title: "Cached image result",
        imageUrls: ["https://example.com/stale-image.jpg"],
        imageCount: 1,
        readStatus: "complete",
        readErrors: [],
      }],
      summary: {
        total: 1,
        completed: 1,
        incomplete: 0,
        underMinimum: 1,
      },
    });
    const markup = renderToStaticMarkup(createElement(ImageAuditPanel, {
      marketplaceId: MARKETPLACE_ID,
      marketplaceShort: "US",
      onOpenSku: () => undefined,
      cachedResult: {
        snapshot: cachedSnapshot,
        query: "",
        reportId: "stale-image-report-001",
        documentId: "stale-image-document-001",
        exportId: "stale-image-export-001",
      },
      initialJob: failedJob("image"),
    }));

    expect(markup).not.toContain("圖片健檢摘要");
    expect(markup).not.toContain("匯出 Excel");
    expect(markup).not.toContain("STALE-IMAGE-SKU");
    expect(markup).toContain("本次圖片健檢未完成。");
  });
});
