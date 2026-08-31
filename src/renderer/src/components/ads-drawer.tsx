"use client";

import { useEffect, useState } from "react";
import {
  MARKETPLACES,
  marketplaceById,
  marketplaceSelectLabel,
} from "../../../shared/marketplaces";
import AdvertisingCoveragePanel from "./advertising-coverage-panel";
import AdvertisingStrategyPanel from "./advertising-strategy-panel";
import type {
  StandaloneAuditJob,
  StandaloneAuditMode,
} from "../standalone-audit";

type AdsStatus = {
  marketplaceCode: string;
  configured: boolean;
  verified: boolean;
  lwaConfigured: boolean;
  profileConfigured: boolean;
  writeEnabled: boolean;
  coverageAuditAvailable?: boolean;
  coverageAuditNotice?: string;
  testedAt?: string | null;
  requiredPermission?: string;
  permissionVerified?: false;
  notice: string;
};

export default function AdsDrawer({
  initialMarketplaceId,
  auditMode = "live",
  coverageAuditJob = null,
  onCoverageAuditJobChange,
  onClose,
}: {
  initialMarketplaceId: string;
  auditMode?: StandaloneAuditMode;
  coverageAuditJob?: StandaloneAuditJob | null;
  onCoverageAuditJobChange?: (job: StandaloneAuditJob) => void;
  onClose: () => void;
}) {
  const [marketplaceId, setMarketplaceId] = useState(initialMarketplaceId);
  const [status, setStatus] = useState<AdsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const marketplace = marketplaceById(marketplaceId) ?? MARKETPLACES[0];

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ marketplaceId });
    fetch(`/api/amazon-ads/status?${params}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as AdsStatus | { message?: string };
        if (!response.ok) throw new Error((payload as { message?: string }).message || "無法讀取 Ads 狀態。");
        if (active) setStatus(payload as AdsStatus);
      })
      .catch((requestError) => {
        if (active) setError(requestError instanceof Error ? requestError.message : "無法讀取 Ads 狀態。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [marketplaceId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside className="order-drawer ads-drawer" role="dialog" aria-modal="true" aria-labelledby="ads-title">
        <div className="drawer-header">
          <div><p className="eyebrow">AMAZON ADS · SEPARATE API</p><h2 id="ads-title">廣告</h2></div>
          <button type="button" onClick={onClose} aria-label="關閉廣告區">×</button>
        </div>
        <label className="ads-marketplace"><span>Amazon Ads 站點</span><select value={marketplaceId} onChange={(event) => { setLoading(true); setError(null); setStatus(null); setMarketplaceId(event.target.value); }}>{MARKETPLACES.map((item) => <option key={item.id} value={item.id}>{marketplaceSelectLabel(item)}</option>)}</select></label>

        {error && <div className="price-error" role="alert">{error}</div>}

        <section className="helium-lane">
          <div className="helium-icon">H10</div>
          <div><strong>Sponsored Products</strong><p>主要操作、規則與關鍵字繼續由 Helium 10 管理。</p></div>
          <span className="capability-pill external">外部管理</span>
          <a href="https://members.helium10.com/" target="_blank" rel="noreferrer">打開 Helium 10 ↗</a>
        </section>

        <section className="ads-connection-card">
          <div className="ads-connection-heading"><div><span className={`connection-light ${status?.verified ? "connected" : ""}`} /><div><strong>{loading ? "檢查 Ads 設定…" : status?.verified ? "Ads Profiles／Campaign query 已驗證" : status?.configured ? "Ads 憑證已設定 · 這個站點尚未驗證" : "Amazon Ads 尚未設定"}</strong><p>{status?.notice ?? "正在由本機主程序驗證獨立 Ads LWA 與 Seller Profile。"}</p></div></div><span className="capability-pill separate">不同於 SP-API</span></div>
          {status && (
            <dl className="ads-connection-facts">
              <div><dt>Ads LWA client</dt><dd>{status.lwaConfigured ? "已設定" : "未設定"}</dd></div>
              <div><dt>{status.marketplaceCode} Seller Profile</dt><dd>{status.profileConfigured ? "已自動對應" : "未驗證"}</dd></div>
              <div><dt>建議最小權限</dt><dd>{status.requiredPermission ?? "Campaign manager Viewer"}（App 不宣稱已驗證角色）</dd></div>
              <div><dt>Campaign writes</dt><dd>{status.writeEnabled ? "已開啟" : "永遠關閉"}</dd></div>
            </dl>
          )}
        </section>

        <AdvertisingStrategyPanel
          key={marketplaceId}
          marketplaceId={marketplaceId}
          marketplaceCode={marketplace.code}
          marketplaceTimeZone={marketplace.timeZone}
          currencyCode={marketplace.currency}
          available={Boolean(status?.verified)}
          unavailableNotice={loading
            ? "正在由 Notebook 鑰匙確認這個站點的 Amazon Ads 連線。"
            : status?.notice ?? "Amazon Ads API 尚未連線；目前不會用展示結果冒充真實策略。"}
        />

        <AdvertisingCoveragePanel
          marketplaceId={marketplaceId}
          mode={auditMode}
          available={Boolean(status?.coverageAuditAvailable)}
          unavailableNotice={status?.coverageAuditNotice ?? "Amazon Ads API 尚未連線；目前不會用展示結果冒充真實覆蓋。"}
          initialJob={coverageAuditJob}
          onJobChange={onCoverageAuditJobChange}
        />

        <section className="ads-product-grid">
          <article>
            <div className="ads-product-icon sb">SB</div>
            <div><p className="eyebrow">SPONSORED BRANDS</p><h3>品牌廣告</h3><p>至少需要 Brand Registry、品牌實體、ASIN、預算、投放日期、素材與目標。</p></div>
            <span className="capability-pill external">本版不支援寫入</span>
          </article>
          <article>
            <div className="ads-product-icon sd">SD</div>
            <div><p className="eyebrow">SPONSORED DISPLAY</p><h3>展示廣告</h3><p>需要品牌主資格、ASIN、每日預算、受眾／情境目標與素材。</p></div>
            <span className="capability-pill external">本版不支援寫入</span>
          </article>
        </section>

        <div className="price-warning compact"><strong>OAuth scope 名稱不等於可寫入</strong><p>Amazon 官方使用 advertising::campaign_management；這裡要求 Campaign manager Viewer，而本機主程序只實作 Profiles、Campaign query 與 Sponsored Products 唯讀報表。建立、修改、啟用與暫停廣告都沒有 IPC 或 API route。</p></div>

        <div className="ads-actions">
          <a href="https://advertising.amazon.com/API/docs/en-us/guides/onboarding/apply-for-access" target="_blank" rel="noreferrer">申請 Amazon Ads API ↗</a>
          <a className="primary" href="https://advertising.amazon.com/" target="_blank" rel="noreferrer">開啟 Amazon Ads ↗</a>
        </div>
        <div className="drawer-api-footnote">Amazon Ads Profiles／Campaign query · Ads Reporting v3 · Viewer · Profile 自動發現 · writes false</div>
      </aside>
    </div>
  );
}
