import type { ImageFolderRow } from "./image-folder-import";

export type LooseImageDraft = {
  id: string;
  file: File;
  slot: number | null;
  seedSku: string | null;
  targets: string;
  errors: string[];
};

const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/u;
const validSku = (sku: string) => Boolean(sku) && sku.length <= 200 && sku.trim() === sku && !INVISIBLE.test(sku);

/** Keep exact spelling, spacing and case; a malformed line invalidates this list. */
export function parseManualImageSkus(text: string): { skus: string[]; error: string | null } {
  if (text.length > 6_030) return { skus: [], error: "每張圖片最多套用 30 個 SKU，請分批處理。" };
  const skus = text.split(/\r?\n/u).filter(sku => sku !== "");
  if (skus.some(sku => !validSku(sku))) return { skus: [], error: "請每行輸入一個完整 Seller SKU，不可有前後空白或隱藏字元，且每個最多 200 字。" };
  if (skus.length > 30) return { skus: [], error: "每張圖片最多套用 30 個 SKU，請分批處理。" };
  if (new Set(skus).size !== skus.length) return { skus: [], error: "同一張圖片的 Seller SKU 不可重複，請移除重複行。" };
  return { skus, error: null };
}

export function inspectLooseImages(files: readonly File[]): { images: LooseImageDraft[]; error: string | null } {
  return {
    images: files.map((file, index) => {
      const errors: string[] = [];
      if (!file.name || file.name.length > 255 || /[/\\]/u.test(file.name) || INVISIBLE.test(file.name)) errors.push("檔名含不支援的路徑或隱藏字元，請更名後重選。");
      if (!/\.(?:jpe?g|png)$/iu.test(file.name) || (file.type && file.type !== "image/jpeg" && file.type !== "image/png")) errors.push("只接受 JPEG 或 PNG 圖片。");
      if (file.size <= 0 || file.size > 10 * 1024 * 1024) errors.push("圖片需有內容且不超過 10 MB。");
      const matches = [...file.name.matchAll(/(?:^|_)(0[1-9]|10)(?=_|\.)/gu)].filter(match => /^(?:_[^/\\]+)?\.(?:jpe?g|png)$/iu.test(file.name.slice(match.index! + match[0].length)));
      const match = matches.length === 1 && !errors.length ? matches[0] : null;
      const candidate = match && match.index! > 0 ? file.name.slice(0, match.index) : null;
      const seedSku = candidate && validSku(candidate) ? candidate : null;
      return { id: `shared-file-${index + 1}`, file, slot: match ? Number(match[1]) - 1 : null, seedSku, targets: seedSku ?? "", errors };
    }),
    error: files.length > 300 ? "每批最多 300 張圖片，這批尚未接受，請減少檔案。" : null,
  };
}

/** Only explicitly assigned positions appear; main preserves every other slot. */
export function buildSharedImageRows(images: readonly LooseImageDraft[]): ImageFolderRow[] {
  const rows = new Map<string, ImageFolderRow>();
  const unconfigured: ImageFolderRow[] = [];
  for (const image of images) {
    const parsed = parseManualImageSkus(image.targets);
    const targets = parsed.skus;
    const errors = [...image.errors];
    const validSlot = image.slot !== null && Number.isInteger(image.slot) && image.slot >= 0 && image.slot < 10;
    if (!validSlot) errors.push("請選擇這張圖片要更換的位置（01–10）。");
    if (parsed.error) errors.push(parsed.error);
    else if (!targets.length) errors.push("請輸入至少一個完整 Seller SKU。");
    if (!targets.length) {
      unconfigured.push({ id: image.id, folderName: image.file.name, sellerSku: null, images: validSlot ? [{ file: image.file, slot: image.slot! }] : [], errors, fileCount: 1 });
    }
    for (const sellerSku of targets) {
      const row = rows.get(sellerSku) ?? { id: `shared-sku-${rows.size + 1}`, folderName: "共用圖片", sellerSku, images: [], errors: [], fileCount: 0 };
      row.errors.push(...errors);
      if (validSlot && row.images.some(other => other.slot === image.slot)) row.errors.push(`第 ${image.slot! + 1} 張有重複檔案，請調整位置或移除其中一張。`);
      if (validSlot) row.images.push({ file: image.file, slot: image.slot! });
      row.fileCount += 1;
      if (row.fileCount > 10) row.errors.push("每個 SKU 最多更換 10 張圖片。");
      rows.set(sellerSku, row);
    }
  }
  const overLimit = images.length > 300 || rows.size > 30 || [...rows.values()].reduce((sum, row) => sum + row.fileCount, 0) > 300;
  return [...rows.values(), ...unconfigured].map(row => ({ ...row, images: row.images.sort((a, b) => a.slot - b.slot), errors: [...new Set([...row.errors, ...(overLimit ? ["每批最多 30 個 SKU、300 張圖片配置；請減少選取，本批尚未準備。"] : [])])] }));
}
