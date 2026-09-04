"use client";

import { useEffect, useState } from "react";
import type { BusinessPricingAuditSnapshot } from "../business-pricing-audit";
import type {
  StandaloneAuditJob,
  StandaloneAuditMode,
} from "../standalone-audit";
import BusinessPricingAuditPanel from "./business-pricing-audit-panel";
import AuditWorkspaceShell, {
  type AuditSurfacePresentation,
} from "./audit-workspace-shell";

export default function BusinessPricingAuditDrawer({
  marketplaceId,
  marketplaceShort,
  mode = "live",
  cachedSnapshot = null,
  initialJob = null,
  onSnapshotChange,
  onJobChange,
  presentation = "dialog",
  onClose,
}: {
  marketplaceId: string;
  marketplaceShort: string;
  mode?: StandaloneAuditMode;
  cachedSnapshot?: BusinessPricingAuditSnapshot | null;
  initialJob?: StandaloneAuditJob | null;
  onSnapshotChange?: (snapshot: BusinessPricingAuditSnapshot) => void;
  onJobChange?: (job: StandaloneAuditJob) => void;
  presentation?: AuditSurfacePresentation;
  onClose: () => void;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const busy = editorBusy || batchBusy;
  const requestClose = () => {
    if (!busy) onClose();
  };

  useEffect(() => {
    if (presentation !== "dialog") return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [busy, onClose, presentation]);

  return (
    <AuditWorkspaceShell
      presentation={presentation}
      eyebrow={editorOpen
        ? "AMAZON BUSINESS · SKU DETAIL"
        : "AMAZON BUSINESS · FBA ONLY"}
      title={editorOpen ? "單一 SKU B2B 價格編輯" : "全站 B2B 價格健檢"}
      closeLabel="關閉全站 B2B 價格健檢"
      surfaceClassName="business-pricing-audit-drawer"
      busy={busy}
      busyStatus={busy ? (
        <p
          className="business-pricing-drawer-status"
          role="status"
          aria-live="polite"
        >{batchBusy
          ? "Notebook Key 正在處理這次批次要求，請勿關閉、返回或重複送出。"
          : "Notebook Key 正在處理這次要求，請勿關閉或重複送出。"}</p>
      ) : null}
      onBack={requestClose}
      autoFocusClose
    >
      <BusinessPricingAuditPanel
        marketplaceId={marketplaceId}
        marketplaceShort={marketplaceShort}
        mode={mode}
        presentation={presentation}
        cachedSnapshot={cachedSnapshot}
        initialJob={initialJob}
        onSnapshotChange={onSnapshotChange}
        onJobChange={onJobChange}
        onEditorOpenChange={setEditorOpen}
        onEditorBusyChange={setEditorBusy}
        onBatchBusyChange={setBatchBusy}
      />
    </AuditWorkspaceShell>
  );
}
