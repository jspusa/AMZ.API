import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type {
  PriceListAmazonRow,
  PriceListAmazonSnapshot,
  PriceListCell,
  PriceListComparison,
  PriceListProductRow,
  PriceListSheet,
  PriceListWorkbook,
} from "../../../shared/price-list";
import { downloadApiWorkbookResponse } from "../api-workbook-download";

type View = "amazon" | "original" | "files";
type DifferenceStatus = "different" | "same" | "unknown";
const statusLabels: Record<DifferenceStatus, string> = {
  different: "★ 有差異",
  same: "☆ 相同",
  unknown: "待確認",
};
const comparisonLabels = {
  changed: "★ 有差異",
  added: "★ 新增",
  removed: "★ 移除",
  duplicate: "待確認：貨號重複",
  unchanged: "☆ 相同",
};
const formatMoney = (value: number | null) =>
  value === null ? "未取得" : `US$ ${value.toFixed(2)}`;

export function priceListAmazonValue(
  field: "standardPrice" | "minimumPrice",
  row: PriceListAmazonRow | undefined,
  snapshot: PriceListAmazonSnapshot | null,
): string {
  const amount = row?.[field];
  if (amount !== null && amount !== undefined) return formatMoney(amount);
  if (field === "minimumPrice" && row?.minimumPriceStatus === "not-set")
    return "Amazon 未設定下限";
  if (!snapshot) return "尚未開始讀取";
  if (row?.status === "unmatched") return "沒有對應的 FBA 商品";
  if (row?.status === "ambiguous") return "Seller SKU 對應不唯一";
  if (snapshot.state === "failed" && !row?.sellerSku) return "本次讀取中斷";
  if (!row && snapshot.state === "running")
    return snapshot.stage === "identifying"
      ? "確認 FBA 商品中"
      : "等候這筆讀取";
  return field === "standardPrice"
    ? "Amazon 未回傳一般售價"
    : "Amazon 未回傳下限設定";
}

function recoveryMessage(snapshot: PriceListAmazonSnapshot): string {
  if (snapshot.errorCode === "PRICE_LIST_OBSERVATION_INTERRUPTED")
    return "本機進度暫時中斷；請按「接回讀取進度」，這只查詢目前結果。";
  if (snapshot.errorCode === "PRICE_LIST_AMAZON_EXPIRED")
    return "本機保留的 Amazon 結果已過期，請按「重新讀取 Amazon」取得新的設定價格。";
  if (snapshot.errorCode === "REPORT_PENDING")
    return "FBA 商品清單仍由 Amazon 準備中。稍後按「重新讀取 Amazon」會接回同一份報表，再查價格。";
  if (
    /AUTH|ACCESS|CREDENTIAL|LWA|TOKEN|UNAUTHORIZED/u.test(
      snapshot.errorCode ?? "",
    )
  )
    return "請返回首頁，在本機安全連線確認 US 帳號及 Listings 讀取權限，再重新讀取 Amazon。";
  if (/THROTTL|RATE_LIMIT/u.test(snapshot.errorCode ?? ""))
    return "Amazon 暫時限制讀取頻率；稍後按「重新讀取 Amazon」，不會修改價格。";
  return "請先查看每筆商品下方的原因，再按「重新讀取 Amazon」。已取得的價格仍保留，未完成項目不會補 0。";
}

class PriceListRequestError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
  }
}

async function response(path: string, init?: RequestInit): Promise<Response> {
  const result = await fetch(path, init);
  if (!result.ok) {
    const body = (await result.json().catch(() => ({}))) as {
      message?: string;
      error?: string;
      code?: string;
    };
    throw new PriceListRequestError(
      result.status === 404 && !body.message
        ? "請先更新 AMZ.API Notebook Key，才能使用價目表。"
        : (body.message ?? body.error ?? "價目表處理未完成。"),
      typeof body.code === "string" ? body.code : null,
    );
  }
  return result;
}
async function json<T>(
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  return (
    await response(
      path,
      body
        ? {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }
        : undefined,
    )
  ).json() as Promise<T>;
}

