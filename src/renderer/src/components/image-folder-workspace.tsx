import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { LISTING_IMAGE_MIN_VALIDITY_MS, LISTING_IMAGE_RETENTION_MS } from "../../../shared/listing-image-retention";
import type { ListingImageBatchRow, ListingImageBatchSnapshot } from "../../../shared/listing-image-batch";
import { parseListingImageReadbackDiagnostics, type ListingImageReadbackBlocker, type ListingImageReadbackDiagnostics } from "../../../shared/listing-image-readback";
import { inspectImageFolders, readDroppedImageFolders, type BrowserFolderEntry, type ImageFolderRow, type SelectedFolderImage } from "../image-folder-import";
import ImageSharedSelection from "./image-shared-selection";

const BATCH_PATH = "/api/sp-api/listing-images-batch";
const ACTIVE_PHASES = new Set(["revalidating", "awaiting-approval", "submitting", "readback"]);
const ROW_LABELS: Record<ListingImageBatchRow["state"], string> = {
  ready: "★ 核對通過", unchanged: "☆ 圖片相同", blocked: "待修正", "not-started": "尚未送出", submitting: "送出中",
  accepted: "Amazon 已接受，待回查", verified: "★ Amazon 回查確認", unknown: "結果待確認，不可重送", rejected: "Amazon 未接受", simulated: "展示模式已完成",
};

const READBACK_REASONS: Record<ListingImageReadbackBlocker, string> = {
  "invalid-evidence": "先前更新紀錄不足以完成核對",
  "receipt-not-live-accepted": "先前紀錄不是正式接受的更新",
  "readback-not-live": "這次取得的不是正式 Amazon 資料",
  "not-fba": "這次資料未能確認為 FBA 商品",
  "marketplace-mismatch": "Amazon 站點與先前更新不一致",
  "sku-mismatch": "Seller SKU 與先前更新不一致",
  "asin-mismatch": "ASIN 與先前更新不一致",
  "product-type-mismatch": "商品類型與先前更新不一致",
  "attributes-missing": "Amazon 尚未提供完整商品欄位",
  "slot-shape-mismatch": "Amazon 圖片位置資料不完整",
  "issues-unavailable": "Amazon 問題清單無法完整判讀",
  "error-issues": "Amazon 仍回報商品錯誤",
  "url-mismatch": "部分圖片位置與這次送出的資料不同",
};

function ReadbackReasons({ diagnostics, sellerSku, state }: { diagnostics: ListingImageReadbackDiagnostics; sellerSku: string; state: ListingImageBatchRow["state"] }) {
  const { slots, issues, blockers } = diagnostics;
  return <details><summary>查看本次回查原因</summary>
    {diagnostics.decision === "verified" && state !== "verified" && <p>本次圖片資料已相符，更新紀錄仍待確認。</p>}
    <table className="image-folder-comparison" aria-label={`${sellerSku} 本次回查原因`}><tbody>
      <tr><th scope="row">核對結果</th><td>{blockers.length ? blockers.map(reason => <p key={reason}>☆ {READBACK_REASONS[reason]}</p>) : "★ 本次資料核對相符"}</td></tr>
      <tr><th scope="row">圖片位置</th><td>{slots.compared ? <>
        <p>{`圖片位置符合 ${slots.matchedCount}／${slots.targetCount}`}</p>
        {slots.missingCount > 0 && <p>{`尚缺圖片 ${slots.missingCount} 個位置`}</p>}
        {slots.deletionPendingCount > 0 && <p>{`舊圖尚未清除 ${slots.deletionPendingCount} 個位置`}</p>}
        {slots.differentUrlCount > 0 && <p>{`圖片網址不同 ${slots.differentUrlCount} 個位置`}</p>}
        {slots.invalidUrlCount > 0 && <p>{`圖片資料無法判讀 ${slots.invalidUrlCount} 個位置`}</p>}
        {slots.unchangedPreviousCount > 0 && <p>{`其中 ${slots.unchangedPreviousCount} 個位置仍與更新前相同`}</p>}
        {slots.crossHostAmazonDifferentCount > 0 && <p>{`有 ${slots.crossHostAmazonDifferentCount} 個位置回傳為不同來源的 Amazon 圖片網址；尚不能據此確認為本次送出的圖片。`}</p>}
      </> : "☆ 本次資料不足，尚未完成圖片比對"}</td></tr>
      <tr><th scope="row">Amazon 回報</th><td>{blockers.includes("issues-unavailable") ? "☆ 問題清單尚未完整讀取" : issues.errorCount ? <>
        {issues.imageErrorCount > 0 && <p>{`圖片欄位錯誤 ${issues.imageErrorCount} 項`}</p>}
        {issues.nonImageErrorCount > 0 && <p>{`其他欄位錯誤 ${issues.nonImageErrorCount} 項`}</p>}
        {issues.unscopedErrorCount > 0 && <p>{`未指明欄位的錯誤 ${issues.unscopedErrorCount} 項`}</p>}
      </> : "★ 本次未回報錯誤"}</td></tr>
    </tbody></table>
  </details>;
}

