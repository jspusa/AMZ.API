import { createHash } from "node:crypto";
import type { AdvertisingStrategySnapshot } from "../../shared/advertising-strategy";
import type {
  AdvertisingDiagnosticRow,
  AdvertisingDiagnosticsSnapshot,
} from "../../shared/advertising-diagnostics";
import type { OperationsFinding } from "../../shared/operations-intelligence";
import { marketplaceById } from "../../shared/marketplaces";

const MAX_METRIC = 1_000_000_000_000;
const MAX_FINDINGS = 5_000;

function nullableMetric(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) &&
    value >= 0 && value <= MAX_METRIC);
}

function exactInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { return new Date(value).toISOString() === value; } catch { return false; }
}

function exactDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
    exactInstant(`${value}T00:00:00.000Z`);
}

function assertCurrentFbaSnapshot(snapshot: AdvertisingStrategySnapshot): void {
  if (snapshot.schemaVersion !== 1 ||
    marketplaceById(snapshot.marketplaceId)?.currency !== snapshot.currencyCode ||
    !exactDate(snapshot.dateRange.startDate) || !exactDate(snapshot.dateRange.endDate) ||
    snapshot.dateRange.startDate > snapshot.dateRange.endDate ||
    ![snapshot.fetchedAt, snapshot.sourceFetchedAt.fba,
      snapshot.sourceFetchedAt.sales, snapshot.sourceFetchedAt.ads].every(exactInstant)) {
    throw new Error("廣告診斷快照站點、幣別或時間無法核對。");
  }
  if (!Array.isArray(snapshot.rows) || snapshot.rows.length > 100_000 ||
    snapshot.coverage.currentFbaSkuCount !== snapshot.rows.length) {
    throw new Error("廣告診斷目前 FBA 範圍無法核對。");
  }
  const seen = new Set<string>();
  for (const row of snapshot.rows) {
    if (typeof row.sellerSku !== "string" || !row.sellerSku.length ||
      row.sellerSku.length > 40 || row.sellerSku !== row.sellerSku.trim() ||
      /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u.test(row.sellerSku) ||
      !/^[A-Z0-9]{10}$/u.test(row.asin) || seen.has(row.sellerSku)) {
      throw new Error("廣告診斷目前 FBA 身分無法核對。");
    }
    seen.add(row.sellerSku);
    const expectedAcos = row.spSpend !== null && row.spSales14d !== null && row.spSales14d > 0
      ? row.spSpend / row.spSales14d : null;
    const expectedAcosStatus = row.spStatus === "not-reported" ? null
      : row.spSales14d === null ? "not-reported" : row.spSales14d === 0 ? "no-sales" : "reported";
    if (![row.spSpend, row.spSales14d, row.spPurchases14d, row.spActualAcos,
      row.suggestedSpTargetAcos].every(nullableMetric) ||
      (row.spPurchases14d !== null && !Number.isSafeInteger(row.spPurchases14d)) ||
      !["reported", "not-reported"].includes(row.spStatus) ||
      (row.spStatus === "reported" && (row.spSpend === null || row.spAttribution === null)) ||
      (row.spStatus === "not-reported" && (row.spSpend !== null || row.spSales14d !== null ||
        row.spPurchases14d !== null || row.spAttribution !== null)) ||
      row.spActualAcos !== expectedAcos || row.spActualAcosStatus !== expectedAcosStatus) {
      throw new Error("廣告診斷來源數值或回報狀態不一致。");
    }
  }
}

