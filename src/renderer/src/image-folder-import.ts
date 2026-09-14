/** Browser-selected relative names and File handles stay in renderer memory. */
export type SelectedFolderImage = { relativePath: string; file: File };
export type FolderImage = { file: File; slot: number };
export type ImageFolderRow = { id: string; folderName: string; sellerSku: string | null; images: FolderImage[]; errors: string[]; fileCount: number };
export type ImageFolderInspection = { rows: ImageFolderRow[]; error: string | null };

/** Narrow browser Entries API; no fullPath, filesystem, or native path access. */
export type BrowserFolderEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  file?: (success: (file: File) => void, failure: (error: unknown) => void) => void;
  createReader?: () => { readEntries: (success: (entries: BrowserFolderEntry[]) => void, failure: (error: unknown) => void) => void };
};

export const IMAGE_FOLDER_LIMIT = 30;
export const IMAGE_FILE_LIMIT = 300;
const MAX_DEPTH = 4;
const MAX_ENTRIES = 512;
const IGNORED_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
const safeName = (name: string) => name.length > 0 && name.length <= 255 && !/[\\/\u0000-\u001f\u007f]/u.test(name) && name !== "." && name !== "..";

export async function readDroppedImageFolders(entries: readonly BrowserFolderEntry[], signal?: AbortSignal): Promise<SelectedFolderImage[]> {
  const selected: SelectedFolderImage[] = [];
  let count = 0;
  const deadline = Date.now() + 15_000;
  const assertActive = () => {
    if (signal?.aborted) throw new Error("資料夾讀取已停止。");
    if (Date.now() >= deadline) throw new Error("資料夾讀取逾時，請分批選擇較少資料夾。");
  };
  const callback = <T,>(start: (success: (value: T) => void, failure: (error: unknown) => void) => void): Promise<T> => new Promise((resolve, reject) => {
    assertActive();
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(new Error("資料夾讀取已停止。")); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("資料夾讀取逾時，請分批選擇較少資料夾。")); }, Math.max(1, deadline - Date.now()));
    signal?.addEventListener("abort", abort, { once: true });
    try { start(value => { cleanup(); resolve(value); }, () => { cleanup(); reject(new Error("資料夾未完整讀取，請確認檔案已下載到這台電腦，再重新選擇。")); }); }
    catch { cleanup(); reject(new Error("無法讀取資料夾，請改用選擇資料夾按鈕。")); }
  });
  const visit = async (entry: BrowserFolderEntry, parents: string[]) => {
    assertActive();
    if (++count > MAX_ENTRIES || !safeName(entry.name) || parents.length > MAX_DEPTH) throw new Error("資料夾內容或層數超過限制；每批最多 30 個商品資料夾、300 張圖片、4 層資料夾。");
    if (entry.isFile === entry.isDirectory) throw new Error("資料夾含無法確認的項目，尚未接受這批圖片。");
    const path = [...parents, entry.name];
    if (entry.isFile) {
      if (!entry.file) throw new Error("檔案未完整讀取，尚未接受這批圖片。");
      if (IGNORED_FILES.has(entry.name)) return;
      const file = await callback<File>((success, failure) => entry.file!(success, failure));
      assertActive();
      selected.push({ relativePath: path.join("/"), file });
      if (selected.length > IMAGE_FILE_LIMIT) throw new Error("每批最多 300 張圖片；請分成兩批。");
      return;
    }
    if (!entry.createReader || path.length > MAX_DEPTH) throw new Error("資料夾層數最多 4 層，請直接選擇商品資料夾。");
    const reader = entry.createReader();
    let sawEntry = false;
    for (let page = 0; page < MAX_ENTRIES; page += 1) {
      const children = await callback<BrowserFolderEntry[]>((success, failure) => reader.readEntries(success, failure));
      assertActive();
      if (!children.length) {
        if (!sawEntry) throw new Error("包含空資料夾，請只選擇已有完整圖片的商品資料夾。");
        return;
      }
      sawEntry = true;
      for (const child of children) await visit(child, path);
    }
    throw new Error("資料夾未完整讀取，請分批選擇。");
  };
  if (!entries.length || entries.some(entry => !entry.isDirectory)) throw new Error("請拖入商品資料夾，或使用選擇資料夾按鈕。");
  for (const entry of entries) await visit(entry, []);
  return selected;
}

