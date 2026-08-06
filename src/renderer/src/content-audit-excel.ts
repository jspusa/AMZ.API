import { createListingsWorkbook } from "../../main/amazon/xlsx";
import type {
  ContentAuditField,
  ContentAuditIssueKind,
  ContentAuditRow,
  ContentAuditSnapshot,
} from "./content-quality";

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function issueLabel(kind: ContentAuditIssueKind): string {
  if (kind === "MISSING_BULLETS") return "賣點不足";
  if (kind === "MISSING_INGREDIENTS") return "缺成分";
  if (kind === "INGREDIENTS_UNVERIFIED") return "成分未驗證";
  return "疑似錯字";
}

function fieldLabel(field: ContentAuditField): string {
  if (field === "title") return "商品標題";
  if (field === "ingredients") return "成分";
  return "五大賣點";
}

export function contentAuditAttentionRows(
  snapshot: ContentAuditSnapshot,
): ContentAuditRow[] {
  return snapshot.rows.filter(
    (row) => row.readStatus === "incomplete" || row.issues.length > 0,
  );
}

export function createContentAuditWorkbook(
  snapshot: ContentAuditSnapshot,
  marketplaceLabel: string,
): Uint8Array {
  const rows = contentAuditAttentionRows(snapshot);
  return createListingsWorkbook({
    marketplaceLabel,
    fetchedAt: snapshot.fetchedAt,
    rows: rows.map((row) => ({
      marketplaceLabel,
      sku: row.sellerSku,
      asin: row.asin,
      productType: row.productType,
      title: row.title,
      bulletPoints: row.bulletPoints,
      ingredients: row.ingredients,
      status: row.readStatus === "complete" ? "待人工確認" : "讀取未完成",
    })),
    errors: rows.flatMap((row) => [
      ...row.readErrors.map((readError) => ({
        sku: row.sellerSku,
        type: "讀取未完成",
        description: readError.message,
      })),
      ...row.issues.map((issue) => ({
        sku: row.sellerSku,
        type: `${issueLabel(issue.kind)} · ${fieldLabel(issue.field)}`,
        description: `${issue.message}${
          issue.suggestion ? ` 建議檢查：${issue.suggestion}` : ""
        }`,
      })),
    ]),
  });
}

export function downloadContentAuditWorkbook(
  snapshot: ContentAuditSnapshot,
  marketplaceLabel: string,
): void {
  const bytes = createContentAuditWorkbook(snapshot, marketplaceLabel);
  const copiedBytes = new Uint8Array(bytes.byteLength);
  copiedBytes.set(bytes);
  const url = URL.createObjectURL(
    new Blob([copiedBytes.buffer], { type: XLSX_CONTENT_TYPE }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `FBA-內容健檢-${marketplaceLabel}-${snapshot.fetchedAt.slice(0, 10)}.xlsx`
    .replace(/[\\/:*?"<>|]/g, "-");
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
