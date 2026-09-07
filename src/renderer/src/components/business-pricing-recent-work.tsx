import { useEffect, useState } from "react";
import {
  B2B_RECENT_WORK_LIMIT,
  type B2bRecentWorkItem,
  type B2bRecentWorkSnapshot,
} from "../../../shared/b2b-recent-work";
import { publicProblemMessage } from "../write-request";

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

function parseRecentWork(
  value: unknown, marketplaceId: string, mode: "live" | "demo",
): B2bRecentWorkSnapshot {
  const invalid = () => new Error("近期 B2B 工作資料不完整或不屬於目前站點，請更新 Notebook Key 後重新讀取。");
  if (!record(value) || value.schemaVersion !== 1 || value.marketplaceId !== marketplaceId ||
    value.mode !== mode || !timestamp(value.checkedAt) || value.limit !== B2B_RECENT_WORK_LIMIT ||
    !Array.isArray(value.items) || value.items.length > B2B_RECENT_WORK_LIMIT) throw invalid();
  const identities = new Set<string>();
  for (const item of value.items) {
    if (!record(item) || !boundedText(item.sellerSku, 200) ||
      typeof item.stage !== "string" || !["business_price", "minimum_price"].includes(item.stage) ||
      typeof item.status !== "string" || !["PROCESSING", "UNKNOWN", "MINIMUM_VERIFIED", "VERIFIED"].includes(item.status) ||
      !timestamp(item.updatedAt) || item.canResend !== false ||
      !boundedText(item.notice, 1600) ||
      (item.acceptedAt !== null && !timestamp(item.acceptedAt)) ||
      (item.verifiedAt !== null && !timestamp(item.verifiedAt))) throw invalid();
    if (item.status === "UNKNOWN") {
      if (item.acceptedAt !== null || item.verifiedAt !== null || item.nextAction !== "readback") throw invalid();
    } else if (item.status === "PROCESSING") {
      if (!timestamp(item.acceptedAt) || item.verifiedAt !== null || item.nextAction !== "readback") throw invalid();
    } else {
      if (!timestamp(item.acceptedAt) || !timestamp(item.verifiedAt)) throw invalid();
      if (item.status === "MINIMUM_VERIFIED"
        ? item.stage !== "minimum_price" || item.nextAction !== "fresh_preview"
        : item.stage !== "business_price" || item.nextAction !== "readback") throw invalid();
    }
    const identity = JSON.stringify([item.sellerSku, item.stage, item.updatedAt]);
    if (identities.has(identity)) throw invalid();
    identities.add(identity);
  }
  return value as B2bRecentWorkSnapshot;
}

const STATUS_LABEL: Record<B2bRecentWorkItem["status"], string> = {
  PROCESSING: "等待 Amazon 回查",
  UNKNOWN: "送出結果不明",
  MINIMUM_VERIFIED: "最低價已確認，待送 B2B",
  VERIFIED: "已確認完成",
};

function WorkTime({ value }: { value: string }) {
  return <time dateTime={value}>{new Date(value).toLocaleString("zh-TW", {
    dateStyle: "short", timeStyle: "short", hour12: false,
  })}</time>;
}

export default function BusinessPricingRecentWork({
  enabled, marketplaceId, marketplaceShort, mode, busy, openingSellerSku, onOpen,
}: {
  enabled: boolean;
  marketplaceId: string;
  marketplaceShort: string;
  mode: "live" | "demo";
  busy: boolean;
  openingSellerSku: string | null;
  onOpen: (item: B2bRecentWorkItem) => void;
}) {
  const [snapshot, setSnapshot] = useState<B2bRecentWorkSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    setSnapshot(null);
    setError(null);
    if (!enabled) return;
    const controller = new AbortController();
    setLoading(true);
    void (async () => {
      try {
        const query = new URLSearchParams({ marketplaceId });
        const response = await fetch(`/api/sp-api/business-pricing/recent-work?${query}`, {
          method: "GET", cache: "no-store", signal: controller.signal,
        });
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error(publicProblemMessage(payload, "無法讀取近期 B2B 工作。"));
        const next = parseRecentWork(payload, marketplaceId, mode);
        if (!controller.signal.aborted) setSnapshot(next);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "無法讀取近期 B2B 工作。");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [enabled, marketplaceId, mode, revision]);

  if (!enabled) return null;
  const visibleSnapshot = snapshot?.marketplaceId === marketplaceId && snapshot.mode === mode ? snapshot : null;
  return <section className="business-pricing-recent-work" aria-label="近期 B2B 工作" aria-busy={loading}>
    <header>
      <div><h4>近期 B2B 工作</h4><p>{marketplaceShort} · 此電腦、目前帳號 · 最多 {B2B_RECENT_WORK_LIMIT} 筆</p></div>
      <button type="button" disabled={loading || busy} onClick={() => setRevision((current) => current + 1)}>重新讀取工作</button>
    </header>
    <p>恢復清單只讀取本機紀錄；查看商品才會向 Amazon 唯讀確認。後續更新仍須重新預檢及 Touch ID／Windows Hello。</p>
    {loading && <p role="status">正在讀取近期工作…</p>}
    {error && <p role="alert">{error}</p>}
    {visibleSnapshot && <>
      <p className="business-pricing-recent-time">本機紀錄讀取時間 · <WorkTime value={visibleSnapshot.checkedAt} />（此電腦時區）</p>
      {visibleSnapshot.items.length === 0 ? <p>此電腦目前沒有可恢復的 B2B 工作紀錄。</p> :
        <ul>{visibleSnapshot.items.map((item) => <li key={JSON.stringify([item.sellerSku, item.stage, item.updatedAt])}>
          <div><strong>{item.sellerSku}</strong><span>{STATUS_LABEL[item.status]}</span>
            <p>{item.notice}</p>
            {item.acceptedAt && <small>Amazon 接受時間 · <WorkTime value={item.acceptedAt} /></small>}
            {item.verifiedAt && <small>確認完成時間 · <WorkTime value={item.verifiedAt} /></small>}
          </div>
          <button type="button" aria-label={`唯讀查看 SKU ${item.sellerSku}`} disabled={busy}
            aria-busy={openingSellerSku === item.sellerSku} onClick={() => onOpen(item)}>
            {openingSellerSku === item.sellerSku ? "正在讀取 Amazon…" : "唯讀查看／繼續處理"}
          </button>
        </li>)}</ul>}
    </>}
  </section>;
}
