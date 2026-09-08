import { describe, expect, it } from "vitest";
import { buildAdvertisingDiagnostics } from "../src/main/amazon/advertising-diagnostics";
import { buildAdvertisingStrategySnapshot } from "../src/main/amazon/advertising-strategy";
import { OperationsEvents } from "../src/main/operations-events";
import type { AdvertisingStrategyAdsRow } from "../src/shared/advertising-strategy";

function strategy(ads: readonly AdvertisingStrategyAdsRow[]) {
  return buildAdvertisingStrategySnapshot({
    marketplaceId: "ATVPDKIKX0DER",
    marketplaceCode: "US",
    dateRange: { startDate: "2026-08-01", endDate: "2026-08-07" },
    currencyCode: "USD",
    fetchedAt: "2026-08-08T03:00:00.000Z",
    sourceFetchedAt: {
      fba: "2026-08-08T02:00:00.000Z",
      sales: "2026-08-08T02:15:00.000Z",
      ads: "2026-08-08T02:30:00.000Z",
    },
    listings: [{ sellerSku: "SKU-A", asin: "B000000001", title: "Synthetic A" }],
    salesRows: [{
      sellerSku: "SKU-A", childAsin: "B000000001", unitsSold: 50,
      salesAmount: 1_000, currencyCode: "USD",
    }],
    spAdvertisedProductRows: ads,
  });
}

function ads(overrides: Partial<AdvertisingStrategyAdsRow> = {}): AdvertisingStrategyAdsRow {
  return {
    sellerSku: "SKU-A", asin: "B000000001", spend: 60,
    sales14d: 100, purchases14d: 2, currencyCode: "USD", ...overrides,
  };
}

