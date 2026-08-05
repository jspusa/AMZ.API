import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ConnectionTestResult,
  CredentialInput,
  CredentialSummary,
  SpApiRegion,
  UpdateStatus,
} from "../../shared/contracts";

type FormState = {
  lwaClientId: string;
  lwaClientSecret: string;
  naRefreshToken: string;
  naSellerId: string;
  feRefreshToken: string;
  feSellerId: string;
  euRefreshToken: string;
  euSellerId: string;
  r2AccountId: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  r2Bucket: string;
  r2PublicBaseUrl: string;
  replenishmentSkillUrl: string;
};

const EMPTY_FORM: FormState = {
  lwaClientId: "",
  lwaClientSecret: "",
  naRefreshToken: "",
  naSellerId: "",
  feRefreshToken: "",
  feSellerId: "",
  euRefreshToken: "",
  euSellerId: "",
  r2AccountId: "",
  r2AccessKeyId: "",
  r2SecretAccessKey: "",
  r2Bucket: "",
  r2PublicBaseUrl: "",
  replenishmentSkillUrl: "",
};

const REGION_META: Array<{
  region: SpApiRegion;
  label: string;
  sites: string;
  token: keyof FormState;
  seller: keyof FormState;
}> = [
  { region: "na", label: "北美 NA", sites: "US · CA", token: "naRefreshToken", seller: "naSellerId" },
  { region: "fe", label: "遠東 FE", sites: "JP · SG · AU", token: "feRefreshToken", seller: "feSellerId" },
  { region: "eu", label: "歐洲 EU", sites: "UK · DE", token: "euRefreshToken", seller: "euSellerId" },
];

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
}: {
  onConnectionChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<CredentialSummary | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState<"save" | "test" | "clear" | "update" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<ConnectionTestResult | null>(null);
  const [version, setVersion] = useState<string>("—");
  const [update, setUpdate] = useState<UpdateStatus>({ state: "idle" });

  const refreshSummary = useCallback(async () => {
    const [nextSummary, nextVersion] = await Promise.all([
      window.fbaOS.credentials.status(),
      window.fbaOS.app.version(),
    ]);
    setSummary(nextSummary);
    setVersion(nextVersion);
  }, []);

  useEffect(() => {
    void refreshSummary().catch((loadError) => setError(cleanError(loadError)));
    return window.fbaOS.updates.onStatus(setUpdate);
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

  const updateField = (field: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setMessage(null);
    setError(null);
  };

  const save = async () => {
    setBusy("save");
    setError(null);
    setMessage(null);
    setTest(null);
    const input: CredentialInput = {
      lwaClientId: form.lwaClientId,
      lwaClientSecret: form.lwaClientSecret,
      regions: {
        na: { refreshToken: form.naRefreshToken, sellerId: form.naSellerId },
        fe: { refreshToken: form.feRefreshToken, sellerId: form.feSellerId },
        eu: { refreshToken: form.euRefreshToken, sellerId: form.euSellerId },
      },
      imageStorage: {
        accountId: form.r2AccountId,
        accessKeyId: form.r2AccessKeyId,
        secretAccessKey: form.r2SecretAccessKey,
        bucket: form.r2Bucket,
        publicBaseUrl: form.r2PublicBaseUrl,
      },
      replenishmentSkillUrl: form.replenishmentSkillUrl,
    };
    try {
      const nextSummary = await window.fbaOS.credentials.save(input);
      setSummary(nextSummary);
      setForm(EMPTY_FORM);
      setMessage("已加密保存到這台 Mac；畫面不會回傳或顯示完整 Secret。正在測試連線…");
      const nextTest = await window.fbaOS.credentials.test();
      setTest(nextTest);
      setMessage(nextTest.ok ? "Amazon SP-API 連線成功，控制台已切換為真實資料。" : "憑證已保存；部分區域尚未通過連線測試。" );
      onConnectionChanged();
    } catch (saveError) {
      setError(cleanError(saveError));
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

  const clearCredentials = async () => {
    if (!window.confirm("確定清除這台 Mac 上的所有 Amazon／R2 憑證？此動作不會刪除 GitHub 程式。")) return;
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

  return (
    <>
      <button
        type="button"
        className={`mac-bridge-button ${configuredCount ? "connected" : ""}`}
        onClick={() => setOpen(true)}
        aria-label="開啟 Mac 安全連線設定"
      >
        <span>{configuredCount ? "✓" : "⌁"}</span>
        <div><strong>Mac 安全連線</strong><small>{configuredCount ? `${configuredCount} 區域已連線` : "輸入 API 憑證"}</small></div>
      </button>

      {open && (
        <div className="connection-panel-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) setOpen(false);
        }}>
          <aside className="connection-panel" role="dialog" aria-modal="true" aria-labelledby="connection-panel-title">
            <header>
              <div className="connection-panel-icon">⌁</div>
              <div><p>LOCAL KEYCHAIN BRIDGE</p><h2 id="connection-panel-title">Mac 安全連線</h2><small>GitHub 沒有金鑰；Amazon 資料只在這個 App 內流動。</small></div>
              <button type="button" onClick={() => setOpen(false)} disabled={Boolean(busy)} aria-label="關閉">×</button>
            </header>

            <section className="vault-status-grid">
              <article className={summary?.encryptionAvailable ? "ready" : "attention"}><span>KEYCHAIN</span><strong>{summary?.encryptionAvailable ? "可用" : "不可用"}</strong><small>無明文 fallback</small></article>
              <article className={configuredCount ? "ready" : "attention"}><span>SP-API</span><strong>{configuredCount} / 3</strong><small>已設定區域</small></article>
              <article className={summary?.imageStorageConfigured ? "ready" : "neutral"}><span>IMAGES</span><strong>{summary?.imageStorageConfigured ? "R2 就緒" : "本機預檢"}</strong><small>公開來源選配</small></article>
              <article className="neutral"><span>UPDATED</span><strong>{formatTime(summary?.updatedAt ?? null)}</strong><small>App v{version}</small></article>
            </section>

            <div className="connection-explainer"><span>i</span><p>Amazon SP-API 不是單一 API Key。最少需要同一個 Private Seller App 的 <strong>LWA Client ID、Client Secret、各區 Refresh Token 與 Seller ID</strong>。</p></div>

            <section className="credential-section">
              <div className="credential-heading"><span>01</span><div><strong>LWA 應用程式</strong><small>三個區域可共用同一組 Client</small></div><b className={summary?.lwaConfigured ? "saved" : ""}>{summary?.lwaConfigured ? "已保存" : "必填"}</b></div>
              <div className="credential-grid two">
                <label><span>LWA Client ID</span><input type="password" value={form.lwaClientId} onChange={(event) => updateField("lwaClientId", event.target.value)} placeholder={summary?.lwaConfigured ? "已保存；留白不變" : "amzn1.application-oa2-client…"} autoComplete="new-password" spellCheck={false} /></label>
                <label><span>LWA Client Secret</span><input type="password" value={form.lwaClientSecret} onChange={(event) => updateField("lwaClientSecret", event.target.value)} placeholder={summary?.lwaConfigured ? "已保存；留白不變" : "輸入 Client Secret"} autoComplete="new-password" spellCheck={false} /></label>
              </div>
            </section>

            <section className="credential-section">
              <div className="credential-heading"><span>02</span><div><strong>銷售區域</strong><small>只填公司真正使用的區域</small></div></div>
              <div className="region-credential-list">
                {REGION_META.map((item) => {
                  const status = summary?.regions[item.region];
                  const testLabel = regionTestLabel(test, item.region);
                  return (
                    <details key={item.region} open={item.region === "na"}>
                      <summary><div><strong>{item.label}</strong><small>{item.sites}</small></div><span className={status?.configured ? "saved" : ""}>{testLabel ?? (status?.configured ? `已保存 ${status.sellerIdHint ?? ""}` : "未設定")}</span><i>＋</i></summary>
                      <div className="credential-grid two">
                        <label><span>Refresh Token</span><input type="password" value={form[item.token]} onChange={(event) => updateField(item.token, event.target.value)} placeholder={status?.refreshTokenHint ?? "Atzr|IwEB…"} autoComplete="new-password" spellCheck={false} /></label>
                        <label><span>Seller ID / Merchant Token</span><input type="password" value={form[item.seller]} onChange={(event) => updateField(item.seller, event.target.value)} placeholder={status?.sellerIdHint ?? "A1XXXXXXXXXXXX"} autoComplete="new-password" spellCheck={false} /></label>
                      </div>
                    </details>
                  );
                })}
              </div>
              <div className="connection-explainer"><span>!</span><p>每個區域目前保存一組 Selling Partner 授權。若 JP／SG／AU 實際屬於不同 Seller accounts，請只操作該 Refresh Token 授權涵蓋的站點；此極簡版不會把不同帳號自動合併。</p></div>
            </section>

            <details className="optional-credential-section">
              <summary><div><span>03</span><strong>圖片一鍵上傳（Cloudflare R2）</strong><small>{summary?.imageStorageConfigured ? `已連線 · ${summary.imagePublicBaseUrl}` : "選配；未設定仍可拖拉預覽與貼公開 URL"}</small></div><i>＋</i></summary>
              <div className="credential-grid two padded">
                <label><span>R2 Account ID</span><input type="password" value={form.r2AccountId} onChange={(event) => updateField("r2AccountId", event.target.value)} placeholder="留白不變" autoComplete="new-password" /></label>
                <label><span>Bucket</span><input value={form.r2Bucket} onChange={(event) => updateField("r2Bucket", event.target.value)} placeholder="amazon-listing-images" /></label>
                <label><span>Access Key ID</span><input type="password" value={form.r2AccessKeyId} onChange={(event) => updateField("r2AccessKeyId", event.target.value)} placeholder="留白不變" autoComplete="new-password" /></label>
                <label><span>Secret Access Key</span><input type="password" value={form.r2SecretAccessKey} onChange={(event) => updateField("r2SecretAccessKey", event.target.value)} placeholder="留白不變" autoComplete="new-password" /></label>
                <label className="full"><span>公開圖片網址</span><input value={form.r2PublicBaseUrl} onChange={(event) => updateField("r2PublicBaseUrl", event.target.value)} placeholder="https://images.example.com" inputMode="url" /></label>
              </div>
            </details>

            <details className="optional-credential-section">
              <summary><div><span>04</span><strong>補貨 Skill 接點</strong><small>{summary?.replenishmentSkillConfigured ? "已保存" : "選配；內建補貨計算已可使用"}</small></div><i>＋</i></summary>
              <div className="credential-grid padded"><label><span>HTTPS Skill URL</span><input value={form.replenishmentSkillUrl} onChange={(event) => updateField("replenishmentSkillUrl", event.target.value)} placeholder="https://…" inputMode="url" /></label></div>
            </details>

            {error && <div className="connection-feedback error" role="alert"><span>!</span><p>{error}</p></div>}
            {message && <div className="connection-feedback success" role="status"><span>✓</span><p>{message}</p></div>}

            <div className="connection-actions">
              <button type="button" className="secondary" onClick={() => void testConnection()} disabled={Boolean(busy) || !configuredCount}>{busy === "test" ? "測試中…" : "測試已保存連線"}</button>
              <button type="button" className="primary" onClick={() => void save()} disabled={Boolean(busy) || !summary?.encryptionAvailable}>{busy === "save" ? "加密保存中…" : "以 Touch ID 保存並測試"}</button>
            </div>

            <footer>
              <div><strong>Mac 鑰匙版本</strong><small>{update.state === "downloaded" ? `安全更新 v${update.version} 已下載` : update.message ?? `v${version} · GitHub 控制台自動保持最新`}</small></div>
              {update.state === "downloaded" ? <button type="button" onClick={() => void window.fbaOS.updates.install()}>更新並重啟</button> : <button type="button" onClick={() => void checkUpdate()} disabled={busy === "update"}>{busy === "update" ? "檢查中…" : "檢查鑰匙更新"}</button>}
              {summary?.hasVault && <button type="button" className="danger-link" onClick={() => void clearCredentials()} disabled={Boolean(busy)}>清除本機憑證</button>}
            </footer>
          </aside>
        </div>
      )}
    </>
  );
}
