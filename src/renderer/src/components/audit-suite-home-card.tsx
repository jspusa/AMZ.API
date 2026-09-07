"use client";

import { useId, useState } from "react";
import {
  AUDIT_SUITE_SECTION_COUNT,
  AUDIT_SUITE_SECTIONS,
  type AuditSuiteSectionId,
} from "../../../shared/audit-suite";
import {
  startStandaloneAuditJob,
  type StandaloneAuditJob,
  type StandaloneAuditKind,
  type StandaloneAuditMode,
  type StandaloneAuditOptions,
} from "../standalone-audit";
import {
  startAplusAuditJob,
  type AplusAuditObservableJob,
} from "./a-plus-audit-panel";

type RunAllAuditDefinition =
  | Readonly<{
      source: "standalone";
      id: AuditSuiteSectionId;
      kind: Exclude<StandaloneAuditKind, "agedInventory">;
      label: string;
      options?: StandaloneAuditOptions;
    }>
  | Readonly<{ source: "aplus"; id: "aplus"; label: string }>;

const RUN_ALL_AUDITS: readonly RunAllAuditDefinition[] =
  AUDIT_SUITE_SECTIONS.map((section): RunAllAuditDefinition => {
    if (section.id === "aplus") {
      return { source: "aplus", id: section.id, label: section.label };
    }
    if (section.id === "subscription") {
      return {
        source: "standalone",
        id: section.id,
        kind: section.id,
        label: section.label,
        options: { months: 6 },
      };
    }
    return {
      source: "standalone",
      id: section.id,
      kind: section.id,
      label: section.label,
    };
  });

type StandaloneStarter = (input: Readonly<{
  kind: StandaloneAuditKind;
  marketplaceId: string;
  mode: StandaloneAuditMode;
  options?: StandaloneAuditOptions;
}>) => Promise<StandaloneAuditJob>;

type AplusStarter = (input: Readonly<{
  marketplaceId: string;
  mode: StandaloneAuditMode;
}>) => Promise<AplusAuditObservableJob>;

export async function startIndividualAuditJobs(input: Readonly<{
  marketplaceId: string;
  mode: StandaloneAuditMode;
  startStandalone?: StandaloneStarter;
  startAplus?: AplusStarter;
  onStandaloneJobChange(job: StandaloneAuditJob): void;
  onAplusJobChange(job: AplusAuditObservableJob): void;
  onStartSuccess?(id: AuditSuiteSectionId): void;
  onStartFailure?(id: AuditSuiteSectionId, message: string): void;
}>): Promise<Readonly<{ failedLabels: readonly string[] }>> {
  const startStandalone = input.startStandalone ?? startStandaloneAuditJob;
  const startAplus = input.startAplus ?? startAplusAuditJob;
  const failedLabels = (await Promise.all(RUN_ALL_AUDITS.map(
    async (definition): Promise<string | null> => {
      try {
        if (definition.source === "aplus") {
          const job = await startAplus({
            marketplaceId: input.marketplaceId,
            mode: input.mode,
          });
          input.onStartSuccess?.(definition.id);
          input.onAplusJobChange(job);
        } else {
          const job = await startStandalone({
            kind: definition.kind,
            marketplaceId: input.marketplaceId,
            mode: input.mode,
            ...(definition.options ? { options: definition.options } : {}),
          });
          input.onStartSuccess?.(definition.id);
          input.onStandaloneJobChange(job);
        }
        return null;
      } catch {
        input.onStartFailure?.(
          definition.id,
          `${definition.label}本次未能啟動；上次結果不會當成本次結果。`,
        );
        return definition.label;
      }
    },
  ))).filter((label): label is string => label !== null);

  return { failedLabels };
}

export default function AuditSuiteHomeCard({
  marketplaceId,
  mode,
  hasRunningJobs = false,
  onStandaloneJobChange,
  onAplusJobChange,
  onStartSuccess,
  onStartFailure,
}: Readonly<{
  marketplaceId: string;
  mode: StandaloneAuditMode;
  hasRunningJobs?: boolean;
  onStandaloneJobChange(job: StandaloneAuditJob): void;
  onAplusJobChange(job: AplusAuditObservableJob): void;
  onStartSuccess?(id: AuditSuiteSectionId): void;
  onStartFailure?(id: AuditSuiteSectionId, message: string): void;
}>) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingId = useId();
  const descriptionId = useId();

  const start = async () => {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      const outcome = await startIndividualAuditJobs({
        marketplaceId,
        mode,
        onStandaloneJobChange,
        onAplusJobChange,
        onStartSuccess,
        onStartFailure,
      });
      if (outcome.failedLabels.length > 0) {
        setError(
          `${outcome.failedLabels.join("、")}未能啟動；其餘卡片已各自交給 Notebook Key 執行。`,
        );
      }
    } catch {
      setError("目前無法啟動 FBA 健檢；請直接查看下方各單項卡片狀態。");
    } finally {
      setStarting(false);
    }
  };

  return (
    <section
      className="audit-suite-home-card"
      aria-labelledby={headingId}
      aria-busy={starting}
    >
      <div className="audit-suite-home-overview">
        <div className="audit-suite-home-heading">
          <p className="audit-suite-home-kicker">
            <span className="automation-badge one_click">一鍵</span>
            <span>全站 FBA · {AUDIT_SUITE_SECTION_COUNT} 項健檢</span>
          </p>
          <h2 id={headingId}>一鍵執行全部 FBA 健檢</h2>
          <p id={descriptionId} className="audit-suite-home-description">
            直接啟動下方 {AUDIT_SUITE_SECTION_COUNT} 張單項卡片，點進各卡片查看完整結果。
          </p>
        </div>
        <ul className="audit-suite-scope-list" aria-label="本次健檢範圍">
          {AUDIT_SUITE_SECTIONS.map((section) => (
            <li key={section.id}>{section.label}</li>
          ))}
        </ul>
      </div>
      <div className="audit-suite-home-actions">
        <div className="audit-suite-launch-summary">
          <span className="audit-suite-launch-count">{AUDIT_SUITE_SECTION_COUNT}</span>
          <div><strong>項目一次啟動</strong><span>只讀取資料，分項查看結果</span></div>
        </div>
        <button
          type="button"
          className="audit-suite-start"
          onClick={() => void start()}
          disabled={starting}
          aria-describedby={descriptionId}
        >
          <span aria-live="polite">
            {starting
              ? `正在啟動 ${AUDIT_SUITE_SECTION_COUNT} 張單項卡片…`
              : hasRunningJobs
                ? "啟動其餘健檢（執行中項目沿用）"
                : `立即啟動下方 ${AUDIT_SUITE_SECTION_COUNT} 項健檢`}
          </span>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="audit-suite-start-arrow">
            <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <p className="audit-suite-launch-note">
          <span className="automation-badge automatic">自動</span>
          <span>{hasRunningJobs ? "執行中項目會沿用目前工作。" : "啟動後由 Notebook Key 背景執行。"}</span>
        </p>
      </div>
      {error && <div className="price-error audit-suite-launch-error" role="alert">{error}</div>}
    </section>
  );
}
