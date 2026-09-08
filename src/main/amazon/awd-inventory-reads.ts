import { createHash } from "node:crypto";
import type { AwdInboundShipment, AwdInventoryQuantity, AwdInventoryRow, AwdInventorySnapshot, AwdShipmentStatus } from "../../shared/awd-inventory";
import type { OperationsFinding } from "../../shared/operations-intelligence";
import { throwIfAborted } from "../abort-utils";
import type { OperationsReadInput } from "./operations-read-context";
import type { SpExecutionContext, SpExecutionContextAdapter } from "./sp-execution-context";
import { SpApiError } from "./sp-api-error";

export type AwdReadPageInput = Readonly<{ context: SpExecutionContext; signal: AbortSignal; assertCurrent(): Promise<void>; nextToken?: string }>;
export interface AwdInventoryReadAdapter {
  listInventory(input: AwdReadPageInput): Promise<unknown>;
  listInboundShipments(input: AwdReadPageInput): Promise<unknown>;
  getInboundShipment(input: Readonly<{ context: SpExecutionContext; signal: AbortSignal; assertCurrent(): Promise<void>; shipmentId: string }>): Promise<unknown>;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function dateTime(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u.test(value) || !Number.isFinite(Date.parse(value))) return null;
  const day = value.slice(0, 10);
  if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) return null;
  return new Date(value).toISOString();
}
function nextPage(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !value || value.length > 4096 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new SpApiError("AWD 分頁證據無法驗證。", { status: 502, code: "AWD_INVALID_RESPONSE" });
  }
  return value;
}
const SHIPMENT_STATUSES = new Set(["CREATED", "SHIPPED", "IN_TRANSIT", "RECEIVING", "DELIVERED", "CLOSED", "CANCELLED"]);
function quantity(value: unknown): AwdInventoryQuantity | null {
  const entry = record(value);
  if (typeof entry.quantity !== "number" || !Number.isFinite(entry.quantity) || entry.quantity < 0 || entry.quantity > Number.MAX_SAFE_INTEGER) return null;
  if (entry.unitOfMeasurement !== "PRODUCT_UNITS" && entry.unitOfMeasurement !== "CASES" && entry.unitOfMeasurement !== "PALLETS") return null;
  return { quantity: entry.quantity, unitOfMeasurement: entry.unitOfMeasurement };
}
function opaqueKey(input: OperationsReadInput, kind: string, ...values: string[]): string {
  return `${kind}.${createHash("sha256").update(JSON.stringify([input.context.accountScope, input.context.marketplaceId, ...values])).digest("hex").slice(0, 24)}`;
}

export class AwdInventoryReads {
  constructor(private readonly dependencies: Readonly<{ adapter: AwdInventoryReadAdapter; context: SpExecutionContextAdapter }>) {}

  private async external(input: OperationsReadInput, operation: () => Promise<unknown>): Promise<unknown> {
    await this.dependencies.context.assertCurrent(input.context);
    throwIfAborted(input.signal);
    try { return await operation(); }
    catch (error) {
      if (error instanceof SpApiError) throw error;
      throw new SpApiError("AWD 外部資料目前無法讀取。", { status: 502, code: "AWD_UPSTREAM_UNAVAILABLE" });
    }
    finally {
      await this.dependencies.context.assertCurrent(input.context);
      throwIfAborted(input.signal);
    }
  }

