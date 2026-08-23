"use client";

import { useState } from "react";
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
    <section className="audit-suite-home-card" aria-busy={starting}>
      <div className="audit-suite-home-heading">
        <span className="audit-suite-home-icon" aria-hidden="true">✓✓</span>
        <div>
          <p className="eyebrow">ONE CLICK · {AUDIT_SUITE_SECTION_COUNT} FBA AUDITS</p>
          <h2>一鍵執行全部 FBA 健檢</h2>
          <p>按一次會直接啟動下方 {AUDIT_SUITE_SECTION_COUNT} 張單項卡片；進度與結果只顯示在各卡片，點進各卡片查看完整結果。</p>
        </div>
      </div>
      {error && <div className="price-error" role="alert">{error}</div>}
      <div className="audit-suite-home-actions">
        <button
          type="button"
          className="audit-suite-start"
          onClick={() => void start()}
          disabled={starting}
        >
          {starting
            ? "正在啟動 7 張單項卡片…"
            : hasRunningJobs
              ? "啟動其餘健檢（執行中項目沿用）"
              : "立即啟動下方 7 項健檢"}
        </button>
      </div>
    </section>
  );
}