describe("SP advertising performance diagnosis", () => {
  it("compares ACoS to the visible strategy suggestion using attributed sales, not overall SKU sales", () => {
    const result = buildAdvertisingDiagnostics(strategy([ads()]), "live");
    expect(result).toMatchObject({
      kind: "advertising", mode: "live", coverage: "complete", currencyCode: "USD",
      attributionWindowDays: 14,
      dateRange: { startDate: "2026-08-01", endDate: "2026-08-07" },
      rows: [{
        sellerSku: "SKU-A", asin: "B000000001", status: "needs-review",
        spend: 60, attributedSales14d: 100, purchases14d: 2,
        acos: 0.6, acosStatus: "reported", roas: 1.6666666666666667,
        roasStatus: "reported", suggestedAcos: 0.35,
      }],
      findings: [{ source: "advertising", sellerSku: "SKU-A", severity: "warning", title: "SP ACoS 高於建議門檻" }],
    });
    expect(result.rows[0].rationale.join(" ")).toContain("60.0%");
    expect(result.rows[0].rationale.join(" ")).toContain("35.0%");
    expect(result.notice).toContain("不是利潤");
    expect(result.notice).toContain("不會修改");
  });

  it("flags spend with explicitly zero attributed sales without inventing infinite ACoS", () => {
    const result = buildAdvertisingDiagnostics(strategy([ads({ spend: 5, sales14d: 0, purchases14d: 0 })]), "live");
    expect(result.rows[0]).toMatchObject({
      status: "needs-review", spend: 5, attributedSales14d: 0, purchases14d: 0,
      acos: null, acosStatus: "no-sales", roas: 0, roasStatus: "reported",
    });
    expect(result.findings).toEqual([expect.objectContaining({
      title: "SP 已有花費但尚無歸因銷售", severity: "warning",
    })]);
    expect(result.findings[0].detail).toContain("5 USD");
    expect(result.findings[0].detail).toContain("回補");
  });

  it("keeps missing or partially reported metrics unknown instead of treating missing sales as zero", () => {
    const missing = buildAdvertisingDiagnostics(strategy([]), "live");
    expect(missing.rows[0]).toMatchObject({
      status: "insufficient-evidence", spend: null, attributedSales14d: null,
      purchases14d: null, acos: null, acosStatus: "not-reported", roas: null,
      roasStatus: "not-reported",
    });
    expect(missing.coverage).toBe("partial");
    expect(missing.findings).toEqual([expect.objectContaining({ title: "SP 診斷資料未完整", severity: "info" })]);
    const partial = buildAdvertisingDiagnostics(strategy([
      ads({ spend: 2, sales14d: 10, purchases14d: 1 }),
      ads({ spend: 3, sales14d: null, purchases14d: null }),
    ]), "live");
    expect(partial.rows[0]).toMatchObject({
      status: "insufficient-evidence", spend: 5, attributedSales14d: null,
      purchases14d: null, acos: null, roas: null,
    });
    expect(partial.coverage).toBe("partial");
    expect(partial.findings.every((finding) => finding.severity === "info")).toBe(true);
  });

  it("does not divide by zero spend or equate no diagnostic signal with profitable advertising", () => {
    const result = buildAdvertisingDiagnostics(strategy([ads({ spend: 0, sales14d: 100 })]), "live");
    expect(result.rows[0]).toMatchObject({
      status: "no-signal", spend: 0, attributedSales14d: 100,
      acos: 0, acosStatus: "reported", roas: null, roasStatus: "no-spend",
    });
    expect(result.findings).toEqual([]);
    expect(result.rows[0].rationale.join(" ")).toContain("不是獲利判定");
    const boundary = buildAdvertisingDiagnostics(strategy([ads({ spend: 35, sales14d: 100 })]), "live");
    expect(boundary.rows[0].status).toBe("no-signal");
    expect(boundary.findings).toEqual([]);
  });

  it("does not diagnose complete SKU performance from an aggregate with unresolved current-SKU attribution", () => {
    const result = buildAdvertisingDiagnostics(strategy([
      ads({ spend: 5, sales14d: 0 }),
      ads({ asin: "B000000099", spend: 10, sales14d: 100 }),
    ]), "live");
    expect(result.rows[0]).toMatchObject({
      status: "insufficient-evidence", spend: 5, attributedSales14d: 0,
      acos: null, acosStatus: "not-reported", roas: null, roasStatus: "not-reported",
    });
    expect(result.coverage).toBe("partial");
    expect(result.findings).toEqual([expect.objectContaining({ title: "SP 診斷資料未完整" })]);
    expect(result.rows[0].rationale.join(" ")).toContain("未歸屬");
    expect(JSON.stringify(result)).not.toContain("B000000099");
  });

  it("marks anonymous attribution gaps partial without leaking out-of-scope identifiers or business amounts", () => {
    const snapshot = strategy([
      ads(), ads({ sellerSku: "OUTSIDE-ADS", asin: "B000000099", spend: 99_987 }),
    ]);
    const result = buildAdvertisingDiagnostics(snapshot, "live");
    expect(result.coverage).toBe("partial");
    expect(result.warnings.join(" ")).toContain("未歸屬");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].spend).toBe(60);
    expect(JSON.stringify(result)).not.toContain("OUTSIDE-ADS");
    expect(JSON.stringify(result)).not.toContain("B000000099");
    expect(JSON.stringify(result)).not.toContain("99987");
  });

  it("leaves an unrepresentable ROAS unavailable instead of emitting Infinity", () => {
    const result = buildAdvertisingDiagnostics(strategy([ads({ spend: Number.MIN_VALUE })]), "live");
    expect(result.rows[0]).toMatchObject({
      status: "insufficient-evidence", roas: null, roasStatus: "not-reported",
    });
    expect(result.coverage).toBe("partial");
    expect(result.rows[0].rationale.join(" ")).toContain("安全表示");
  });

  it("rejects conflicting or unsafe current-FBA snapshot identities before publishing diagnosis", () => {
    const duplicate = strategy([ads()]);
    duplicate.rows.push({ ...duplicate.rows[0] });
    expect(() => buildAdvertisingDiagnostics(duplicate, "live")).toThrow(/FBA/u);
    const unsafe = strategy([ads()]);
    unsafe.rows[0].sellerSku = "SKU\u200b-A";
    expect(() => buildAdvertisingDiagnostics(unsafe, "live")).toThrow(/FBA/u);
    const currency = strategy([ads()]);
    currency.currencyCode = "JPY";
    expect(() => buildAdvertisingDiagnostics(currency, "live")).toThrow(/快照/u);
  });

  it("rejects invalid metrics and contradictory source statuses rather than publishing a false signal", () => {
    const invalid = strategy([ads()]);
    invalid.rows[0].spSpend = Number.NaN;
    expect(() => buildAdvertisingDiagnostics(invalid, "live")).toThrow(/數值/u);
    const contradicted = strategy([ads()]);
    contradicted.rows[0].spStatus = "not-reported";
    expect(() => buildAdvertisingDiagnostics(contradicted, "live")).toThrow(/數值/u);
    const wrongRatio = strategy([ads()]);
    wrongRatio.rows[0].spActualAcos = 0.01;
    expect(() => buildAdvertisingDiagnostics(wrongRatio, "live")).toThrow(/數值/u);
  });

  it("preserves source evidence times and rejects invalid or reversed report dates", () => {
    const source = strategy([ads()]);
    const result = buildAdvertisingDiagnostics(source, "demo");
    expect(result).toMatchObject({
      mode: "demo", fetchedAt: "2026-08-08T03:00:00.000Z",
      sourceFetchedAt: {
        fba: "2026-08-08T02:00:00.000Z", sales: "2026-08-08T02:15:00.000Z", ads: "2026-08-08T02:30:00.000Z",
      },
    });
    source.sourceFetchedAt.ads = "invalid-time";
    expect(() => buildAdvertisingDiagnostics(source, "live")).toThrow(/快照/u);
    const reversed = strategy([ads()]);
    reversed.dateRange.endDate = "2026-07-01";
    expect(() => buildAdvertisingDiagnostics(reversed, "live")).toThrow(/快照/u);
  });

  it("labels demo evidence and keeps opaque finding identity stable when report values change", () => {
    const initial = buildAdvertisingDiagnostics(strategy([ads()]), "demo");
    expect(initial.notice).toContain("展示資料");
    const next = buildAdvertisingDiagnostics(strategy([ads({ spend: 80 })]), "demo");
    expect(next.findings[0].key).toBe(initial.findings[0].key);
    expect(initial.findings[0].key).toMatch(/^advertising\.[a-f0-9]{24}\.high-acos$/u);
    expect(initial.findings[0].key).not.toContain("SKU-A");
    expect(initial.findings[0].key).not.toContain("B000000001");
    expect(next.rows[0].spend).toBe(80);
  });

  it("publishes real diagnostic findings through the event owner's public safety boundary and preserves acknowledgement", () => {
    const events = new OperationsEvents({ marketplaceId: "ATVPDKIKX0DER", mode: "live" });
    events.observe("advertising", buildAdvertisingDiagnostics(strategy([ads()]), "live"));
    const first = events.read().events[0];
    expect(events.read()).toMatchObject({
      omittedEventCount: 0,
      events: [{ source: "advertising", sellerSku: "SKU-A", title: "SP ACoS 高於建議門檻", status: "open" }],
    });
    expect(events.acknowledge(first.id, "acknowledged")).toBe(true);
    const laterSource = strategy([ads({ spend: 80 })]);
    laterSource.fetchedAt = "2026-08-08T04:00:00.000Z";
    events.observe("advertising", buildAdvertisingDiagnostics(laterSource, "live"));
    expect(events.read().events).toEqual([expect.objectContaining({
      id: first.id, status: "acknowledged", lastObservedAt: "2026-08-08T04:00:00.000Z",
      detail: "SP ACoS 80.0% 高於可人工覆寫的建議 35.0%；請核對目標與 14 日歸因回補。",
    })]);
  });

  it("bounds findings from 5000 FBA rows and explicitly marks omitted notification evidence partial", () => {
    const listings = Array.from({ length: 5_000 }, (_, index) => ({
      sellerSku: `LARGE-${index + 1}`,
      asin: `B${String(index + 1).padStart(9, "0")}`,
      title: "Synthetic large catalog row",
    }));
    const source = buildAdvertisingStrategySnapshot({
      ...strategy([]),
      listings,
      salesRows: [],
      spAdvertisedProductRows: listings.map((listing) => ads({
        sellerSku: listing.sellerSku, asin: listing.asin,
        spend: 1, sales14d: 0, purchases14d: 0,
      })),
    });
    const result = buildAdvertisingDiagnostics(source, "live");

    expect(result.rows).toHaveLength(5_000);
    expect(result.findings).toHaveLength(5_000);
    expect(result.coverage).toBe("partial");
    expect(result.warnings).toContain("廣告通知達到 5000 筆安全上限，另有 5000 筆未納入通知；診斷列仍保留，不能以本次結果判定舊通知已解除。");
  });
});
