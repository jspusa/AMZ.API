import { persistDisplayPreferences } from "../display-preferences-client";
"use client";

import UiBuildInformation from "./ui-build-information";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AppearancePreference from "./appearance-preference";
import {
  applyUiFontSize,
  readUiFontSize,
  saveUiFontSize,
  UI_FONT_SIZE_OPTIONS,
  type UiFontSize,
} from "../ui-font-size";

type AutomationLevel = "automatic" | "one_click" | "manual";
type CheckState = "ready" | "attention" | "manual";

type HealthCheck = {
  id: string;
  label: string;
  state: CheckState;
  automation: AutomationLevel;
  detail: string;
  action: string | null;
};

type HealthSnapshot = {
  marketplaceId: string;
  marketplaceLabel: string;
  mode: "live" | "demo";
  overall: "ready" | "attention";
  checkedAt: string;
  score: number;
  summary: { ready: number; attention: number; manual: number };
  checks: HealthCheck[];
  safeguards: string[];
  notice: string;
};

type ApiProblem = { message?: string };

export type AuditPreference =
  | "content"
  | "images"
  | "inventory"
  | "variations"
  | "subscriptions"
  | null;

const FEATURE_IDEAS: Record<Exclude<AuditPreference, null>, { label: string; idea: string }> = {
  content: {
    label: "文案健檢",
    idea: "下一步可加入「待人工確認字詞」跨次保留，讓你只重看仍未決定的項目。",
  },
  images: {
    label: "圖片健檢",
    idea: "下一步可加入圖片補齊優先順序，先看低於所選張數門檻且仍在售的 FBA SKU。",
  },
  inventory: {
    label: "冗餘庫存健檢",
    idea: "下一步可加入處理清單，把 Amazon estimated excess 與庫齡分欄比較。",
  },
  variations: {
    label: "變體健檢",
    idea: "下一步可加入 Parent／child 關係差異預覽，寫入前更快看懂移動結果。",
  },
  subscriptions: {
    label: "訂閱價格健檢",
    idea: "下一步可加入本機價格變動標記，優先顯示需要人工核對的 S&S SKU。",
  },
};

const LEVEL_LABELS: Record<AutomationLevel, string> = {
  automatic: "自動",
  one_click: "一鍵",
  manual: "需人工",
};

function formatCheckedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "剛剛";
  const taipei = new Date(date.getTime() + 8 * 60 * 60 * 1_000);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(taipei.getUTCHours())}:${pad(taipei.getUTCMinutes())}`;
}

function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

export default function SystemHealthControl({
  marketplaceId,
  autoSync = true,
  auditPreference = null,
  disabled = false,
  reloadBlockedReason = null,
  onAutoSyncChange,
}: {
  marketplaceId: string;
  autoSync?: boolean;
  auditPreference?: AuditPreference;
  disabled?: boolean;
  reloadBlockedReason?: string | null;
  onAutoSyncChange?: (enabled: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState<UiFontSize>(() => readUiFontSize());
  const [fontSizePersisted, setFontSizePersisted] = useState(true);
  const chooseFontSize = (value: UiFontSize) => {
    setFontSize(value);
    saveUiFontSize(value);
    void persistDisplayPreferences({ fontSize: value }).then(saved => setFontSizePersisted(saved !== false));
  };
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    applyUiFontSize(fontSize);
  }, [fontSize]);

  useEffect(() => {
    let active = true;
    void window.fbaOS.app.version()
      .then((version) => {
        if (active && typeof version === "string" && version.length <= 40) {
          setAppVersion(version);
        }
      })
      .catch(() => {
        // Version advice remains useful even if the desktop bridge is unavailable.
      });
    return () => {
      active = false;
    };
  }, []);

  const runCheck = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ marketplaceId });

    try {
      let response: Response | null = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        response = await fetch(`/api/system/health?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!retryable(response.status) || attempt === 1) break;
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(resolve, 550);
          controller.signal.addEventListener(
            "abort",
            () => {
              window.clearTimeout(timeout);
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );
        });
      }

      const payload = (await response!.json()) as HealthSnapshot | ApiProblem;
      if (!response!.ok) {
        throw new Error((payload as ApiProblem).message || "系統自我檢查未完成。");
      }
      setHealth(payload as HealthSnapshot);
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") return;
      setError(
        requestError instanceof Error
          ? requestError.message
          : "系統自我檢查未完成。",
      );
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  }, [marketplaceId]);

  useEffect(() => {
    const initialCheck = window.setTimeout(() => void runCheck(), 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void runCheck();
    }, 10 * 60 * 1_000);
    const online = () => void runCheck();
    window.addEventListener("online", online);
    return () => {
      window.clearTimeout(initialCheck);
      window.clearInterval(interval);
      window.removeEventListener("online", online);
      abortRef.current?.abort();
    };
  }, [runCheck]);

  useEffect(() => {
    if (!open) return;
    const appRoot = document.getElementById?.("root");
    const wasInert = appRoot?.inert ?? false;
    if (appRoot) appRoot.inert = true;
    const close = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs.item(dialogs.length - 1) !== dialog) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); setOpen(false);
      }
      if (event.key === "Tab") {
        const targets = Array.from(dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary, [tabindex="0"]',
        )).filter((item) => item.tabIndex >= 0 && (typeof item.checkVisibility === "function"
          ? item.checkVisibility() : item.getClientRects().length > 0));
        const first = targets[0], last = targets.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", close, true);
    return () => {
      window.removeEventListener("keydown", close, true);
      if (appRoot) appRoot.inert = wasInert;
      triggerRef.current?.focus({ preventScroll: true });
    };
  }, [open]);

  const orderedChecks = useMemo(
    () =>
      [...(health?.checks ?? [])]
        .filter((item) => item.id !== "product-master")
        .sort((left, right) => {
        const rank: Record<CheckState, number> = {
          attention: 0,
          manual: 1,
          ready: 2,
        };
        return rank[left.state] - rank[right.state];
        }),
    [health],
  );
  const featureIdea = auditPreference ? FEATURE_IDEAS[auditPreference] : null;

  return (
    <>
      <button
        ref={triggerRef}
        className="system-health-trigger neutral"
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-label="開啟設定"
      >
        <svg className="settings-gear" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.61 5.42 10.54 5.15 10.75 3.09 13.25 3.09 13.46 5.15 14.39 5.42 14.96 5.66 15.81 6.13 17.42 4.81 19.19 6.58 17.87 8.19 18.34 9.04 18.58 9.61 18.85 10.54 20.91 10.75 20.91 13.25 18.85 13.46 18.58 14.39 18.34 14.96 17.87 15.81 19.19 17.42 17.42 19.19 15.81 17.87 14.96 18.34 14.39 18.58 13.46 18.85 13.25 20.91 10.75 20.91 10.54 18.85 9.61 18.58 9.04 18.34 8.19 17.87 6.58 19.19 4.81 17.42 6.13 15.81 5.66 14.96 5.42 14.39 5.15 13.46 3.09 13.25 3.09 10.75 5.15 10.54 5.42 9.61 5.66 9.04 6.13 8.19 4.81 6.58 6.58 4.81 8.19 6.13 9.04 5.66Z"/><circle cx="12" cy="12" r="3"/></svg>
        <strong>設定</strong>
      </button>

      {open && createPortal(
        <div
          className="drawer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <aside
            ref={dialogRef}
            className="order-drawer system-health-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="system-health-title"
          >
            <div className="drawer-header">
              <h2 id="system-health-title">設定</h2>
              <button type="button" onClick={() => setOpen(false)} autoFocus aria-label="關閉設定">×</button>
            </div>

            <section className="font-size-preference" aria-labelledby="font-size-preference-title">
              <div>
                <p className="eyebrow">外觀與顯示</p>
                <h3 id="font-size-preference-title">介面字級</h3>
                <small>只在這台電腦保存顯示偏好，不保存商品、銷售或其他營運資料。</small>
              </div>
              <div role="radiogroup" aria-label="介面字級">
                {UI_FONT_SIZE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={fontSize === option.value}
                    tabIndex={fontSize === option.value ? 0 : -1}
                    onKeyDown={(event) => {
                      const index = UI_FONT_SIZE_OPTIONS.findIndex((item) => item.value === fontSize);
                      const nextIndex = event.key === "ArrowRight" || event.key === "ArrowDown" ? (index + 1) % UI_FONT_SIZE_OPTIONS.length
                        : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index + UI_FONT_SIZE_OPTIONS.length - 1) % UI_FONT_SIZE_OPTIONS.length
                        : event.key === "Home" ? 0 : event.key === "End" ? UI_FONT_SIZE_OPTIONS.length - 1 : null;
                      if (nextIndex === null) return;
                      event.preventDefault();
                      const next = UI_FONT_SIZE_OPTIONS[nextIndex]!;
                      chooseFontSize(next.value);
                      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]').item(nextIndex)?.focus();
                    }}
                    onClick={() => {
                      chooseFontSize(option.value);
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>

            {!fontSizePersisted && <p className="appearance-storage-note" role="status">已套用；目前無法儲存偏好，重新開啟後可能恢復預設。請確認 Notebook Key 已更新。</p>}

            <AppearancePreference />

            <section className="settings-sync-preference" aria-label="自動同步">
                <label className="auto-sync-switch system-auto-sync-switch">
                  <input
                    type="checkbox"
                    checked={autoSync}
                    onChange={(event) => onAutoSyncChange?.(event.target.checked)}
                  />
                  <span aria-hidden="true" />
                  <div><strong>銷售趨勢自動同步</strong><small>{autoSync ? "每 5 分鐘 · 已開啟" : "已暫停"}</small></div>
                </label>
            </section>
            <details className="health-advanced-details settings-about">
              <summary><span><strong>關於與功能建議</strong><small>App 版本、能力說明與下次功能靈感</small></span><i aria-hidden="true">›</i></summary>
            <UiBuildInformation blockedReason={disabled ? "目前工作進行中，完成後才能重新載入。" : reloadBlockedReason} />
            <div className="system-recommendation-grid">
              <section className="api-version-recommendation" aria-labelledby="api-version-recommendation-title">
                <span aria-hidden="true">API</span>
                <div>
                  <p className="eyebrow">版本與能力</p>
                  <h3 id="api-version-recommendation-title">API 版本更新建議</h3>
                  <strong>{appVersion ? `目前本機 App ${appVersion}` : "正在確認本機 App 版本"}</strong>
                  <p>GitHub Release 出現新版時，先更新本機 App／Bridge，再重跑唯讀健檢；網頁不會自行替換 Amazon API 能力。</p>
                </div>
              </section>

              <section className="feature-idea-recommendation" aria-labelledby="feature-idea-title">
                <span aria-hidden="true">✦</span>
                <div>
                  <p className="eyebrow">功能建議</p>
                  <h3 id="feature-idea-title">下次功能靈感</h3>
                  <strong>{featureIdea ? `依本次開啟的${featureIdea.label}` : "先從常用健檢開始"}</strong>
                  <p>{featureIdea?.idea ?? "開啟任一首頁健檢後，這裡會提供對應的下一步功能靈感。"}</p>
                  <small>只依本次 App 內你開啟的健檢入口顯示；不會讀取或分析 SKU、銷售、憑證等私密資料。</small>
                </div>
              </section>
            </div>

            </details>

            <details className="health-advanced-details system-preferences-details">
              <summary>
                <span><strong>操作偏好與系統說明</strong><small>能力邊界、狀態色彩與連線架構</small></span>
                <i>＋</i>
              </summary>
              <div className="health-advanced-body">
                <div className="automation-legend" aria-label="自動化顏色說明">
                  <span className="automation-badge automatic"><i />自動</span>
                  <span className="automation-badge one_click"><i />一鍵</span>
                  <span className="automation-badge manual"><i />需人工</span>
                </div>
                <div className="connection-grid system-info-grid">
                  <article><span>1</span><div><strong>SP-API Private Seller App</strong><p>Amazon 資料由本機 Bridge 依固定白名單讀取。</p></div></article>
                  <article><span>2</span><div><strong>本機系統安全儲存區</strong><p>本機憑證只以加密密文留在這台電腦。</p></div></article>
                  <article><span>3</span><div><strong>FBA only</strong><p>健檢、庫存與營運資料都保留 FBA 證據邊界。</p></div></article>
                  <article><span>4</span><div><strong>寫入防呆</strong><p>預檢、Notebook 鑰匙（Touch ID／Windows Hello）、單次送出與唯讀回查不可略過。Windows Hello（指紋／臉部／PIN 由 Windows 決定）不會回傳所用方式。</p></div></article>
                </div>
              </div>
            </details>

            <details className="health-advanced-details">
              <summary>
                <span><strong>查看連線、授權與防呆細節</strong><small>{loading ? "正在更新" : health ? `最後檢查 ${formatCheckedAt(health.checkedAt)}` : "需要時再檢查"}</small></span>
                <i>＋</i>
              </summary>
              <div className="health-advanced-body">
                {error && (
                  <div className="health-error" role="alert">
                    <span>!</span><div><strong>進階檢查暫時未完成</strong><p>{error}</p></div>
                  </div>
                )}

                {health && (
                  <>
                    <section className={`health-summary ${health.overall}`}>
                      <div className="health-score"><strong>{health.score}</strong><span>%</span></div>
                      <div><p className="eyebrow">{health.marketplaceLabel} · {health.mode === "live" ? "LIVE CREDENTIALS" : "DEMO"}</p><h3>{health.mode === "live" ? "Live 憑證已設定（未代表即時驗證）" : health.overall === "ready" ? "展示設定已就緒" : "部分進階整合尚未設定"}</h3><small>最後檢查 {formatCheckedAt(health.checkedAt)} · 只核對本機設定 · 不會修改 Amazon</small></div>
                    </section>

                    <section className="health-check-list" aria-label="進階系統項目">
                      {orderedChecks.map((item) => (
                        <article key={item.id} className={`health-check automation-${item.automation} state-${item.state}`}>
                          <span className="health-check-icon" aria-hidden="true">{item.state === "ready" ? "✓" : item.state === "manual" ? "↗" : "!"}</span>
                          <div><div className="health-check-title"><strong>{item.label}</strong><span className={`automation-badge ${item.automation}`}>{LEVEL_LABELS[item.automation]}</span></div><p>{item.detail}</p>{item.action && <small><b>處理路徑</b>{item.action}</small>}</div>
                        </article>
                      ))}
                    </section>

                    <section className="safety-guard-card">
                      <div><p className="eyebrow">GUARDRAILS</p><h3>防呆守門已開啟</h3><span>所有寫入先檢查，錯誤時停止；不會因重試而重複送出。</span></div>
                      <ul>{health.safeguards.map((item) => <li key={item}>✓ {item}</li>)}</ul>
                    </section>
                    <p className="health-notice">{health.notice}</p>
                  </>
                )}

                <button className="price-primary-button health-refresh" type="button" onClick={() => void runCheck()} disabled={loading}>
                  {loading ? "正在更新…" : "重新檢查進階狀態"}
                </button>
                <p className="submission-note">只對安全的讀取失敗自動重試一次；任何 Amazon 寫入都不會自動重送。</p>
              </div>
            </details>
          </aside>
        </div>,
        document.body,
      )}
    </>
  );
}
