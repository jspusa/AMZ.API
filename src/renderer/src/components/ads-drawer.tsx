"use client";

import { useEffect, useState } from "react";
import AdvertisingCoveragePanel from "./advertising-coverage-panel";

type AdsStatus = {
  marketplaceCode: string;
  configured: boolean;
  verified: boolean;
  lwaConfigured: boolean;
  profileConfigured: boolean;
  writeEnabled: boolean;
  coverageAuditAvailable?: boolean;
  coverageAuditNotice?: string;
  notice: string;
};

const MARKETPLACES = [
  { id: "ATVPDKIKX0DER", label: "US · 美國站" },
  { id: "A1VC38T7YXB528", label: "JP · 日本站" },
  { id: "A2EUQ1WTGCTBG2", label: "CA · 加拿大站" },
  { id: "A19VAU5U5O7RUS", label: "SG · 新加坡站" },
  { id: "A39IBJ37TRP1C6", label: "AU · 澳洲站" },
  { id: "A1F83G8C2ARO7P", label: "UK · 英國站" },
  { id: "A1PA6795UKMFR9", label: "DE · 德國站" },
];

export default function AdsDrawer({
  initialMarketplaceId,
  onClose,
}: {
  initialMarketplaceId: string;
  onClose: () => void;
}) {
  const [marketplaceId, setMarketplaceId] = useState(initialMarketplaceId);
  const [status, setStatus] = useState<AdsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        <p className="price-intro">SP 操作繼續交給 Helium 10；Ads API 連線後，這裡會唯讀核對 ProductAI 活動名稱與全站 FBA SKU 覆蓋。</p>
        <div className="automation-summary"><span className="automation-badge automatic">自動</span><p>系統自動檢查 Ads 連線，並列出沒有 ENABLED SP 活動或同 ASIN 覆蓋的 FBA SKU；不會建立或啟用廣告。</p><span className="automation-badge manual">需人工</span><p>SB／SD 的素材、預算、目標與正式啟用仍需人工確認，避免誤燒廣告費。</p></div>

        <label className="ads-marketplace"><span>Amazon Ads 站點</span><select value={marketplaceId} onChange={(event) => { setLoading(true); setError(null); setStatus(null); setMarketplaceId(event.target.value); }}>{MARKETPLACES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>

        {error && <div className="price-error" role="alert">{error}</div>}

        <section className="helium-lane">
          <div className="helium-icon">H10</div>
          <div><strong>Sponsored Products</strong><p>主要操作、規則與關鍵字繼續由 Helium 10 管理。</p></div>
          <span className="capability-pill external">外部管理</span>
          <a href="https://members.helium10.com/" target="_blank" rel="noreferrer">打開 Helium 10 ↗</a>
        </section>

        <section className="ads-connection-card">
          <div className="ads-connection-heading"><div><span className={`connection-light ${status?.verified ? "connected" : ""}`} /><div><strong>{loading ? "檢查 Ads 設定…" : status?.verified ? "Amazon Ads 已驗證" : status?.configured ? "Ads 憑證已設定 · 尚未驗證" : "Amazon Ads 尚未設定"}</strong><p>{status?.notice ?? "正在讀取獨立 Ads LWA 與 Profile 設定狀態。"}</p></div></div><span className="capability-pill separate">不同於 SP-API</span></div>
          {status && (
            <dl className="ads-connection-facts">
              <div><dt>Ads LWA client</dt><dd>{status.lwaConfigured ? "已設定" : "未設定"}</dd></div>
              <div><dt>{status.marketplaceCode} Profile ID</dt><dd>{status.profileConfigured ? "已設定" : "未設定"}</dd></div>
              <div><dt>Campaign writes</dt><dd>{status.writeEnabled ? "已開啟" : "安全關閉"}</dd></div>
            </dl>
          )}
        </section>

        <AdvertisingCoveragePanel
          marketplaceId={marketplaceId}
          available={Boolean(status?.coverageAuditAvailable)}
          unavailableNotice={status?.coverageAuditNotice ?? "Amazon Ads API 尚未連線；目前不會用展示結果冒充真實覆蓋。"}
        />

        <section className="ads-product-grid">
          <article>
            <div className="ads-product-icon sb">SB</div>
            <div><p className="eyebrow">SPONSORED BRANDS</p><h3>品牌廣告</h3><p>至少需要 Brand Registry、品牌實體、ASIN、預算、投放日期、素材與目標。</p></div>
            <span className={`capability-pill ${status?.configured ? "ready" : "needs-auth"}`}>{status?.configured ? "設定已備妥" : "需要 Ads 授權"}</span>
          </article>
          <article>
            <div className="ads-product-icon sd">SD</div>
            <div><p className="eyebrow">SPONSORED DISPLAY</p><h3>展示廣告</h3><p>需要品牌主資格、ASIN、每日預算、受眾／情境目標與素材。</p></div>
            <span className={`capability-pill ${status?.configured ? "ready" : "needs-auth"}`}>{status?.configured ? "設定已備妥" : "需要 Ads 授權"}</span>
          </article>
        </section>

        <div className="price-warning compact"><strong>SB／SD 不是單一開關</strong><p>Campaign 只是第一層，還要建立 ad group、ad、creative 與 target 才會投放。正式自動化應先建立成 PAUSED，確認預算與素材後再啟用，避免誤燒廣告費。</p></div>

        <div className="ads-actions">
          <a href="https://advertising.amazon.com/API/docs/en-us/guides/onboarding/apply-for-access" target="_blank" rel="noreferrer">申請 Amazon Ads API ↗</a>
          <a className="primary" href="https://advertising.amazon.com/" target="_blank" rel="noreferrer">開啟 Amazon Ads ↗</a>
        </div>
        <div className="drawer-api-footnote">Amazon Ads API v1 · advertising::campaign_management · Profile per marketplace</div>
      </aside>
    </div>
  );
}
