import { describe, expect, it } from "vitest";
import {
  auditSuiteRunForMarketplace,
  createAuditSuiteState,
  parseAuditSuiteRun,
  replaceAuditSuiteRun,
  storeAuditSuiteRun,
} from "../src/renderer/src/audit-suite";
import {
  AUDIT_SUITE_SECTION_COUNT,
  AUDIT_SUITE_SECTIONS,
  AUDIT_SUITE_SECTION_IDS,
  type AuditSuitePublicContext,
  type AuditSuiteRunDto,
  type AuditSuiteRunStatus,
  type AuditSuiteSectionStatus,
} from "../src/shared/audit-suite";

const CONTEXT: AuditSuitePublicContext = {
  runId: "suite-run-0001",
  contextId: "context-run-0001-abcdef",
  marketplaceId: "ATVPDKIKX0DER",
  mode: "live",
};

function runDto(
  status: AuditSuiteRunStatus,
  sectionStatuses: Partial<Record<(typeof AUDIT_SUITE_SECTION_IDS)[number], AuditSuiteSectionStatus>> = {},
  updatedAt = "2026-08-09T04:05:00.000Z",
): AuditSuiteRunDto {
  return {
    schemaVersion: 3,
    ...CONTEXT,
    status,
    startedAt: "2026-08-09T04:00:00.000Z",
    updatedAt,
    sections: Object.fromEntries(AUDIT_SUITE_SECTION_IDS.map((id) => {
      const sectionStatus = sectionStatuses[id] ?? status;
      const terminal = ["completed", "partial", "failed"].includes(sectionStatus);
      return [id, {
        id,
        status: sectionStatus,
        message: `${id} 狀態可核對。`,
        completedUnits: terminal ? 1 : 0,
        totalUnits: 1,
        updatedAt,
      }];
    })) as AuditSuiteRunDto["sections"],
  };
}

describe("audit suite renderer state", () => {
  it("publishes the seven canonical audit labels in the one-click order", () => {
    expect(AUDIT_SUITE_SECTIONS).toEqual([
      { id: "content", label: "全站文案健檢" },
      { id: "image", label: "全站圖片健檢" },
      { id: "aplus", label: "全站 A+ 健檢" },
      { id: "variation", label: "未綁變體健檢" },
      { id: "subscription", label: "全站訂閱價格健檢" },
      { id: "businessPricing", label: "全站 B2B 價格健檢" },
      { id: "advertising", label: "廣告覆蓋健檢" },
    ]);
    expect(AUDIT_SUITE_SECTION_IDS).toEqual(
      AUDIT_SUITE_SECTIONS.map(({ id }) => id),
    );
    expect(AUDIT_SUITE_SECTION_COUNT).toBe(7);
  });

  it("gives an explicit Notebook Key upgrade message for the previous five-section bridge", () => {
    const previous = {
      ...runDto("completed"),
      schemaVersion: 2,
    };

    expect(() => parseAuditSuiteRun(previous, CONTEXT)).toThrow(
      /Notebook Key.*更新/u,
    );
  });

  it("retains one background run when a drawer closes and accepts monotonic progress", () => {
    const queued = parseAuditSuiteRun(runDto("queued"), CONTEXT);
    let state = storeAuditSuiteRun(createAuditSuiteState(), queued);

    // Drawer visibility is deliberately absent from this state container.
    expect(auditSuiteRunForMarketplace(state, CONTEXT.marketplaceId)?.status).toBe("queued");

    const running = parseAuditSuiteRun(runDto("running", {
      content: "running",
      image: "queued",
      variation: "queued",
      subscription: "queued",
    }, "2026-08-09T04:06:00.000Z"), CONTEXT);
    state = storeAuditSuiteRun(state, running);

    const partial = parseAuditSuiteRun(runDto("partial", {
      content: "completed",
      image: "failed",
      variation: "completed",
      subscription: "completed",
    }, "2026-08-09T04:10:00.000Z"), CONTEXT);
    state = storeAuditSuiteRun(state, partial);
    expect(auditSuiteRunForMarketplace(state, CONTEXT.marketplaceId)?.status).toBe("partial");

    expect(() => storeAuditSuiteRun(state, running)).toThrow(/不可.*回退|更新時間不可倒退/u);
  });

  it.each([
    ["marketplaceId", "A2EUQ1WTGCTBG2", /站點不一致/u],
    ["contextId", "context-run-9999-abcdef", /contextId 不一致/u],
    ["mode", "demo", /模式已改變/u],
    ["runId", "suite-run-9999", /runId 不一致/u],
  ] as const)("fails closed for a wrong %s", (field, value, pattern) => {
    expect(() => parseAuditSuiteRun(
      { ...runDto("queued"), [field]: value },
      CONTEXT,
    )).toThrow(pattern);
  });

  it("rejects an overall status that contradicts its seven sections", () => {
    expect(() => parseAuditSuiteRun(runDto("completed", {
      image: "failed",
    }), CONTEXT)).toThrow(/總狀態.*不一致/u);
  });

  it("parses raw unknown fail-closed before accessing missing sections", () => {
    expect(() => parseAuditSuiteRun(null, CONTEXT)).toThrow(/回應格式無效/u);
    expect(() => parseAuditSuiteRun({
      ...runDto("queued"),
      sections: undefined,
    }, CONTEXT)).toThrow(/根層欄位格式無效/u);
    expect(() => parseAuditSuiteRun({
      ...runDto("queued"),
      accountScope: "a".repeat(64),
    }, CONTEXT)).toThrow(/未允許欄位/u);
  });

  it("requires an explicit replacement for a new run and preserves account/mode fences", () => {
    const completed = parseAuditSuiteRun(runDto("completed"), CONTEXT);
    const state = createAuditSuiteState(completed);
    const nextContext = {
      ...CONTEXT,
      runId: "suite-run-0002",
      contextId: "context-run-0002-abcdef",
    };
    const next = parseAuditSuiteRun({
      ...runDto("queued", {}, "2026-08-09T04:11:00.000Z"),
      ...nextContext,
      startedAt: "2026-08-09T04:11:00.000Z",
    }, nextContext);
    expect(() => storeAuditSuiteRun(state, next)).toThrow(/須明確開始新執行/u);
    expect(auditSuiteRunForMarketplace(
      replaceAuditSuiteRun(state, next),
      CONTEXT.marketplaceId,
    )?.runId).toBe("suite-run-0002");

    const otherContext = {
      ...next,
      runId: "suite-run-0003",
      contextId: "context-run-other-abcdef",
      mode: "demo" as const,
    };
    expect(auditSuiteRunForMarketplace(
      replaceAuditSuiteRun(state, otherContext),
      CONTEXT.marketplaceId,
    )).toMatchObject({ runId: "suite-run-0003", mode: "demo" });
  });
});
