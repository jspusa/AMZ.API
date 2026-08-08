"use client";

import { useEffect } from "react";
import { isSubscriptionAuditMarketplaceSupported } from "../subscription-audit";
import SubscriptionAuditPanel from "./subscription-audit-panel";

export default function SubscriptionAuditDrawer({
  marketplaceId,
  marketplaceShort,
  onClose,
}: {
  marketplaceId: string;
  marketplaceShort: string;
  onClose: () => void;
}) {
  const marketplaceSupported = isSubscriptionAuditMarketplaceSupported(marketplaceId);
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
        className="order-drawer subscription-audit-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="subscription-audit-title"
      >
        <div className="drawer-header">
          <div>
            <p className="eyebrow">FBA SUBSCRIBE &amp; SAVE</p>
            <h2 id="subscription-audit-title">{marketplaceSupported ? "全站訂閱價格健檢" : "Subscribe & Save 能力說明"}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={marketplaceSupported ? "關閉全站訂閱省健檢" : "關閉 Subscribe & Save 能力說明"} autoFocus>×</button>
        </div>
        <SubscriptionAuditPanel
          marketplaceId={marketplaceId}
          marketplaceShort={marketplaceShort}
        />
      </aside>
    </div>
  );
}
