import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import AuditSuiteHomeCard, {
  startIndividualAuditJobs,
} from "../src/renderer/src/components/audit-suite-home-card";

const MARKETPLACE_ID = "ATVPDKIKX0DER";

function standaloneJob(kind: string, index: number) {
  return {
    jobId: `standalone-job-${index}`,
    contextId: `standalone-context-${index}`,
    kind,
    marketplaceId: MARKETPLACE_ID,
    mode: "live" as const,
    options: kind === "subscription" ? { months: 6 as const } : {},
    ready: false as const,
    status: "queued" as const,
    progress: {
      stage: "queued",
      message: "已交給 Notebook Key 背景執行。",
      completedUnits: 0,
      totalUnits: null,
    },
  };
}

describe("one-click individual audit launcher", () => {
  it("renders only one launcher and leaves status and results to the seven cards below", () => {
    const markup = renderToStaticMarkup(
      <AuditSuiteHomeCard
        marketplaceId={MARKETPLACE_ID}
        mode="live"
        onStandaloneJobChange={() => undefined}
        onAplusJobChange={() => undefined}
      />,
    );

    expect(markup).toContain("一鍵執行全部 FBA 健檢");
    expect(markup).toContain("直接啟動下方 7 張單項卡片");
    expect(markup).toContain("點進各卡片查看完整結果");
    expect(markup.match(/<button\b/gu)).toHaveLength(1);
    expect(markup).not.toContain("audit-suite-section-grid");
    expect(markup).not.toContain("audit-suite-home-status");
    expect(markup).not.toContain("狀態收斂進度");
    expect(markup).not.toContain("下載合併健檢 Excel");
    expect(markup).not.toContain("/api/sp-api/audit-suite");
  });

  it("keeps the launcher available when another card is already running", () => {
    const markup = renderToStaticMarkup(
      <AuditSuiteHomeCard
        marketplaceId={MARKETPLACE_ID}
        mode="live"
        hasRunningJobs
        onStandaloneJobChange={() => undefined}
        onAplusJobChange={() => undefined}
      />,
    );

    expect(markup).toContain("啟動其餘健檢（執行中項目沿用）");
    expect(markup).not.toContain("disabled=\"\"");
    expect(markup).toContain("aria-busy=\"false\"");
  });

  it("starts the six standalone jobs and specialized A+ job, then hands every main identity to the existing card observers", async () => {
    const starts: Array<{ kind: string; options?: unknown }> = [];
    const launchOrder: string[] = [];
    const standaloneIdentities: string[] = [];
    const aplusIdentities: string[] = [];

    const outcome = await startIndividualAuditJobs({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      startStandalone: vi.fn(async (input) => {
        launchOrder.push(input.kind);
        starts.push({ kind: input.kind, options: input.options });
        return standaloneJob(input.kind, starts.length);
      }),
      startAplus: vi.fn(async () => {
        launchOrder.push("aplus");
        return {
          jobId: "aplus-job-1",
          contextId: "aplus-context-1",
          marketplaceId: MARKETPLACE_ID,
          mode: "live" as const,
          ready: false as const,
          status: "queued" as const,
          progress: { completedAsins: 0, totalAsins: 0 },
        };
      }),
      onStandaloneJobChange: (job) => {
        standaloneIdentities.push(`${job.kind}:${job.jobId}:${job.contextId}`);
      },
      onAplusJobChange: (job) => {
        aplusIdentities.push(`${job.jobId}:${job.contextId}`);
      },
    });

    expect(starts).toEqual([
      { kind: "content", options: undefined },
      { kind: "image", options: undefined },
      { kind: "variation", options: undefined },
      { kind: "subscription", options: { months: 6 } },
      { kind: "businessPricing", options: undefined },
      { kind: "advertising", options: undefined },
    ]);
    expect(launchOrder).toEqual([
      "content",
      "image",
      "aplus",
      "variation",
      "subscription",
      "businessPricing",
      "advertising",
    ]);
    expect(standaloneIdentities).toEqual([
      "content:standalone-job-1:standalone-context-1",
      "image:standalone-job-2:standalone-context-2",
      "variation:standalone-job-3:standalone-context-3",
      "subscription:standalone-job-4:standalone-context-4",
      "businessPricing:standalone-job-5:standalone-context-5",
      "advertising:standalone-job-6:standalone-context-6",
    ]);
    expect(aplusIdentities).toEqual(["aplus-job-1:aplus-context-1"]);
    expect(outcome.failedLabels).toEqual([]);
  });

  it("still starts every independent card when one main-owned job fails to start", async () => {
    const attempted: string[] = [];
    const successful: string[] = [];
    const failed: Array<{ id: string; message: string }> = [];
    const outcome = await startIndividualAuditJobs({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      startStandalone: async (input) => {
        attempted.push(input.kind);
        if (input.kind === "image") throw new Error("圖片工作無法建立");
        return standaloneJob(input.kind, attempted.length);
      },
      startAplus: async () => {
        attempted.push("aplus");
        return {
          jobId: "aplus-job-2",
          contextId: "aplus-context-2",
          marketplaceId: MARKETPLACE_ID,
          mode: "live" as const,
          ready: false as const,
          status: "queued" as const,
          progress: { completedAsins: 0, totalAsins: 0 },
        };
      },
      onStandaloneJobChange: () => undefined,
      onAplusJobChange: () => undefined,
      onStartSuccess: (id) => successful.push(id),
      onStartFailure: (id, message) => failed.push({ id, message }),
    });

    expect(new Set(attempted)).toEqual(new Set([
      "content",
      "image",
      "variation",
      "subscription",
      "businessPricing",
      "advertising",
      "aplus",
    ]));
    expect(outcome.failedLabels).toEqual(["全站圖片健檢"]);
    expect(new Set(successful)).toEqual(new Set([
      "content",
      "aplus",
      "variation",
      "subscription",
      "businessPricing",
      "advertising",
    ]));
    expect(failed).toEqual([{
      id: "image",
      message: "全站圖片健檢本次未能啟動；上次結果不會當成本次結果。",
    }]);
  });

  it("hands each successful identity to its card without waiting for another start call", async () => {
    let releaseImage!: () => void;
    const imageGate = new Promise<void>((resolve) => {
      releaseImage = resolve;
    });
    const standaloneIdentities: string[] = [];
    const aplusIdentities: string[] = [];
    let ordinal = 0;
    const launching = startIndividualAuditJobs({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      startStandalone: async (input) => {
        ordinal += 1;
        if (input.kind === "image") {
          await imageGate;
          throw new Error("圖片工作無法建立");
        }
        return standaloneJob(input.kind, ordinal);
      },
      startAplus: async () => ({
        jobId: "aplus-job-immediate",
        contextId: "aplus-context-immediate",
        marketplaceId: MARKETPLACE_ID,
        mode: "live" as const,
        ready: false as const,
        status: "queued" as const,
        progress: { completedAsins: 0, totalAsins: 0 },
      }),
      onStandaloneJobChange: (job) => {
        standaloneIdentities.push(job.kind);
      },
      onAplusJobChange: (job) => {
        aplusIdentities.push(job.jobId);
      },
    });

    for (let index = 0; index < 4; index += 1) await Promise.resolve();
    expect(new Set(standaloneIdentities)).toEqual(new Set([
      "content",
      "variation",
      "subscription",
      "businessPricing",
      "advertising",
    ]));
    expect(aplusIdentities).toEqual(["aplus-job-immediate"]);

    releaseImage();
    await expect(launching).resolves.toEqual({
      failedLabels: ["全站圖片健檢"],
    });
  });
});
