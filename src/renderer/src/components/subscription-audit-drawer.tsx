"use client";

import { useEffect } from "react";
import { isSubscriptionAuditMarketplaceSupported } from "../subscription-audit";
import SubscriptionAuditPanel from "./subscription-audit-panel";
import AuditWorkspaceShell, {
  type AuditSurfacePresentation,
} from "./audit-workspace-shell";
import type {
  StandaloneAuditJob,
  StandaloneAuditMode,
} from "../standalone-audit";

export default function SubscriptionAuditDrawer({
  marketplaceId,
  marketplaceShort,
  mode = "live",
  initialJob = null,
  onJobChange,
  presentation = "dialog",
  onClose,
}: {
  marketplaceId: string;
  marketplaceShort: string;
  mode?: StandaloneAuditMode;
  initialJob?: StandaloneAuditJob | null;
  onJobChange?: (job: StandaloneAuditJob) => void;
  presentation?: AuditSurfacePresentation;
  onClose: () => void;
}) {
  const marketplaceSupported = isSubscriptionAuditMarketplaceSupported(marketplaceId);
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
      eyebrow="FBA SUBSCRIBE & SAVE"
      title={marketplaceSupported ? "全站訂閱價格健檢" : "Subscribe & Save 能力說明"}
      closeLabel={marketplaceSupported ? "關閉全站訂閱省健檢" : "關閉 Subscribe & Save 能力說明"}
      surfaceClassName="subscription-audit-drawer"
      onBack={onClose}
      autoFocusClose
    >
      <SubscriptionAuditPanel
        marketplaceId={marketplaceId}
        marketplaceShort={marketplaceShort}
        mode={mode}
        initialJob={initialJob}
        onJobChange={onJobChange}
      />
    </AuditWorkspaceShell>
  );
}
