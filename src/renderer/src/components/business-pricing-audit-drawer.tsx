"use client";

import { useEffect } from "react";
import type { BusinessPricingAuditSnapshot } from "../business-pricing-audit";
import BusinessPricingAuditPanel from "./business-pricing-audit-panel";

export default function BusinessPricingAuditDrawer({
  marketplaceId,
  marketplaceShort,
  cachedSnapshot = null,
  onSnapshotChange,
  onClose,
}: {
  marketplaceId: string;
  marketplaceShort: string;
  cachedSnapshot?: BusinessPricingAuditSnapshot | null;
  onSnapshotChange?: (snapshot: BusinessPricingAuditSnapshot) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div
      className="drawer-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="order-drawer business-pricing-audit-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="business-pricing-audit-title"
      >
        <div className="drawer-header">
          <div>
            <p className="eyebrow">AMAZON BUSINESS · FBA ONLY</p>
            <h2 id="business-pricing-audit-title">全站 B2B 價格健檢</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="關閉全站 B2B 價格健檢" autoFocus>×</button>
        </div>
        <BusinessPricingAuditPanel
          marketplaceId={marketplaceId}
          marketplaceShort={marketplaceShort}
          cachedSnapshot={cachedSnapshot}
          onSnapshotChange={onSnapshotChange}
        />
      </aside>
    </div>
  );
}
