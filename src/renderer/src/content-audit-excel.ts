import { createContentAuditWorkbookV2 } from "../../main/amazon/xlsx";
import type {
  ContentAuditField,
  ContentAuditIssueKind,
  ContentAuditRow,
  ContentAuditSnapshot,
} from "./content-quality";
import {
  contentHighlightSegments,
  isInvisibleCharacterIssue,
  locateInvisibleCharacters,
} from "./content-quality";
import { auditExportFilename } from "./audit-export-filename";

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function issueLabel(kind: ContentAuditIssueKind): string {
  if (kind === "MISSING_BULLETS") return "賣點不足";
  if (kind === "MISSING_INGREDIENTS") return "缺成分";
  if (kind === "INGREDIENTS_UNVERIFIED") return "成分未驗證";
  if (kind === "TITLE_BELOW_TARGET") return "產品名稱過短";
  if (kind === "HIGHLIGHT_BELOW_TARGET") return "產品亮點過短";
  if (kind === "BULLET_BELOW_TARGET") return "產品要點過短";
  if (kind === "BULLET_ABOVE_TARGET") return "產品要點過長";
  if (kind === "DESCRIPTION_BELOW_TARGET") return "產品敘述過短";
  if (kind === "SINGLE_INGREDIENT_MISMATCH") return "成分宣稱不一致";
  return "疑似錯字";
}

function fieldLabel(field: ContentAuditField): string {
  if (field === "title") return "產品名稱";
  if (field === "itemHighlight") return "產品亮點";
  if (field === "productDescription") return "產品敘述";
  if (field === "ingredients") return "成分";
  return "產品要點";
}

export function contentAuditAttentionRows(
  snapshot: ContentAuditSnapshot,
): ContentAuditRow[] {
  return snapshot.rows.filter(
    (row) => row.readStatus === "incomplete" || row.issues.length > 0,
  );
}

function auditFindings(row: ContentAuditRow): Array<{
  type: string;
  description: string;
}> {
  const invisibleLocations = locateInvisibleCharacters([row]);
  const locatedInvisibleIssues = new Set(
    invisibleLocations.map(
      (location) => `${location.field}:${location.codePoint}`,
    ),
  );
  return [
    ...row.readErrors.map((readError) => ({
      type: "讀取未完成",
      description: readError.message,
    })),
    ...row.issues
      .filter(
        (issue) =>
          !isInvisibleCharacterIssue(issue) ||
          !locatedInvisibleIssues.has(
            `${issue.field}:${issue.token?.toUpperCase() ?? ""}`,
          ),
      )
      .map((issue) => ({
        type: `${issueLabel(issue.kind)} · ${fieldLabel(issue.field)}`,
        description: `${issue.message}${
          issue.suggestion && !issue.message.includes(issue.suggestion)
            ? ` 建議檢查：${issue.suggestion}`
            : ""
        }`,
      })),
    ...invisibleLocations.map((location) => ({
      type: `不可見字元 · ${location.fieldLabel}`,
      description: `${location.codePoint}（${location.name}）位於「${location.before}」與「${location.after}」之間：${location.context}。應手動修改此段。`,
    })),
  ];
}

function auditRichTextRuns(
  value: string,
  row: ContentAuditRow,
  field: ContentAuditField,
  bulletIndex?: number,
) {
  const issues = row.issues.filter(
    (issue) =>
      issue.kind === "SUSPECTED_TYPO" &&
      issue.field === field &&
      (field !== "bulletPoints" ||
        issue.bulletIndex === undefined ||
        issue.bulletIndex === bulletIndex),
  );
  return contentHighlightSegments(value, issues).map((segment) => ({
    text: segment.text,
    alert: segment.highlighted,
  }));
}

export function createContentAuditWorkbook(
  snapshot: ContentAuditSnapshot,
  marketplaceLabel: string,
): Uint8Array {
  const rows = contentAuditAttentionRows(snapshot);
  const workbookSnapshot = snapshot as ContentAuditSnapshot & {
    exportId?: string;
  };
  if (!workbookSnapshot.exportId) {
    throw new Error("內容健檢 Excel 缺少 exportId，請重新執行全站掃描。");
  }
  return createContentAuditWorkbookV2({
    marketplaceId: snapshot.marketplaceId,
    marketplaceLabel,
    exportId: workbookSnapshot.exportId,
    fetchedAt: snapshot.fetchedAt,
    rows: rows.map((row) => {
      const variation = row as ContentAuditRow & {
        variationRole?: string | null;
        variationParentSku?: string | null;
        variationFamilyKey?: string | null;
        variationTheme?: string | null;
      };
      const findings = auditFindings(row);
      const itemHighlight = row.itemHighlight ?? "";
      const productDescription = row.productDescription ?? "";
      const bulletRuns = Array.from({ length: 5 }, (_, index) =>
        auditRichTextRuns(
          row.bulletPoints[index] ?? "",
          row,
          "bulletPoints",
          index,
        ));
      const bulletIssueFields = Array.from({ length: 5 }, (_, index) =>
        row.issues.some((issue) => {
          if (issue.field !== "bulletPoints") return false;
          if (issue.bulletIndex !== undefined) return issue.bulletIndex === index;
          if (issue.kind === "SUSPECTED_TYPO") {
            return bulletRuns[index]?.some((run) => run.alert) ?? false;
          }
          return true;
        }));
      return {
        sellerSku: row.sellerSku,
        asin: row.asin,
        productType: row.productType,
        title: row.title,
        itemHighlight,
        bulletPoints: row.bulletPoints,
        productDescription,
        ingredients: row.ingredients,
        variationRole: variation.variationRole ?? "unknown",
        variationParentSku: variation.variationParentSku ?? "",
        variationFamilyKey: variation.variationFamilyKey ?? "",
        variationTheme: variation.variationTheme ?? "",
        issueFields: {
          title: row.issues.some((issue) => issue.field === "title"),
          itemHighlight: row.issues.some(
            (issue) => issue.field === "itemHighlight",
          ),
          bulletPoints: bulletIssueFields,
          productDescription: row.issues.some(
            (issue) => issue.field === "productDescription",
          ),
          ingredients: row.issues.some(
            (issue) => issue.field === "ingredients",
          ),
        },
        auditTitleRuns: auditRichTextRuns(row.title, row, "title"),
        auditItemHighlightRuns: auditRichTextRuns(
          itemHighlight,
          row,
          "itemHighlight",
        ),
        auditBulletPointRuns: bulletRuns,
        auditProductDescriptionRuns: auditRichTextRuns(
          productDescription,
          row,
          "productDescription",
        ),
        auditIngredientsRuns: auditRichTextRuns(
          row.ingredients,
          row,
          "ingredients",
        ),
        auditType: [...new Set(findings.map((finding) => finding.type))].join("、"),
        auditDescription: findings
          .map((finding) => `[${finding.type}] ${finding.description}`)
          .join("\n"),
      };
    }),
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
  link.download = auditExportFilename({
    kind: "content",
    marketplaceShort: marketplaceLabel,
    fetchedAt: snapshot.fetchedAt,
  });
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
