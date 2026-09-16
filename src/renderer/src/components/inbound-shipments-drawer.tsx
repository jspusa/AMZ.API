"use client";

import { useEffect } from "react";
import type { InboundShipmentCache } from "../inbound-shipments";
import InboundShipmentsPanel from "./inbound-shipments-panel";
import AuditWorkspaceShell, { type AuditSurfacePresentation } from "./audit-workspace-shell";

export default function InboundShipmentsDrawer({
  marketplaceId,
  marketplaceShort,
  marketplaceTimeZone,
  cachedResult,
  onCachedResultChange,
  onClose,
  presentation = "dialog",
}: {
  marketplaceId: string;
  marketplaceShort: string;
  marketplaceTimeZone: string;
  cachedResult?: InboundShipmentCache | null;
  onCachedResultChange?: (cache: InboundShipmentCache) => void;
  onClose: () => void;
  presentation?: AuditSurfacePresentation;
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
    <AuditWorkspaceShell presentation={presentation} eyebrow="FBA FULFILLMENT INBOUND · READ ONLY"
      title="FBA 入庫貨件追蹤" closeLabel="關閉 FBA 入庫貨件追蹤" surfaceClassName="inbound-shipments-drawer" onBack={onClose} autoFocusClose>
        <InboundShipmentsPanel
          marketplaceId={marketplaceId}
          marketplaceShort={marketplaceShort}
          marketplaceTimeZone={marketplaceTimeZone}
          cachedResult={cachedResult}
          onCachedResultChange={onCachedResultChange}
        />
    </AuditWorkspaceShell>
  );
}
