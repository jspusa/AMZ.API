import { marketplaceById, type MarketplaceId } from "./marketplaces";

export type InventoryHealthSyncJob = Readonly<{
  id: string;
  marketplaceId: MarketplaceId;
  mode: "live" | "demo";
  status: "running" | "completed" | "partial" | "failed";
  stage: "report" | "expiry" | "complete";
  message: string;
  error: Readonly<{ code: string; message: string }> | null;
}>;

export function isInventoryHealthSyncJob(value: unknown): value is InventoryHealthSyncJob {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const text = (x: unknown, max: number) => typeof x === "string" && x.length > 0 && x.length <= max && !/[\p{Cc}\p{Cf}]/u.test(x);
  return text(v.id, 64) && typeof v.marketplaceId === "string" && Boolean(marketplaceById(v.marketplaceId)) &&
    ["live", "demo"].includes(String(v.mode)) && ["running", "completed", "partial", "failed"].includes(String(v.status)) &&
    ["report", "expiry", "complete"].includes(String(v.stage)) && text(v.message, 2048) &&
    (v.error === null || (typeof v.error === "object" && v.error !== null && text((v.error as Record<string, unknown>).code, 128) && text((v.error as Record<string, unknown>).message, 2048)));
}
