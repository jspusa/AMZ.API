"use client";

import { useEffect } from "react";
import type { AplusAuditSnapshot } from "../a-plus-audit";
import AplusAuditPanel, {
  type AplusAuditObservableJob,
  type AplusAuditRequester,
} from "./a-plus-audit-panel";

export default function AplusAuditDrawer({
  marketplaceId,
  marketplaceShort,
  mode,
  cachedSnapshot = null,
  onSnapshotChange,
  job = null,
  onJobChange,
  requestAudit,
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
        aria-labelledby="a-plus-audit-title"
      >
        <div className="drawer-header">
          <div>
            <p className="eyebrow">A+ CONTENT · FBA ONLY · READ ONLY</p>
            <h2 id="a-plus-audit-title">全站 A+ 健檢</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="關閉全站 A+ 健檢" autoFocus>×</button>
        </div>
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
      </aside>
    </div>
  );
}