export function priceListAmazonDifference(
  product: PriceListProductRow,
  amazon: PriceListAmazonRow | undefined,
): DifferenceStatus {
  if (!amazon || amazon.status !== "matched") return "unknown";
  const original = product.cells.standardPrice?.value;
  const minimum = product.cells.minimumPrice?.value;
  const comparableStandard =
    typeof original === "number" && amazon.standardPrice !== null;
  const comparableMinimum =
    typeof minimum === "number" &&
    amazon.minimumPriceStatus === "set" &&
    amazon.minimumPrice !== null;
  if (
    (comparableStandard &&
      Math.abs(original - amazon.standardPrice!) >= 0.005) ||
    (comparableMinimum && Math.abs(minimum - amazon.minimumPrice!) >= 0.005)
  )
    return "different";
  if (comparableStandard && comparableMinimum) return "same";
  return "unknown";
}

function LocalImage({
  id,
  imageId,
  label,
}: {
  id: string;
  imageId: string;
  label: string;
}) {
  const element = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    let started = false;
    const controller = new AbortController();
    const load = () => {
      if (started) return;
      started = true;
      void response(
        `/api/price-list/image?id=${encodeURIComponent(id)}&imageId=${encodeURIComponent(imageId)}`,
        { signal: controller.signal },
      )
        .then((result) => result.blob())
        .then((blob) => {
          if (!active) return;
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        })
        .catch(() => {
          if (active) setFailed(true);
        });
    };
    const observer =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(
            (entries) => {
              if (entries.some((entry) => entry.isIntersecting)) {
                load();
                observer?.disconnect();
              }
            },
            { rootMargin: "250px" },
          )
        : null;
    if (observer && element.current) observer.observe(element.current);
    else load();
    return () => {
      active = false;
      controller.abort();
      observer?.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, imageId]);
  return (
    <span className="price-list-image" ref={element}>
      {url ? (
        <img src={url} alt={label} />
      ) : failed ? (
        <small>圖片未取得</small>
      ) : (
        <small>圖片</small>
      )}
    </span>
  );
}

