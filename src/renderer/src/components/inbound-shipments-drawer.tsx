"use client";

import { useEffect } from "react";
import type { InboundShipmentCache } from "../inbound-shipments";
import InboundShipmentsPanel from "./inbound-shipments-panel";

export default function InboundShipmentsDrawer({
  marketplaceId,
  marketplaceShort,
  marketplaceTimeZone,
  cachedResult,
  onCachedResultChange,
  onClose,
}: {
  marketplaceId: string;
  marketplaceShort: string;
  marketplaceTimeZone: string;
  cachedResult?: InboundShipmentCache | null;
  onCachedResultChange?: (cache: InboundShipmentCache) => void;
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
        className="order-drawer inbound-shipments-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="inbound-shipments-title"
      >
        <div className="drawer-header">
          <div>
            <p className="eyebrow">FBA FULFILLMENT INBOUND · READ ONLY</p>
            <h2 id="inbound-shipments-title">FBA 入庫貨件追蹤</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="關閉 FBA 入庫貨件追蹤" autoFocus>×</button>
        </div>
        <InboundShipmentsPanel
          marketplaceId={marketplaceId}
          marketplaceShort={marketplaceShort}
          marketplaceTimeZone={marketplaceTimeZone}
          cachedResult={cachedResult}
          onCachedResultChange={onCachedResultChange}
        />
      </aside>
    </div>
  );
}
