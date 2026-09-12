import { useEffect, useState } from "react";
import { inventoryHealthCalendarRows, isInventoryHealthSnapshot, type InventoryHealthSnapshot } from "../../shared/inventory-health";
import type { MarketplaceId } from "../../shared/marketplaces";

export function useInventoryHealthCalendar(marketplaceId?: MarketplaceId, mode?: "live" | "demo") {
  const [state, setState] = useState<{ key: string; snapshot: InventoryHealthSnapshot | null; notice: string } | null>(null);
  const key = `${marketplaceId}:${mode}`;
  useEffect(() => {
    if (!marketplaceId || !mode) return;
    let active = true, revision = 0;
    let controller = new AbortController();
    const clear = () => { revision += 1; controller.abort(); if (active) setState(null); };
    const read = async () => {
      clear(); const current = revision;
      controller = new AbortController();
      try {
        const response = await fetch(`/api/inventory-health?${new URLSearchParams({ marketplaceId })}`, { cache: "no-store", signal: controller.signal });
        const value: unknown = await response.json();
        if (!response.ok || !value || typeof value !== "object" || !("snapshot" in value)) throw new Error();
        const snapshot = value.snapshot;
        if (snapshot !== null && (!isInventoryHealthSnapshot(snapshot) || snapshot.marketplaceId !== marketplaceId || snapshot.mode !== mode)) throw new Error();
        if (active && current === revision) setState({ key, snapshot, notice: snapshot === null ? "尚無庫存健康資料；執行健檢後會自動整理入庫效期。" : snapshot.stale || !snapshot.sourceComplete ? "資料過期或來源不完整，自動清售提醒暫停。請重新執行庫存健康健檢。" : "只列出已確認批次、依目前銷速預估清不完的 SKU。每個 SKU 顯示最早處理期限。" });
      } catch {
        if (active && current === revision) setState({ key, snapshot: null, notice: "目前無法讀取庫存健康，自動清售提醒暫停。" });
      }
    };
    const changed = (event: Event) => { if ((event as CustomEvent<{ marketplaceId?: string }>).detail?.marketplaceId === marketplaceId) void read(); };
    const focused = () => { void read(); };
    const stopContext = window.fbaOS?.app?.onContextInvalidated?.(clear);
    window.addEventListener("amz-api-inventory-health-changed", changed);
    window.addEventListener("focus", focused);
    const timer = window.setInterval(focused, 60000);
    void read();
    return () => { active = false; clear(); stopContext?.(); window.clearInterval(timer); window.removeEventListener("amz-api-inventory-health-changed", changed); window.removeEventListener("focus", focused); };
  }, [key, marketplaceId, mode]);
  const snapshot = state?.key === key ? state.snapshot : null;
  const elapsed = snapshot ? Date.now() - Date.parse(snapshot.fetchedAt) : Number.POSITIVE_INFINITY;
  return { rows: snapshot && elapsed >= 0 && elapsed <= 48 * 3600000 ? inventoryHealthCalendarRows(snapshot) : [],
    notice: state?.key === key ? state.notice : "正在讀取本機庫存健康…", fetchedAt: snapshot?.fetchedAt ?? null };
}
