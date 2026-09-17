import { useEffect, useMemo, useRef, useState } from "react";
import type { ImageFolderRow } from "../image-folder-import";
import { buildSharedImageRows, inspectLooseImages, parseManualImageSkus, type LooseImageDraft } from "../image-loose-import";
import { parseVariationFamilyResponse, type VariationFamilyView, type VariationMemberView } from "../variation-planner";

type FamilyLookup = { status: "loading" | "complete" | "failed"; family?: VariationFamilyView; message?: string };

function Thumbnail({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!URL.createObjectURL) return;
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url ? <img className="image-shared-thumbnail" src={url} alt={file.name} /> : null;
}

function candidates(family: VariationFamilyView): VariationMemberView[] {
  const members = [...family.children];
  if (family.queried.role !== "parent" && family.queried.fba && !members.some(item => item.sellerSku === family.queriedSku)) members.unshift(family.queried);
  return members;
}

/** Local assignments plus read-only suggestions; no upload or Amazon write authority. */
export default function ImageSharedSelection({ files, marketplaceId, disabled, onRowsChange, onBusyChange }: {
  files: readonly File[];
  marketplaceId: string;
  disabled: boolean;
  onRowsChange: (rows: ImageFolderRow[]) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const inspected = useMemo(() => inspectLooseImages(files), [files]);
  const [images, setImages] = useState<LooseImageDraft[]>(inspected.images);
  const [families, setFamilies] = useState<Record<string, FamilyLookup>>({});
  const [invalidated, setInvalidated] = useState(false);
  const generation = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const callbacks = useRef({ onRowsChange, onBusyChange });
  callbacks.current = { onRowsChange, onBusyChange };
  const rows = useMemo(() => buildSharedImageRows(images).map(row => {
    const family = row.sellerSku ? families[row.sellerSku]?.family : undefined;
    return family?.queried.role === "parent" ? { ...row, errors: [...row.errors, "這個 SKU 是父商品，請改選要更新的 FBA 子商品。"] } : row;
  }), [images, families]);
  useEffect(() => { callbacks.current.onRowsChange(rows); }, [rows]);
  useEffect(() => {
    setImages(inspected.images); setFamilies({}); setInvalidated(false);
    const revision = ++generation.current;
    const request = new AbortController(); abortRef.current = request;
    const seeds = [...new Set(inspected.images.filter(image => !image.errors.length).map(image => image.seedSku).filter((sku): sku is string => sku !== null))];
    const current = () => revision === generation.current && !request.signal.aborted;
    if (!inspected.error && seeds.length && seeds.length <= 30) {
      setFamilies(Object.fromEntries(seeds.map(sku => [sku, { status: "loading" }])));
      callbacks.current.onBusyChange(true);
      void (async () => {
        try {
          for (const sellerSku of seeds) {
            if (!current()) return;
            let isolatedFailure = false;
            try {
              const params = new URLSearchParams({ marketplaceId, sku: sellerSku });
              const response = await fetch(`/api/sp-api/variation-family?${params}`, { cache: "no-store", signal: request.signal });
              isolatedFailure = [400, 404, 422].includes(response.status);
              if (!response.ok) throw new Error("系列查詢未完成；可手工輸入完整 Seller SKU，再由預檢核對商品。");
              const family = parseVariationFamilyResponse(await response.json(), { marketplaceId, sellerSku });
              if (!current()) return;
              setFamilies(previous => ({ ...previous, [sellerSku]: { status: "complete", family } }));
            } catch {
              if (!current()) return;
              setFamilies(previous => ({ ...previous, [sellerSku]: { status: "failed", message: "系列查詢未完成；可手工輸入完整 Seller SKU，再由預檢核對商品。" } }));
              if (!isolatedFailure) {
                setFamilies(previous => Object.fromEntries(Object.entries(previous).map(([sku, lookup]) => [sku, lookup.status === "loading" ? { status: "failed", message: "連線或資料未能完整核對，其餘系列查詢未啟動；可手工輸入完整 Seller SKU。" } : lookup])));
                return;
              }
            }
          }
        } finally { if (current()) callbacks.current.onBusyChange(false); }
      })();
    } else {
      callbacks.current.onBusyChange(false);
      if (seeds.length > 30) setFamilies(Object.fromEntries(seeds.map(sku => [sku, { status: "failed", message: "超過 30 個檔名 SKU，未啟動系列查詢；請分批處理。" }])));
    }
    return () => { generation.current += 1; request.abort(); callbacks.current.onBusyChange(false); };
  }, [inspected, marketplaceId]);
  useEffect(() => window.fbaOS?.app.onContextInvalidated?.(() => {
    generation.current += 1; abortRef.current?.abort();
    setImages([]); setFamilies({}); setInvalidated(true); callbacks.current.onBusyChange(false);
  }), []);

  const change = (id: string, update: Partial<LooseImageDraft>) => {
    if (disabled || invalidated) return;
    setImages(previous => previous.map(image => image.id === id ? { ...image, ...update } : image));
  };
  return <section className="image-shared-selection" aria-label="共用圖片與 SKU 選擇">
    <p>每張圖片可套用到多個 SKU；只更換選定位置，其餘圖片保留。檔名中的 01–10 會自動帶入位置，同系列商品仍由你勾選。</p>
    {inspected.error && <p role="alert" className="price-error">{inspected.error}</p>}
    {invalidated && <p role="alert">帳號或安全環境已更新，請重新選擇圖片。</p>}
    {images.map(image => {
      const parsed = parseManualImageSkus(image.targets);
      const lookup = image.seedSku ? families[image.seedSku] : undefined;
      const family = lookup?.family;
      return <article className="image-shared-item" key={image.id}>
        <div className="image-shared-file"><Thumbnail file={image.file} /><strong>{image.file.name}</strong>
          <button type="button" disabled={disabled || invalidated} aria-label={`移除圖片：${image.file.name}`} onClick={() => { if (!disabled && !invalidated) setImages(previous => previous.filter(item => item.id !== image.id)); }}>移除此圖</button>
        </div>
        <label>更換位置<select aria-label={`共用圖片位置：${image.file.name}`} value={image.slot ?? ""} disabled={disabled || invalidated || Boolean(image.errors.length)} onChange={event => change(image.id, { slot: event.target.value === "" ? null : Number(event.target.value) })}>
          <option value="">請選擇位置</option>
          {Array.from({ length: 10 }, (_, slot) => <option key={slot} value={slot}>{String(slot + 1).padStart(2, "0")} · {slot === 0 ? "主圖" : "副圖"}</option>)}
        </select></label>
        {image.slot === null && <p>☆ 檔名沒有唯一的 01–10 編號，請手工選擇位置。</p>}
        {image.errors.map(error => <p key={error} role="alert" className="price-error">{error}</p>)}
        <label>套用的 Seller SKU（每行一個，最多 30 個）<textarea aria-label={`套用 SKU：${image.file.name}`} value={image.targets} disabled={disabled || invalidated} rows={3} spellCheck={false} onChange={event => change(image.id, { targets: event.target.value })} /></label>
        {parsed.error && <p role="alert" className="price-error">{parsed.error}</p>}
        {!image.seedSku && <p>☆ 檔名未辨識出完整 SKU，請手工輸入要更新的商品。</p>}
        {lookup?.status === "loading" && <p role="status">正在尋找 {image.seedSku} 的同系列 FBA SKU…</p>}
        {lookup?.status === "failed" && <p role="status">☆ {lookup.message}</p>}
        {family && <div className="image-shared-suggestions">
          <p>★ {family.mode === "demo" ? "展示" : "Amazon"} 同系列建議 · {image.seedSku}（勾選才會加入）</p>
          {!family.familyComplete && <p role="status">☆ 系列資料未完整，以下僅顯示已讀取商品；可手工補入其他完整 SKU。</p>}
          {family.excludedChildren.length > 0 && <p>☆ {family.excludedChildren.length} 個商品未能確認為可用 FBA 建議。</p>}
          {family.queried.role === "parent" && <p>☆ 檔名 SKU 是父商品，請改選要更新的 FBA 子商品。</p>}
          <div className="image-shared-candidates">{candidates(family).map(candidate => <label key={candidate.sellerSku}>
            <input type="checkbox" aria-label={`${image.file.name} 套用至 ${candidate.sellerSku}`} checked={parsed.skus.includes(candidate.sellerSku)} disabled={disabled || invalidated || Boolean(parsed.error)} onChange={event => {
              if (parsed.error) return;
              change(image.id, { targets: (event.target.checked ? [...parsed.skus.filter(sku => sku !== candidate.sellerSku), candidate.sellerSku] : parsed.skus.filter(sku => sku !== candidate.sellerSku)).join("\n") });
            }} /> <strong>{candidate.sellerSku}</strong><span>{candidate.title}</span><small>{candidate.asin ?? "ASIN 未提供"}</small>
          </label>)}</div>
        </div>}
      </article>;
    })}
  </section>;
}