function responseSnapshot(value: unknown, marketplaceId: string, expectedSkus: readonly string[], batchId?: string, expectedMode?: "complete" | "selected-slots"): ListingImageBatchSnapshot {
  const item = value as ListingImageBatchSnapshot | null;
  if (!item || item.capability !== "listing-image-batch-v1" || item.marketplaceId !== marketplaceId || !["complete", "selected-slots"].includes(item.replacementMode) || (expectedMode && item.replacementMode !== expectedMode) ||
    !["live", "demo"].includes(item.mode) || !["ready", ...ACTIVE_PHASES, "completed", "stopped"].includes(item.phase) ||
    typeof item.batchId !== "string" || !item.batchId || item.batchId.length > 200 || (batchId && batchId !== item.batchId) ||
    typeof item.reviewToken !== "string" || !item.reviewToken || item.reviewToken.length > 200 || !Number.isFinite(Date.parse(item.expiresAt)) ||
    !Array.isArray(item.rows) || !item.rows.length || item.rows.length > 30 || item.rows.length !== expectedSkus.length ||
    new Set(item.rows.map(row => row.sellerSku)).size !== item.rows.length || item.rows.some(row => !expectedSkus.includes(row.sellerSku) ||
      !Object.hasOwn(ROW_LABELS, row.state) || typeof row.title !== "string" || (row.asin !== null && typeof row.asin !== "string") ||
      !Array.isArray(row.previousUrls) || !Array.isArray(row.requestedUrls) || row.previousUrls.length !== 10 || row.requestedUrls.length !== 10 ||
      [...row.previousUrls, ...row.requestedUrls].some(url => url !== null && (typeof url !== "string" || !url.startsWith("https://"))) ||
      !Array.isArray(row.changedSlots) || !Array.isArray(row.deletedSlots) || [...row.changedSlots, ...row.deletedSlots].some(slot => !Number.isInteger(slot) || slot < 1 || slot > 10) ||
      (row.readbackDiagnostics !== undefined && !parseListingImageReadbackDiagnostics(row.readbackDiagnostics))) ||
    (item.lastReadbackAt !== undefined && item.lastReadbackAt !== null && (typeof item.lastReadbackAt !== "string" || !Number.isFinite(Date.parse(item.lastReadbackAt)))) ||
    !item.totals || Object.values(item.totals).some(count => !Number.isSafeInteger(count) || count < 0) || item.totals.skus !== item.rows.length) {
    throw new Error("批次回應與本次商品不一致，已停止；請更新 Notebook Key 後重新核對。");
  }
  return item;
}

async function jsonResponse(response: Response): Promise<unknown> {
  const value = await response.json() as { message?: string };
  if (!response.ok) throw new Error(response.status === 404 ? "目前 Notebook Key 尚未支援資料夾批次更新，請更新桌面程式。" : value.message || "本次處理未完成，請核對結果。");
  return value;
}

function LocalThumbnail({ file, slot }: { file: File; slot: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!URL.createObjectURL) return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return <figure title={file.name}>{url && <img src={url} alt={`${String(slot + 1).padStart(2, "0")} · ${file.name}`} loading="lazy" />}<figcaption>{String(slot + 1).padStart(2, "0")}{slot === 0 ? " 主圖" : ""}</figcaption></figure>;
}

type FolderState = ImageFolderRow & { preparation: string; uploaded: number; urls: (string | null)[]; expiresAt: string | null };