function imageIdentity(name: string, folder: string): { sellerSku: string; slot: number } | null {
  if (!safeName(name) || !/\.(?:jpe?g|png)$/iu.test(name)) return null;
  const identities: Array<{ sellerSku: string; slot: number }> = [];
  for (const match of name.matchAll(/_(\d{2})(?=_|\.)/gu)) {
    const order = Number(match[1]);
    const sku = name.slice(0, match.index);
    if (order < 1 || order > 10 || !sku || sku.length > 200 || sku.trim() !== sku) continue;
    if (!/^_(?:0[1-9]|10)(?:_[^/\\]+)?\.(?:jpe?g|png)$/iu.test(name.slice(match.index))) continue;
    const folderWithoutVersion = folder.replace(/_V\d+$/u, "");
    if (folder === sku || folderWithoutVersion === sku || folderWithoutVersion.endsWith(`_${sku}`)) identities.push({ sellerSku: sku, slot: order - 1 });
  }
  return identities.length === 1 ? identities[0] : null;
}

/** Complete-set inspection never truncates, aliases a SKU, or accepts part of an invalid folder. */
export function inspectImageFolders(files: readonly SelectedFolderImage[]): ImageFolderInspection {
  if (!files.length) return { rows: [], error: "資料夾沒有可讀取的圖片。" };
  if (files.length > MAX_ENTRIES) return { rows: [], error: "資料夾內容過多；每批最多 30 個商品資料夾、300 張圖片。" };
  const groups = new Map<string, SelectedFolderImage[]>();
  for (const item of files) {
    const parts = item.relativePath.split("/");
    if (parts.length < 2 || parts.length > MAX_DEPTH + 1 || parts.some(part => !safeName(part)) || parts.at(-1) !== item.file.name) {
      return { rows: [], error: "請選擇商品資料夾或它們的上層資料夾；資料夾層數最多 4 層，不接受無法確認的路徑。" };
    }
    if (IGNORED_FILES.has(item.file.name)) continue;
    const folderPath = parts.slice(0, -1).join("/");
    groups.set(folderPath, [...(groups.get(folderPath) ?? []), item]);
  }
  if (groups.size > IMAGE_FOLDER_LIMIT || [...groups.values()].reduce((sum, group) => sum + group.length, 0) > IMAGE_FILE_LIMIT) {
    return { rows: [], error: "每批最多 30 個商品資料夾、300 張圖片；請分成兩批，這批尚未上傳。" };
  }
  const rows = [...groups].map(([path, group], index): ImageFolderRow => {
    const folderName = path.split("/").at(-1)!;
    const errors: string[] = [];
    const skus = new Set<string>();
    const slots = new Set<number>();
    const images: FolderImage[] = [];
    if (group.length > 10) errors.push("每個商品資料夾最多 10 張圖片。");
    for (const { file } of group) {
      const identity = imageIdentity(file.name, folderName);
      if (!identity) { errors.push(`「${file.name}」與資料夾品號或 01–10 編號不一致。`); continue; }
      skus.add(identity.sellerSku);
      if (slots.has(identity.slot)) errors.push(`第 ${identity.slot + 1} 張有重複檔案。`);
      slots.add(identity.slot);
      if (!file.size || file.size > 10 * 1024 * 1024) errors.push(`「${file.name}」需有內容且不超過 10 MB。`);
      if (file.type && file.type !== "image/jpeg" && file.type !== "image/png") errors.push(`「${file.name}」只接受 JPEG 或 PNG。`);
      images.push({ file, slot: identity.slot });
    }
    if (skus.size !== 1) errors.push("同一資料夾必須對應同一個完整 Seller SKU。");
    if (!slots.has(0)) errors.push("完整圖片組必須包含 01 主圖。");
    const ordered = [...slots].sort((a, b) => a - b);
    if (ordered.some((slot, order) => slot !== order)) errors.push("完整圖片組的 01–10 編號必須連續，請補齊缺少的圖片。");
    return { id: `folder-${index + 1}`, folderName, sellerSku: skus.size === 1 ? [...skus][0] : null, images: images.sort((a, b) => a.slot - b.slot), errors: [...new Set(errors)], fileCount: group.length };
  });
  for (const row of rows) if (row.sellerSku && rows.filter(other => other.sellerSku === row.sellerSku).length > 1) row.errors.push("同一 SKU 出現在多個資料夾，請只保留要更新的一個版本。");
  return { rows, error: rows.length ? null : "資料夾沒有可讀取的圖片。" };
}
