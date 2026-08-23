import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  standaloneAuditDashboardKey,
  standaloneAuditSnapshotMatchesJob,
} from "../src/renderer/src/components/dashboard";
import {
  mergeAuditJobObservation,
  parseStandaloneAuditJob,
} from "../src/renderer/src/standalone-audit";

describe("dashboard audit background observation", () => {
  it("keys independent main-owned jobs by exact marketplace and audit kind", () => {
    expect(standaloneAuditDashboardKey("ATVPDKIKX0DER", "content"))
      .toBe("ATVPDKIKX0DER\u0000content");
    expect(standaloneAuditDashboardKey("ATVPDKIKX0DER", "agedInventory"))
      .not.toBe(standaloneAuditDashboardKey("ATVPDKIKX0DER", "content"));
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

  it("shows a cached count only when terminal time and marketplace match", () => {
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
      },
    }, {
      kind: "content",
      marketplaceId: "ATVPDKIKX0DER",
      mode: "live",
    });

    expect(standaloneAuditSnapshotMatchesJob({
      marketplaceId: "ATVPDKIKX0DER",
      fetchedAt: "2026-08-23T03:00:00.000Z",
    }, job)).toBe(true);
    expect(standaloneAuditSnapshotMatchesJob({
      marketplaceId: "ATVPDKIKX0DER",
      fetchedAt: "2026-08-22T03:00:00.000Z",
    }, job)).toBe(false);
    expect(standaloneAuditSnapshotMatchesJob({
      marketplaceId: "A2EUQ1WTGCTBG2",
      fetchedAt: "2026-08-23T03:00:00.000Z",
    }, job)).toBe(false);
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

    // A+ remains its specialized main-owned coordinator but uses the same
    // home-observer handoff behavior.
    expect(source).toContain("observeAplusAuditJob({");
    expect(source).toContain("onJobChange={cacheAplusAuditJob}");
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
