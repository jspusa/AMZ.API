import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  auditCacheForMarketplace,
  auditSnapshotMatchesCurrentAttempt,
  auditSuiteLaunchFailureKey,
  shouldClearAuditSuiteLaunchFailure,
  standaloneAuditDashboardKey,
  standaloneAuditSnapshotMatchesJob,
} from "../src/renderer/src/components/dashboard";
import {
  mergeAuditJobObservation,
  parseStandaloneAuditJob,
  standaloneAuditTerminalOutcome,
  type StandaloneAuditKind,
} from "../src/renderer/src/standalone-audit";

function completedJob(kind: StandaloneAuditKind, snapshot: unknown) {
  return parseStandaloneAuditJob({
    jobId: "84ec9cda-e878-4e87-984e-65c8c5652cee",
    contextId: "94ec9cda-e878-4e87-984e-65c8c5652cef",
    kind,
    marketplaceId: "ATVPDKIKX0DER",
    mode: "live",
    options: kind === "subscription" ? { months: 6 } : {},
    ready: true,
    status: "completed",
    progress: {
      stage: "complete",
      message: "完成",
      completedUnits: 1,
      totalUnits: 1,
    },
    snapshot,
  }, {
    kind,
    marketplaceId: "ATVPDKIKX0DER",
    mode: "live",
  });
}

