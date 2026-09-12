import { randomUUID } from "node:crypto";
import { createGeneratedPriceListWorkbook } from "./price-list-generated-workbook";
import { validatePriceListImageReplacement } from "./price-list-workbook";
import type { ApiRequest, ApiResponse } from "../shared/contracts";
import type {
  PriceListAmazonRow,
  PriceListAmazonSnapshot,
  PriceListProductRow,
} from "../shared/price-list";
import {
  priceListAmazonImageUrl,
  type PriceListListingFacts,
} from "./amazon/price-list-reads";
import {
  SpExecutionContextError,
  type SpExecutionContext,
  type SpExecutionContextAdapter,
} from "./amazon/sp-execution-context";
import { publicSpApiError, SpApiError } from "./amazon/sp-api-error";
import { throwIfAborted, waitForPromiseWithSignal } from "./abort-utils";
import { bodyRecord } from "./route-input";
import { invalid, json } from "./route-response";

const US = "ATVPDKIKX0DER" as const;
type ImageReplacement = {
  sheetName: string;
  rowNumber: number;
  bytes: Uint8Array;
  mediaType: "image/png" | "image/jpeg";
};
type Job = {
  context: SpExecutionContext;
  controller: AbortController;
  snapshot: PriceListAmazonSnapshot;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
};
type Dependencies = {
  context: SpExecutionContextAdapter;
  products(id: string): readonly PriceListProductRow[];
  fba(
    context: SpExecutionContext,
    signal: AbortSignal,
  ): Promise<readonly { sellerSku: string; asin: string }[]>;
  listing(input: {
    marketplaceId: typeof US;
    sellerSku: string;
    asin: string;
    signal: AbortSignal;
  }): Promise<PriceListListingFacts>;
  export(
    id: string,
    rows: PriceListAmazonRow[],
    images: ImageReplacement[],
  ): Uint8Array;
  image?: typeof downloadPriceListImage;
  now?: () => number;
};

function matchProduct(
  product: PriceListProductRow,
  identities: readonly { sellerSku: string; asin: string }[],
) {
  const bySku = identities.filter((item) => item.sellerSku === product.key);
  // 貨號 is not an alias for Seller SKU. A product code needs its own exact ASIN proof.
  const matches =
    product.keyKind === "seller-sku"
      ? bySku
      : product.asin
        ? identities.filter((item) => item.asin === product.asin)
        : [];
  if (matches.length !== 1)
    return {
      status: matches.length ? ("ambiguous" as const) : ("unmatched" as const),
      identity: null,
    };
  if (product.asin && matches[0]!.asin !== product.asin)
    return { status: "ambiguous" as const, identity: null };
  return { status: "matched" as const, identity: matches[0]! };
}

