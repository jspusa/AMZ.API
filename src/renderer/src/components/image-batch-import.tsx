import { useMemo, useRef, useState } from "react";

export type ImageUploadOutcome =
  | { ok: true; readyForAmazon: boolean }
  | { ok: false; message: string; stopBatch: boolean };

type Slot = { label: string; editable: boolean; reason: string | null; occupied: boolean; sourceFile: File | null; readyForAmazon: boolean };
type ImportRow = {
  file: File;
  fileOrder: number | null;
  targetSlot: number | null;
  issue: string | null;
  status: "pending" | "uploading" | "applied" | "private" | "failed" | "skipped" | "replaced";
  result?: string;
};

function importRow(file: File, sellerSku: string): ImportRow {
  const row: ImportRow = { file, fileOrder: null, targetSlot: null, issue: null, status: "pending" };
  if (!file.name.startsWith(`${sellerSku}_`)) {
    return { ...row, issue: "品號與目前 Seller SKU 不一致，請核對商品與檔名。" };
  }
  const suffix = file.name.slice(sellerSku.length);
  const parsed = /^_(\d+)_[^/\\\u0000-\u001f\u007f]+\.(?:png|jpe?g)$/iu.exec(suffix);
  if (!parsed || !Number.isSafeInteger(Number(parsed[1])) || Number(parsed[1]) < 1) {
    return { ...row, issue: "檔名需為「目前品號_數字_說明.jpg／png」，請修正檔名後重選。" };
  }
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) {
    return { ...row, issue: "圖片需有內容且不超過 10 MB。" };
  }
  if (file.type && file.type !== "image/jpeg" && file.type !== "image/png") {
    return { ...row, issue: "只接受 JPEG／PNG 圖片；實際格式與像素會再檢查。" };
  }
  return { ...row, fileOrder: Number(parsed[1]), targetSlot: Number(parsed[1]) - 1 };
}

