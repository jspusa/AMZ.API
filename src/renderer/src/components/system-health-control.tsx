"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
}: {
  marketplaceId: string;
}) {
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  const label = loading
    ? "檢查中"
    : error
      ? "需要檢查"
      : health?.overall === "ready"
        ? "系統正常"
        : "有待處理";
  const tone = loading
    ? "checking"
    : error || health?.overall === "attention"
      ? "attention"
      : "ready";
  const orderedChecks = useMemo(
    () =>
      [...(health?.checks ?? [])].sort((left, right) => {
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
        className={`system-health-trigger ${tone}`}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <span className="health-orb" aria-hidden="true">{loading ? "↻" : health?.overall === "ready" ? "✓" : "!"}</span>
        <span><strong>{label}</strong><small>{health ? `${health.score}% · 自我檢查` : "自我檢查"}</small></span>
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
              <div><p className="eyebrow">SAFE AUTOMATION · READ ONLY</p><h2 id="system-health-title">系統自檢與除錯</h2></div>
              <button type="button" onClick={() => setOpen(false)} disabled={loading} autoFocus aria-label="關閉系統自檢">×</button>
            </div>
            <p className="price-intro">系統會自行找出能修復的暫時性連線問題；缺少授權或必須人工判斷時，才會停下來告訴你。</p>

            {error && (
              <div className="health-error" role="alert">
                <span>!</span><div><strong>自我檢查暫時失敗</strong><p>{error}</p></div>
              </div>
            )}

            {health && (
              <>
                <section className={`health-summary ${health.overall}`} aria-live="polite">
                  <div className="health-score"><strong>{health.score}</strong><span>%</span></div>
                  <div><p className="eyebrow">{health.marketplaceLabel} · {health.mode === "live" ? "LIVE" : "DEMO"}</p><h3>{health.overall === "ready" ? "所有可執行項目已就緒" : "系統已攔住尚未就緒的項目"}</h3><small>最後自檢 {formatCheckedAt(health.checkedAt)} · 不會修改 Amazon</small></div>
                </section>

                <section className="health-check-list" aria-label="系統自檢項目">
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
              {loading ? "正在自動檢查…" : "一鍵重新檢查"}
            </button>
            <p className="submission-note">只對安全的讀取失敗自動重試一次；價格、文案、圖片、促銷與入庫寫入永遠不會自動重送。</p>
          </aside>
        </div>,
        document.body,
      )}
    </>
  );
}