  async read(input: OperationsReadInput): Promise<AwdInventorySnapshot> {
    await this.dependencies.context.assertCurrent(input.context);
    throwIfAborted(input.signal);
    if (input.context.mode !== "live") throw new SpApiError("AWD 尚未提供展示資料；不會以展示模式呼叫真實帳號。", { status: 409, code: "AWD_DEMO_UNAVAILABLE" });
    if (input.context.marketplaceId !== "ATVPDKIKX0DER" || input.context.region !== "na") {
      throw new SpApiError("此版本的 AWD 唯讀能力只支援美國站。", { status: 400, code: "AWD_MARKETPLACE_UNSUPPORTED" });
    }
    const identities = new Map(input.fba.map((identity) => [identity.sellerSku, identity]));
    if (input.fba.length > 10000 || identities.size !== input.fba.length || input.fba.some((identity) => !identity.sellerSku || identity.sellerSku !== identity.sellerSku.trim() || identity.sellerSku.length > 200 || /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(identity.sellerSku) || !/^[A-Z0-9]{10}$/u.test(identity.asin))) {
      throw new SpApiError("AWD 需要同次完整且精確的 FBA 商品身分。", { status: 400, code: "AWD_FBA_IDENTITY_INVALID" });
    }
    const rows: AwdInventoryRow[] = [];
    const assertCurrent = () => this.dependencies.context.assertCurrent(input.context);
    const warnings = new Set<string>();
    let excludedInventoryRows = 0;
    const seenSkus = new Set<string>();
    const tokens = new Set<string>();
    let nextToken: string | null = null;
    let inventoryCount = 0;
    let expirationCount = 0;
    for (let pageNumber = 0; pageNumber < 50; pageNumber++) {
      const page = record(await this.external(input, () => this.dependencies.adapter.listInventory({ context: input.context, signal: input.signal, assertCurrent, ...(nextToken ? { nextToken } : {}) })));
      if (!Array.isArray(page.inventory) || page.inventory.length > 200) throw new SpApiError("AWD 庫存清單格式不完整。", { status: 502, code: "AWD_INVALID_RESPONSE" });
      inventoryCount += page.inventory.length;
      if (inventoryCount > 10000) { warnings.add("AWD 庫存超過安全列數上限，資料未讀完。"); break; }
      for (const raw of page.inventory) {
        const value = record(raw);
        const identity = typeof value.sku === "string" ? identities.get(value.sku) : undefined;
        if (!identity) { excludedInventoryRows++; continue; }
        if (seenSkus.has(identity.sellerSku)) {
          warnings.add("AWD 回傳重複商品列；重複商品的數量不作完整證據。");
          const index = rows.findIndex((row) => row.sellerSku === identity.sellerSku);
          if (index >= 0) rows.splice(index, 1);
          continue;
        }
        seenSkus.add(identity.sellerSku);
        const details = record(value.inventoryDetails);
        if (Array.isArray(value.expirationDetails)) expirationCount += value.expirationDetails.length;
        if (expirationCount > 10000) warnings.add("AWD 效期明細超過安全列數上限；超限明細保持未完成。");
        const row: AwdInventoryRow = {
          ...identity,
          totalOnhandQuantity: count(value.totalOnhandQuantity),
          totalInboundQuantity: count(value.totalInboundQuantity),
          availableDistributableQuantity: count(details.availableDistributableQuantity),
          reservedDistributableQuantity: count(details.reservedDistributableQuantity),
          replenishmentQuantity: count(details.replenishmentQuantity),
          expirationDetails: Array.isArray(value.expirationDetails) && value.expirationDetails.length <= 2000 && expirationCount <= 10000
            ? value.expirationDetails.map((item) => {
              const expiry = record(item);
              return { expiration: dateTime(expiry.expiration), onhandQuantity: count(expiry.onhandQuantity) };
            }) : null,
        };
        if (Object.values(row).some((value) => value === null) || row.expirationDetails?.some((expiry) => expiry.expiration === null || expiry.onhandQuantity === null)) warnings.add("部分 AWD 數量或效期未回報／無法驗證；空白不代表零庫存或無效期。");
        rows.push(row);
      }
      nextToken = nextPage(page.nextToken);
      if (!nextToken) break;
      if (tokens.has(nextToken)) { warnings.add("AWD 庫存分頁重複，資料未讀完。"); break; }
      tokens.add(nextToken);
      if (pageNumber === 49) warnings.add("AWD 庫存超過安全分頁上限，資料未讀完。");
    }
    if (excludedInventoryRows) warnings.add("部分 AWD 列未能匹配同次 current-FBA 商品身分；只呈現已核對商品。");
    const inventoryCoverage = warnings.size ? "partial" : "complete";
    const shipments: AwdInboundShipment[] = [];
    let shipmentCoverage: "complete" | "partial" = "complete";
    const shipmentTokens = new Set<string>();
    const shipmentIds = new Set<string>();
    let shipmentToken: string | null = null;
    let detailCount = 0;
    let quantityRows = 0;
    try {
      shipmentPages: for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
        const page = record(await this.external(input, () => this.dependencies.adapter.listInboundShipments({ context: input.context, signal: input.signal, assertCurrent, ...(shipmentToken ? { nextToken: shipmentToken } : {}) })));
        if (!Array.isArray(page.shipments) || page.shipments.length > 200) throw new SpApiError("AWD 貨件清單格式不完整。", { status: 502, code: "AWD_INVALID_RESPONSE" });
        for (const summary of page.shipments) {
          const seed = record(summary);
          if (typeof seed.shipmentId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(seed.shipmentId)) {
            shipmentCoverage = "partial";
            continue;
          }
          if (shipmentIds.has(seed.shipmentId)) {
            shipmentCoverage = "partial";
            const duplicate = shipments.findIndex((shipment) => shipment.id === opaqueKey(input, "awd-shipment", seed.shipmentId as string));
            if (duplicate >= 0) shipments.splice(duplicate, 1);
            continue;
          }
          shipmentIds.add(seed.shipmentId);
          if (++detailCount > 100) { shipmentCoverage = "partial"; break shipmentPages; }
          const shipmentId = seed.shipmentId;
          const detail = record(await this.external(input, () => this.dependencies.adapter.getInboundShipment({ context: input.context, signal: input.signal, assertCurrent, shipmentId })));
          if (detail.shipmentId !== shipmentId) throw new SpApiError("AWD 貨件明細身分不一致。", { status: 502, code: "AWD_INVALID_RESPONSE" });
          const status: AwdShipmentStatus = typeof detail.shipmentStatus === "string" && SHIPMENT_STATUSES.has(detail.shipmentStatus) ? detail.shipmentStatus as AwdShipmentStatus : "UNKNOWN";
          let partial = status === "UNKNOWN";
          const shipmentRows: AwdInboundShipment["rows"][number][] = [];
          if (!Array.isArray(detail.shipmentSkuQuantities) || detail.shipmentSkuQuantities.length > 2000) {
            shipmentCoverage = "partial";
            continue;
          }
          quantityRows += detail.shipmentSkuQuantities.length;
          if (quantityRows > 10000) { shipmentCoverage = "partial"; break shipmentPages; }
          const rowSkus = new Set<string>();
          for (const rawQuantity of detail.shipmentSkuQuantities) {
            const item = record(rawQuantity);
            const identity = typeof item.sku === "string" ? identities.get(item.sku) : undefined;
            if (!identity) { partial = true; continue; }
            if (rowSkus.has(identity.sellerSku)) {
              partial = true;
              const duplicate = shipmentRows.findIndex((row) => row.sellerSku === identity.sellerSku);
              if (duplicate >= 0) shipmentRows.splice(duplicate, 1);
              continue;
            }
            rowSkus.add(identity.sellerSku);
            const expectedQuantity = quantity(item.expectedQuantity);
            const receivedQuantity = quantity(item.receivedQuantity);
            const outstandingQuantity = expectedQuantity && receivedQuantity && expectedQuantity.unitOfMeasurement === receivedQuantity.unitOfMeasurement && expectedQuantity.quantity >= receivedQuantity.quantity
              ? { quantity: expectedQuantity.quantity - receivedQuantity.quantity, unitOfMeasurement: expectedQuantity.unitOfMeasurement } : null;
            if (!expectedQuantity || !receivedQuantity || !outstandingQuantity) partial = true;
            shipmentRows.push({ ...identity, expectedQuantity, receivedQuantity, outstandingQuantity });
          }
          if (partial) shipmentCoverage = "partial";
          if (shipmentRows.length) shipments.push({ id: opaqueKey(input, "awd-shipment", shipmentId), status, updatedAt: dateTime(detail.updatedAt), coverage: partial ? "partial" : "complete", rows: shipmentRows });
        }
        shipmentToken = nextPage(page.nextToken);
        if (!shipmentToken) break;
        if (shipmentTokens.has(shipmentToken)) { shipmentCoverage = "partial"; break; }
        shipmentTokens.add(shipmentToken);
        if (pageNumber === 9) shipmentCoverage = "partial";
      }
    } catch (error) {
      await this.dependencies.context.assertCurrent(input.context);
      throwIfAborted(input.signal);
      if (error instanceof SpApiError && error.status === 409) throw error;
      shipmentCoverage = "partial";
      warnings.add(error instanceof SpApiError && (error.status === 401 || error.status === 403)
        ? "AWD 貨件權限不足；庫存數字與貨件明細的可用性分開顯示。"
        : "AWD 貨件明細未完成；保留已核對資料，不把未讀到的貨件當成不存在。");
    }
    if (shipmentCoverage === "partial") warnings.add("AWD 貨件含未核對身分、缺失數量／單位或未完成分頁；箱、板、件不互相換算，差額不代表遺失。");
    const findings: OperationsFinding[] = [];
    const fetchedAt = new Date().toISOString();
    for (const row of rows) {
      const expired = row.expirationDetails?.some((expiry) => expiry.expiration !== null && expiry.onhandQuantity !== null && expiry.onhandQuantity > 0 && Date.parse(expiry.expiration) <= Date.parse(fetchedAt));
      if (expired) findings.push({ key: opaqueKey(input, "awd-expiry", row.sellerSku), source: "awd", sellerSku: row.sellerSku,
        severity: "warning", title: "AWD 有已到效期的在庫證據", detail: "Amazon AWD 回傳到期日已過且對應在庫量大於零；請核對該批商品。此證據不代表 FBA 批次效期。" });
    }
    for (const shipment of shipments) {
      if (shipment.status !== "CLOSED") continue;
      for (const row of shipment.rows) {
        if (row.outstandingQuantity && row.outstandingQuantity.quantity > 0) findings.push({ key: opaqueKey(input, "awd-closed-quantity", shipment.id, row.sellerSku), source: "awd", sellerSku: row.sellerSku,
          severity: "warning", title: "已關閉 AWD 貨件數量待核對", detail: `同 SKU／同單位的預期與接收數量差額為 ${row.outstandingQuantity.quantity} ${row.outstandingQuantity.unitOfMeasurement}；此為對帳提醒，請至 Amazon 核對收貨紀錄。` });
      }
    }
    if (findings.length > 5000) warnings.add("AWD 提醒超過安全顯示上限，僅顯示前 5,000 項；不以此解除其他提醒。");
    await this.dependencies.context.assertCurrent(input.context);
    throwIfAborted(input.signal);
    return { marketplaceId: input.context.marketplaceId, mode: input.context.mode, fetchedAt,
      coverage: warnings.size ? "partial" : "complete", inventoryCoverage, shipmentCoverage,
      stockScope: "AWD_SHARED_DOWNSTREAM", rows, shipments, excludedInventoryRows, findings: findings.slice(0, 5000), warnings: [...warnings] };
  }
}
