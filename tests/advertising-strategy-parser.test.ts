import { describe, expect, it } from "vitest";
import { parseAdvertisingStrategySnapshot } from "../src/renderer/src/advertising-strategy";
import {
  ADVERTISING_STRATEGY_EXPECTED,
  advertisingStrategySnapshotFixture,
} from "./advertising-strategy-fixture";

describe("advertising strategy renderer parser", () => {
  it("accepts an exact snapshot and preserves explicit zero and three source timestamps", () => {
    const parsed = parseAdvertisingStrategySnapshot(
      advertisingStrategySnapshotFixture(),
      ADVERTISING_STRATEGY_EXPECTED,
    );
    expect(parsed.sourceFetchedAt).toEqual({
      fba: "2026-08-08T02:00:00.000Z",
      sales: "2026-08-08T02:15:00.000Z",
      ads: "2026-08-08T02:30:00.000Z",
    });
    expect(parsed.rows.find((row) => row.sellerSku === "SKU-B")).toMatchObject({
      salesAmount: 0,
      spSpend: 5,
      spSales14d: 0,
      spActualAcos: null,
      spActualAcosStatus: "no-sales",
      spPurchases14d: 0,
    });
    expect(parsed.rows.every((row) => row.price === null)).toBe(true);
    expect(parsed.coverage).toMatchObject({
      salesUnresolvedSourceRowCount: 2,
      salesAnonymousUnprovenSourceRowCount: 1,
      spUnresolvedSourceRowCount: 1,
      spAnonymousUnprovenSourceRowCount: 1,
    });
    expect(parsed.unresolved).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "sales",
        sellerSku: "SKU-C",
        asin: "B000000004",
        code: "sales-sku-asin-mismatch",
        fbaEvidence: "exact-seller-sku",
      }),
    ]));
    const rendererPayload = JSON.stringify(parsed);
    expect(rendererPayload).not.toContain("SKU-X");
    expect(rendererPayload).not.toContain("B000000009");
  });

  it("rejects the wrong marketplace, range, currency, or malformed source time", () => {
    const snapshot = advertisingStrategySnapshotFixture();
    expect(() => parseAdvertisingStrategySnapshot(snapshot, {
      ...ADVERTISING_STRATEGY_EXPECTED,
      marketplaceId: "A2EUQ1WTGCTBG2",
    })).toThrow(/安全辨識/u);
    expect(() => parseAdvertisingStrategySnapshot(snapshot, {
      ...ADVERTISING_STRATEGY_EXPECTED,
      endDate: "2026-08-08",
    })).toThrow(/安全辨識/u);
    expect(() => parseAdvertisingStrategySnapshot(snapshot, {
      ...ADVERTISING_STRATEGY_EXPECTED,
      currencyCode: "CAD",
    })).toThrow(/安全辨識/u);
    const tampered = structuredClone(snapshot);
    tampered.sourceFetchedAt.ads = "2026-08-08";
    expect(() => parseAdvertisingStrategySnapshot(
      tampered,
      ADVERTISING_STRATEGY_EXPECTED,
    )).toThrow(/安全辨識/u);
  });

  it("rejects summary, coverage, ranking, tier, and default-suggestion drift", () => {
    const summaryDrift = advertisingStrategySnapshotFixture();
    summaryDrift.summary.sourceSpSpend += 1;
    expect(() => parseAdvertisingStrategySnapshot(
      summaryDrift,
      ADVERTISING_STRATEGY_EXPECTED,
    )).toThrow(/加總/u);

    const coverageDrift = advertisingStrategySnapshotFixture();
    coverageDrift.coverage.spResolvedSourceRowCount += 1;
    expect(() => parseAdvertisingStrategySnapshot(
      coverageDrift,
      ADVERTISING_STRATEGY_EXPECTED,
    )).toThrow(/覆蓋加總/u);

    const unprovenMetricsInSummary = advertisingStrategySnapshotFixture();
    unprovenMetricsInSummary.summary.unresolvedSalesAmount += 30;
    unprovenMetricsInSummary.summary.sourceSalesAmount += 30;
    expect(() => parseAdvertisingStrategySnapshot(
      unprovenMetricsInSummary,
      ADVERTISING_STRATEGY_EXPECTED,
    )).toThrow(/加總/u);

    const rankDrift = advertisingStrategySnapshotFixture();
    rankDrift.rows[0].salesRank = 2;
    expect(() => parseAdvertisingStrategySnapshot(
      rankDrift,
      ADVERTISING_STRATEGY_EXPECTED,
    )).toThrow(/排名/u);

    const tierDrift = advertisingStrategySnapshotFixture();
    tierDrift.rows[0].salesTier = "T4";
    tierDrift.rows[0].suggestedSpDailyBudget = 50;
    tierDrift.rows[0].suggestedSpTargetAcos = 0.5;
    expect(() => parseAdvertisingStrategySnapshot(
      tierDrift,
      ADVERTISING_STRATEGY_EXPECTED,
    )).toThrow(/分級/u);

    const suggestionDrift = advertisingStrategySnapshotFixture();
    suggestionDrift.rows[0].suggestedSpDailyBudget = 999;
    expect(() => parseAdvertisingStrategySnapshot(
      suggestionDrift,
      ADVERTISING_STRATEGY_EXPECTED,
    )).toThrow(/銷售報表狀態/u);
  });

  it("rejects an invented zero, a divided-by-zero ACoS, and manual-field data", () => {
    const inventedZero = advertisingStrategySnapshotFixture();
    const notReported = inventedZero.rows.find((row) => row.sellerSku === "SKU-C")!;
    notReported.salesAmount = 0;
    expect(() => parseAdvertisingStrategySnapshot(
      inventedZero,
      ADVERTISING_STRATEGY_EXPECTED,
    )).toThrow(/狀態與明細/u);

    const dividedByZero = advertisingStrategySnapshotFixture();
    const zeroSales = dividedByZero.rows.find((row) => row.sellerSku === "SKU-B")!;
    zeroSales.spActualAcos = Number.POSITIVE_INFINITY;
    zeroSales.spActualAcosStatus = "reported";
    expect(() => parseAdvertisingStrategySnapshot(
      dividedByZero,
      ADVERTISING_STRATEGY_EXPECTED,
    )).toThrow(/SP 報表狀態/u);

    const inventedManualValue = advertisingStrategySnapshotFixture();
    (inventedManualValue.rows[0] as unknown as { sbSales: number }).sbSales = 100;
    expect(() => parseAdvertisingStrategySnapshot(
      inventedManualValue,
      ADVERTISING_STRATEGY_EXPECTED,
    )).toThrow(/安全辨識/u);

    const inventedPrice = advertisingStrategySnapshotFixture();
    (inventedPrice.rows[0] as unknown as { price: number }).price = 19.99;
    expect(() => parseAdvertisingStrategySnapshot(
      inventedPrice,
      ADVERTISING_STRATEGY_EXPECTED,
    )).toThrow(/安全辨識/u);
  });

  it("rejects zero-width and bidi controls in Seller SKU or title", () => {
    const hiddenSku = advertisingStrategySnapshotFixture();
    (hiddenSku.rows[0] as unknown as { sellerSku: string }).sellerSku = "SKU\u2066-A";
    expect(() => parseAdvertisingStrategySnapshot(
      hiddenSku,
      ADVERTISING_STRATEGY_EXPECTED,
    )).toThrow(/安全辨識/u);

    const bidiTitle = advertisingStrategySnapshotFixture();
    (bidiTitle.rows[0] as unknown as { title: string }).title = "Synthetic\u202e title";
    expect(() => parseAdvertisingStrategySnapshot(
      bidiTitle,
      ADVERTISING_STRATEGY_EXPECTED,
    )).toThrow(/安全辨識/u);
  });

  it("rejects unresolved detail without exact current-FBA evidence or with a data-bearing message", () => {
    const unknownSku = advertisingStrategySnapshotFixture();
    unknownSku.unresolved[0]!.sellerSku = "SKU-X";
    expect(() => parseAdvertisingStrategySnapshot(
      unknownSku,
      ADVERTISING_STRATEGY_EXPECTED,
    )).toThrow(/exact current-FBA/u);

    const dataBearingMessage = advertisingStrategySnapshotFixture();
    dataBearingMessage.unresolved[0]!.message += " raw SKU-X";
    expect(() => parseAdvertisingStrategySnapshot(
      dataBearingMessage,
      ADVERTISING_STRATEGY_EXPECTED,
    )).toThrow(/未完成明細/u);

    const missingAnonymousCount = advertisingStrategySnapshotFixture();
    delete (missingAnonymousCount.coverage as unknown as Record<string, unknown>)
      .salesAnonymousUnprovenSourceRowCount;
    expect(() => parseAdvertisingStrategySnapshot(
      missingAnonymousCount,
      ADVERTISING_STRATEGY_EXPECTED,
    )).toThrow(/覆蓋加總/u);
  });

  it("rejects oversized row arrays before mapping them", () => {
    const tooManyRows = advertisingStrategySnapshotFixture();
    (tooManyRows as unknown as { rows: unknown[] }).rows = new Array(100_001);
    expect(() => parseAdvertisingStrategySnapshot(
      tooManyRows,
      ADVERTISING_STRATEGY_EXPECTED,
    )).toThrow(/安全辨識/u);

    const tooManyUnresolved = advertisingStrategySnapshotFixture();
    (tooManyUnresolved as unknown as { unresolved: unknown[] }).unresolved = new Array(150_001);
    expect(() => parseAdvertisingStrategySnapshot(
      tooManyUnresolved,
      ADVERTISING_STRATEGY_EXPECTED,
    )).toThrow(/安全辨識/u);
  });
});
