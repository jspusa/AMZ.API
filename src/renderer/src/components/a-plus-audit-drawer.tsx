"use client";

import { useEffect } from "react";
import type { AplusAuditSnapshot } from "../a-plus-audit";
import AplusAuditPanel, {
  type AplusAuditObservableJob,
  type AplusAuditRequester,
} from "./a-plus-audit-panel";
import AuditWorkspaceShell, {
  type AuditSurfacePresentation,
} from "./audit-workspace-shell";

export default function AplusAuditDrawer({
  marketplaceId,
  marketplaceShort,
  mode,
  cachedSnapshot = null,
  onSnapshotChange,
  job = null,
  onJobChange,
  requestAudit,
  presentation = "dialog",
  onClose,
}: {
  marketplaceId: string;
  marketplaceShort: string;
  mode: "live" | "demo";
  cachedSnapshot?: AplusAuditSnapshot | null;
  onSnapshotChange?: (snapshot: AplusAuditSnapshot) => void;
  job?: AplusAuditObservableJob | null;
  onJobChange?: (job: AplusAuditObservableJob) => void;
  requestAudit?: AplusAuditRequester;
  presentation?: AuditSurfacePresentation;
  onClose: () => void;
}) {
  useEffect(() => {
    if (presentation !== "dialog") return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose, presentation]);

  return (
    <AuditWorkspaceShell
      presentation={presentation}
      eyebrow="A+ CONTENT · FBA ONLY · READ ONLY"
      title="全站 A+ 健檢"
      closeLabel="關閉全站 A+ 健檢"
      surfaceClassName="business-pricing-audit-drawer a-plus-audit-surface"
      onBack={onClose}
      autoFocusClose
    >
      <AplusAuditPanel
        marketplaceId={marketplaceId}
        marketplaceShort={marketplaceShort}
        mode={mode}
        cachedSnapshot={cachedSnapshot}
        onSnapshotChange={onSnapshotChange}
        job={job}
        onJobChange={onJobChange}
        requestAudit={requestAudit}
      />
    </AuditWorkspaceShell>
  );
}
