import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ImageAuditPanel from "../src/renderer/src/components/image-audit-panel";
import ImageWorkspaceDrawer from "../src/renderer/src/components/image-workspace-drawer";
import { readFile } from "node:fs/promises";
import {
  imageAuditAttentionRows,
  parseImageAuditSnapshot,
} from "../src/renderer/src/image-audit";

describe("FBA image audit parsing", () => {
  it("lists only complete rows below five images plus fail-visible reads", () => {
    const snapshot = parseImageAuditSnapshot({
      marketplaceId: "ATVPDKIKX0DER",
      fetchedAt: "2026-08-08T08:00:00.000Z",
      minimumImages: 5,
      rows: [
        {
          sellerSku: "FOUR-IMAGES",
          asin: "B0FOUR",
          productType: "PET_FOOD",
          title: "Four images",
          imageUrls: ["https://a/1.jpg", "https://a/2.jpg", "https://a/3.jpg", "https://a/4.jpg"],
          imageCount: 4,
          readStatus: "complete",
          readErrors: [],
        },
        {
          sellerSku: "FIVE-IMAGES",
          imageUrls: ["https://a/1.jpg", "https://a/2.jpg", "https://a/3.jpg", "https://a/4.jpg", "https://a/5.jpg"],
          imageCount: 5,
          readStatus: "complete",
          readErrors: [],
        },
        {
          sellerSku: "UNKNOWN-IMAGES",
          imageUrls: [],
          imageCount: 0,
          readStatus: "incomplete",
          readErrors: [
            { code: "LISTING_CONTENT_NOT_RETURNED", message: "attributes missing" },
          ],
        },
      ],
      summary: { total: 3, completed: 2, incomplete: 1, underMinimum: 1 },
    });

    expect(snapshot.summary).toEqual({
      total: 3,
      completed: 2,
      incomplete: 1,
      underMinimum: 1,
    });
    expect(imageAuditAttentionRows(snapshot).map((row) => row.sellerSku)).toEqual([
      "FOUR-IMAGES",
      "UNKNOWN-IMAGES",
    ]);
  });

  it("deduplicates URLs but rejects a contradictory declared count", () => {
    expect(() =>
      parseImageAuditSnapshot({
        marketplaceId: "ATVPDKIKX0DER",
        fetchedAt: "2026-08-08T08:00:00.000Z",
        minimumImages: 5,
        rows: [
          {
            sellerSku: "BAD-COUNT",
            imageUrls: ["https://a/1.jpg", "https://a/1.jpg"],
            imageCount: 2,
            readStatus: "complete",
            readErrors: [],
          },
        ],
      }),
    ).toThrow(/圖片數量與 URL 不一致/);
  });

  it("does not misclassify an incomplete response as zero images", () => {
    const snapshot = parseImageAuditSnapshot({
      marketplaceId: "ATVPDKIKX0DER",
      fetchedAt: "2026-08-08T08:00:00.000Z",
      minimumImages: 5,
      rows: [
        {
          sellerSku: "INCOMPLETE",
          imageUrls: [],
          imageCount: 0,
          readStatus: "incomplete",
          readErrors: [],
        },
      ],
    });

    expect(snapshot.rows[0].readErrors[0].message).toContain("不判定圖片不足");
    expect(snapshot.summary.underMinimum).toBe(0);
    expect(snapshot.summary.incomplete).toBe(1);
  });

  it("rejects a completed snapshot from a different marketplace before display or cache", () => {
    expect(() =>
      parseImageAuditSnapshot(
        {
          marketplaceId: "A39IBJ37TRP1C6",
          fetchedAt: "2026-08-08T08:00:00.000Z",
          minimumImages: 5,
          rows: [],
        },
        "ATVPDKIKX0DER",
      ),
    ).toThrow(/目前選擇的站點不一致；已停止顯示與快取/u);
  });

  it("renders the five-image boundary and a direct image-workspace action", () => {
    const snapshot = parseImageAuditSnapshot({
      marketplaceId: "ATVPDKIKX0DER",
      fetchedAt: "2026-08-08T08:00:00.000Z",
      minimumImages: 5,
      rows: [
        {
          sellerSku: "FOUR-IMAGES",
          title: "Turkey treats",
          imageUrls: ["https://a/1.jpg", "https://a/2.jpg", "https://a/3.jpg", "https://a/4.jpg"],
          imageCount: 4,
          readStatus: "complete",
          readErrors: [],
        },
      ],
    });
    const markup = renderToStaticMarkup(
      createElement(ImageAuditPanel, {
        marketplaceId: "ATVPDKIKX0DER",
        marketplaceShort: "US",
        onOpenSku: () => undefined,
        cachedResult: { snapshot, query: "" },
      }),
    );

    expect(markup).toContain("全站 FBA 圖片健檢");
    expect(markup).toContain("少於 5 張");
    expect(markup).toContain("目前 4 張 · 還差 1 張達到 5 張");
    expect(markup).toContain("開啟圖片工作台");
  });

  it("opens cached audit results inside the existing image workspace", () => {
    const snapshot = parseImageAuditSnapshot({
      marketplaceId: "ATVPDKIKX0DER",
      fetchedAt: "2026-08-08T08:00:00.000Z",
      minimumImages: 5,
      rows: [
        {
          sellerSku: "FOUR-IMAGES",
          title: "Turkey treats",
          imageUrls: ["https://a/1.jpg", "https://a/2.jpg", "https://a/3.jpg", "https://a/4.jpg"],
          imageCount: 4,
          readStatus: "complete",
          readErrors: [],
        },
      ],
    });
    const markup = renderToStaticMarkup(
      createElement(ImageWorkspaceDrawer, {
        initialMarketplaceId: "ATVPDKIKX0DER",
        initialTab: "audit",
        auditCacheByMarketplace: {
          ATVPDKIKX0DER: { snapshot, query: "FOUR" },
        },
        onClose: () => undefined,
      }),
    );

    expect(markup).toContain("單一 SKU 圖片工作台");
    expect(markup).toContain("全站圖片健檢");
    expect(markup).toContain("FOUR-IMAGES");
    expect(markup).toContain("目前 4 張 · 還差 1 張達到 5 張");
    expect(markup).toContain("重新掃描");
  });

  it("keeps the audit cache and an explicit return path when opening a SKU", async () => {
    const [source, dashboardSource] = await Promise.all([
      readFile(
        new URL(
          "../src/renderer/src/components/image-workspace-drawer.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../src/renderer/src/components/dashboard.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);

    expect(source).toContain("setReturnToAudit(true)");
    expect(source).toContain("← 返回全站圖片健檢結果");
    expect(source).toContain("void loadSku(sellerSku)");
    expect(source).toContain("auditCacheByMarketplace[marketplaceId]");
    expect(source).toContain("onCachedResultChange={onAuditCacheChange}");
    expect(dashboardSource).toContain("[cache.snapshot.marketplaceId]: cache");
    expect(dashboardSource).toContain("auditCacheByMarketplace={imageAuditCache}");
    expect(dashboardSource).toContain("繼續上次圖片健檢");
  });
});