/** Reviews one exact SKU's filename mapping before preparing image assets. */
export default function ImageBatchImport({ files, sellerSku, slots, disabled, upload, onBusyChange, onDismiss, onSelectSlot }: {
  files: readonly File[];
  sellerSku: string;
  slots: readonly Slot[];
  disabled: boolean;
  upload: (file: File, slot: number) => Promise<ImageUploadOutcome>;
  onBusyChange: (busy: boolean) => void;
  onDismiss: () => void;
  onSelectSlot: (slot: number) => void;
}) {
  const [rows, setRows] = useState(() => files.map(file => {
    const row = importRow(file, sellerSku);
    // A retained File belongs to the current draft, including an explicitly
    // chosen position for an unnumbered single image. Do not remap it on reopen.
    const targetSlot = slots.findIndex(slot => slot.sourceFile === file);
    return targetSlot < 0 ? row : {
      ...row, targetSlot, issue: null,
      status: slots[targetSlot].readyForAmazon ? "applied" as const : "private" as const,
    };
  }).sort((left, right) => (left.fileOrder ?? Infinity) - (right.fileOrder ?? Infinity)));
  const [running, setRunning] = useState(false);
  const [stopped, setStopped] = useState(false);
  const runningRef = useRef(false);
  const currentRows = useMemo(() => rows.map(row => {
    if (row.status !== "applied" && row.status !== "private") return row;
    const targetSlot = slots.findIndex(slot => slot.sourceFile === row.file);
    if (targetSlot < 0) return { ...row, status: "replaced" as const, result: "已從草稿移除或被取代；原檔仍保留。" };
    return { ...row, targetSlot, status: slots[targetSlot].readyForAmazon ? "applied" as const : "private" as const };
  }), [rows, slots]);
  const duplicates = useMemo(() => {
    const counts = new Map<number, number>();
    for (const row of currentRows) {
      if ((row.status === "pending" || row.status === "private") && !row.issue && row.targetSlot !== null) counts.set(row.targetSlot, (counts.get(row.targetSlot) ?? 0) + 1);
    }
    return new Set([...counts].filter(([, count]) => count > 1).map(([slot]) => slot));
  }, [currentRows]);
  const issueFor = (row: ImportRow) => row.issue ?? (row.targetSlot === null ? null
    : !slots[row.targetSlot] ? `此商品目前未提供第 ${row.targetSlot + 1} 張；請保留並改選可用位置，或略過此檔。`
    : !slots[row.targetSlot]?.editable ? slots[row.targetSlot].reason ?? "此圖片位置不可編輯，請選擇其他位置。"
    : duplicates.has(row.targetSlot) ? "同一位置有重複檔案，請改位置或略過其中一張。" : null);
  const pending = currentRows.filter(row => (row.status === "pending" || row.status === "private") && row.targetSlot !== null && !issueFor(row));
  const hasFailedRows = currentRows.some(row => row.status === "failed");
  const readyCount = currentRows.filter(row => row.status === "applied").length;
  const privateCount = currentRows.filter(row => row.status === "private").length;
  const update = (index: number, change: Partial<ImportRow>) => setRows(current => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...change } : row));
  const prepareUnfinished = () => {
    if (disabled || runningRef.current) return;
    setRows(currentRows.map(row => row.status === "failed" ? { ...row, status: "pending", result: undefined } : row));
    setStopped(false);
  };
  const apply = async () => {
    if (disabled || runningRef.current || !pending.length || stopped) return;
    runningRef.current = true;
    setRunning(true);
    onBusyChange(true);
    try {
      for (let index = 0; index < currentRows.length; index += 1) {
        const row = currentRows[index];
        if ((row.status !== "pending" && row.status !== "private") || row.targetSlot === null || issueFor(row)) continue;
        update(index, { status: "uploading" });
        let result: ImageUploadOutcome;
        try { result = await upload(row.file, row.targetSlot); }
        catch { result = { ok: false, message: "圖片處理結果不明，已停止本批次；原檔仍保留，請核對後繼續準備。", stopBatch: true }; }
        if (result.ok) update(index, { status: result.readyForAmazon ? "applied" : "private" });
        else {
          update(index, { status: "failed", result: result.message });
          if (result.stopBatch) { setStopped(true); break; }
        }
      }
    } finally {
      runningRef.current = false;
      setRunning(false);
      onBusyChange(false);
    }
  };
  return <section className="image-batch-import" aria-label="批次圖片對照">
    <div className="image-batch-heading"><div><strong>檔名對照 · {sellerSku}</strong><p>依檔名數字排序；01 是主圖，02–10 是副圖，實際可用位置依商品規格。套用後可再調整，Amazon 更新仍需安全預檢與確認。</p></div>
      <button type="button" disabled={running || disabled} onClick={onDismiss}>收起對照</button></div>
    <div className="image-batch-table"><table>
      <thead><tr><th scope="col">檔案</th><th scope="col">圖片位置</th><th scope="col">處理結果</th><th scope="col">選擇</th></tr></thead>
      <tbody>{currentRows.map((row, index) => <tr key={index}>
        <td>{row.file.name}{row.fileOrder !== null && <small>原檔第 {row.fileOrder} 張</small>}</td>
        <td><select aria-label={`圖片位置：${row.file.name}`} value={row.targetSlot ?? ""}
          disabled={disabled || running || row.status !== "pending" || Boolean(row.issue)}
          onChange={event => update(index, { targetSlot: event.target.value === "" ? null : Number(event.target.value) })}>
          {row.targetSlot === null && <option value="">未對應</option>}
          {row.targetSlot !== null && !slots[row.targetSlot] && <option value={row.targetSlot}>第 {row.targetSlot + 1} 張（目前未提供）</option>}
          {slots.map((slot, slotIndex) => <option value={slotIndex} key={slotIndex} disabled={!slot.editable}>{slotIndex + 1} · {slot.label}</option>)}
        </select>{(row.status === "pending" || row.status === "private") && row.targetSlot !== null && !issueFor(row) && <small>{slots[row.targetSlot]?.occupied ? "取代目前圖片" : "新增圖片"}</small>}</td>
        <td role="status">{row.status === "pending" ? (issueFor(row) ? `⚠ ${issueFor(row)}` : "★ 已對應，待套用")
          : row.status === "applied" ? "★ 已套用至草稿"
          : row.status === "private" ? "★ 已暫存，待提供公開網址"
          : row.status === "uploading" ? "檢查與上傳中…"
          : row.status === "skipped" ? "已略過"
          : `⚠ ${row.result}`}</td>
        <td>{(row.status === "applied" || row.status === "private") && row.targetSlot !== null && <button type="button" disabled={running || disabled} aria-label={`查看位置：${row.file.name}`} onClick={() => onSelectSlot(row.targetSlot!)}>查看位置</button>}{row.status === "replaced" && <button type="button" disabled={running || disabled} aria-label={`重新準備：${row.file.name}`} onClick={() => update(index, { status: "pending", result: undefined })}>重新準備</button>}{(row.status === "pending" || row.status === "failed") && <button type="button" disabled={running || disabled} onClick={() => update(index, { status: "skipped" })} aria-label={`略過：${row.file.name}`}>略過</button>}</td>
      </tr>)}</tbody>
    </table></div>
    {stopped && <p className="price-error" role="alert">本批次已停止，尚未處理的圖片保持原樣；已套用的圖片仍保留。請核對連線與處理結果後繼續準備未完成圖片。</p>}
    {(stopped || hasFailedRows) && <button type="button" disabled={disabled || running} onClick={prepareUnfinished}>重新準備未完成圖片</button>}
    <div className="image-batch-footer"><span role="status">草稿就緒 {readyCount} 張 · 暫存待準備 {privateCount} 張。僅套用已對應且沒有衝突的圖片。</span>
      <button className="price-primary-button" type="button" disabled={disabled || running || stopped || !pending.length} onClick={apply}>
        {running ? "圖片處理中…" : pending.length ? `檢查並套用 ${pending.length} 張` : readyCount ? "草稿已準備" : "請修正或略過未處理圖片"}
      </button></div>
  </section>;
}
