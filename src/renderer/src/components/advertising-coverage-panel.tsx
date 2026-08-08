"use client";

import { useEffect, useState } from "react";
import {
  parseAdvertisingCoverageSnapshot,
  type AdvertisingCoverageSnapshot,
} from "../advertising-coverage";

export default function AdvertisingCoveragePanel({
  marketplaceId,
  available,
  unavailableNotice,
}: {
  marketplaceId: string;
  available: boolean;
  unavailableNotice: string;
}) {
  const [snapshot, setSnapshot] = useState<AdvertisingCoverageSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSnapshot(null);
    setBusy(false);
    setError(null);
  }, [marketplaceId]);

  async function runAudit(): Promise<void> {
    if (!available || busy) return;
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ marketplaceId });
      const response = await fetch(`/api/amazon-ads/coverage?${params}`, {
        cache: "no-store",
      });
      const payload = await response.json() as unknown;
      if (!response.ok) {
        const problem = payload && typeof payload === "object"
          ? payload as { message?: unknown }
          : null;
        throw new Error(
          typeof problem?.message === "string"
            ? problem.message
            : "目前無法執行廣告覆蓋健檢。",
        );
      }
      setSnapshot(parseAdvertisingCoverageSnapshot(payload, marketplaceId));
    } catch (auditError) {
      setSnapshot(null);
      setError(
        auditError instanceof Error
          ? auditError.message
          : "目前無法執行廣告覆蓋健檢。",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ads-coverage-panel">
      <header>
        <div>
          <p className="eyebrow">FBA AD COVERAGE</p>
          <h3>全站廣告覆蓋健檢</h3>
          <p>依 ProductAI 活動名稱核對 Seller SKU；同一 ASIN 的其他 FBA SKU 也視為已覆蓋。</p>
        </div>
        <button type="button" onClick={() => void runAudit()} disabled={!available || busy}>
          {busy ? "掃描中…" : snapshot ? "重新掃描" : "掃描全部 FBA SKU"}
        </button>
      </header>
      <div className="ads-coverage-rule">
        <code>[ProductAI] US-B092384873-AFA33AM-SP-PAT-Jul242026</code>
        <p>只計 ENABLED Sponsored Products；PAUSED／ARCHIVED、錯站點、錯 ASIN 或無法對應目前 FBA SKU 的活動都不會算。</p>
      </div>
      {!available && <div className="ads-coverage-unavailable"><strong>功能已備妥，等待 Ads API</strong><p>{unavailableNotice}</p></div>}
      {error && <div className="price-error" role="alert">{error}</div>}
      {snapshot && (
        <>
          <div className="ads-coverage-summary">
            <div><strong>{snapshot.summary.coveredSkuCount}</strong><span>已覆蓋</span></div>
            <div><strong>{snapshot.summary.sameAsinCount}</strong><span>由同 ASIN 覆蓋</span></div>
            <div className={snapshot.summary.uncoveredSkuCount ? "needs-attention" : ""}><strong>{snapshot.summary.uncoveredSkuCount}</strong><span>無符合命名的 ENABLED SP 覆蓋</span></div>
          </div>
          <p className="ads-coverage-notice">{snapshot.rule}</p>
          {snapshot.uncovered.length ? (
            <div className="ads-coverage-results">
              <h4>尚無符合命名的 ENABLED SP campaign 覆蓋</h4>
              {snapshot.uncovered.map((row) => (
                <article key={row.sellerSku}>
                  <div><strong>{row.sellerSku}</strong><span>{row.asin}</span></div>
                  <p>{row.title || "Amazon 未回傳商品名稱"}</p>
                </article>
              ))}
            </div>
          ) : <div className="ads-coverage-clear"><strong>目前全部 FBA SKU 都有符合命名的 ENABLED SP campaign 證據</strong></div>}
          <p className="ads-coverage-notice">{snapshot.notice}</p>
        </>
      )}
    </section>
  );
}
