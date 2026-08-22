import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AuditSuiteHomeCard, {
  auditSuiteCompletedSections,
  auditSuiteSectionPresentation,
  auditSuiteStatusPresentation,
  parseAuditSuiteStart,
  runAuditSuitePollLoop,
} from "../src/renderer/src/components/audit-suite-home-card";
import { AUDIT_SUITE_SECTION_IDS } from "../src/shared/audit-suite";

const MARKETPLACE_ID = "ATVPDKIKX0DER";

function run(
  status: "queued" | "running" | "completed" | "partial" | "failed" = "queued",
) {
  return {
    schemaVersion: 2 as const,
    runId: "suite-run-0001",
    contextId: "context-run-0001-abcdef",
    marketplaceId: MARKETPLACE_ID,
    mode: "live" as const,
    status,
    startedAt: "2026-08-09T04:00:00.000Z",
    updatedAt: "2026-08-09T04:00:00.000Z",
    sections: Object.fromEntries(AUDIT_SUITE_SECTION_IDS.map((id) => [id, {
      id,
      status,
      message: `${id} 狀態可核對。`,
      completedUnits: status === "completed" ? 1 : 0,
      totalUnits: 1,
      updatedAt: "2026-08-09T04:00:00.000Z",
    }])),
  };
}

describe("audit suite home card", () => {
  it("keeps the five common audit labels in one-click order and an honest shared-dictionary boundary", () => {
    const markup = renderToStaticMarkup(
      <AuditSuiteHomeCard marketplaceId={MARKETPLACE_ID} marketplaceShort="US" />,
    );
    expect(markup).toContain("一鍵執行全部 FBA 健檢");
    const orderedLabels = [
      "商品內容結構",
      "Listing 圖片",
      "未綁變體",
      "訂閱價格",
      "廣告覆蓋",
    ];
    for (const label of orderedLabels) expect(markup).toContain(label);
    for (let index = 1; index < orderedLabels.length; index += 1) {
      expect(markup.indexOf(orderedLabels[index - 1])).toBeLessThan(
        markup.indexOf(orderedLabels[index]),
      );
    }
    expect(markup).not.toContain("180+ 庫齡與預估冗餘");
    expect(markup).not.toContain("評論主題");
    expect(markup).toContain("廣告覆蓋");
    expect(markup).toContain("GitHub Pages 共用英文辭典與紅字標示由「單項文案健檢」完成");
    expect(markup).toContain("按一次，讓五項健檢自動執行");
    expect(markup).toContain("下面五項會自動執行");
    expect(markup).toContain("這些卡片只顯示各項狀態，不是五個分開按鈕");
    expect(markup).toContain('data-state="waiting"');
    expect(markup).toContain("等待開始");
    expect(markup).toContain("狀態收斂進度");
    expect(markup).toContain("綜合 FBA 健檢狀態收斂進度 0%");
    expect(markup).toContain("audit-suite-section-pill");
    expect(markup).toContain("等待</span>");
    expect(markup.match(/按上方一次後自動執行。/gu)).toHaveLength(5);
    expect(markup.match(/<button\b/gu)).toHaveLength(1);
    expect(markup.indexOf("audit-suite-home-actions")).toBeLessThan(
      markup.indexOf("audit-suite-section-grid"),
    );
  });

  it("uses explicit text, icons, and progress for every overall and section state", () => {
    expect(auditSuiteStatusPresentation(null)).toMatchObject({
      state: "waiting",
      label: "等待開始",
      completedSections: 0,
      progressPercent: 0,
    });
    expect(auditSuiteStatusPresentation(run("running"))).toMatchObject({
      state: "running",
      label: "背景執行中",
      completedSections: 0,
      progressPercent: 0,
    });
    expect(auditSuiteStatusPresentation(run("completed"))).toMatchObject({
      state: "completed",
      label: "全部完成",
      completedSections: 5,
      progressPercent: 100,
    });
    expect(auditSuiteStatusPresentation(run("partial"))).toMatchObject({
      state: "partial",
      label: "部分完成",
      completedSections: 5,
      progressPercent: 100,
    });
    expect(auditSuiteStatusPresentation(run("failed"))).toMatchObject({
      state: "failed",
      label: "未完成",
      completedSections: 5,
      progressPercent: 100,
    });

    expect(auditSuiteSectionPresentation(null)).toEqual({
      state: "waiting",
      label: "等待",
      icon: "○",
    });
    expect(auditSuiteSectionPresentation("queued").label).toBe("排隊中");
    expect(auditSuiteSectionPresentation("running").label).toBe("執行中");
    expect(auditSuiteSectionPresentation("completed").label).toBe("完成");
    expect(auditSuiteSectionPresentation("partial").label).toBe("部分完成");
    expect(auditSuiteSectionPresentation("failed").label).toBe("未完成");
  });

  it("accepts only the requested marketplace and never exposes accountScope", () => {
    const parsed = parseAuditSuiteStart(run(), MARKETPLACE_ID);
    expect(parsed.marketplaceId).toBe(MARKETPLACE_ID);
    expect("accountScope" in parsed).toBe(false);
    expect(() => parseAuditSuiteStart(run(), "A2EUQ1WTGCTBG2")).toThrow(/context/u);
  });

  it("counts terminal section progress", () => {
    const completed = parseAuditSuiteStart(run("completed"), MARKETPLACE_ID);
    expect(auditSuiteCompletedSections(completed)).toBe(5);
    expect(auditSuiteCompletedSections(null)).toBe(0);
  });

  it("allows an explicit second run to use a fresh main-issued context", async () => {
    const source = await import("../src/renderer/src/audit-suite");
    const first = parseAuditSuiteStart(run("completed"), MARKETPLACE_ID);
    const second = parseAuditSuiteStart({
      ...run(),
      runId: "suite-run-0002",
      contextId: "context-run-0002-abcdef",
    }, MARKETPLACE_ID);
    const state = source.replaceAuditSuiteRun(
      source.createAuditSuiteState(first),
      second,
    );
    expect(source.auditSuiteRunForMarketplace(state, MARKETPLACE_ID)).toMatchObject({
      runId: "suite-run-0002",
      contextId: "context-run-0002-abcdef",
    });
  });

  it("continues polling across identical running snapshots and one retryable failure", async () => {
    const running = parseAuditSuiteStart(run("running"), MARKETPLACE_ID);
    const completed = parseAuditSuiteStart(run("completed"), MARKETPLACE_ID);
    let calls = 0;
    const seen: string[] = [];
    await runAuditSuitePollLoop({
      signal: new AbortController().signal,
      wait: async () => undefined,
      load: async () => {
        calls += 1;
        if (calls === 2) throw new Error("temporary 500");
        return { kind: "run", run: calls < 4 ? running : completed };
      },
      onRun: (next) => seen.push(next.status),
      onRetryableError: (error) => seen.push((error as Error).message),
      onStopped: (message) => seen.push(message),
    });
    expect(calls).toBe(4);
    expect(seen).toEqual(["running", "temporary 500", "running", "completed"]);
  });

  it("stops polling after unmount abort", async () => {
    const controller = new AbortController();
    const running = parseAuditSuiteStart(run("running"), MARKETPLACE_ID);
    let calls = 0;
    await runAuditSuitePollLoop({
      signal: controller.signal,
      wait: async () => undefined,
      load: async () => {
        calls += 1;
        return { kind: "run", run: running };
      },
      onRun: () => controller.abort(),
      onRetryableError: () => undefined,
      onStopped: () => undefined,
    });
    expect(calls).toBe(1);
  });
});
