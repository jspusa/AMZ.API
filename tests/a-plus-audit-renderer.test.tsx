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
        fromTheBrandStatus: "not_verifiable_by_public_api",
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
        fromTheBrandStatus: "not_verifiable_by_public_api",
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
        fromTheBrandStatus: "not_verifiable_by_public_api",
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
    notice: "只讀取目前 FBA 商品的 A+ publish records；From the brand／Brand Story 不在公開 API 可驗證範圍。",
  };
}

describe("A+ FBA audit renderer", () => {
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

  it("rejects a locale outside the exact official A+ LanguageTag pattern", () => {
    const source = payload();
    (source.rows as Array<Record<string, unknown>>)[0]!.locales = ["EN-us-extra"];

    expect(() => parseAplusAuditSnapshot(source, MARKETPLACE_ID, "live"))
      .toThrow(/A\+ 語系/u);
  });

  it("renders missing A+ findings and the fixed Brand Story API boundary in a desktop drawer", () => {
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
    expect(panelMarkup).toContain("From the brand／Brand Story");
    expect(panelMarkup).toContain("公開 A+ API 未提供可驗證欄位");
    expect(drawerMarkup).toContain('role="dialog"');
    expect(drawerMarkup).toContain("全站 A+ 健檢");
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
      fromTheBrandStatus: "not_verifiable_by_public_api",
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

  it("rejects cross-market, duplicate, fabricated Brand Story or contradictory evidence", () => {
    expect(() => parseAplusAuditSnapshot(payload(), "A2EUQ1WTGCTBG2", "live"))
      .toThrow(/站點不一致/u);

    expect(() => parseAplusAuditSnapshot(payload(), MARKETPLACE_ID, "demo"))
      .toThrow(/模式不一致/u);

    const duplicate = payload();
    (duplicate.rows as Array<Record<string, unknown>>)[1]!.sellerSku = "PUBLISHED";
    expect(() => parseAplusAuditSnapshot(duplicate, MARKETPLACE_ID, "live"))
      .toThrow(/重複 Seller SKU/u);

    const fabricatedBrandStory = payload();
    (fabricatedBrandStory.rows as Array<Record<string, unknown>>)[0]!
      .fromTheBrandStatus = "present";
    expect(() => parseAplusAuditSnapshot(fabricatedBrandStory, MARKETPLACE_ID, "live"))
      .toThrow(/不得猜測 From the brand/u);

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
    expect(parseAplusAuditJobTerminal(failure, {
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      jobId: receipt.jobId,
      contextId: receipt.contextId,
    })).toMatchObject({
      ready: true,
      status: "failed",
      error: { code: "A_PLUS_JOB_FAILED" },
    });

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
