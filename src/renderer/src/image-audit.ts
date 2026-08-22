import { createImageAuditWorkbook } from "../../main/amazon/xlsx";

const IMAGE_AUDIT_MINIMUM_IMAGES = 6 as const;

export type ImageAuditReadError = {
  code: "LISTING_QUERY_FAILED" | "LISTING_CONTENT_NOT_RETURNED";
  message: string;
};

export type ImageAuditRow = {
  sellerSku: string;
  asin: string;
  productType: string;
  title: string;
  imageUrls: string[];
  imageCount: number;
  readStatus: "complete" | "incomplete";
  readErrors: ImageAuditReadError[];
};

export type ImageAuditSnapshot = {
  marketplaceId: string;
  fetchedAt: string;
  minimumImages: number;
  rows: ImageAuditRow[];
  summary: {
    total: number;
    completed: number;
    incomplete: number;
    underMinimum: number;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parsedReadErrors(value: unknown): ImageAuditReadError[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (candidate): candidate is ImageAuditReadError =>
      isRecord(candidate) &&
      (candidate.code === "LISTING_QUERY_FAILED" ||
        candidate.code === "LISTING_CONTENT_NOT_RETURNED") &&
      typeof candidate.message === "string",
  );
}

function normalizedUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean),
  )].slice(0, 9);
}

export function summarizeImageAudit(
  rows: readonly ImageAuditRow[],
  minimumImages: number,
): ImageAuditSnapshot["summary"] {
  const completed = rows.filter((row) => row.readStatus === "complete").length;
  return {
    total: rows.length,
    completed,
    incomplete: rows.length - completed,
    underMinimum: rows.filter(
      (row) => row.readStatus === "complete" && row.imageCount < minimumImages,
    ).length,
  };
}

export function parseImageAuditSnapshot(
  raw: unknown,
  expectedMarketplaceId?: string,
): ImageAuditSnapshot {
  if (!isRecord(raw)) throw new Error("圖片健檢回應格式無效。");
  if (
    typeof raw.marketplaceId !== "string" ||
    typeof raw.fetchedAt !== "string" ||
    typeof raw.minimumImages !== "number" ||
    !Number.isInteger(raw.minimumImages) ||
    raw.minimumImages !== IMAGE_AUDIT_MINIMUM_IMAGES ||
    !Array.isArray(raw.rows)
  ) {
    if (raw.minimumImages !== IMAGE_AUDIT_MINIMUM_IMAGES) {
      throw new Error(
        "圖片健檢固定門檻為 6 張；目前橋接程式回傳不同標準，請更新 AMZ.API Notebook Key Bridge。",
      );
    }
    throw new Error("圖片健檢缺少可核對的站點或商品資料。");
  }
  if (
    expectedMarketplaceId !== undefined &&
    raw.marketplaceId !== expectedMarketplaceId
  ) {
    throw new Error("圖片健檢回應與目前選擇的站點不一致；已停止顯示與快取。");
  }
  const minimumImages = Number(raw.minimumImages);
  const rows = raw.rows.map((candidate, index): ImageAuditRow => {
    if (!isRecord(candidate) || typeof candidate.sellerSku !== "string" || !candidate.sellerSku.trim()) {
      throw new Error(`圖片健檢第 ${index + 1} 筆商品缺少 SKU；已停止顯示不完整結果。`);
    }
    const readErrors = parsedReadErrors(candidate.readErrors);
    const readStatus = candidate.readStatus === "complete" && !readErrors.length
      ? "complete"
      : "incomplete";
    const imageUrls = normalizedUrls(candidate.imageUrls);
    const declaredCount = candidate.imageCount;
    if (
      readStatus === "complete" &&
      (typeof declaredCount !== "number" ||
        !Number.isInteger(declaredCount) ||
        declaredCount !== imageUrls.length)
    ) {
      throw new Error(`圖片健檢 ${candidate.sellerSku} 的圖片數量與 URL 不一致。`);
    }
    return {
      sellerSku: candidate.sellerSku,
      asin: typeof candidate.asin === "string" ? candidate.asin : "",
      productType: typeof candidate.productType === "string" ? candidate.productType : "",
      title: typeof candidate.title === "string" ? candidate.title : "",
      imageUrls,
      imageCount: readStatus === "complete" ? imageUrls.length : 0,
      readStatus,
      readErrors: readStatus === "incomplete" && !readErrors.length
        ? [{
            code: "LISTING_CONTENT_NOT_RETURNED",
            message: "Amazon 沒有回傳可驗證的完整圖片 attributes；本列不判定圖片不足。",
          }]
        : readErrors,
    };
  });
  const summary = summarizeImageAudit(rows, minimumImages);
  if (isRecord(raw.summary)) {
    for (const [name, actual] of Object.entries(summary)) {
      const declared = raw.summary[name];
      if (declared !== undefined && declared !== actual) {
        throw new Error("圖片健檢摘要與商品列數不一致；已停止顯示不完整結果。");
      }
    }
  }
  return {
    marketplaceId: raw.marketplaceId,
    fetchedAt: raw.fetchedAt,
    minimumImages,
    rows,
    summary,
  };
}

export function imageAuditAttentionRows(
  snapshot: ImageAuditSnapshot,
): ImageAuditRow[] {
  return snapshot.rows.filter(
    (row) =>
      row.readStatus === "incomplete" || row.imageCount < snapshot.minimumImages,
  );
}

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function downloadImageAuditWorkbook(
  snapshot: ImageAuditSnapshot,
  marketplaceLabel: string,
  filename: string,
): void {
  const bytes = createImageAuditWorkbook({
    marketplaceId: snapshot.marketplaceId,
    marketplaceLabel,
    fetchedAt: snapshot.fetchedAt,
    minimumImages: snapshot.minimumImages,
    rows: snapshot.rows,
  });
  const copiedBytes = new Uint8Array(bytes.byteLength);
  copiedBytes.set(bytes);
  const url = URL.createObjectURL(
    new Blob([copiedBytes.buffer], { type: XLSX_CONTENT_TYPE }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