/** Pure projection of the existing, context-fenced SP strategy report snapshot. */
export function buildAdvertisingDiagnostics(
  snapshot: AdvertisingStrategySnapshot,
  mode: "live" | "demo",
): AdvertisingDiagnosticsSnapshot {
  assertCurrentFbaSnapshot(snapshot);
  const findings: OperationsFinding[] = [];
  let omittedFindings = 0;
  const recordFinding = (finding: OperationsFinding): void => {
    if (findings.length < MAX_FINDINGS) findings.push(finding);
    else omittedFindings += 1;
  };
  const warnings: string[] = [];
  const unassigned = snapshot.coverage.spUnresolvedSourceRowCount > 0 ||
    snapshot.coverage.salesUnresolvedSourceRowCount > 0;
  let partial = unassigned;
  if (unassigned) warnings.push("部分 Ads 或銷售來源列未歸屬至 exact 目前 FBA 身分；未核對識別碼與數字不納入診斷。");
  const unresolvedAdsSkus = new Set(snapshot.unresolved
    .filter((row) => row.source === "sp-advertised-product")
    .map((row) => row.sellerSku));
  const rows: AdvertisingDiagnosticRow[] = snapshot.rows.map((row) => {
    // Public observation identity, not an account-scope SHA-256 value.
    const key = `advertising.${createHash("sha256")
      .update(JSON.stringify([row.sellerSku, row.asin])).digest("hex").slice(0, 24)}`;
    const unresolved = unresolvedAdsSkus.has(row.sellerSku);
    const acos = unresolved ? null : row.spActualAcos;
    const rawRoas = !unresolved && row.spSpend !== null && row.spSpend > 0 && row.spSales14d !== null
      ? row.spSales14d / row.spSpend : null;
    const unsafeRoas = rawRoas !== null && (!Number.isFinite(rawRoas) || rawRoas > MAX_METRIC);
    const roas = unsafeRoas ? null : rawRoas;
    const suggestedAcos = row.suggestedSpTargetAcos;
    const highAcos = acos !== null && suggestedAcos !== null && acos > suggestedAcos;
    const rationale = highAcos
      ? [`SP ACoS ${(acos * 100).toFixed(1)}% 高於可人工覆寫的建議 ${(suggestedAcos * 100).toFixed(1)}%；請核對目標與 14 日歸因回補。`]
      : [];
    if (highAcos) recordFinding({
      key: `${key}.high-acos`, source: "advertising", sellerSku: row.sellerSku,
      severity: "warning", title: "SP ACoS 高於建議門檻", detail: rationale[0],
    });
    const spendWithoutSales = !unresolved && row.spSpend !== null && row.spSpend > 0 && row.spSales14d === 0;
    if (spendWithoutSales) {
      const detail = `SP 花費 ${row.spSpend} ${snapshot.currencyCode}，報表明確回報 14 日歸因銷售為 0；請先核對歸因回補與報表期間，不能直接推定沒有成交。`;
      rationale.push(detail);
      recordFinding({
        key: `${key}.spend-no-sales`, source: "advertising", sellerSku: row.sellerSku,
        severity: "warning", title: "SP 已有花費但尚無歸因銷售", detail,
      });
    }
    const incomplete = unresolved || unsafeRoas || row.spStatus !== "reported" || row.spSpend === null ||
      row.spSales14d === null || row.spPurchases14d === null || suggestedAcos === null;
    if (incomplete) {
      partial = true;
      const detail = unsafeRoas
        ? "ROAS 超過可安全表示範圍；保留來源金額，比例不以 Infinity 或 0 代替。"
        : unresolved
        ? "此 SKU 另有身分衝突的 SP 報表列未歸屬；顯示數值只涵蓋已核對部分，不計算整體 ACoS／ROAS 或零歸因銷售警示。"
        : row.spStatus !== "reported"
        ? "這個目前 FBA SKU 未有可歸屬的 SP 報表列；不等於沒有廣告或零花費。"
        : "部分歸因銷售、購買次數或策略建議未回報；保留已回報數字，不補 0，也不判定整體成效正常。";
      rationale.push(detail);
      recordFinding({
        key: `${key}.insufficient-evidence`, source: "advertising", sellerSku: row.sellerSku,
        severity: "info", title: "SP 診斷資料未完整", detail,
      });
    }
    if (!rationale.length) {
      rationale.push("目前已回報數值未命中高 ACoS 或有花費零歸因銷售規則；這不是獲利判定，也不代表所有投放都健康。");
    }
    return {
      key, sellerSku: row.sellerSku, asin: row.asin,
      status: highAcos || spendWithoutSales ? "needs-review" : incomplete ? "insufficient-evidence" : "no-signal",
      spend: row.spSpend, attributedSales14d: row.spSales14d,
      purchases14d: row.spPurchases14d,
      acos, acosStatus: unresolved ? "not-reported" : row.spActualAcosStatus ?? "not-reported",
      roas,
      roasStatus: unresolved || unsafeRoas ? "not-reported" : row.spSpend === 0 ? "no-spend"
        : row.spSpend === null || row.spSales14d === null ? "not-reported" : "reported",
      suggestedAcos, rationale,
    };
  });
  if (rows.some((row) => row.status === "insufficient-evidence")) {
    warnings.push("部分 SP 診斷證據未完整；空白不是 0，也不代表沒有廣告。");
  }
  if (omittedFindings > 0) {
    partial = true;
    warnings.push(`廣告通知達到 ${MAX_FINDINGS} 筆安全上限，另有 ${omittedFindings} 筆未納入通知；診斷列仍保留，不能以本次結果判定舊通知已解除。`);
  }
  return {
    kind: "advertising", marketplaceId: snapshot.marketplaceId, mode,
    fetchedAt: snapshot.fetchedAt, coverage: partial ? "partial" : "complete",
    warnings, findings,
    dateRange: { ...snapshot.dateRange }, currencyCode: snapshot.currencyCode,
    attributionWindowDays: 14, sourceFetchedAt: { ...snapshot.sourceFetchedAt }, rows,
    notice: `${mode === "demo" ? "展示資料，不是真實 Amazon 成效。" : ""}只使用目前 FBA 身分已核對的 SP advertised-product 報表；sales14d／purchases14d 採 14 日歸因，不等於報表日期範圍。近期轉換可能尚未回補。ACoS 門檻是可人工覆寫的策略建議，不是利潤或獲利保證；不會修改廣告、預算或投放。未提供搜尋詞、CTR、CPC 或 SB／SD 診斷。`,
  };
}
