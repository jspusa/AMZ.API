export type AuditExportKind =
  | "content"
  | "image"
  | "variation"
  | "inventory"
  | "subscription"
  | "review"
  | "advertising"
  | "suite";

const AUDIT_EXPORT_LABELS: Readonly<Record<AuditExportKind, string>> = {
  content: "文案健檢",
  image: "圖片健檢",
  variation: "未綁變體健檢",
  inventory: "庫齡與預估冗餘健檢",
  subscription: "訂閱價格健檢",
  review: "評論主題健檢",
  advertising: "廣告覆蓋健檢",
  suite: "一鍵全部健檢",
};

const MARKETPLACE_SHORT_PATTERN = /^[A-Z]{2,3}$/u;
const RFC3339_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})T/u;

function trustedSnapshotDate(value: string): string {
  const match = RFC3339_DATE_PREFIX.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) {
    throw new Error("健檢快照時間無效，已停止建立下載檔名。");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  if (
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() !== month - 1 ||
    normalized.getUTCDate() !== day
  ) {
    throw new Error("健檢快照日期無效，已停止建立下載檔名。");
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function auditExportFilename(input: {
  kind: AuditExportKind;
  marketplaceShort: string;
  fetchedAt: string;
}): string {
  const marketplaceShort = input.marketplaceShort.trim().toUpperCase();
  if (!MARKETPLACE_SHORT_PATTERN.test(marketplaceShort)) {
    throw new Error("健檢站點簡碼無效，已停止建立下載檔名。");
  }
  const date = trustedSnapshotDate(input.fetchedAt);
  return `FBA-${AUDIT_EXPORT_LABELS[input.kind]}-${marketplaceShort}-${date}.xlsx`;
}
