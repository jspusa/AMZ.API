import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { parseBrandSalesJob } from "../src/renderer/src/components/brand-sales-card";

const expected = {
  marketplaceId: "ATVPDKIKX0DER",
  startDate: "2026-08-01",
  endDate: "2026-08-07",
};

describe("brand sales report job", () => {
  it("accepts only the exact selected marketplace, dates and coherent ready state", () => {
    const job = {
      jobId: "demo-brand-1234",
      mode: "demo",
      ...expected,
      ready: false,
      status: "IN_QUEUE",
      message: "Amazon 正在準備報表。",
    };
    expect(parseBrandSalesJob(job, expected).jobId).toBe(job.jobId);
    expect(() => parseBrandSalesJob({ ...job, marketplaceId: "A2EUQ1WTGCTBG2" }, expected)).toThrow(/無法辨識/u);
    expect(() => parseBrandSalesJob({ ...job, ready: true }, expected)).toThrow(/無法辨識/u);
  });

  it("keeps no cross-account module cache for brand revenue", async () => {
    const source = await readFile(
      new URL(
        "../src/renderer/src/components/brand-sales-card.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).not.toContain("const cache = new Map");
    expect(source).toContain("setSnapshot(null)");
    expect(source).toContain("[marketplaceId, startDate, endDate]");
  });
});
