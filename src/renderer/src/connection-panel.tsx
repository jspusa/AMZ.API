import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AdvertisingConnectionTestResult,
  AdvertisingCredentialSummary,
  ConnectionTestResult,
  CredentialSummary,
  SpApiRegion,
  UpdateStatus,
} from "../../shared/contracts";
import { MARKETPLACES } from "../../shared/marketplaces";
import NotebookUpdateProgress from "./components/notebook-update-progress";

const REGION_LABELS: Record<SpApiRegion, string> = {
  na: "北美 NA",
  fe: "遠東 FE",
  eu: "歐洲 EU",
};

const REGION_META = (["na", "fe", "eu"] as const).map((region) => ({
  region,
  label: REGION_LABELS[region],
  sites: MARKETPLACES.filter((marketplace) => marketplace.region === region)
    .map((marketplace) => marketplace.code)
    .join(" · "),
}));

function cleanError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "操作未完成。";
  return raw.replace(/^Error invoking remote method '[^']+':\s*/i, "").replace(/^Error:\s*/i, "");
}

function formatTime(value: string | null): string {
  if (!value) return "尚未保存";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "已保存"
    : new Intl.DateTimeFormat("zh-TW", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(date);
}

function regionTestLabel(test: ConnectionTestResult | null, region: SpApiRegion): string | null {
  const result = test?.regions[region];
  return result ? result.message : null;
}

export default function ConnectionPanel({
  onConnectionChanged,
  open: controlledOpen,
  onOpenChange,
  showTrigger = true,
}: {
  onConnectionChanged: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const [sopOpen, setSopOpen] = useState(true);
  const [summary, setSummary] = useState<CredentialSummary | null>(null);
  const [adsSummary, setAdsSummary] = useState<AdvertisingCredentialSummary | null>(null);
  const [busy, setBusy] = useState<"sp-open" | "test" | "clear" | "ads-open" | "ads-test" | "ads-clear" | "update" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<ConnectionTestResult | null>(null);
  const [adsTest, setAdsTest] = useState<AdvertisingConnectionTestResult | null>(null);
  const [version, setVersion] = useState<string>("—");
  const [update, setUpdate] = useState<UpdateStatus>({ state: "idle" });
  const [supportsBackgroundUpdates] = useState(
    () =>
      typeof window === "undefined" ||
      typeof window.fbaOS.updates.current === "function",
  );

  const refreshSummary = useCallback(async () => {
    const [nextSummary, nextAdsSummary, nextVersion] = await Promise.all([
      window.fbaOS.credentials.status(),
      window.fbaOS.advertisingCredentials.status(),
      window.fbaOS.app.version(),
    ]);
    setSummary(nextSummary);
    setAdsSummary(nextAdsSummary);
    setVersion(nextVersion);
  }, []);

  useEffect(() => {
    let receivedLiveStatus = false;
    const stopListening = window.fbaOS.updates.onStatus((status) => {
      receivedLiveStatus = true;
      setUpdate(status);
      if (status.state === "error") {
        setBusy((currentBusy) =>
          currentBusy === "update" ? null : currentBusy,
        );
      }
    });
    void refreshSummary().catch((loadError) => setError(cleanError(loadError)));
    const currentStatus = window.fbaOS.updates.current?.();
    if (currentStatus) {
      void currentStatus
        .then((status) => {
          if (!receivedLiveStatus) setUpdate(status);
        })
        .catch((loadError) => setError(cleanError(loadError)));
    }
    return stopListening;
  }, [refreshSummary]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [busy, open]);

  const configuredCount = useMemo(
    () =>
      summary
        ? (["na", "fe", "eu"] as const).filter((region) => summary.regions[region].configured).length
        : 0,
    [summary],
  );

  const openCredentialEditor = async () => {
    setBusy("sp-open");
    setError(null);
    setMessage(null);
    setTest(null);
    try {
      await window.fbaOS.credentials.openEditor();
      await refreshSummary();
      setMessage("Notebook 鑰匙的 SP-API 安全輸入視窗已關閉，狀態已重新讀取。");
      onConnectionChanged();
    } catch (openError) {
      setError(cleanError(openError));
    } finally {
      setBusy(null);
    }
  };

  const testConnection = async () => {
    setBusy("test");
    setError(null);
    setMessage(null);
    try {
      const result = await window.fbaOS.credentials.test();
      setTest(result);
      setMessage(result.ok ? "所有已設定區域均連線成功。" : "有區域尚未連線；請依下方結果檢查。" );
    } catch (testError) {
      setError(cleanError(testError));
    } finally {
      setBusy(null);
    }
  };

  const openAdvertisingCredentialEditor = async () => {
    setBusy("ads-open");
    setError(null);
    setMessage(null);
    setAdsTest(null);
    try {
      await window.fbaOS.advertisingCredentials.openEditor();
      await refreshSummary();
      setMessage("Notebook 鑰匙的 Ads 安全輸入視窗已關閉，狀態已重新讀取。");
      onConnectionChanged();
    } catch (openError) {
      setError(cleanError(openError));
    } finally {
      setBusy(null);
    }
  };

  const testAdvertisingConnection = async () => {
    setBusy("ads-test");
    setError(null);
    setMessage(null);
    try {
      const region = adsSummary?.oauthRegion ?? "na";
      const marketplaceId = MARKETPLACES.find(
        (marketplace) => marketplace.region === region,
      )?.id;
      if (!marketplaceId) throw new Error("找不到 Ads 區域對應的 Amazon 站點。");
      const result = await window.fbaOS.advertisingCredentials.test(marketplaceId);
      setAdsTest(result);
      setMessage(result.message);
      onConnectionChanged();
    } catch (testError) {
      setError(cleanError(testError));
    } finally {
      setBusy(null);
    }
  };

  const clearAdvertisingCredentials = async () => {
    setBusy("ads-clear");
    setError(null);
    setMessage(null);
    try {
      const nextSummary = await window.fbaOS.advertisingCredentials.clear();
      setAdsSummary(nextSummary);
      setAdsTest(null);
      setMessage("這台電腦上的 Amazon Ads 憑證已清除；SP-API 憑證不受影響。");
      onConnectionChanged();
    } catch (clearError) {
      setError(cleanError(clearError));
    } finally {
      setBusy(null);
    }
  };

  const clearCredentials = async () => {
    if (!window.confirm("確定清除這台電腦上的所有 Amazon／R2 憑證？此動作不會刪除 GitHub 程式。")) return;
    setBusy("clear");
    setError(null);
    try {
      const nextSummary = await window.fbaOS.credentials.clear();
      setSummary(nextSummary);
      setTest(null);
      setMessage("本機憑證已清除，控制台回到展示模式。" );
      onConnectionChanged();
    } catch (clearError) {
      setError(cleanError(clearError));
    } finally {
      setBusy(null);
    }
  };

  const checkUpdate = async () => {
    setBusy("update");
    setError(null);
    try {
      setUpdate(await window.fbaOS.updates.check());
    } catch (updateError) {
      setError(cleanError(updateError));
    } finally {
      setBusy(null);
    }
  };

  const installUpdate = async () => {
    setBusy("update");
    setError(null);
    try {
      await window.fbaOS.updates.install();
    } catch (installError) {
      setError(cleanError(installError));
      setBusy(null);
    }
  };

  return (
    <>
      {showTrigger && (
        <button
          type="button"
          className={`mac-bridge-button ${configuredCount ? "connected" : ""}`}
          onClick={() => setOpen(true)}
          aria-label="開啟 Notebook 安全連線設定"
        >
          <span>{configuredCount ? "✓" : "⌁"}</span>
          <div><strong>Notebook 安全連線</strong><small>{configuredCount ? `${configuredCount} 區域已連線` : "輸入 API 憑證"}</small></div>
        </button>
      )}

      {open && (
        <div className="connection-panel-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) setOpen(false);
        }}>
          <aside className="connection-panel" role="dialog" aria-modal="true" aria-labelledby="connection-panel-title">
            <header>
              <div className="connection-panel-icon">⌁</div>
              <div><p>LOCAL NOTEBOOK KEY</p><h2 id="connection-panel-title">Notebook 安全連線</h2><small>GitHub 沒有金鑰；Amazon 資料只在這個本機 App 內流動。</small></div>
              <button type="button" onClick={() => setOpen(false)} disabled={Boolean(busy)} aria-label="關閉">×</button>
            </header>

            <section className="vault-status-grid compact">
              <article className={summary?.encryptionAvailable ? "ready" : "attention"}><span>SYSTEM KEY STORE</span><strong>{summary?.encryptionAvailable ? "安全儲存可用" : "目前不可用"}</strong><small>Secret 不會傳到 GitHub</small></article>
              <article className={configuredCount ? "ready" : "attention"}><span>AMAZON SP-API</span><strong>{configuredCount ? `${configuredCount} 個區域已設定` : "等待連線"}</strong><small>{configuredCount ? formatTime(summary?.updatedAt ?? null) : "完成下方 4 項資料即可"}</small></article>
            </section>

            <details className="connection-sop" open={sopOpen} onToggle={(event) => setSopOpen(event.currentTarget.open)}>
              <summary><div><span>?</span><div><strong>第一次串接 SOP</strong><small>照 1 → 4 找到需要的資料</small></div></div><i>＋</i></summary>
              <div className="connection-sop-body">
                <ol>
                  <li><span>1</span><div><strong>進入開發者頁面</strong><p>Seller Central → <b>Apps and Services</b> → <b>Develop Apps</b>。第一次使用時選擇 <b>Private Developer</b>，因為 AMZ.API 只供自己公司使用。</p></div></li>
                  <li><span>2</span><div><strong>建立 Private SP-API App</strong><p>建立或編輯 App，加入目前需要的角色：<b>Product Listing、Pricing、Amazon Fulfillment、Inventory and Order Tracking</b>。不需要買家 PII／Restricted Roles。</p></div></li>
                  <li><span>3</span><div><strong>複製 LWA 兩個欄位</strong><p>在該 App 選 <b>Edit App</b>，於 <b>LWA credentials</b> 按 View，取得 Client ID 與 Client Secret。</p></div></li>
                  <li><span>4</span><div><strong>授權各區域</strong><p>App 右側選單 → <b>Authorize</b> → <b>Authorize app</b>，複製 Refresh Token。Seller ID 在 Settings → Account Info → Business Information → Your Merchant Token。</p></div></li>
                </ol>
                <div className="connection-sop-actions">
                  <button type="button" onClick={() => void window.fbaOS.app.openExternal("seller-central")}>開啟 Seller Central ↗</button>
                </div>
                <p className="connection-sop-note">只做美國／加拿大先填 NA；日本填 FE。每次按 Authorize 顯示的 Refresh Token 請立即貼入，不要放在 GitHub、訊息或試算表。</p>
              </div>
            </details>

            <section className="credential-section">
              <div className="credential-heading"><span>SP</span><div><strong>SP-API／R2／Skill 本機安全輸入</strong><small>所有敏感欄位只存在 main process 建立的本機 modal</small></div><b className={summary?.lwaConfigured ? "saved" : ""}>{summary?.lwaConfigured ? "已保存" : "必填"}</b></div>
              <div className="connection-explainer"><span>i</span><p>GitHub Pages 只讀取遮罩摘要，不能建立或送出憑證 save payload。已保存欄位不會回填；本機視窗留白會沿用本機系統安全儲存區既有值。</p></div>
              <div className="connection-actions">
                <button type="button" className="primary" onClick={() => void openCredentialEditor()} disabled={Boolean(busy) || !summary?.encryptionAvailable}>{busy === "sp-open" ? "開啟中…" : "開啟 Notebook SP-API 安全輸入"}</button>
              </div>
            </section>

            <section className="credential-section">
              <div className="credential-heading"><span>ADS</span><div><strong>Amazon Ads 唯讀連線</strong><small>獨立 Ads LWA App；Profile ID 由主程式自動發現</small></div><b className={adsSummary?.configured ? "saved" : ""}>{adsSummary?.configured ? "已保存" : "選配"}</b></div>
              <div className="connection-explainer"><span>i</span><p>Amazon 官方的 OAuth scope 為 <b>advertising::campaign_management</b>，不是 read-only scope。請在 Campaign manager 只授予使用者 <b>Viewer</b>；AMZ.API 只啟用 Profiles 與 Campaign query，寫入永遠關閉。</p></div>
              <div className="connection-sop-body">
                <ol>
                  <li><span>1</span><div><strong>建立獨立 Ads LWA security profile</strong><p>不沿用 SP-API LWA；申請 Ads API access 後，依官方流程完成 authorization grant。</p></div></li>
                  <li><span>2</span><div><strong>設定 Viewer 權限</strong><p>在 Amazon Ads Campaign manager 把專用使用者設為 Viewer；OAuth scope 名稱雖含 campaign_management，本 App 仍無任何 campaign write route。</p></div></li>
                  <li><span>3</span><div><strong>開啟 Notebook 本機安全輸入</strong><p>OAuth 區域與三個憑證欄位只存在本機 modal sheet；GitHub Pages 不持有這些 input state。Profile ID 不需要複製或貼上。</p></div></li>
                </ol>
              </div>
              <div className="connection-actions">
                <button type="button" className="secondary" onClick={() => void testAdvertisingConnection()} disabled={Boolean(busy) || !adsSummary?.configured}>{busy === "ads-test" ? "Ads 測試中…" : "測試 Ads 唯讀連線"}</button>
                <button type="button" className="primary" onClick={() => void openAdvertisingCredentialEditor()} disabled={Boolean(busy) || !adsSummary?.encryptionAvailable}>{busy === "ads-open" ? "開啟中…" : "開啟 Notebook Ads 安全輸入"}</button>
                {adsSummary?.hasVault && <button type="button" className="danger-link" onClick={() => void clearAdvertisingCredentials()} disabled={Boolean(busy)}>{busy === "ads-clear" ? "清除中…" : "Touch ID／Windows Hello 清除 Ads 憑證"}</button>}
              </div>
              {adsTest && <p className="connection-sop-note">{adsTest.ok ? "已驗證 Seller Profile 與 Campaign 唯讀查詢。" : adsTest.message}</p>}
              <p className="connection-sop-note">安全邊界：GitHub Pages 只能開啟本機 sheet、讀取 redacted status、測試與清除；無法送出 Ads save payload。請勿將憑證貼入訊息、GitHub、URL 或試算表。</p>
            </section>

            <section className="credential-section">
              <div className="credential-heading"><span>2</span><div><strong>銷售區域狀態</strong><small>只顯示遮罩提示與連線測試結果；完整 Seller ID 不會進 renderer</small></div></div>
              <div className="region-credential-list">
                {REGION_META.map((item) => {
                  const status = summary?.regions[item.region];
                  const testLabel = regionTestLabel(test, item.region);
                  return (
                    <div className="advanced-credential-block" key={item.region}>
                      <div className="advanced-credential-heading"><strong>{item.label} · {item.sites}</strong><small className={status?.configured ? "saved" : ""}>{testLabel ?? (status?.configured ? `已保存 · Token ${status.refreshTokenHint ?? "已遮罩"} · Seller ${status.sellerIdHint ?? "已遮罩"}` : "未設定")}</small></div>
                    </div>
                  );
                })}
              </div>
              <div className="connection-explainer"><span>!</span><p>每個區域目前保存一組 Selling Partner 授權。若 JP／SG／AU 實際屬於不同 Seller accounts，請只操作該 Refresh Token 授權涵蓋的站點；此極簡版不會把不同帳號自動合併。</p></div>
            </section>

            <details className="optional-credential-section">
              <summary><div><span>•••</span><strong>進階選配狀態</strong><small>R2 與補貨 Skill 也只能在 Notebook 鑰匙安全輸入</small></div><i>＋</i></summary>
              <div className="advanced-credential-block">
                <div className="advanced-credential-heading"><strong>Cloudflare R2 圖片上傳</strong><small>{summary?.imageStorageConfigured ? `已連線 · ${summary.imagePublicBaseUrl}` : "未設定仍可拖拉預覽與貼公開 URL"}</small></div>
              </div>
              <div className="advanced-credential-block">
                <div className="advanced-credential-heading"><strong>補貨 Skill 接點</strong><small>{summary?.replenishmentSkillConfigured ? "已保存" : "內建補貨計算已可直接使用"}</small></div>
              </div>
            </details>

            {error && <div className="connection-feedback error" role="alert"><span>!</span><p>{error}</p></div>}
            {message && <div className="connection-feedback success" role="status"><span>✓</span><p>{message}</p></div>}

            <div className="connection-actions">
              <button type="button" className="secondary" onClick={() => void testConnection()} disabled={Boolean(busy) || !configuredCount}>{busy === "test" ? "測試中…" : "重新測試"}</button>
            </div>

            <footer className="connection-panel-footer">
              <div className="connection-panel-release">
                <strong>Notebook 鑰匙版本</strong>
                <small>
                  {!supportsBackgroundUpdates
                    ? `v${version} · 請先從 Supply Boss 完成最後一次安全安裝；之後才會背景更新。`
                    : update.state === "downloaded"
                    ? `安全更新 v${update.version} 已下載，等你決定何時重啟。`
                    : update.state === "checking"
                      ? `v${version} · 正在背景檢查安全更新…`
                      : update.state === "available"
                        ? `找到安全更新 v${update.version}，正在準備背景下載…`
                        : update.state === "downloading"
                          ? `v${version} · 安全更新 v${update.version ?? "新版"} 正在背景下載。`
                          : update.message ?? `v${version} · GitHub 介面自動保持最新；本機憑證不會隨介面更新上傳。`}
                </small>
                <NotebookUpdateProgress status={update} />
              </div>
              <div className="connection-panel-footer-actions">
                {!supportsBackgroundUpdates ? (
                  <button type="button" disabled>
                    需先安裝簽章版
                  </button>
                ) : update.state === "downloaded" ? (
                  <button type="button" onClick={() => void installUpdate()} disabled={busy === "update"}>
                    {busy === "update" ? "正在安全重啟…" : "更新並重啟"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void checkUpdate()}
                    disabled={busy === "update" || update.state === "checking" || update.state === "available" || update.state === "downloading"}
                  >
                    {update.state === "downloading"
                      ? "背景下載中…"
                      : update.state === "checking" || update.state === "available" || busy === "update"
                        ? "檢查中…"
                        : "立即檢查更新"}
                  </button>
                )}
                {summary?.hasVault && <button type="button" className="danger-link" onClick={() => void clearCredentials()} disabled={Boolean(busy)}>清除本機憑證</button>}
              </div>
            </footer>
          </aside>
        </div>
      )}
    </>
  );
}
