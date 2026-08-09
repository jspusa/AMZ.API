import { afterEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import type { BrandSalesSnapshot } from "../src/renderer/src/brand-sales";
import {
  clearBrandSalesSnapshotCache,
  parseBrandSalesJob,
  readBrandSalesSnapshotCache,
  storeBrandSalesSnapshotCache,
} from "../src/renderer/src/components/brand-sales-card";

const expected = {
  marketplaceId: "ATVPDKIKX0DER",
  startDate: "2026-08-01",
  endDate: "2026-08-07",
};

describe("brand sales report job", () => {
  afterEach(() => clearBrandSalesSnapshotCache());

  it("accepts only the exact selected marketplace, dates and coherent ready state", () => {
    const job = {
      jobId: "demo-brand-1234",
      mode: "demo",
      ...expected,
      expiresAt: "2026-08-08T01:00:00.000Z",
      ready: false,
      status: "IN_QUEUE",
      message: "Amazon 正在準備報表。",
    };
    expect(parseBrandSalesJob(job, expected).jobId).toBe(job.jobId);
    expect(() => parseBrandSalesJob({ ...job, marketplaceId: "A2EUQ1WTGCTBG2" }, expected)).toThrow(/無法辨識/u);
    expect(() => parseBrandSalesJob({ ...job, ready: true }, expected)).toThrow(/無法辨識/u);
  });

  it("reuses only the exact main-minted job, mode, marketplace and date range", () => {
    const base = {
      jobId: "demo-brand-1234",
      mode: "demo" as const,
      ...expected,
      expiresAt: "2026-08-08T01:00:00.000Z",
      ready: true,
      status: "DONE" as const,
      message: "done",
    };
    const job = parseBrandSalesJob(base, expected);
    const cached = {
      mode: "demo",
      ...expected,
    } as BrandSalesSnapshot;
    storeBrandSalesSnapshotCache(job, cached, Date.parse("2026-08-08T00:00:00.000Z"));
    expect(readBrandSalesSnapshotCache(job, Date.parse("2026-08-08T00:30:00.000Z"))).toBe(cached);

    const anotherAccountJob = parseBrandSalesJob(
      { ...base, jobId: "demo-brand-5678" },
      expected,
    );
    expect(readBrandSalesSnapshotCache(anotherAccountJob, Date.parse("2026-08-08T00:30:00.000Z"))).toBeNull();
    const anotherModeJob = parseBrandSalesJob(
      { ...base, mode: "live" },
      expected,
    );
    expect(readBrandSalesSnapshotCache(anotherModeJob, Date.parse("2026-08-08T00:30:00.000Z"))).toBeNull();
    expect(readBrandSalesSnapshotCache(job, Date.parse("2026-08-08T01:00:00.000Z"))).toBeNull();
  });

  it("asks trusted main for the account-scoped job before consulting the cache", async () => {
    const source = await readFile(
      new URL(
        "../src/renderer/src/components/brand-sales-card.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source.indexOf("const started = parseJob")).toBeLessThan(
      source.indexOf("readBrandSalesSnapshotCache(job)"),
    );
    expect(source).toContain("jobId is minted and account-scoped by trusted main");
    expect(source).toContain("[endDate, marketplaceId, startDate]");
    expect(source).toContain("automaticSelectionRef");
    expect(source).toContain("automaticSelectionRef.current === selectionKey");
    expect(source).toContain("void sync(false)");
    expect(source).toContain("onRetry={() => void sync(true)}");
    expect(source).toContain("...(explicitRetry ? { retry: true } : {})");
    expect(source).toContain("job.ready && !explicitRetry");
    expect(source).toContain('snapshot?.rangeFreshness !== "includes-current-day"');
    expect(source).toContain("5 * 60 * 1_000");
    expect(source).toContain('code === "REPORT_CANCELLED"');
    expect(source).toContain('code === "REPORT_FATAL"');
    expect(source).not.toContain("for (let postAttempt");
  });
});
