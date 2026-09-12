import { useMemo, useRef, useState } from "react";

export type ImageUploadOutcome =
  | { ok: true; readyForAmazon: boolean }
  | { ok: false; message: string; stopBatch: boolean };

type Slot = { label: string; editable: boolean; occupied: boolean };
type ImportRow = {
  file: File;
  slot: number | null;
  issue: string | null;
  status: "pending" | "uploading" | "applied" | "private" | "failed" | "skipped";
  result?: string;
};

function importRow(file: File, sellerSku: string): ImportRow {
  const row: ImportRow = { file, slot: null, issue: null, status: "pending" };
  if (!file.name.startsWith(`${sellerSku}_`)) {
    return { ...row, issue: "品號與目前 Seller SKU 不一致，請核對商品與檔名。" };
  }
  const suffix = file.name.slice(sellerSku.length);
  const parsed = /^_(0[1-9])_[^/\\\u0000-\u001f\u007f]+\.(?:png|jpe?g)$/iu.exec(suffix);
  if (!parsed) {
    return { ...row, issue: "檔名需為「目前品號_01–09_說明.jpg／png」，請修正檔名後重選。" };
  }
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) {
    return { ...row, issue: "圖片需有內容且不超過 10 MB。" };
  }
  if (file.type && file.type !== "image/jpeg" && file.type !== "image/png") {
    return { ...row, issue: "只接受 JPEG／PNG 圖片；實際格式與像素會再檢查。" };
  }
  return { ...row, slot: Number(parsed[1]) - 1 };
}

/** Reviews one exact SKU's filename mapping before applying local/R2 assets. */
export default function ImageBatchImport({ files, sellerSku, slots, disabled, upload, onBusyChange, onDismiss }: {
  files: readonly File[];
  sellerSku: string;
  slots: readonly Slot[];
  disabled: boolean;
  upload: (file: File, slot: number) => Promise<ImageUploadOutcome>;
  onBusyChange: (busy: boolean) => void;
  onDismiss: () => void;
}) {
  const [rows, setRows] = useState(() => files.map(file => importRow(file, sellerSku)));
  const [running, setRunning] = useState(false);
  const [stopped, setStopped] = useState(false);
  const runningRef = useRef(false);
  const duplicates = useMemo(() => {
    const counts = new Map<number, number>();
    for (const row of rows) {
      if (row.status === "pending" && !row.issue && row.slot !== null) counts.set(row.slot, (counts.get(row.slot) ?? 0) + 1);
    }
    return new Set([...counts].filter(([, count]) => count > 1).map(([slot]) => slot));
  }, [rows]);
  const issueFor = (row: ImportRow) => row.issue ?? (row.slot === null ? null
    : !slots[row.slot]?.editable ? "此圖片位置不可編輯，請選擇其他位置。"
    : duplicates.has(row.slot) ? "同一位置有重複檔案，請改位置或略過其中一張。" : null);
  const pending = rows.filter(row => row.status === "pending" && row.slot !== null && !issueFor(row));
  const update = (index: number, change: Partial<ImportRow>) => setRows(current => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...change } : row));
  const apply = async () => {
    if (disabled || runningRef.current || !pending.length || stopped) return;
    runningRef.current = true;
    setRunning(true);
    onBusyChange(true);
    try {
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        if (row.status !== "pending" || row.slot === null || issueFor(row)) continue;
        update(index, { status: "uploading" });
        let result: ImageUploadOutcome;
        try { result = await upload(row.file, row.slot); }
        catch { result = { ok: false, message: "圖片處理結果不明，已停止本批次；請核對後重新選檔。", stopBatch: true }; }
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
    <div className="image-batch-heading"><div><strong>檔名對照 · {sellerSku}</strong><p>01 是主圖，02–09 是副圖。套用後可再調整，Amazon 更新仍需安全預檢與確認。</p></div>
      <button type="button" disabled={running || disabled} onClick={onDismiss}>收起對照</button></div>
    <div className="image-batch-table"><table>
      <thead><tr><th scope="col">檔案</th><th scope="col">圖片位置</th><th scope="col">處理結果</th><th scope="col">選擇</th></tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index}>
        <td>{row.file.name}</td>
        <td><select aria-label={`圖片位置：${row.file.name}`} value={row.slot ?? ""}
          disabled={disabled || running || row.status !== "pending" || Boolean(row.issue)}
          onChange={event => update(index, { slot: event.target.value === "" ? null : Number(event.target.value) })}>
          {row.slot === null && <option value="">未對應</option>}
          {slots.map((slot, slotIndex) => <option value={slotIndex} key={slotIndex} disabled={!slot.editable}>{slotIndex + 1} · {slot.label}</option>)}
        </select>{row.status === "pending" && row.slot !== null && !issueFor(row) && <small>{slots[row.slot]?.occupied ? "取代目前圖片" : "新增圖片"}</small>}</td>
        <td role="status">{row.status === "pending" ? (issueFor(row) ? `⚠ ${issueFor(row)}` : "★ 已對應，待套用")
          : row.status === "applied" ? "★ 已套用至草稿"
          : row.status === "private" ? "★ 已暫存，待提供公開網址"
          : row.status === "uploading" ? "檢查與上傳中…"
          : row.status === "skipped" ? "已略過"
          : `⚠ ${row.result}`}</td>
        <td>{row.status === "pending" && <button type="button" disabled={running || disabled} onClick={() => update(index, { status: "skipped" })} aria-label={`略過：${row.file.name}`}>略過</button>}</td>
      </tr>)}</tbody>
    </table></div>
    {stopped && <p className="price-error" role="alert">本批次已停止，尚未處理的圖片保持原樣；已套用的圖片仍保留。請核對連線與處理結果後重新選檔。</p>}
    <div className="image-batch-footer"><span>僅套用已對應且沒有衝突的圖片。</span>
      <button className="price-primary-button" type="button" disabled={disabled || running || stopped || !pending.length} onClick={apply}>
        {running ? "圖片處理中…" : `檢查並套用 ${pending.length} 張`}
      </button></div>
  </section>;
}
