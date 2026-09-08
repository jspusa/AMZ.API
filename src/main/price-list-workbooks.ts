import { randomUUID } from "node:crypto";
import type { ApiRequest, ApiResponse } from "../shared/contracts";
import type { PriceListWorkbook } from "../shared/price-list";
import { json, invalid } from "./route-response";
import { bodyRecord } from "./route-input";
import { comparePriceListWorkbooks } from "./price-list-comparison";
import {
  exportPriceListWorkbook,
  parsePriceListWorkbook,
  PriceListError,
  type ParsedPriceListWorkbook,
  type PriceListCellChange,
} from "./price-list-workbook";

/** Two imported files and generated copies, held solely in main memory. */
export class PriceListWorkbooks {
  private readonly books = new Map<
    string,
    { workbook: ParsedPriceListWorkbook; expiresAt: number }
  >();
  constructor(private readonly now: () => number = Date.now) {}
  import(input: { bytes: Uint8Array; fileName: string }): PriceListWorkbook {
    this.expire();
    if (this.books.size >= 4)
      throw new PriceListError(
        409,
        "PRICE_LIST_CAPACITY",
        "已開啟 4 份價目表；請先清除本次資料，再選取新檔。",
      );
    const workbook = parsePriceListWorkbook(input);
    workbook.view.id = `price-list.${randomUUID()}`;
    workbook.view.importedAt = new Date(this.now()).toISOString();
    this.books.set(workbook.view.id, {
      workbook,
      expiresAt: this.now() + 8 * 60 * 60_000,
    });
    return structuredClone(workbook.view);
  }
  get(id: string): ParsedPriceListWorkbook {
    this.expire();
    const book = this.books.get(id);
    if (!book)
      throw new PriceListError(
        404,
        "PRICE_LIST_EXPIRED",
        "價目表已清除或過期，請重新選檔。",
      );
    return book.workbook;
  }
  retainGenerated(
    workbook: ParsedPriceListWorkbook,
    changes: readonly PriceListCellChange[],
    label: string,
  ): PriceListWorkbook {
    return this.import({
      bytes: exportPriceListWorkbook(workbook, changes),
      fileName: label,
    });
  }
  export(id: string): Uint8Array {
    return exportPriceListWorkbook(this.get(id));
  }
  clear(): void {
    this.books.clear();
  }
  private expire(): void {
    for (const [id, entry] of this.books)
      if (this.now() >= entry.expiresAt) this.books.delete(id);
  }

  /** Fixed local intents; no path, arbitrary URL, transport or filesystem port. */
  route(request: ApiRequest): ApiResponse | null {
    if (!request.path.startsWith("/api/price-list/")) return null;
    try {
      if (
        request.method === "POST" &&
        request.path === "/api/price-list/import"
      ) {
        if (
          Object.keys(request.query).length ||
          request.body?.kind !== "multipart" ||
          Object.keys(request.body.fields).length
        )
          return invalid("請選取本機 .xlsx 價目表。");
        return json(
          this.import({
            bytes: request.body.file.bytes,
            fileName: request.body.file.name,
          }),
        );
      }
      if (
        request.method === "POST" &&
        request.path === "/api/price-list/compare"
      ) {
        const body = bodyRecord(request);
        if (
          Object.keys(request.query).length ||
          !body ||
          Object.keys(body).length !== 2 ||
          typeof body.baseId !== "string" ||
          typeof body.candidateId !== "string"
        )
          return invalid("請先選取兩份價目表。");
        return json(
          comparePriceListWorkbooks(
            this.get(body.baseId).view,
            this.get(body.candidateId).view,
          ),
        );
      }
      if (
        request.method === "GET" &&
        request.path === "/api/price-list/export"
      ) {
        if (
          request.body ||
          Object.keys(request.query).length !== 1 ||
          typeof request.query.id !== "string"
        )
          return invalid("價目表下載格式無效。");
        const book = this.get(request.query.id);
        return {
          status: 200,
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(book.view.fileName)}`,
          },
          body: { kind: "bytes", value: this.export(request.query.id) },
        };
      }
      if (
        request.method === "GET" &&
        request.path === "/api/price-list/image"
      ) {
        if (
          request.body ||
          Object.keys(request.query).length !== 2 ||
          typeof request.query.id !== "string" ||
          typeof request.query.imageId !== "string"
        )
          return invalid("價目表圖片格式無效。");
        const book = this.get(request.query.id);
        const item = book.images.get(request.query.imageId);
        if (!item) return invalid("此圖片不存在。", 404);
        return {
          status: 200,
          headers: {
            "Content-Type": item.mediaType,
            "Cache-Control": "no-store",
          },
          body: { kind: "bytes", value: book.archive[item.path]!.slice() },
        };
      }
      if (
        request.method === "POST" &&
        request.path === "/api/price-list/clear"
      ) {
        const body = bodyRecord(request);
        if (
          Object.keys(request.query).length ||
          !body ||
          Object.keys(body).length
        )
          return invalid("清除價目表格式無效。");
        this.clear();
        return json({ cleared: true });
      }
      return null;
    } catch (error) {
      if (error instanceof PriceListError)
        return invalid(error.message, error.status, error.code);
      throw error;
    }
  }
}