describe("dashboard audit background observation", () => {
  it("keys independent main-owned jobs by exact marketplace and audit kind", () => {
    expect(standaloneAuditDashboardKey("ATVPDKIKX0DER", "content"))
      .toBe("ATVPDKIKX0DER\u0000content");
    expect(standaloneAuditDashboardKey("ATVPDKIKX0DER", "agedInventory"))
      .not.toBe(standaloneAuditDashboardKey("ATVPDKIKX0DER", "content"));
    expect(auditSuiteLaunchFailureKey(
      "ATVPDKIKX0DER",
      "live",
      "businessPricing",
    )).not.toBe(auditSuiteLaunchFailureKey(
      "ATVPDKIKX0DER",
      "demo",
      "businessPricing",
    ));
  });

  it("does not let a late pending observation replace a terminal job identity", () => {
    const terminal = {
      jobId: "84ec9cda-e878-4e87-984e-65c8c5652cee",
      contextId: "94ec9cda-e878-4e87-984e-65c8c5652cef",
      ready: true,
      status: "completed",
    } as const;
    const latePending = {
      ...terminal,
      ready: false,
      status: "running",
    } as const;
    const newJob = {
      ...latePending,
      jobId: "74ec9cda-e878-4e87-984e-65c8c5652ced",
    } as const;

    expect(mergeAuditJobObservation(terminal, latePending)).toBe(terminal);
    expect(mergeAuditJobObservation(terminal, newJob)).toBe(newJob);
  });

  it("keeps a launch failure fenced from observations of the blocked old job", () => {
    const oldJob = {
      jobId: "84ec9cda-e878-4e87-984e-65c8c5652cee",
      contextId: "94ec9cda-e878-4e87-984e-65c8c5652cef",
    };
    const failure = {
      message: "本次未能啟動。",
      blockedJobIdentity: `${oldJob.jobId}\u0000${oldJob.contextId}`,
    };

    expect(shouldClearAuditSuiteLaunchFailure(failure, oldJob)).toBe(false);
    expect(shouldClearAuditSuiteLaunchFailure(failure, {
      ...oldJob,
      jobId: "74ec9cda-e878-4e87-984e-65c8c5652ced",
    })).toBe(true);
  });

  it("hides old cached output for launch failures and newer failed jobs", () => {
    const snapshot = {
      marketplaceId: "ATVPDKIKX0DER",
      fetchedAt: "2026-08-22T03:00:00.000Z",
    };
    const failedJob = {
      jobId: "74ec9cda-e878-4e87-984e-65c8c5652ced",
      contextId: "64ec9cda-e878-4e87-984e-65c8c5652cec",
      marketplaceId: "ATVPDKIKX0DER",
      ready: true,
      status: "failed",
    };
    const launchFailure = {
      message: "本次未能啟動。",
      blockedJobIdentity: null,
    };

    expect(auditSnapshotMatchesCurrentAttempt(snapshot, failedJob, null)).toBe(false);
    expect(auditSnapshotMatchesCurrentAttempt(snapshot, null, launchFailure)).toBe(false);
    expect(auditSnapshotMatchesCurrentAttempt(snapshot, {
      ...failedJob,
      status: "completed",
      snapshot,
    }, null)).toBe(true);

    const cached = { ATVPDKIKX0DER: snapshot, A2EUQ1WTGCTBG2: snapshot };
    const masked = auditCacheForMarketplace(cached, "ATVPDKIKX0DER", null);
    expect(masked).not.toHaveProperty("ATVPDKIKX0DER");
    expect(masked.A2EUQ1WTGCTBG2).toBe(snapshot);
    expect(cached).toHaveProperty("ATVPDKIKX0DER");
  });

  it("shows a cached count only when terminal time and marketplace match", () => {
    const exportId = "11111111-1111-4111-8111-111111111111";
    const job = parseStandaloneAuditJob({
      jobId: "84ec9cda-e878-4e87-984e-65c8c5652cee",
      contextId: "94ec9cda-e878-4e87-984e-65c8c5652cef",
      kind: "content",
      marketplaceId: "ATVPDKIKX0DER",
      mode: "live",
      options: {},
      ready: true,
      status: "completed",
      progress: {
        stage: "complete",
        message: "完成",
        completedUnits: 1,
        totalUnits: 1,
      },
      snapshot: {
        marketplaceId: "ATVPDKIKX0DER",
        fetchedAt: "2026-08-23T03:00:00.000Z",
        exportId,
      },
    }, {
      kind: "content",
      marketplaceId: "ATVPDKIKX0DER",
      mode: "live",
    });

    expect(standaloneAuditSnapshotMatchesJob({
      marketplaceId: "ATVPDKIKX0DER",
      fetchedAt: "2026-08-23T03:00:00.000Z",
      exportId,
    }, job)).toBe(true);
    expect(standaloneAuditSnapshotMatchesJob({
      marketplaceId: "ATVPDKIKX0DER",
      fetchedAt: "2026-08-22T03:00:00.000Z",
      exportId,
    }, job)).toBe(false);
    expect(standaloneAuditSnapshotMatchesJob({
      marketplaceId: "A2EUQ1WTGCTBG2",
      fetchedAt: "2026-08-23T03:00:00.000Z",
      exportId,
    }, job)).toBe(false);
  });

  it("does not reuse an audit cache without the exact current owned snapshot", () => {
    const fetchedAt = "2026-08-23T03:00:00.000Z";
    const exportId = "11111111-1111-4111-8111-111111111111";
    const job = completedJob("variation", {
      marketplaceId: "ATVPDKIKX0DER",
      mode: "live",
      fetchedAt,
      exportId,
    });
    const wrongMode = {
      marketplaceId: "ATVPDKIKX0DER",
      mode: "demo" as const,
      fetchedAt,
      exportId,
    };
    const wrongExport = {
      marketplaceId: "ATVPDKIKX0DER",
      mode: "live" as const,
      fetchedAt,
      exportId: "22222222-2222-4222-8222-222222222222",
    };

    expect(standaloneAuditSnapshotMatchesJob(wrongMode, job)).toBe(false);
    expect(standaloneAuditSnapshotMatchesJob(wrongExport, job)).toBe(false);
    expect(standaloneAuditSnapshotMatchesJob(wrongMode, null)).toBe(false);

    const legacyBusinessCache = {
      marketplaceId: "ATVPDKIKX0DER",
      mode: "live" as const,
      fetchedAt,
    };
    expect(standaloneAuditSnapshotMatchesJob(
      legacyBusinessCache,
      completedJob("businessPricing", {
        ...legacyBusinessCache,
        exportId,
      }),
    )).toBe(true);
  });

  it("keeps terminal home status fail-honest before a drawer parses the snapshot", () => {
    expect(standaloneAuditTerminalOutcome(completedJob("content", {
      marketplaceId: "ATVPDKIKX0DER",
      rows: [],
    }))).toBe("partial");
    expect(standaloneAuditTerminalOutcome(completedJob("content", {
      marketplaceId: "ATVPDKIKX0DER",
      fetchedAt: "2026-08-23T03:00:00.000Z",
      exportId: "11111111-1111-4111-8111-111111111111",
      rows: [],
      summary: {
        total: 0,
        completed: 0,
        incomplete: 0,
      },
    }))).toBe("success");
    expect(standaloneAuditTerminalOutcome(completedJob("image", {
      marketplaceId: "ATVPDKIKX0DER",
      summary: { incomplete: 0 },
    }))).toBe("partial");
    expect(standaloneAuditTerminalOutcome(completedJob("image", {
      marketplaceId: "ATVPDKIKX0DER",
      fetchedAt: "2026-08-23T03:00:00.000Z",
      minimumImages: 6,
      rows: [],
      summary: { total: 0, completed: 0, incomplete: 0, underMinimum: 0 },
    }))).toBe("success");
    expect(standaloneAuditTerminalOutcome(completedJob("variation", {
      marketplaceId: "ATVPDKIKX0DER",
      summary: { incomplete: 2 },
    }))).toBe("partial");
    expect(standaloneAuditTerminalOutcome(completedJob("subscription", {
      marketplaceId: "ATVPDKIKX0DER",
      inventoryEvidence: { coverage: "complete" },
      upstreamCoverage: { status: "complete" },
      summary: { revenueCoverage: { status: "partial" } },
    }))).toBe("partial");
    expect(standaloneAuditTerminalOutcome(completedJob("advertising", {
      marketplaceId: "ATVPDKIKX0DER",
      schemaVersion: 1,
      rows: [],
      summary: {},
    }))).toBe("partial");
    expect(standaloneAuditTerminalOutcome(completedJob("advertising", {
      schemaVersion: 1,
      mode: "live",
      marketplaceId: "ATVPDKIKX0DER",
      marketplaceCode: "US",
      fetchedAt: "2026-08-23T03:00:00.000Z",
      rows: [],
      uncovered: [],
      summary: {
        currentFbaSkuCount: 0,
        coveredSkuCount: 0,
        directSkuCount: 0,
        sameAsinCount: 0,
        uncoveredSkuCount: 0,
        eligibleCampaignCount: 0,
        ignoredInactiveCampaignCount: 0,
        ignoredMalformedCampaignCount: 0,
      },
      rule: "SKU exact first, same-ASIN supplement second.",
      notice: "完整唯讀驗收快照。",
    }))).toBe("success");
    expect(standaloneAuditTerminalOutcome(completedJob("advertising", {
      marketplaceId: "ATVPDKIKX0DER",
    }))).toBe("partial");
  });

  it("observes every individual audit from home and reconnects drawers to the same job", () => {
    const source = readFileSync(
      new URL("../src/renderer/src/components/dashboard.tsx", import.meta.url),
      "utf8",
    );

    for (const kind of [
      "content",
      "image",
      "variation",
      "subscription",
      "businessPricing",
      "advertising",
      "agedInventory",
    ]) {
      expect(source).toContain(`currentStandaloneJob("${kind}")`);
    }
    expect(source).toContain("observeStandaloneAuditJob({");
    expect(source).toContain("activeStandaloneAuditIdentity");
    expect(source).toContain("onAuditJobChange={cacheStandaloneAuditJob}");
    expect(source).toContain("onJobChange={cacheStandaloneAuditJob}");
    expect(source).toContain("onCoverageAuditJobChange={cacheStandaloneAuditJob}");
    expect(source).toContain("已完成");
    expect(source).toContain("點開查看並載入本次結果");
    expect(source).not.toContain("點開完成本機字典檢查並查看已核對結果");

    // A+ remains its specialized main-owned coordinator but uses the same
    // home-observer handoff behavior.
    expect(source).toContain("observeAplusAuditJob({");
    expect(source).toContain("onJobChange={cacheAplusAuditJob}");
  });

  it("routes the one-click launcher into the exact same card-owned job stores", () => {
    const dashboardSource = readFileSync(
      new URL("../src/renderer/src/components/dashboard.tsx", import.meta.url),
      "utf8",
    );
    const launcherSource = readFileSync(
      new URL("../src/renderer/src/components/audit-suite-home-card.tsx", import.meta.url),
      "utf8",
    );

    expect(dashboardSource).toContain("onStandaloneJobChange={cacheStandaloneAuditJob}");
    expect(dashboardSource).toContain("onAplusJobChange={cacheAplusAuditJob}");
    expect(dashboardSource).toContain("onStartFailure={(sectionId, message)");
    expect(dashboardSource).toContain("currentBusinessPricingLaunchFailure");
    expect(dashboardSource).toContain("auditLaunchFailureStatus");
    expect(dashboardSource).toContain("mode={currentStandaloneMode}");
    expect(launcherSource).toContain("startStandaloneAuditJob");
    expect(launcherSource).toContain("startAplusAuditJob");
    expect(launcherSource).not.toContain('fetch("/api/sp-api/audit-suite"');
    expect(launcherSource).not.toContain("audit-suite-section-grid");
    expect(dashboardSource).toContain("查看未完成的 A+ 健檢");
  });

  it("wires every standalone panel to the pending-to-terminal reconnect revision", () => {
    for (const file of [
      "content-audit-panel.tsx",
      "image-audit-panel.tsx",
      "unbound-variation-audit-panel.tsx",
      "subscription-audit-panel.tsx",
      "advertising-coverage-panel.tsx",
      "aged-inventory-panel.tsx",
    ]) {
      const source = readFileSync(
        new URL(`../src/renderer/src/components/${file}`, import.meta.url),
        "utf8",
      );
      expect(source, file).toContain("standaloneAuditReconnectRevision(initialJob)");
      expect(source, file).toContain("shouldResumeStandaloneAuditJob({");
      expect(source, file).toContain("abortRef.current === controller");
    }
  });
});
