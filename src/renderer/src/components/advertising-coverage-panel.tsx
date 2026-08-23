"use client";

import { useEffect, useRef, useState } from "react";
import {
  parseAdvertisingCoverageSnapshot,
  type AdvertisingCoverageSnapshot,
} from "../advertising-coverage";
import {
  pollStandaloneAuditJob,
  shouldResumeStandaloneAuditJob,
  startStandaloneAuditJob,
  standaloneAuditReconnectRevision,
  type StandaloneAuditJob,
  type StandaloneAuditMode,
} from "../standalone-audit";

export default function AdvertisingCoveragePanel({
  marketplaceId,
  mode = "live",
  available,
  unavailableNotice,
  initialJob = null,
  onJobChange,
}: {
  marketplaceId: string;
  mode?: StandaloneAuditMode;
  available: boolean;
  unavailableNotice: string;
  initialJob?: StandaloneAuditJob | null;
  onJobChange?: (job: StandaloneAuditJob) => void;
}) {
  const [snapshot, setSnapshot] = useState<AdvertisingCoverageSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const observerJobIdRef = useRef<string | null>(null);
  const initialJobReconnectRevision = standaloneAuditReconnectRevision(initialJob);

  useEffect(() => {
    abortRef.current?.abort();
    setSnapshot(null);
    setBusy(false);
    setError(null);
  }, [marketplaceId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const acceptTerminal = (job: StandaloneAuditJob) => {
    if (!job.ready || job.status !== "completed") {
      throw new Error(
        job.ready ? job.error.message : "廣告覆蓋背景工作尚未完成。",
      );
    }
    setSnapshot(parseAdvertisingCoverageSnapshot(job.snapshot, marketplaceId));
  };

  async function runAudit(): Promise<void> {
    if (!available || busy) return;
    setBusy(true);
    setError(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      let current = await startStandaloneAuditJob({
        kind: "advertising",
        marketplaceId,
        mode,
        signal: controller.signal,
      });
      observerJobIdRef.current = current.jobId;
      onJobChange?.(current);
      current = await pollStandaloneAuditJob({
        expected: current,
        signal: controller.signal,
        onProgress: onJobChange,
      });
      onJobChange?.(current);
      acceptTerminal(current);
      observerJobIdRef.current = null;
    } catch (auditError) {
      setSnapshot(null);
      setError(
        auditError instanceof Error
          ? auditError.message
          : "目前無法執行廣告覆蓋健檢。",
      );
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        observerJobIdRef.current = null;
        setBusy(false);
      }
    }
  }

  useEffect(() => {
    if (!shouldResumeStandaloneAuditJob({
      initialJob,
      expectedKind: "advertising",
      marketplaceId,
      mode,
      observerJobId: observerJobIdRef.current,
    })) return;
    const observedJob = initialJob!;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    observerJobIdRef.current = observedJob.jobId;
    setBusy(true);
    void (async () => {
      try {
        const terminal = observedJob.ready
          ? observedJob
          : await pollStandaloneAuditJob({
              expected: observedJob,
              signal: controller.signal,
              onProgress: onJobChange,
            });
        onJobChange?.(terminal);
        acceptTerminal(terminal);
      } catch (resumeError) {
        if (resumeError instanceof Error && resumeError.name === "AbortError") return;
        setError(resumeError instanceof Error
          ? resumeError.message
          : "目前無法接續廣告覆蓋健檢。");
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setBusy(false);
          observerJobIdRef.current = null;
        }
      }
    })();
    return () => {
      controller.abort();
      if (abortRef.current === controller) {
        abortRef.current = null;
        observerJobIdRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJobReconnectRevision, marketplaceId, mode]);

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
