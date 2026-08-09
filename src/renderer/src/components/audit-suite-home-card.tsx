"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  auditSuiteRunForMarketplace,
  createAuditSuiteState,
  parseAuditSuiteRun,
  replaceAuditSuiteRun,
  storeAuditSuiteRun,
} from "../audit-suite";
import {
  AUDIT_SUITE_SECTION_IDS,
  type AuditSuitePublicContext,
  type AuditSuiteRun,
  type AuditSuiteRunDto,
  type AuditSuiteSectionId,
} from "../../../shared/audit-suite";

const SECTION_LABELS: Readonly<Record<AuditSuiteSectionId, string>> = {
  subscription: "訂閱價格",
  inventory: "180+ 庫齡與預估冗餘",
  content: "商品內容結構",
  image: "Listing 圖片",
  variation: "未綁變體",
  review: "評論主題",
  advertising: "廣告覆蓋",
};

type ApiProblem = { message?: string; requestId?: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function publicContext(
  value: unknown,
  expectedMarketplaceId: string,
): AuditSuitePublicContext {
  if (!isRecord(value)) throw new Error("綜合健檢啟動回應格式無效。");
  const runId = value.runId;
  const contextId = value.contextId;
  const marketplaceId = value.marketplaceId;
  const mode = value.mode;
  if (
    typeof runId !== "string" ||
    !/^[A-Za-z0-9._-]{1,200}$/u.test(runId) ||
    typeof contextId !== "string" ||
    !/^[A-Za-z0-9-]{16,100}$/u.test(contextId) ||
    marketplaceId !== expectedMarketplaceId ||
    (mode !== "live" && mode !== "demo")
  ) {
    throw new Error("綜合健檢執行 context 與目前站點不一致。");
  }
  return { runId, contextId, marketplaceId, mode };
}

export function parseAuditSuiteStart(
  value: unknown,
  expectedMarketplaceId: string,
): AuditSuiteRun {
  const context = publicContext(value, expectedMarketplaceId);
  return parseAuditSuiteRun(value as AuditSuiteRunDto, context);
}

export function auditSuiteCompletedSections(run: AuditSuiteRun | null): number {
  if (!run) return 0;
  return AUDIT_SUITE_SECTION_IDS.filter((id) =>
    ["completed", "partial", "failed"].includes(run.sections[id].status)
  ).length;
}

function terminal(run: AuditSuiteRun | null): boolean {
  return Boolean(run && ["completed", "partial", "failed"].includes(run.status));
}

type AuditSuitePollResult =
  | { kind: "run"; run: AuditSuiteRun }
  | { kind: "stopped"; message: string };

export async function runAuditSuitePollLoop(input: {
  signal: AbortSignal;
  wait: (signal: AbortSignal) => Promise<void>;
  load: (signal: AbortSignal) => Promise<AuditSuitePollResult>;
  onRun: (run: AuditSuiteRun) => void;
  onRetryableError: (error: unknown) => void;
  onStopped: (message: string) => void;
}): Promise<void> {
  while (!input.signal.aborted) {
    try {
      await input.wait(input.signal);
      if (input.signal.aborted) return;
      const result = await input.load(input.signal);
      if (result.kind === "stopped") {
        input.onStopped(result.message);
        return;
      }
      input.onRun(result.run);
      if (terminal(result.run)) return;
    } catch (error) {
      if (
        input.signal.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) return;
      input.onRetryableError(error);
    }
  }
}

function pollDelay(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, 1_200);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function problemMessage(value: unknown, fallback: string): string {
  if (!isRecord(value)) return fallback;
  const problem = value as ApiProblem;
  const requestId = typeof problem.requestId === "string" ? problem.requestId : null;
  return `${typeof problem.message === "string" ? problem.message : fallback}${
    requestId ? `（Request ID: ${requestId}）` : ""
  }`;
}

function safeFilename(response: Response): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  const candidate = encoded
    ? decodeURIComponent(encoded)
    : plain ?? `amazon-fba-audit-suite-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return candidate.replace(/[\\/:*?"<>|]/g, "-");
}

export default function AuditSuiteHomeCard({
  marketplaceId,
}: {
  marketplaceId: string;
}) {
  const [state, setState] = useState(createAuditSuiteState);
  const [starting, setStarting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stoppedRunId, setStoppedRunId] = useState<string | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const run = auditSuiteRunForMarketplace(state, marketplaceId);
  const completedSections = auditSuiteCompletedSections(run);

  useEffect(() => {
    pollAbortRef.current?.abort();
    if (!run || terminal(run) || stoppedRunId === run.runId) return;
    const controller = new AbortController();
    pollAbortRef.current = controller;
    void runAuditSuitePollLoop({
      signal: controller.signal,
      wait: pollDelay,
      load: async (signal) => {
        const query = new URLSearchParams({
          marketplaceId,
          runId: run.runId,
          contextId: run.contextId,
        });
        const response = await fetch(`/api/sp-api/audit-suite?${query}`, {
          cache: "no-store",
          signal,
        });
        const raw = (await response.json()) as unknown;
        if (!response.ok) {
          const message = problemMessage(raw, "綜合健檢背景狀態讀取失敗。");
          if (response.status === 409 || response.status === 410) {
            return {
              kind: "stopped" as const,
              message: `${message}可以重新開始一次健檢。`,
            };
          }
          throw new Error(message);
        }
        const next = parseAuditSuiteRun(raw as AuditSuiteRunDto, {
          runId: run.runId,
          contextId: run.contextId,
          marketplaceId,
          mode: run.mode,
        });
        return { kind: "run" as const, run: next };
      },
      onRun: (next) => {
        setState((current) => storeAuditSuiteRun(current, next));
        setError(null);
      },
      onRetryableError: (requestError) => {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "綜合健檢背景狀態讀取失敗。",
        );
      },
      onStopped: (message) => {
        setError(message);
        setStoppedRunId(run.runId);
      },
    });
    return () => {
      controller.abort();
      if (pollAbortRef.current === controller) pollAbortRef.current = null;
    };
  }, [marketplaceId, run?.contextId, run?.mode, run?.runId, run?.status, stoppedRunId]);

  useEffect(() => () => pollAbortRef.current?.abort(), []);

  const progressText = useMemo(() => {
    if (!run) return "尚未執行";
    if (run.status === "completed") return "7 項全部完成";
    if (run.status === "partial") return "已完成，但有項目僅能部分核對";
    if (run.status === "failed") return "7 項都未建立可核對快照";
    return `${completedSections}／7 項已收斂，main process 仍在背景處理`;
  }, [completedSections, run]);

  const start = async () => {
    setStarting(true);
    setError(null);
    setStoppedRunId(null);
    try {
      const response = await fetch("/api/sp-api/audit-suite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ marketplaceId }),
      });
      const raw = (await response.json()) as unknown;
      if (!response.ok) {
        throw new Error(problemMessage(raw, "無法開始綜合 FBA 健檢。"));
      }
      const next = parseAuditSuiteStart(raw, marketplaceId);
      setState((current) => replaceAuditSuiteRun(current, next));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "無法開始綜合 FBA 健檢。",
      );
    } finally {
      setStarting(false);
    }
  };

  const download = async () => {
    if (!run || !terminal(run) || run.status === "failed") return;
    setExporting(true);
    setError(null);
    try {
      const query = new URLSearchParams({
        marketplaceId,
        runId: run.runId,
        contextId: run.contextId,
      });
      const response = await fetch(`/api/sp-api/audit-suite/export?${query}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const raw = (await response.json()) as unknown;
        throw new Error(problemMessage(raw, "綜合健檢 Excel 下載失敗。"));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = safeFilename(response);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "綜合健檢 Excel 下載失敗。",
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="audit-suite-home-card" aria-busy={starting || Boolean(run && !terminal(run))}>
      <div className="audit-suite-home-heading">
        <span className="audit-suite-home-icon" aria-hidden="true">✓✓</span>
        <div>
          <p className="eyebrow">ONE CLICK · SEVEN FBA AUDITS</p>
          <h2>一鍵執行全部 FBA 健檢</h2>
          <p>七項唯讀健檢由 Mac main process 在背景繼續；你可以關閉視窗或先使用其他功能。</p>
        </div>
      </div>
      <div className="audit-suite-home-status" aria-live="polite">
        <strong>{progressText}</strong>
        <small>本機拼字紅字標示仍由「單項文案健檢」完成；綜合健檢不會上傳文案或自動改 Amazon。</small>
      </div>
      <div className="audit-suite-section-grid">
        {AUDIT_SUITE_SECTION_IDS.map((id) => {
          const section = run?.sections[id] ?? null;
          return (
            <article key={id} className={section ? `is-${section.status}` : "is-idle"}>
              <span aria-hidden="true" />
              <div>
                <strong>{SECTION_LABELS[id]}</strong>
                <small>{section?.message ?? "等待你開始。"}</small>
              </div>
            </article>
          );
        })}
      </div>
      {error && <div className="price-error" role="alert">{error}</div>}
      <div className="audit-suite-home-actions">
        <button type="button" className="audit-suite-start" onClick={() => void start()} disabled={starting || Boolean(run && !terminal(run) && stoppedRunId !== run.runId)}>
          {starting
            ? "正在建立背景健檢…"
            : run && (terminal(run) || stoppedRunId === run.runId)
              ? "重新執行七項 FBA 健檢"
              : run
                ? "全部健檢正在背景執行"
                : "開始全部 FBA 健檢"}
        </button>
        {run && (run.status === "completed" || run.status === "partial") && (
          <button type="button" className="secondary" onClick={() => void download()} disabled={exporting}>
            {exporting ? "正在建立 Excel…" : "下載合併健檢 Excel"}
          </button>
        )}
      </div>
    </section>
  );
}