/** A bounded local observation job. There is deliberately no Amazon write port. */
export class PriceListAmazon {
  private readonly jobs = new Map<string, Job>();
  private revision = 0;
  private exporting = false;
  private readonly now: () => number;
  constructor(private readonly dependencies: Dependencies) {
    this.now = dependencies.now ?? Date.now;
  }
  private active(id: string): Job {
    const job = this.jobs.get(id);
    if (!job || this.now() >= job.expiresAt) {
      if (job) {
        clearTimeout(job.timer);
        job.controller.abort();
        this.jobs.delete(id);
      }
      throw new SpApiError("Amazon 比對已過期，請重新讀取。", {
        status: 404,
        code: "PRICE_LIST_AMAZON_EXPIRED",
      });
    }
    return job;
  }
  private async checkpoint(id: string, job: Job): Promise<void> {
    await this.dependencies.context.assertCurrent(job.context);
    throwIfAborted(job.controller.signal);
    if (this.jobs.get(id) !== job || this.now() >= job.expiresAt)
      throw new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "這次價目表比對已失效。",
      );
    if (job.snapshot.source !== "amazon") this.dependencies.products(id);
  }
  async start(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    if (
      !body ||
      Object.keys(body).length !== 1 ||
      typeof body.id !== "string" ||
      Object.keys(request.query).length
    )
      return invalid("請先選取本機價目表。");
    const id = body.id;
    const products = this.dependencies.products(id);
    if (!products.length || products.length > 2_000)
      return invalid("價目表需有 1 至 2,000 列可辨識商品。", 422);
    return this.startJob(id, products, "workbook");
  }
  /** Explicitly builds a new price list from the current FBA set; no source file. */
  async generate(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    if (!body || Object.keys(body).length || Object.keys(request.query).length)
      return invalid("產生 Amazon 價目表不接受商品列或來源檔案。");
    return this.startJob(`price-list-generated.${randomUUID()}`, [], "amazon");
  }
  private async startJob(
    requestedId: string,
    products: readonly PriceListProductRow[],
    source: "workbook" | "amazon",
  ): Promise<ApiResponse> {
    const revision = this.revision;
    const context = await this.dependencies.context.capture(US);
    await this.dependencies.context.assertCurrent(context);
    if (revision !== this.revision)
      throw new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "請重新開始價目表比對。",
      );
    if (context.mode !== "live")
      return invalid(
        "請連接 US Amazon 真實帳號；價目表不會填入展示價格。",
        422,
        "PRICE_LIST_LIVE_REQUIRED",
      );
    const runningGenerated = source === "amazon"
      ? [...this.jobs.entries()].find(([, job]) => job.snapshot.source === "amazon" && job.snapshot.state === "running")
      : undefined;
    const id = runningGenerated?.[0] ?? requestedId;
    const previous = this.jobs.get(id);
    if (previous?.snapshot.state === "running") {
      await this.checkpoint(id, previous);
      return json(structuredClone(previous.snapshot), 202);
    }
    if ([...this.jobs.values()].some((job) => job.snapshot.state === "running"))
      return invalid(
        "另一份價目表正在讀取，請等候完成。",
        409,
        "PRICE_LIST_BUSY",
      );
    if (previous) {
      clearTimeout(previous.timer);
      previous.controller.abort();
    }
    if (source === "amazon") {
      for (const [key, prior] of this.jobs) {
        if (prior.snapshot.source !== "amazon") continue;
        clearTimeout(prior.timer);
        prior.controller.abort();
        this.jobs.delete(key);
      }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15 * 60_000);
    timer.unref?.();
    const job: Job = {
      context,
      controller,
      timer,
      expiresAt: this.now() + 30 * 60_000,
      snapshot: {
        source,
        workbookId: id,
        state: "running",
        rows: [],
        fetchedAt: null,
        completed: 0,
        total: products.length,
        message: "正在核對 US FBA 商品與 Amazon 設定價格。",
        stage: "identifying",
        errorCode: null,
      },
    };
    this.jobs.set(id, job);
    void this.run(id, job, products);
    return json(structuredClone(job.snapshot), 202);
  }
  private async run(
    id: string,
    job: Job,
    products: readonly PriceListProductRow[],
  ): Promise<void> {
    try {
      await this.checkpoint(id, job);
      const identities = await waitForPromiseWithSignal(
        this.dependencies.fba(job.context, job.controller.signal),
        job.controller.signal,
      );
      await this.checkpoint(id, job);
      const seen = new Set<string>();
      if (
        identities.length > 5_000 ||
        identities.some((item) => {
          const bad =
            !item.sellerSku ||
            item.sellerSku !== item.sellerSku.trim() ||
            item.sellerSku.length > 40 ||
            /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(
              item.sellerSku,
            ) ||
            !/^[A-Z0-9]{10}$/u.test(item.asin) ||
            seen.has(item.sellerSku);
          seen.add(item.sellerSku);
          return bad;
        })
      )
        throw new SpApiError("FBA 商品身分無法完整核對。", {
          status: 422,
          code: "PRICE_LIST_FBA_INVALID",
        });
      if (job.snapshot.source === "amazon") {
        if (!identities.length || identities.length > 2_000)
          throw new SpApiError("產生價目表需要 1 至 2,000 筆可確認的 US FBA 商品。", {
            status: 422, code: "PRICE_LIST_FBA_COUNT_INVALID",
          });
        products = identities.map((item, index) => ({
          key: item.sellerSku, keyKind: "seller-sku", asin: item.asin,
          sheetName: "US 價目表", rowNumber: index + 2, cells: {},
        }));
        job.snapshot.total = products.length;
      }
      const cache = new Map<string, PriceListListingFacts>();
      job.snapshot.stage = "reading";
      job.snapshot.message =
        "FBA 商品身分已取得，正在逐一讀取 Amazon 售價與最低價格設定。";
      for (const product of products) {
        await this.checkpoint(id, job);
        const match = matchProduct(product, identities);
        const row: PriceListAmazonRow = {
          sheetName: product.sheetName,
          rowNumber: product.rowNumber,
          sellerSku: match.identity?.sellerSku ?? null,
          asin: product.asin,
          status: match.status,
          message:
            match.status === "ambiguous"
              ? product.keyKind === "seller-sku"
                ? "原表的 Seller SKU 與 ASIN 對不上；請核對兩欄後重新匯入。"
                : "同一 ASIN 對應多個 Seller SKU；請核對要查的 FBA Seller SKU，並用含 Seller SKU 的價目表重新匯入。"
              : !product.asin && product.keyKind !== "seller-sku"
                ? "原表只有公司貨號，請補上 ASIN 後重新匯入；公司貨號不會當成 Seller SKU 查詢。"
                : "目前 US FBA 清單找不到這筆商品；請核對原表 ASIN／Seller SKU 與 US FBA 狀態。",
          standardPrice: null,
          minimumPrice: null,
          minimumPriceStatus: "unavailable",
          imageUrl: null,
          currency: "USD",
          fetchedAt: new Date(this.now()).toISOString(),
          issueCode:
            match.status === "ambiguous"
              ? "FBA_MATCH_AMBIGUOUS"
              : match.status === "unmatched"
                ? product.asin || product.keyKind === "seller-sku"
                  ? "FBA_MATCH_NOT_FOUND"
                  : "WORKBOOK_ASIN_MISSING"
                : null,
        };
        if (match.identity) {
          row.asin = match.identity.asin;
          try {
            let facts = cache.get(match.identity.sellerSku);
            if (!facts) {
              facts = await waitForPromiseWithSignal(
                this.dependencies.listing({
                  marketplaceId: US,
                  ...match.identity,
                  signal: job.controller.signal,
                }),
                job.controller.signal,
              );
              await this.checkpoint(id, job);
              cache.set(match.identity.sellerSku, facts);
            }
            Object.assign(row, facts);
            row.status =
              facts.standardPrice === null ||
              facts.minimumPriceStatus === "unavailable"
                ? "incomplete"
                : "matched";
            row.message =
              row.status === "matched"
                ? "已核對 Amazon 設定；最低活動價與平台下限的用途不同。"
                : "部分 Amazon 設定未取得，缺值不代表 0。";
            row.issueCode =
              row.status === "matched" ? null : "LISTING_PRICE_INCOMPLETE";
          } catch (error) {
            await this.checkpoint(id, job);
            if (
              !(error instanceof SpApiError) ||
              !(
                [400, 404, 413, 415, 422].includes(error.status) ||
                (error.status === 409 && error.code === "LISTING_IDENTITY_MISMATCH")
              )
            )
              throw error;
            const publicError = publicSpApiError(error, "此商品讀取未完成。");
            row.status = "incomplete";
            row.message = publicError.message;
            row.issueCode = publicError.code;
          }
        }
        await this.checkpoint(id, job);
        job.snapshot.rows.push(row);
        job.snapshot.completed += 1;
      }
      await this.checkpoint(id, job);
      job.snapshot.state = "complete";
      job.snapshot.stage = "finished";
      job.snapshot.fetchedAt = new Date(this.now()).toISOString();
      job.snapshot.message = job.snapshot.source === "amazon"
        ? "Amazon 價目表已整理完成；未回報價格與缺圖逐列標示。"
        : "比對讀取完成。原表價格保留；缺值與無法唯一對應的商品另行標示。";
    } catch (error) {
      if (this.jobs.get(id) !== job) return;
      try {
        await this.dependencies.context.assertCurrent(job.context);
      } catch {
        this.clear();
        return;
      }
      const publicError =
        error instanceof SpApiError
          ? publicSpApiError(error, "Amazon 比對未完成。")
          : null;
      job.snapshot.state = "failed";
      job.snapshot.errorCode =
        publicError?.code ??
        (job.controller.signal.aborted
          ? "PRICE_LIST_READ_TIMEOUT"
          : "PRICE_LIST_READ_FAILED");
      job.snapshot.message =
        publicError?.message ??
        "Amazon 比對未完成或逾時；已讀取部分不能當成完整結果。";
      const observed = new Set(
        job.snapshot.rows.map((row) => `${row.sheetName}\0${row.rowNumber}`),
      );
      for (const product of products) {
        if (observed.has(`${product.sheetName}\0${product.rowNumber}`))
          continue;
        job.snapshot.rows.push({
          sheetName: product.sheetName,
          rowNumber: product.rowNumber,
          sellerSku: null,
          asin: product.asin,
          status: "incomplete",
          message: job.snapshot.message,
          issueCode: job.snapshot.errorCode,
          standardPrice: null,
          minimumPrice: null,
          minimumPriceStatus: "unavailable",
          imageUrl: null,
          currency: "USD",
          fetchedAt: new Date(this.now()).toISOString(),
        });
      }
    } finally {
      clearTimeout(job.timer);
    }
  }
  async observe(request: ApiRequest): Promise<ApiResponse> {
    if (
      request.body ||
      Object.keys(request.query).length !== 1 ||
      typeof request.query.id !== "string"
    )
      return invalid("價目表比對查詢格式無效。");
    const job = this.active(request.query.id);
    await this.dependencies.context.assertCurrent(job.context);
    if (this.active(request.query.id) !== job)
      throw new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "這次價目表比對已失效。",
      );
    if (job.snapshot.source !== "amazon") this.dependencies.products(request.query.id);
    return json(
      structuredClone(job.snapshot),
      job.snapshot.state === "running" ? 202 : 200,
    );
  }
  async export(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    if (
      !body ||
      Object.keys(request.query).length ||
      Object.keys(body).length !== 2 ||
      typeof body.id !== "string" ||
      typeof body.replaceImages !== "boolean"
    )
      return invalid("價目表輸出選項無效。");
    if (this.exporting)
      return invalid("正在準備比對價目表，請等待本次下載完成。", 409);
    this.exporting = true;
    try {
      const id = body.id;
      const job = this.active(id);
      const exportSignal = AbortSignal.any([
        job.controller.signal,
        AbortSignal.timeout(120_000),
      ]);
      await this.checkpoint(id, job);
      if (job.snapshot.state !== "complete")
        return invalid("請先完成 Amazon 價格讀取，再下載比對表。", 409);
      if (
        !job.snapshot.rows.some(
          (row) => row.standardPrice !== null || row.minimumPrice !== null,
        )
      )
        return invalid(
          "本次沒有取得任何 Amazon 價格；請先處理商品對應或讀取原因，再重新讀取。",
          409,
          "PRICE_LIST_NO_PRICES",
        );
      const images: ImageReplacement[] = [];
      if (body.replaceImages) {
        let total = 0;
        const cache = new Map<
          string,
          Awaited<ReturnType<typeof downloadPriceListImage>>
        >();
        const unavailableImages = new Set<string>();
        for (const row of job.snapshot.rows) {
          if (!row.imageUrl || unavailableImages.has(row.imageUrl)) continue;
          await this.checkpoint(id, job);
          throwIfAborted(exportSignal);
          let image = cache.get(row.imageUrl);
          if (!image) {
            try {
              image = await waitForPromiseWithSignal(
                (this.dependencies.image ?? downloadPriceListImage)(row.imageUrl, exportSignal),
                exportSignal,
              );
              if (job.snapshot.source === "amazon") validatePriceListImageReplacement(image);
            } catch (error) {
              await this.checkpoint(id, job);
              throwIfAborted(exportSignal);
              if (job.snapshot.source !== "amazon") throw error;
              unavailableImages.add(row.imageUrl);
              continue;
            }
            total += image.bytes.byteLength;
            if (total > 25 * 1024 * 1024)
              throw new SpApiError(
                "Amazon 首圖合計超過 25 MB；請取消替換首圖後下載。",
                { status: 422, code: "PRICE_LIST_IMAGE_LIMIT" },
              );
            cache.set(row.imageUrl, image);
          }
          images.push({
            sheetName: row.sheetName,
            rowNumber: row.rowNumber,
            ...image,
          });
        }
      }
      await this.checkpoint(id, job);
      throwIfAborted(exportSignal);
      const bytes = job.snapshot.source === "amazon"
        ? createGeneratedPriceListWorkbook(job.snapshot.rows, images)
        : this.dependencies.export(id, structuredClone(job.snapshot.rows), images);
      await this.checkpoint(id, job);
      return {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": job.snapshot.source === "amazon"
            ? 'attachment; filename="AMZ_US_Price_List.xlsx"'
            : 'attachment; filename="AMZ_US_Amazon_Comparison.xlsx"',
        },
        body: { kind: "bytes", value: bytes },
      };
    } finally {
      this.exporting = false;
    }
  }
  clear(): void {
    this.revision += 1;
    for (const job of this.jobs.values()) {
      clearTimeout(job.timer);
      job.controller.abort();
    }
    this.jobs.clear();
  }
}

export async function downloadPriceListImage(
  rawUrl: string,
  signal: AbortSignal,
): Promise<{ bytes: Uint8Array; mediaType: "image/png" | "image/jpeg" }> {
  const url = priceListAmazonImageUrl(rawUrl);
  const failed = () =>
    new SpApiError(
      "Amazon 首圖無法安全下載；請取消替換首圖，或稍後重新下載。",
      { status: 422, code: "PRICE_LIST_IMAGE_UNAVAILABLE" },
    );
  if (!url) throw failed();
  const response = await fetch(url, {
    redirect: "error",
    credentials: "omit",
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  if (!response.ok || !response.body) throw failed();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 2 * 1024 * 1024) {
        await reader.cancel();
        throw failed();
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks);
  const png =
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg =
    bytes.length >= 4 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255;
  if (!png && !jpeg) throw failed();
  return { bytes, mediaType: png ? "image/png" : "image/jpeg" };
}
