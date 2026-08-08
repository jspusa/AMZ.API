"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  onAutoSyncChange,
}: {
  marketplaceId: string;
  autoSync?: boolean;
  onAutoSyncChange?: (enabled: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState<UiFontSize>(() => readUiFontSize());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    applyUiFontSize(fontSize);
  }, [fontSize]);

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
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [loading, open]);

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

  return (
    <>
      <button
        className="system-health-trigger neutral"
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label="開啟系統資訊"
      >
        <span className="health-orb" aria-hidden="true">{loading ? "↻" : "•••"}</span>
        <span><strong>系統資訊</strong><small>進階</small></span>
      </button>

      {open && createPortal(
        <div
          className="drawer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !loading) setOpen(false);
          }}
        >
          <aside
            className="order-drawer system-health-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="system-health-title"
          >
            <div className="drawer-header">
              <div><p className="eyebrow">ADVANCED · READ ONLY</p><h2 id="system-health-title">進階與系統資訊</h2></div>
              <button type="button" onClick={() => setOpen(false)} disabled={loading} autoFocus aria-label="關閉進階與系統資訊">×</button>
            </div>
            <p className="price-intro">一般工作不需要處理這裡。連線、授權與防呆細節集中收在下方，需要除錯時再展開。</p>

            <section className="health-quiet-summary" aria-live="polite">
              <span aria-hidden="true">✓</span>
              <div><strong>安全守門在背景運作</strong><p>系統會在真正需要決策的功能內直接提示，不把工程設定當成員工待辦。</p></div>
            </section>

            <section className="font-size-preference" aria-labelledby="font-size-preference-title">
              <div>
                <p className="eyebrow">LOCAL DISPLAY</p>
                <h3 id="font-size-preference-title">介面字級</h3>
                <small>只在這台 Mac 保存顯示偏好，不保存商品、銷售或其他營運資料。</small>
              </div>
              <div role="radiogroup" aria-label="介面字級">
                {UI_FONT_SIZE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={fontSize === option.value}
                    onClick={() => {
                      setFontSize(option.value);
                      saveUiFontSize(option.value);
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>

            <details className="health-advanced-details system-preferences-details">
              <summary>
                <span><strong>操作偏好與系統說明</strong><small>自動同步、能力邊界與連線架構</small></span>
                <i>＋</i>
              </summary>
              <div className="health-advanced-body">
                <label className="auto-sync-switch system-auto-sync-switch">
                  <input
                    type="checkbox"
                    checked={autoSync}
                    onChange={(event) => onAutoSyncChange?.(event.target.checked)}
                  />
                  <span aria-hidden="true" />
                  <div><strong>銷售趨勢自動同步</strong><small>{autoSync ? "每 5 分鐘 · 已開啟" : "已暫停"}</small></div>
                </label>
                <div className="automation-legend" aria-label="自動化顏色說明">
                  <span className="automation-badge automatic"><i />自動</span>
                  <span className="automation-badge one_click"><i />一鍵</span>
                  <span className="automation-badge manual"><i />需人工</span>
                </div>
                <div className="connection-grid system-info-grid">
                  <article><span>1</span><div><strong>SP-API Private Seller App</strong><p>Amazon 資料由 Mac Bridge 依固定白名單讀取。</p></div></article>
                  <article><span>2</span><div><strong>Mac Keychain Secrets</strong><p>本機憑證只以加密密文留在這台 Mac。</p></div></article>
                  <article><span>3</span><div><strong>FBA only</strong><p>健檢、庫存與營運資料都保留 FBA 證據邊界。</p></div></article>
                  <article><span>4</span><div><strong>寫入防呆</strong><p>預檢、Touch ID、單次送出與唯讀回查不可略過。</p></div></article>
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