export default function ImageFolderWorkspace({ marketplaceId, onBusyChange }: { marketplaceId: string; onBusyChange: (busy: boolean) => void }) {
  const [supported, setSupported] = useState(false);
  const [sharedSupported, setSharedSupported] = useState(false);
  const [looseFiles, setLooseFiles] = useState<readonly File[]>([]);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [replacementMode, setReplacementMode] = useState<"complete" | "selected-slots">("complete");
  const [readbackSupported, setReadbackSupported] = useState(false);
  const [checking, setChecking] = useState(false);
  const [recoveryText, setRecoveryText] = useState("");
  const [rows, setRows] = useState<FolderState[]>([]);
  const [batch, setBatch] = useState<ListingImageBatchSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [contextEpoch, setContextEpoch] = useState(0);
  const [observationPaused, setObservationPaused] = useState(false);
  const [uncertainSubmission, setUncertainSubmission] = useState(false);
  const [now, setNow] = useState(Date.now);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const generation = useRef(0);
  const running = useRef(false);
  const submitted = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const active = Boolean(batch && ACTIVE_PHASES.has(batch.phase));
  const busy = working || active || uncertainSubmission || checking || selectionBusy;
  const shared = replacementMode === "selected-slots";
  const showReadbackReasons = !checking && !active && !observationPaused;
  const validRows = rows.filter(row => !row.errors.length && row.sellerSku);

  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  useEffect(() => {
    inputRef.current?.setAttribute("webkitdirectory", "");
    inputRef.current?.setAttribute("directory", "");
  }, []);
  useEffect(() => {
    const revision = ++generation.current;
    const request = new AbortController();
    setSupported(false); setReadbackSupported(false); setSharedSupported(false);
    void fetch(`${BATCH_PATH}?marketplaceId=${encodeURIComponent(marketplaceId)}`, { signal: request.signal }).then(jsonResponse).then(value => {
      if (revision !== generation.current) return;
      const item = value as Record<string, unknown>;
      if (item.capability !== "listing-image-batch-v1" || item.maxSkus !== 30 || item.maxImagesPerSku !== 10 || item.replacementMode !== "complete" || item.confirmationMode !== "native") throw new Error("目前 Notebook Key 尚未支援完整的資料夾批次更新，請更新桌面程式。");
      setSupported(true);
      setSharedSupported(item.selectedSlotReplacement === true);
      setReadbackSupported(item.readbackRecovery === "exact-sku-v1");
    }).catch(reason => { if (revision === generation.current && !request.signal.aborted) setError(reason instanceof Error ? reason.message : "無法確認批次功能，請更新 Notebook Key。"); });
    return () => { generation.current += 1; request.abort(); controller.current?.abort(); };
  }, [marketplaceId, contextEpoch]);
  useEffect(() => window.fbaOS?.app.onContextInvalidated?.(() => {
    generation.current += 1;
    controller.current?.abort();
    running.current = false;
    submitted.current = false;
    setWorking(false); setRows([]); setLooseFiles([]); setSelectionBusy(false); setSharedSupported(false); setBatch(null); setAcknowledged(false); setAttempted(false); setSupported(false); setUncertainSubmission(false); setReadbackSupported(false); setChecking(false); setRecoveryText("");
    setError("帳號或安全環境已更新，本批次已停止；請重新選擇資料夾。已送出的更新不會重送。");
    setContextEpoch(value => value + 1);
  }), []);

  const acceptRows = useCallback((selected: ImageFolderRow[]) => {
    setRows(selected.map(row => ({ ...row, preparation: "待準備", uploaded: 0, urls: Array.from({ length: 10 }, () => null), expiresAt: null })));
    setBatch(null); setAcknowledged(false); setAttempted(false); setObservationPaused(false); setUncertainSubmission(false); submitted.current = false;
    setError(null);
  }, []);
  const acceptFiles = (files: readonly SelectedFolderImage[]) => {
    const inspected = inspectImageFolders(files);
    setReplacementMode("complete"); setLooseFiles([]); acceptRows(inspected.rows);
    setError(inspected.error);
  };
  const acceptLooseFiles = (files: readonly File[]) => {
    if (!sharedSupported) { setError("共用圖片需要更新 Notebook Key，原有資料夾功能仍可使用。"); return; }
    if (!files.length || files.length > 300) { setError("請選擇 1–300 張圖片；這次選擇尚未接受。"); return; }
    setReplacementMode("selected-slots"); acceptRows([]); setLooseFiles([...files]);
  };
  const dropped = async (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (busy || running.current || !supported) return;
    const items = Array.from(event.dataTransfer.items ?? []);
    const entries = items.map(item => item.webkitGetAsEntry?.());
    if (entries.length && entries.every(entry => entry?.isFile && !entry.isDirectory)) {
      const files = Array.from(event.dataTransfer.files ?? []);
      if (files.length !== entries.length) { setError("圖片未完整讀取，請改用選擇圖片；原本的核對內容仍保留。"); return; }
      acceptLooseFiles(files); return;
    }
    if (!items.length && event.dataTransfer.files?.length) {
      const files = Array.from(event.dataTransfer.files);
      if (files.every(file => !file.webkitRelativePath)) { acceptLooseFiles(files); return; }
    }
    if (entries.some(entry => entry?.isFile)) { setError("請將圖片與資料夾分開拖入，這次選擇尚未接受。"); return; }
    const revision = generation.current;
    const request = new AbortController(); controller.current = request;
    running.current = true; setWorking(true); setError(null);
    try {
      if (entries.some(entry => !entry)) throw new Error("有資料夾無法完整讀取，請改用選擇資料夾按鈕；原本的核對內容仍保留。");
      const files = await readDroppedImageFolders(entries as BrowserFolderEntry[], request.signal);
      if (revision === generation.current) acceptFiles(files);
    } catch (reason) { if (revision === generation.current) setError(reason instanceof Error ? reason.message : "無法完整讀取資料夾。"); }
    finally { if (revision === generation.current) { running.current = false; setWorking(false); } }
  };

  const observe = async (refresh = false) => {
    if (!batch || running.current) return;
    if (refresh && !readbackSupported && !active && !uncertainSubmission) { setError("目前 Notebook Key 只支援讀取已保存進度，請更新桌面程式後重新回查 Amazon。"); return; }
    const revision = generation.current;
    running.current = true;
    if (refresh) setChecking(true);
    const request = new AbortController(); controller.current = request;
    try {
      const value = await jsonResponse(await fetch(`${BATCH_PATH}?marketplaceId=${encodeURIComponent(marketplaceId)}&batchId=${encodeURIComponent(batch.batchId)}${refresh && readbackSupported ? "&refresh=true" : ""}`, { signal: request.signal }));
      if (revision !== generation.current) return;
      setBatch(responseSnapshot(value, marketplaceId, batch.rows.map(row => row.sellerSku), batch.batchId, batch.replacementMode));
      setError(null); setObservationPaused(false); setUncertainSubmission(false);
    } catch (reason) {
      if (revision === generation.current) { setError(reason instanceof Error ? reason.message : "進度暫時無法讀取，只能重新讀取，不能重送。"); setObservationPaused(true); }
    } finally { if (revision === generation.current) { running.current = false; if (refresh) setChecking(false); } }
  };
  useEffect(() => {
    if (!active || working || observationPaused) return;
    const timeout = window.setTimeout(() => void observe(), 1_500);
    return () => window.clearTimeout(timeout);
  });
  useEffect(() => {
    if (batch?.phase !== "ready" || submitted.current) return;
    const timeout = window.setTimeout(() => setNow(Date.now()), Math.min(30_000, Math.max(1, Date.parse(batch.expiresAt) - now)));
    if (Date.parse(batch.expiresAt) <= now) { window.clearTimeout(timeout); return; }
    return () => window.clearTimeout(timeout);
  }, [batch, now]);

  const prepare = async (explicitRecheck = false) => {
    if (!supported || (shared && !sharedSupported) || busy || running.current || submitted.current || (attempted && !explicitRecheck) || !validRows.length) return;
    const revision = generation.current;
    const request = new AbortController(); controller.current = request;
    running.current = true; setWorking(true); setAttempted(true); setError(null); setAcknowledged(false); setBatch(null); setNow(Date.now());
    const prepared: Array<{ sellerSku: string; urls: (string | null)[]; expiresAt: number }> = [];
    const assertRemaining = (expiry = Infinity) => {
      if (Math.min(expiry, ...prepared.map(row => row.expiresAt)) <= Date.now() + LISTING_IMAGE_MIN_VALIDITY_MS) throw new Error("圖片暫存期限不足十分鐘，請重新準備並核對；尚未更新 Amazon。");
    };
    const update = (id: string, changes: Partial<FolderState>) => setRows(previous => previous.map(row => row.id === id ? { ...row, ...changes } : row));
    try {
      for (const row of validRows) {
        const nextUrls: (string | null)[] = Array.from({ length: 10 }, () => null);
        let firstExpiry: string | null = null;
        let failed = false;
        for (const image of row.images) {
          if (revision !== generation.current) return;
          assertRemaining(firstExpiry ? Date.parse(firstExpiry) : Infinity);
          update(row.id, { preparation: `準備第 ${image.slot + 1} 張…` });
          const form = new FormData();
          form.set("marketplaceId", marketplaceId); form.set("sellerSku", row.sellerSku!); form.set("batchMode", "true"); form.set("file", image.file);
          const response = await fetch("/api/uploads/listing-images", { method: "POST", body: form, signal: request.signal });
          const payload = await response.json() as { amazonUrl?: string; readyForAmazon?: boolean; expiresAt?: string; message?: string; code?: string };
          if (revision !== generation.current) return;
          if (!response.ok && [413, 415, 422].includes(response.status) && ["IMAGE_TOO_LARGE", "INVALID_IMAGE", "IMAGE_TOO_SMALL"].includes(payload.code ?? "")) {
            update(row.id, { errors: [...row.errors, payload.message || "圖片格式或尺寸未通過，整個 SKU 暫不更新。"], preparation: "待修正，整組未送出" }); failed = true; break;
          }
          if (!response.ok) throw new Error(payload.message || "圖片準備結果不明，已停止這批；尚未更新 Amazon。");
          if (!payload.readyForAmazon || typeof payload.amazonUrl !== "string" || !payload.amazonUrl.startsWith("https://") ||
            typeof payload.expiresAt !== "string" || !Number.isFinite(Date.parse(payload.expiresAt)) || new Date(payload.expiresAt).toISOString() !== payload.expiresAt || Date.parse(payload.expiresAt) > Date.now() + LISTING_IMAGE_RETENTION_MS + 60_000) throw new Error("圖片服務尚未提供可用的暫存期限，已停止；請更新 Notebook Key 與圖片服務。");
          assertRemaining(Math.min(Date.parse(payload.expiresAt), firstExpiry ? Date.parse(firstExpiry) : Infinity));
          nextUrls[image.slot] = payload.amazonUrl;
          if (!firstExpiry || payload.expiresAt < firstExpiry) firstExpiry = payload.expiresAt;
          update(row.id, { uploaded: nextUrls.filter(Boolean).length, urls: [...nextUrls], expiresAt: firstExpiry });
        }
        if (!failed) { prepared.push({ sellerSku: row.sellerSku!, urls: nextUrls, expiresAt: Date.parse(firstExpiry!) }); update(row.id, { preparation: "圖片已備妥，核對商品中…" }); }
      }
      if (!prepared.length) throw new Error("沒有完整通過的 SKU；請修正資料夾後重新選擇。");
      assertRemaining();
      const value = await jsonResponse(await fetch(BATCH_PATH, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ marketplaceId, replacementMode, rows: prepared.map(({sellerSku,urls}) => ({sellerSku,urls})) }), signal: request.signal }));
      if (revision === generation.current) {
        const reviewed = responseSnapshot(value, marketplaceId, prepared.map(row => row.sellerSku), undefined, replacementMode);
        if (reviewed.rows.some(row => {
          const supplied = prepared.find(input => input.sellerSku === row.sellerSku)!.urls;
          if (shared && row.state === "blocked") return row.deletedSlots.length > 0;
          return (shared && row.deletedSlots.length > 0) || row.requestedUrls.some((url, slot) => url !== (shared ? supplied[slot] ?? row.previousUrls[slot] : supplied[slot]));
        })) throw new Error("核對結果的圖片位置與所選內容不一致，已停止，請重新核對。");
        const readyExpiry = Math.min(...reviewed.rows.filter(row => row.state === "ready").map(row => prepared.find(input => input.sellerSku === row.sellerSku)!.expiresAt));
        if (reviewed.totals.ready && (Date.parse(reviewed.expiresAt) > readyExpiry - LISTING_IMAGE_MIN_VALIDITY_MS || Date.parse(reviewed.expiresAt) <= Date.now())) throw new Error("核對期限已不足以送出這組圖片，請重新準備並核對；尚未更新 Amazon。");
        setBatch(reviewed); setNow(Date.now());
      }
    } catch (reason) { if (revision === generation.current) setError(reason instanceof Error ? reason.message : "本批次準備未完成；不會自動重傳或更新 Amazon。"); }
    finally { if (revision === generation.current) { running.current = false; setWorking(false); } }
  };

  const submit = async () => {
    if (!batch || busy || running.current || submitted.current || batch.phase !== "ready" || !acknowledged || !batch.totals.ready || Date.parse(batch.expiresAt) <= Date.now()) return;
    const revision = generation.current;
    const request = new AbortController(); controller.current = request;
    running.current = true; submitted.current = true; setWorking(true); setError(null);
    try {
      const value = await jsonResponse(await fetch(BATCH_PATH, { method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ marketplaceId, batchId: batch.batchId, reviewToken: batch.reviewToken, ...(batch.replacementMode === "selected-slots" ? { selectedSlotsAcknowledged: true } : { completeReplacementAcknowledged: true }) }), signal: request.signal }));
      if (revision === generation.current) setBatch(responseSnapshot(value, marketplaceId, batch.rows.map(row => row.sellerSku), batch.batchId, batch.replacementMode));
    } catch (reason) {
      if (revision === generation.current) { setError(reason instanceof Error ? reason.message : "送出結果待確認；請重新讀取本批次進度，不可重送。"); setObservationPaused(true); setUncertainSubmission(true); }
    } finally { if (revision === generation.current) { running.current = false; setWorking(false); } }
  };

  const recover = async () => {
    if (busy || running.current) return;
    if (!readbackSupported) { setError("請更新 Notebook Key 後，再讀取先前圖片更新。"); return; }
    const skus = recoveryText.split(/\r?\n/u).filter(sku => Boolean(sku.trim()));
    if (skus.some(sku => sku !== sku.trim())) { setError("SKU 前後不可有空白；請每行貼上一個完整 SKU。"); return; }
    if (!skus.length || skus.length > 30 || new Set(skus).size !== skus.length) {
      setError("請每行貼上一個完整 SKU，最多 30 個且不可重複。"); return;
    }
    const revision = generation.current;
    const request = new AbortController(); controller.current = request;
    running.current = true; setChecking(true); setError(null);
    try {
      const value = await jsonResponse(await fetch(`${BATCH_PATH}?marketplaceId=${encodeURIComponent(marketplaceId)}&recoverSkus=${encodeURIComponent(JSON.stringify(skus))}`, { signal: request.signal }));
      if (revision !== generation.current) return;
      const recovered = responseSnapshot(value, marketplaceId, skus);
      if (recovered.phase === "ready" || recovered.rows.some(row => ["ready", "submitting", "not-started"].includes(row.state))) throw new Error("先前更新回應不是唯讀進度，已停止，請更新 Notebook Key。");
      setRows([]); setLooseFiles([]); setBatch(recovered); setAcknowledged(false); setObservationPaused(false); setUncertainSubmission(false);
      submitted.current = true;
    } catch (reason) {
      if (revision === generation.current) { setError(reason instanceof Error ? reason.message : "先前圖片進度未能讀取，沒有重新送出更新。"); setObservationPaused(true); }
    } finally { if (revision === generation.current) { running.current = false; setChecking(false); } }
  };

  const awaitingResult = submitted.current && batch?.phase === "ready";
  return <section className="image-folder-workspace" aria-label="批次圖片更新">
    <p>每批最多 <strong>30 個 SKU</strong>，每個 SKU 最多 <strong>10 張</strong>；可選單張、多張圖片或商品資料夾，實際可用位置依商品檢查結果。</p>
    <p className="image-folder-temporary">圖片只作暫時轉交，準備後保留 1 小時，再由服務自動清理。Amazon 已接受不代表已下載完成，圖片不會在送出後立刻刪除。</p>
    <div className="image-folder-drop" onDragOver={event => event.preventDefault()} onDrop={dropped} aria-disabled={busy || !supported}>
      <strong>拖入單張、多張圖片，或一組商品資料夾</strong>
      <span>共用圖片可一次套用多個 SKU；資料夾則替換完整圖片組。</span>
      <div className="image-folder-pickers">
        <button type="button" disabled={busy || !sharedSupported} onClick={() => imageInputRef.current?.click()}>選擇圖片</button>
        <button type="button" disabled={busy || !supported} onClick={() => inputRef.current?.click()}>選擇資料夾</button>
      </div>
      <input ref={imageInputRef} type="file" multiple accept="image/jpeg,image/png" hidden aria-label="選擇單張或多張圖片" disabled={busy || !sharedSupported} onChange={event => {
        if (busy || running.current || !sharedSupported) return;
        acceptLooseFiles(Array.from(event.target.files ?? []));
        event.target.value = "";
      }} />
      <input ref={inputRef} type="file" multiple hidden aria-label="選擇商品資料夾" disabled={busy || !supported} onChange={event => {
        if (busy || running.current || !supported) return;
        const files = Array.from(event.target.files ?? []);
        acceptFiles(files.map(file => ({ relativePath: file.webkitRelativePath, file })));
        event.target.value = "";
      }} />
    </div>
    {supported && !sharedSupported && <p role="status">共用圖片需要更新 Notebook Key；原有資料夾更新仍可使用。</p>}
    {shared && looseFiles.length > 0 && <ImageSharedSelection files={looseFiles} marketplaceId={marketplaceId}
      disabled={busy || submitted.current} onRowsChange={acceptRows} onBusyChange={setSelectionBusy} />}
    <details className="image-folder-recovery"><summary>找回先前圖片更新</summary>
      <p>重新開啟程式後，可貼上先前送出的 SKU。只核對本機紀錄與 Amazon 圖片，不需重新上傳檔案。</p>
      <label>每行一個完整 SKU，最多 30 個<textarea aria-label="找回圖片更新的 SKU" value={recoveryText} disabled={busy} rows={4} onChange={event => setRecoveryText(event.target.value)} /></label>
      <button type="button" disabled={busy || !supported || !recoveryText.trim()} onClick={recover}>讀取先前圖片進度</button>
    </details>
    <p className="image-folder-rule">{shared ? "共用圖片只替換指定位置，其他位置全部保留。01 是主圖，02–10 是副圖；不必補齊整組。" : "以資料夾為完整圖片組：01 主圖、02–10 副圖；資料夾未提供的舊圖片會列出並清除。"}</p>
    {error && <p className="price-error" role="alert">{error}</p>}
    {rows.length > 0 && <>
      <div className="image-folder-summary" role="status"><strong>{shared ? `${rows.filter(row => row.sellerSku).length} 個 SKU · ${rows.reduce((sum, row) => sum + row.fileCount, 0)} 個圖片配置` : `${rows.length} 個資料夾 · ${rows.reduce((sum, row) => sum + row.fileCount, 0)} 張`}</strong><span>可準備 {validRows.length} 個 SKU · 待修正 {rows.length - validRows.length} 個</span></div>
      <div className="image-folder-table" tabIndex={0} aria-label={shared ? "共用圖片與 SKU 核對" : "資料夾與完整圖片組核對"}><table><thead><tr><th scope="col">{shared ? "目標 SKU" : "資料夾／SKU"}</th><th scope="col">{shared ? "指定圖片位置" : "完整圖片組"}</th><th scope="col">Amazon 變更</th><th scope="col">狀況</th></tr></thead><tbody>
        {rows.map(row => {
          const result = batch?.rows.find(item => item.sellerSku === row.sellerSku);
          return <tr key={row.id} data-state={row.errors.length ? "blocked" : result?.state ?? "local"}>
            <td><strong>{row.sellerSku ?? "SKU 待確認"}</strong><small>{row.folderName}</small>{result && <small>{result.asin ?? "ASIN 待確認"} · {result.title}</small>}</td>
            <td><div className="image-folder-thumbnails">{row.images.map((image, index) => <LocalThumbnail key={`${image.slot}-${index}`} file={image.file} slot={image.slot} />)}</div></td>
            <td>{result?.state === "blocked" ? <span>本 SKU 未通過核對，暫不更新。</span> : result ? <><span>★ 更新 {result.changedSlots.filter(slot => !result.deletedSlots.includes(slot)).length} 個位置</span>{result.deletedSlots.length > 0 ? <strong className="image-folder-deletions">清除第 {result.deletedSlots.join("、")} 張</strong> : <small>{shared ? "☆ 其他位置全部保留" : "☆ 沒有多出的舊圖"}</small>}
              {result.changedSlots.length > 0 && <details><summary>查看逐張變更（原圖／新圖）</summary>
                <table className="image-folder-comparison" aria-label={`${row.sellerSku} 逐張圖片變更`}><thead><tr><th scope="col">位置</th><th scope="col">原圖</th><th scope="col">新圖</th></tr></thead><tbody>
                  {result.changedSlots.map(slot => <tr key={slot}>
                    <th scope="row">★ {String(slot).padStart(2, "0")}</th>
                    <td>{result.previousUrls[slot - 1] ? <img src={result.previousUrls[slot - 1]!} alt={`第 ${slot} 張原圖`} loading="lazy" referrerPolicy="no-referrer" /> : <span>無</span>}</td>
                    <td>{result.requestedUrls[slot - 1] ? <div className="image-folder-thumbnails">{row.images.filter(image => image.slot === slot - 1).map(image => <LocalThumbnail key={slot} file={image.file} slot={image.slot} />)}</div> : <strong className="image-folder-deletions">清除</strong>}</td>
                  </tr>)}
                </tbody></table>
              </details>}</> : <span>待核對商品與可用位置</span>}</td>
            <td aria-live="polite">{row.errors.length ? row.errors.map(issue => <p key={issue}>{issue}</p>) : result ? <><strong>{ROW_LABELS[result.state]}</strong>{result.message && <p>{result.message}</p>}{showReadbackReasons && result.readbackDiagnostics && <ReadbackReasons diagnostics={result.readbackDiagnostics} sellerSku={result.sellerSku} state={result.state} />}</> : <><span>{row.preparation}</span>{attempted && <small>已準備 {row.uploaded}／{row.images.length} 張</small>}</>}{row.expiresAt && <small>圖片暫存至 {new Date(row.expiresAt).toLocaleString("zh-TW")}</small>}</td>
          </tr>;
        })}
      </tbody></table></div>
      {!batch && !attempted && <button type="button" className="price-primary-button" disabled={busy || !supported || !validRows.length} onClick={() => prepare()}>{working ? "準備與核對中…" : `準備圖片並核對 ${validRows.length} 個 SKU`}</button>}
      {working && <p role="status">準備與核對中，請保留這個工作區。</p>}
      {attempted && !submitted.current && (!batch || batch.phase === "ready") && <button type="button" disabled={busy || !supported || !validRows.length} onClick={() => prepare(true)}>重新準備並核對</button>}
    </>}
    {batch && rows.length === 0 && <div className="image-folder-table image-folder-recovered" tabIndex={0} aria-label="先前圖片更新進度"><table>
      <thead><tr><th scope="col">SKU／ASIN</th><th scope="col">送出圖片</th><th scope="col">狀況</th></tr></thead>
      <tbody>{batch.rows.map(row => <tr key={row.sellerSku} data-state={row.state}><td><strong>{row.sellerSku}</strong><small>{row.asin ?? "ASIN 尚未確認"}</small></td>
        <td>{row.acceptedAt ? `${row.requestedUrls.filter(Boolean).length} 張` : "沒有可核對的接受紀錄"}</td>
        <td aria-live="polite"><strong>{ROW_LABELS[row.state]}</strong>{row.message && <p>{row.message}</p>}{showReadbackReasons && row.readbackDiagnostics && <ReadbackReasons diagnostics={row.readbackDiagnostics} sellerSku={row.sellerSku} state={row.state} />}</td></tr>)}</tbody>
    </table></div>}
    {(checking || batch?.phase === "readback") && <p role="status">{readbackSupported ? "正在唯讀回查 Amazon 圖片，請稍候…" : "正在讀取圖片更新進度，請稍候…"}</p>}
    {batch && <div className="image-folder-confirmation">
      <p role="status">{batch.message ?? (batch.phase === "ready" ? `核對通過 ${batch.totals.ready} 個 SKU，待修正 ${batch.totals.blocked} 個。` : `已送出 ${batch.totals.submitted}／${batch.totals.skus} · Amazon 已接受 ${batch.totals.accepted} · 回查確認 ${batch.totals.verified}`)}</p>
      {batch.phase === "ready" && !awaitingResult && <><p>本次核對有效至 {new Date(batch.expiresAt).toLocaleString("zh-TW")}；每張圖片送出時仍須保留超過十分鐘的有效期。</p><label><input type="checkbox" aria-label="確認本批圖片變更" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />{batch.replacementMode === "selected-slots" ? "我已核對每個 SKU 的指定圖片位置，其他位置全部保留，只更新核對通過的 SKU。" : "我已核對完整圖片組與列出的舊圖清除項目，只更新核對通過的 SKU。"}</label>
        <button type="button" className="price-primary-button" disabled={busy || !acknowledged || !batch.totals.ready || Date.parse(batch.expiresAt) <= now} onClick={submit}>一次指紋確認並更新 {batch.totals.ready} 個 SKU</button>
        {Date.parse(batch.expiresAt) <= now && <p role="status">核對已到期，請使用「重新準備並核對」；原檔仍保留，尚未送出 Amazon 更新。</p>}</>}
      {batch.lastReadbackAt && <p>最近回查：{new Date(batch.lastReadbackAt).toLocaleString("zh-TW")}</p>}
      {(batch.phase !== "ready" || awaitingResult) && <button type="button" disabled={working || checking || (active && !observationPaused)} onClick={() => observe(true)}>重新讀取本批次進度</button>}
      {(active || awaitingResult) && <p>本批次已交給 Notebook Key；只讀取既有進度，不會重送更新。</p>}
    </div>}
  </section>;
}