function OriginalSheet({
  workbook,
  sheet,
  zoom,
  amazonRows,
  replaceImages,
  snapshot,
}: {
  workbook: PriceListWorkbook;
  sheet: PriceListSheet;
  zoom: number;
  amazonRows: Map<string, PriceListAmazonRow>;
  replaceImages: boolean;
  snapshot: PriceListAmazonSnapshot | null;
}) {
  const cells = useMemo(
    () => new Map(sheet.cells.map((cell) => [cell.reference, cell])),
    [sheet],
  );
  const columns = Array.from(
    { length: sheet.columnCount },
    (_, i) => i + 1,
  ).filter((column) => !sheet.hiddenColumns.includes(column));
  const rows = Array.from({ length: sheet.rowCount }, (_, i) => i + 1).filter(
    (row) => !sheet.hiddenRows.includes(row),
  );
  const colName = (column: number) => {
    let result = "";
    for (let n = column; n > 0; n = Math.floor((n - 1) / 26))
      result = String.fromCharCode(65 + ((n - 1) % 26)) + result;
    return result;
  };
  const pairedHeaders = [
    "Amazon 設定售價",
    "Amazon 最低價格設定",
    "售價差額",
    "最低價格差額",
    "比對結果",
  ];
  const showAmazon = snapshot !== null;
  return (
    <div
      className="price-list-sheet-scroll"
      tabIndex={0}
      aria-label={`${sheet.name} 原表，可水平與垂直捲動`}
    >
      <table
        className="price-list-sheet"
        style={
          {
            zoom: zoom / 100,
            width:
              40 +
              columns.reduce(
                (sum, column) => sum + (sheet.columnWidths[column] ?? 90),
                0,
              ) +
              (showAmazon ? 920 : 0),
          } as CSSProperties
        }
      >
        <caption className="sr-only">
          {sheet.name} 原始工作表與 Amazon 價格
        </caption>
        <colgroup>
          <col style={{ width: 40 }} />
          {columns.map((column) => (
            <col
              key={column}
              style={{ width: sheet.columnWidths[column] ?? 90 }}
            />
          ))}
          {showAmazon &&
            pairedHeaders.map((label) => (
              <col
                key={label}
                style={{ width: label === "比對結果" ? 280 : 160 }}
              />
            ))}
        </colgroup>
        <thead>
          <tr>
            <th aria-label="列號" />
            {columns.map((column) => (
              <th key={column}>{colName(column)}</th>
            ))}
            {showAmazon &&
              pairedHeaders.map((label) => <th key={label}>{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const product = workbook.products.find(
              (item) => item.sheetName === sheet.name && item.rowNumber === row,
            );
            const amazon = amazonRows.get(`${sheet.name}\0${row}`);
            const delta = (
              source: PriceListCell | undefined,
              amount: number | null | undefined,
            ) =>
              typeof source?.value === "number" &&
              amount !== null &&
              amount !== undefined
                ? `${amount - source.value >= 0 ? "+" : ""}${(amount - source.value).toFixed(2)}`
                : "—";
            return (
              <tr key={row} style={{ height: sheet.rowHeights[row] ?? 28 }}>
                <th scope="row" className="price-list-row-number">
                  {row}
                </th>
                {columns.map((column) => {
                  const merge = sheet.merges.find(
                    (item) =>
                      row >= item.startRow &&
                      row <= item.endRow &&
                      column >= item.startColumn &&
                      column <= item.endColumn,
                  );
                  if (
                    merge &&
                    (row !== merge.startRow || column !== merge.startColumn)
                  )
                    return null;
                  const reference = `${colName(column)}${row}`;
                  const cell = cells.get(reference);
                  const style = workbook.styles[cell?.styleId ?? 0]!;
                  return (
                    <td
                      key={column}
                      colSpan={
                        merge
                          ? columns.filter(
                              (c) =>
                                c >= merge.startColumn && c <= merge.endColumn,
                            ).length
                          : 1
                      }
                      rowSpan={
                        merge
                          ? rows.filter(
                              (r) => r >= merge.startRow && r <= merge.endRow,
                            ).length
                          : 1
                      }
                      title={`${reference}${cell?.formula ? ` · 公式：=${cell.formula}` : ""}`}
                      style={{
                        color: style.color,
                        background: style.background,
                        fontFamily: style.fontName,
                        fontSize: `${style.fontSize}pt`,
                        fontWeight: style.bold ? 700 : 400,
                        fontStyle: style.italic ? "italic" : "normal",
                        textAlign: style.horizontal,
                        verticalAlign: style.vertical,
                        whiteSpace: style.wrap ? "pre-wrap" : "pre",
                        border: style.border ? "1px solid #8b9199" : undefined,
                      }}
                    >
                      {replaceImages &&
                      amazon?.imageUrl &&
                      product?.cells.image?.column === column ? (
                        <span className="price-list-image">
                          <img
                            src={amazon.imageUrl}
                            alt={`${product.key} Amazon 首圖`}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                          />
                        </span>
                      ) : cell?.imageId ? (
                        <LocalImage
                          id={workbook.id}
                          imageId={cell.imageId}
                          label={`${sheet.name} ${reference} 商品圖片`}
                        />
                      ) : (
                        (cell?.display ?? "")
                      )}
                    </td>
                  );
                })}
                {showAmazon &&
                  (product ? (
                    <>
                      <td className="price-list-sheet-amazon">
                        {priceListAmazonValue(
                          "standardPrice",
                          amazon,
                          snapshot,
                        )}
                      </td>
                      <td className="price-list-sheet-amazon">
                        {priceListAmazonValue("minimumPrice", amazon, snapshot)}
                      </td>
                      <td className="price-list-sheet-amazon">
                        {delta(
                          product.cells.standardPrice,
                          amazon?.standardPrice,
                        )}
                      </td>
                      <td className="price-list-sheet-amazon">
                        {delta(
                          product.cells.minimumPrice,
                          amazon?.minimumPrice,
                        )}
                      </td>
                      <td className="price-list-sheet-amazon">
                        {
                          statusLabels[
                            priceListAmazonDifference(product, amazon)
                          ]
                        }
                        <small>{amazon?.message ?? "尚未讀取 Amazon"}</small>
                      </td>
                    </>
                  ) : (
                    pairedHeaders.map((label) => <td key={label} />)
                  ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function sourcePrice(cell: PriceListCell | undefined): string {
  return !cell || cell.value === null || cell.display === ""
    ? "表上空白"
    : typeof cell.value === "number"
      ? formatMoney(cell.value)
      : cell.display;
}

export default function PriceListPanel({ onClose, active = true }: { onClose: () => void; active?: boolean }) {
  const [base, setBase] = useState<PriceListWorkbook | null>(null);
  const [candidate, setCandidate] = useState<PriceListWorkbook | null>(null);
  const [amazon, setAmazon] = useState<PriceListAmazonSnapshot | null>(null);
  const [comparison, setComparison] = useState<PriceListComparison | null>(
    null,
  );
  const [view, setView] = useState<View>("original");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [search, setSearch] = useState("");
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const [replaceImages, setReplaceImages] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [zoom, setZoom] = useState(85);
  const input = useRef<HTMLInputElement>(null);
  const candidateInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(true);
  const importing = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    if (active) heading.current?.focus();
  }, [active]);
  function resetInvalidSource(reason: unknown): boolean {
    if (
      !(reason instanceof PriceListRequestError) ||
      ![
        "PRICE_LIST_EXPIRED",
        "ACCOUNT_SCOPE_CHANGED",
        "REPORT_MODE_CHANGED",
        "SP_CONTEXT_INVALIDATED",
      ].includes(reason.code ?? "")
    )
      return false;
    generation.current++;
    setBase(null);
    setCandidate(null);
    setAmazon(null);
    setComparison(null);
    setView("original");
    return true;
  }
  const running = amazon?.state === "running";
  const locked = busy || running;
  useEffect(() => {
    if (!base || amazon?.state !== "running") return;
    const revision = generation.current;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = (await (
          await response(
            `/api/price-list/amazon-refresh?id=${encodeURIComponent(base.id)}`,
            { signal: controller.signal },
          )
        ).json()) as PriceListAmazonSnapshot;
        if (!mounted.current || revision !== generation.current) return;
        setAmazon(next);
        if (next.state === "complete" || next.state === "failed")
          setView("amazon");
        if (next.state === "running")
          timeout = setTimeout(() => void poll(), 2_500);
      } catch (reason) {
        if (
          controller.signal.aborted ||
          !mounted.current ||
          revision !== generation.current
        )
          return;
        if (!resetInvalidSource(reason)) {
          setAmazon((old) =>
            old
              ? {
                  ...old,
                  state: "failed",
                  errorCode:
                    reason instanceof PriceListRequestError
                      ? (reason.code ?? "PRICE_LIST_OBSERVATION_INTERRUPTED")
                      : "PRICE_LIST_OBSERVATION_INTERRUPTED",
                  message:
                    reason instanceof PriceListRequestError
                      ? reason.message
                      : "狀態讀取中斷；已取得的資料保留，尚未確認全部完成。",
                }
              : old,
          );
          setView("amazon");
        }
        setError(reason instanceof Error ? reason.message : "讀取未完成。");
      }
    };
    timeout = setTimeout(() => void poll(), 1_500);
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [base?.id, amazon?.state]);

  async function run(action: () => Promise<void>) {
    if (importing.current) return;
    importing.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      if (mounted.current) {
        if (
          !resetInvalidSource(reason) &&
          reason instanceof PriceListRequestError &&
          reason.code === "PRICE_LIST_AMAZON_EXPIRED"
        ) {
          setAmazon((old) =>
            old
              ? {
                  ...old,
                  state: "failed",
                  errorCode: reason.code,
                  message: reason.message,
                }
              : old,
          );
        }
        setError(reason instanceof Error ? reason.message : "處理未完成。");
      }
    } finally {
      importing.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function importFile(
    file: File | undefined,
    role: "base" | "candidate",
  ) {
    if (!file || locked) return;
    await run(async () => {
      if (!/\.xlsx$/iu.test(file.name) || file.size > 25 * 1024 * 1024)
        throw new Error("請選擇 25 MB 以下的 .xlsx 檔案。");
      const form = new FormData();
      form.append("file", file);
      const book = (await (
        await response("/api/price-list/import", { method: "POST", body: form })
      ).json()) as PriceListWorkbook;
      if (!mounted.current) return;
      generation.current++;
      if (role === "base") {
        setBase(book);
        setSheetName(
          book.sheets.find((sheet) => !sheet.hidden)?.name ??
            book.sheets[0]?.name ??
            "",
        );
        setAmazon(null);
        setComparison(null);
        setCandidate(null);
        setView("original");
      } else if (base) {
        setCandidate(book);
        setComparison(
          await json<PriceListComparison>("/api/price-list/compare", {
            baseId: base.id,
            candidateId: book.id,
          }),
        );
        setView("files");
      }
    });
  }
  const sheets =
    base?.sheets.filter((sheet) => showHidden || !sheet.hidden) ?? [];
  const sheet = sheets.find((item) => item.name === sheetName) ?? sheets[0];
  const amazonRows = useMemo(
    () =>
      new Map(
        (amazon?.rows ?? []).map((row) => [
          `${row.sheetName}\0${row.rowNumber}`,
          row,
        ]),
      ),
    [amazon?.rows],
  );
  const query = search.toLocaleLowerCase();
  const products = (base?.products ?? []).filter(
    (product) =>
      (showHidden ||
        !base?.sheets.find((item) => item.name === product.sheetName)
          ?.hidden) &&
      `${product.key} ${product.asin ?? ""} ${product.cells.title?.display ?? ""} ${product.sheetName}`
        .toLocaleLowerCase()
        .includes(query),
  );
  const visibleProducts = products.filter(
    (product) =>
      !onlyDifferences ||
      priceListAmazonDifference(
        product,
        amazonRows.get(`${product.sheetName}\0${product.rowNumber}`),
      ) !== "same",
  );
  const differenceRows = (comparison?.rows ?? []).filter(
    (row) =>
      row.key.toLocaleLowerCase().includes(query) &&
      (!onlyDifferences || row.status !== "unchanged"),
  );
  const counts = products.reduce(
    (all, product) => {
      all[
        priceListAmazonDifference(
          product,
          amazonRows.get(`${product.sheetName}\0${product.rowNumber}`),
        )
      ]++;
      return all;
    },
    { different: 0, same: 0, unknown: 0 },
  );
  const priceCount =
    amazon?.rows.filter(
      (row) => row.standardPrice !== null || row.minimumPrice !== null,
    ).length ?? 0;
  const readFinished = amazon?.state === "complete";
  return (
    <section
      className="price-list-workspace"
      aria-labelledby="price-list-title"
    >
      <header className="price-list-heading">
        <div>
          <p className="eyebrow">PRIVATE PRICE LIST · US</p>
          <h2 id="price-list-title" tabIndex={-1} ref={heading}>
            價目表與 Amazon 比對
          </h2>
          <p>保留你的原表、圖片與價格，直接核對 Amazon 售價及最低價格設定。</p>
        </div>
        <button type="button" onClick={onClose}>
          ← 返回首頁
        </button>
      </header>
      <input
        className="price-list-file-input"
        ref={input}
        type="file"
        accept=".xlsx"
        aria-label="選取原始價目表"
        onChange={(event) => {
          void importFile(event.target.files?.[0], "base");
          event.currentTarget.value = "";
        }}
      />
      <input
        className="price-list-file-input"
        ref={candidateInput}
        type="file"
        accept=".xlsx"
        aria-label="選取另一份價目表"
        onChange={(event) => {
          void importFile(event.target.files?.[0], "candidate");
          event.currentTarget.value = "";
        }}
      />
      <div
        className={`price-list-import ${base ? "has-file" : ""}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void importFile(event.dataTransfer.files[0], "base");
        }}
      >
        <div>
          <strong>{base?.fileName ?? "先放入你的原始價目表"}</strong>
          <p>
            {base
              ? `${base.sheets.length} 個工作表 · ${base.products.length} 列商品 · ${base.imageCount} 張儲存格圖片 · ${(base.byteLength / 1024 / 1024).toFixed(1)} MB`
              : "選取或拖入 .xlsx；檔案留在本機，圖片、原價、格式及公式都會保留。"}
          </p>
        </div>
        <button
          type="button"
          className={base ? undefined : "price-list-primary"}
          disabled={locked}
          onClick={() => input.current?.click()}
        >
          {base ? "換一份原表" : "選取原始價目表"}
        </button>
      </div>
      {error && (
        <p className="price-list-error" role="alert">
          {error}
        </p>
      )}
      {base && (
        <>
          <ol className="price-list-steps" aria-label="價目表操作進度">
            <li className="done">
              <b>1</b>
              <span>
                放入原表<small>已保留原檔</small>
              </span>
            </li>
            <li className={readFinished ? "done" : "current"}>
              <b>2</b>
              <span>
                讀取 Amazon
                <small>
                  {running
                    ? amazon.stage === "identifying"
                      ? "確認 FBA 商品中"
                      : `${amazon.completed} / ${amazon.total} 列`
                    : readFinished
                      ? `${priceCount} 列有價格`
                      : amazon?.state === "failed"
                        ? "讀取中斷，請處理原因"
                        : "下一步"}
                </small>
              </span>
            </li>
            <li className={readFinished ? "current" : ""}>
              <b>3</b>
              <span>
                核對差異<small>表上與 Amazon 並排</small>
              </span>
            </li>
            <li>
              <b>4</b>
              <span>
                下載比對表<small>確認後才下載</small>
              </span>
            </li>
          </ol>
          <div className="price-list-actions">
            <button
              type="button"
              className={readFinished ? undefined : "price-list-primary"}
              disabled={locked}
              onClick={() =>
                void run(async () => {
                  generation.current++;
                  setAmazon(
                    await json<PriceListAmazonSnapshot>(
                      amazon?.errorCode === "PRICE_LIST_OBSERVATION_INTERRUPTED"
                        ? `/api/price-list/amazon-refresh?id=${encodeURIComponent(base.id)}`
                        : "/api/price-list/amazon-refresh",
                      amazon?.errorCode === "PRICE_LIST_OBSERVATION_INTERRUPTED"
                        ? undefined
                        : { id: base.id },
                    ),
                  );
                  setView("amazon");
                })
              }
            >
              {running
                ? `Amazon 讀取 ${amazon.completed} / ${amazon.total}`
                : amazon?.errorCode === "PRICE_LIST_OBSERVATION_INTERRUPTED"
                  ? "接回讀取進度"
                  : amazon
                    ? "重新讀取 Amazon"
                    : "2. 讀取 Amazon 價格與首圖"}
            </button>
            <p>
              {!amazon
                ? "選完原表還沒有查 Amazon；請先按「讀取 Amazon」按鈕。"
                : running
                  ? "正在背景讀取，可以先查看原表。"
                  : `全部工作表 ${amazon.completed} / ${amazon.total} 列已處理，${priceCount} 列取得價格，${amazon.total - priceCount} 列沒有價格。`}
            </p>
          </div>
          <details className="price-list-secondary-actions">
            <summary>原檔備份與其他檔案比對</summary>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () =>
                  downloadApiWorkbookResponse(
                    await response(
                      `/api/price-list/export?id=${encodeURIComponent(base.id)}`,
                    ),
                    base.fileName,
                  ),
                )
              }
            >
              下載原檔備份（沒有 Amazon 資料）
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={() => {
                setView("files");
                candidateInput.current?.click();
              }}
            >
              選另一份 Excel 比較檔案差異
            </button>
          </details>
          {amazon && (
            <div
              className={`price-list-progress ${amazon.state}`}
              role="status"
            >
              <strong>
                {amazon.state === "running"
                  ? `讀取中 ${amazon.completed} / ${amazon.total}`
                  : amazon.state === "failed"
                    ? "讀取未完成"
                    : `讀取完成 ${amazon.completed} / ${amazon.total}`}
              </strong>
              <span>{amazon.message}</span>
              {amazon.state === "failed" && (
                <p className="price-list-recovery">{recoveryMessage(amazon)}</p>
              )}
              {amazon.fetchedAt && (
                <small>
                  {new Date(amazon.fetchedAt).toLocaleString("zh-TW")}
                </small>
              )}
              {amazon.state === "complete" && priceCount === 0 && (
                <p className="price-list-recovery">
                  本次沒有取得任何 Amazon 價格。請到「Amazon
                  價格比對」查看商品名稱下方的原因；此時尚不能下載價格比對結果。
                </p>
              )}
            </div>
          )}
          <nav className="price-list-tabs" aria-label="價目表檢視">
            {(
              [
                ["amazon", "Amazon 價格比對"],
                ["original", "原表檢視"],
                ["files", "兩份 Excel 比對"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={view === key}
                onClick={() => setView(key)}
              >
                {label}
              </button>
            ))}
          </nav>
          <label className="price-list-image-choice">
            <input
              type="checkbox"
              checked={replaceImages}
              onChange={(event) => setReplaceImages(event.target.checked)}
              disabled={busy}
            />
            比對表改用 Amazon 首圖<small>未取得首圖的商品保留原圖</small>
          </label>
          {view !== "original" && (
            <div className="price-list-filters">
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜尋貨號、Seller SKU、ASIN 或品名"
                aria-label="搜尋價目表商品"
              />
              <label>
                <input
                  type="checkbox"
                  checked={onlyDifferences}
                  onChange={(event) => setOnlyDifferences(event.target.checked)}
                />
                只看差異與待確認
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={showHidden}
                  onChange={(event) => setShowHidden(event.target.checked)}
                />
                含隱藏工作表
              </label>
            </div>
          )}
          {view === "original" && (
            <>
              <div className="price-list-filters">
                <label>
                  工作表
                  <select
                    value={sheet?.name ?? ""}
                    onChange={(event) => setSheetName(event.target.value)}
                  >
                    {sheets.map((item) => (
                      <option key={item.name} value={item.name}>
                        {item.name}
                        {item.hidden ? "（隱藏）" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  縮放
                  <select
                    value={zoom}
                    onChange={(event) => setZoom(Number(event.target.value))}
                  >
                    {[60, 75, 85, 100, 125].map((value) => (
                      <option key={value} value={value}>
                        {value}%
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={showHidden}
                    onChange={(event) => setShowHidden(event.target.checked)}
                  />
                  顯示隱藏工作表
                </label>
              </div>
              {sheet && (
                <OriginalSheet
                  workbook={base}
                  sheet={sheet}
                  zoom={zoom}
                  amazonRows={amazonRows}
                  replaceImages={replaceImages}
                  snapshot={amazon}
                />
              )}
              <p className="price-list-note">
                原表檢視保留欄寬、列高、合併儲存格、基本樣式與儲存格圖片。滑鼠停在儲存格可看公式；原檔下載完整保留
                Excel 原生功能。
              </p>
            </>
          )}
          {view === "amazon" && (
            <>
              <div className="price-list-summary">
                <span>
                  ★ 有差異 <strong>{counts.different}</strong>
                </span>
                <span>
                  ☆ 相同 <strong>{counts.same}</strong>
                </span>
                <span>
                  {amazon
                    ? running
                      ? "等候讀取／待確認"
                      : "待確認"
                    : "尚未讀取"}{" "}
                  <strong>{counts.unknown}</strong>
                </span>
                <span>
                  顯示 <strong>{visibleProducts.length}</strong> 列
                </span>
              </div>
              <p className="price-list-note">
                最低活動價是你的促銷參考；Amazon
                最低價格設定是平台價格下限。兩者分欄比對，未設定及未取得都不當作
                0。
              </p>
              <div className="price-list-table-scroll">
                <table className="price-list-comparison">
                  <caption className="sr-only">
                    表上價格與 US Amazon 設定比較
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">商品 / 原表位置</th>
                      <th scope="col">
                        {replaceImages ? "Amazon 首圖" : "原表圖片"}
                      </th>
                      <th scope="col">表上標準定價</th>
                      <th scope="col">Amazon 設定售價</th>
                      <th scope="col">表上最低活動價</th>
                      <th scope="col">Amazon 最低價格設定</th>
                      <th scope="col">比對結果</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleProducts.map((product) => {
                      const item = amazonRows.get(
                        `${product.sheetName}\0${product.rowNumber}`,
                      );
                      const status = priceListAmazonDifference(product, item);
                      return (
                        <tr
                          key={`${product.sheetName}-${product.rowNumber}`}
                          className={`price-list-${status}`}
                        >
                          <th scope="row">
                            <strong>{product.key}</strong>
                            <span>{product.cells.title?.display}</span>
                            <small>
                              {product.sheetName}!{product.rowNumber} ·{" "}
                              {product.asin ?? "無 ASIN"}
                            </small>
                            {item?.sellerSku && (
                              <small>Seller SKU：{item.sellerSku}</small>
                            )}
                            {item?.status !== "matched" && (
                              <small className="price-list-row-reason">
                                {item?.message ??
                                  (!amazon
                                    ? "尚未開始讀取；請先完成第 2 步。"
                                    : running
                                      ? amazon.stage === "identifying"
                                        ? "正在取得 FBA 商品清單，尚未開始逐 SKU 查價。"
                                        : "等候這筆商品讀取。"
                                      : amazon.message)}
                              </small>
                            )}
                          </th>
                          <td>
                            {replaceImages && item?.imageUrl ? (
                              <span className="price-list-image">
                                <img
                                  src={item.imageUrl}
                                  alt={`${product.key} Amazon 首圖`}
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                />
                              </span>
                            ) : product.cells.image?.imageId ? (
                              <LocalImage
                                id={base.id}
                                imageId={product.cells.image.imageId}
                                label={`${product.key} 原表圖片`}
                              />
                            ) : (
                              <small>
                                {replaceImages ? "首圖未取得" : "無圖片"}
                              </small>
                            )}
                          </td>
                          <td>
                            {sourcePrice(product.cells.standardPrice)}
                            <small>
                              {product.cells.standardPrice?.reference}
                            </small>
                          </td>
                          <td className="price-list-amazon-value">
                            {priceListAmazonValue(
                              "standardPrice",
                              item,
                              amazon,
                            )}
                          </td>
                          <td>
                            {sourcePrice(product.cells.minimumPrice)}
                            <small>
                              {product.cells.minimumPrice?.reference}
                            </small>
                          </td>
                          <td className="price-list-amazon-value">
                            {priceListAmazonValue("minimumPrice", item, amazon)}
                          </td>
                          <td>
                            <strong>{statusLabels[status]}</strong>
                            <small>
                              {item?.message ??
                                (!amazon
                                  ? "尚未開始讀取"
                                  : running
                                    ? "等候這筆商品讀取"
                                    : amazon.message)}
                            </small>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!visibleProducts.length && (
                <p className="price-list-empty">
                  目前篩選沒有商品。請調整搜尋或工作表範圍。
                </p>
              )}
            </>
          )}
          {view === "files" && (
            <>
              <div className="price-list-file-compare">
                <div>
                  <strong>
                    {candidate?.fileName ??
                      "放入另一份價目表，核對檔案之間的差異"}
                  </strong>
                  <p>
                    以貨號 / Seller SKU
                    精確配對，列出價格、文字、公式、新增、移除和重複貨號。
                  </p>
                </div>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => candidateInput.current?.click()}
                >
                  選取另一份 Excel
                </button>
              </div>
              {comparison && (
                <>
                  <div className="price-list-summary">
                    {Object.entries(comparison.counts).map(
                      ([status, count]) => (
                        <span key={status}>
                          {
                            comparisonLabels[
                              status as keyof typeof comparisonLabels
                            ]
                          }{" "}
                          <strong>{count}</strong>
                        </span>
                      ),
                    )}
                  </div>
                  <div className="price-list-table-scroll">
                    <table className="price-list-comparison">
                      <thead>
                        <tr>
                          {[
                            "貨號 / SKU",
                            "結果",
                            "欄位",
                            "原表",
                            "另一份 Excel",
                            "差額",
                          ].map((label) => (
                            <th key={label}>{label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {differenceRows.flatMap((row) =>
                          (row.fields.length
                            ? row.fields
                            : [
                                {
                                  field: "整列",
                                  before: row.beforeLocation ?? "無此商品",
                                  after: row.afterLocation ?? "無此商品",
                                  beforeCell: null,
                                  afterCell: null,
                                  delta: null,
                                },
                              ]
                          ).map((field, index) => (
                            <tr key={`${row.key}-${index}`}>
                              <th scope="row">{row.key}</th>
                              <td>{comparisonLabels[row.status]}</td>
                              <td>{field.field}</td>
                              <td>
                                {field.before}
                                <small>{field.beforeCell}</small>
                              </td>
                              <td>
                                {field.after}
                                <small>{field.afterCell}</small>
                              </td>
                              <td>
                                {field.delta === null
                                  ? "—"
                                  : `${field.delta > 0 ? "+" : ""}${field.delta}`}
                              </td>
                            </tr>
                          )),
                        )}
                      </tbody>
                    </table>
                  </div>
                  {comparison.warnings.map((warning) => (
                    <p key={warning} className="price-list-note">
                      {warning}
                    </p>
                  ))}
                </>
              )}
            </>
          )}
          {readFinished && view !== "files" && (
            <section className="price-list-download" aria-label="下載比對結果">
              <div>
                <h3>4. 下載你剛核對的比對表</h3>
                <p>
                  原表價格保留，右側附上 Amazon 價格、下限、差額及讀取結果。
                </p>
              </div>
              <button
                type="button"
                className="price-list-primary"
                disabled={locked || priceCount === 0}
                onClick={() =>
                  void run(async () =>
                    downloadApiWorkbookResponse(
                      await response("/api/price-list/amazon-export", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ id: base.id, replaceImages }),
                      }),
                      "AMZ_US_Amazon_Comparison.xlsx",
                    ),
                  )
                }
              >
                下載已核對的 Amazon 比對表
              </button>
            </section>
          )}
          <details className="price-list-details">
            <summary>檔案保留與比對說明</summary>
            {base.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
            <p>
              「一模一樣的原表」直接下載原始位元組。「Amazon
              比對價目表」保留所有原欄位，在每頁右側增加兩個 Amazon
              價格、兩項差額、核對結果及讀取時間。勾選替換首圖時，只使用已取得的
              Amazon 商品首圖。
            </p>
            <p>只讀 Amazon；這個頁面不修改 Amazon 價格或商品。</p>
            <button
              type="button"
              disabled={locked}
              onClick={() =>
                void run(async () => {
                  await json("/api/price-list/clear", {});
                  generation.current++;
                  setBase(null);
                  setCandidate(null);
                  setAmazon(null);
                  setComparison(null);
                })
              }
            >
              清除本次所有價目表資料
            </button>
          </details>
        </>
      )}
    </section>
  );
}
