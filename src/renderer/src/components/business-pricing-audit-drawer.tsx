"use client";

import { useEffect, useState } from "react";
import type { BusinessPricingAuditSnapshot } from "../business-pricing-audit";
import type {
  StandaloneAuditJob,
  StandaloneAuditMode,
} from "../standalone-audit";
import BusinessPricingAuditPanel from "./business-pricing-audit-panel";

export default function BusinessPricingAuditDrawer({
  marketplaceId,
  marketplaceShort,
  mode = "live",
  cachedSnapshot = null,
  initialJob = null,
  onSnapshotChange,
  onJobChange,
  onClose,
}: {
  marketplaceId: string;
  marketplaceShort: string;
  mode?: StandaloneAuditMode;
  cachedSnapshot?: BusinessPricingAuditSnapshot | null;
  initialJob?: StandaloneAuditJob | null;
  onSnapshotChange?: (snapshot: BusinessPricingAuditSnapshot) => void;
  onJobChange?: (job: StandaloneAuditJob) => void;
  onClose: () => void;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const requestClose = () => {
    if (!editorBusy) onClose();
  };

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !editorBusy) onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [editorBusy, onClose]);

  return (
    <div
      className="drawer-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <aside
        className="order-drawer business-pricing-audit-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="business-pricing-audit-title"
        aria-busy={editorBusy}
      >
        <div className="drawer-header">
          <div>
            <p className="eyebrow">
              {editorOpen
                ? "AMAZON BUSINESS · SKU DETAIL"
                : "AMAZON BUSINESS · FBA ONLY"}
            </p>
            <h2 id="business-pricing-audit-title">
              {editorOpen ? "單一 SKU B2B 價格編輯" : "全站 B2B 價格健檢"}
            </h2>
            {editorBusy && (
              <p
                className="business-pricing-drawer-status"
                role="status"
                aria-live="polite"
              >Notebook Key 正在處理這次要求，請勿關閉或重複送出。</p>
            )}
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="關閉全站 B2B 價格健檢"
            disabled={editorBusy}
            autoFocus
          >×</button>
        </div>
        <BusinessPricingAuditPanel
          marketplaceId={marketplaceId}
          marketplaceShort={marketplaceShort}
          mode={mode}
          cachedSnapshot={cachedSnapshot}
          initialJob={initialJob}
          onSnapshotChange={onSnapshotChange}
          onJobChange={onJobChange}
          onEditorOpenChange={setEditorOpen}
          onEditorBusyChange={setEditorBusy}
        />
      </aside>
    </div>
  );
}
