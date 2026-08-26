import type { ApiRequest, ApiResponse } from "../shared/contracts";
import {
  marketplaceByCode,
} from "../shared/marketplaces";
import type { LocalStore } from "./local-store";
import type { RouterRequestContextAdapter } from "./router-request-context";
import {
  bodyRecord,
  integer,
  multiLineText,
  optionalInteger,
  parseMarketplace,
  parseSellerSku,
  shortText,
} from "./route-input";
import { invalid, json } from "./route-response";

export interface ProductMasterRoutesPort {
  getProductMaster(request: ApiRequest): Promise<ApiResponse>;
  putProductMaster(request: ApiRequest): Promise<ApiResponse>;
}

export type ProductMasterStorePort = Pick<
  LocalStore,
  "getProductMaster" | "listProductMasters" | "saveProductMaster"
>;

export type ProductMasterRoutesDependencies = Readonly<{
  context: RouterRequestContextAdapter;
  store: ProductMasterStorePort;
}>;

/** Semantic owner for the durable, account-scoped Product Master routes. */
export class ProductMasterRoutes implements ProductMasterRoutesPort {
  private readonly context: RouterRequestContextAdapter;
  private readonly store: ProductMasterStorePort;

  constructor(input: ProductMasterRoutesDependencies) {
    this.context = input.context;
    this.store = input.store;
  }

  async getProductMaster(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    if (!marketplaceId) return invalid("請選擇有效的 Amazon 站點。");
    const context = await this.context.capture(marketplaceId);
    if (Object.prototype.hasOwnProperty.call(request.query, "sku")) {
      const sellerSku = parseSellerSku(request.query.sku);
      if (!sellerSku) return invalid("請輸入有效的 Seller SKU。");
      return json(
        await this.store.getProductMaster(
          context.accountScope,
          marketplaceId,
          sellerSku,
        ),
      );
    }
    const query = (request.query.q ?? "").trim();
    const limit = integer(request.query.limit, 8, 1, 20);
    if (query.length > 80 || limit === null) {
      return invalid("商品主檔搜尋條件無效。");
    }
    return json(
      await this.store.listProductMasters({
        accountScope: context.accountScope,
        marketplaceId,
        query,
        limit,
      }),
    );
  }

  async putProductMaster(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    if (!body) {
      return invalid(
        "商品主檔請求必須使用 JSON。",
        415,
        "UNSUPPORTED_MEDIA_TYPE",
      );
    }
    const marketplaceId = parseMarketplace(body.marketplaceId);
    const sellerSku = parseSellerSku(body.sellerSku);
    const supplyRoute =
      body.supplyRoute === "DIRECT_FBA" || body.supplyRoute === "AWD_TO_FBA"
        ? body.supplyRoute
        : null;
    const settings = {
      casePack: integer(body.casePack, null, 1, 10_000),
      cartonsPerPallet: integer(body.cartonsPerPallet, null, 1, 1_000),
      leadTimeDays: integer(body.leadTimeDays, null, 1, 120),
      safetyDays: integer(body.safetyDays, null, 0, 90),
      targetDays: integer(body.targetDays, null, 14, 180),
      supplyRoute,
      awdBufferDays: integer(body.awdBufferDays, null, 0, 60),
      shelfLifeDays: optionalInteger(body.shelfLifeDays, 1, 3_650),
      minimumRemainingDays: optionalInteger(body.minimumRemainingDays, 1, 3_650),
      factory: shortText(body.factory, 80),
      notes: multiLineText(body.notes, 500),
    };
    const displayName = shortText(body.displayName, 300);
    const asin = shortText(body.asin, 20);
    const fnSku = shortText(body.fnSku, 40);
    if (
      !marketplaceId ||
      !sellerSku ||
      !supplyRoute ||
      settings.casePack === null ||
      settings.cartonsPerPallet === null ||
      settings.leadTimeDays === null ||
      settings.safetyDays === null ||
      settings.targetDays === null ||
      settings.awdBufferDays === null ||
      settings.shelfLifeDays === undefined ||
      settings.minimumRemainingDays === undefined ||
      settings.factory === undefined ||
      settings.notes === undefined ||
      displayName === undefined ||
      asin === undefined ||
      fnSku === undefined
    ) {
      return invalid("商品主檔內有格式或範圍不正確的欄位。");
    }
    if (
      supplyRoute === "AWD_TO_FBA" &&
      marketplaceId !== marketplaceByCode("US").id
    ) {
      return invalid("AWD→FBA 目前只開放美國站。", 422, "AWD_US_ONLY");
    }
    const effectiveLead = settings.leadTimeDays +
      (supplyRoute === "AWD_TO_FBA" ? settings.awdBufferDays : 0);
    if (settings.targetDays < effectiveLead + settings.safetyDays) {
      return invalid(
        "目標庫存不能小於補貨交期、AWD 緩衝與安全庫存的合計。",
        422,
        "INVALID_RESTOCK_WINDOW",
      );
    }
    if (
      settings.shelfLifeDays &&
      settings.minimumRemainingDays &&
      settings.minimumRemainingDays > settings.shelfLifeDays
    ) {
      return invalid(
        "到倉最低剩餘效期不能大於商品總效期。",
        422,
        "INVALID_SHELF_LIFE",
      );
    }
    const context = await this.context.capture(marketplaceId);
    return json(
      await this.store.saveProductMaster({
        accountScope: context.accountScope,
        marketplaceId,
        sellerSku,
        settings: {
          casePack: settings.casePack,
          cartonsPerPallet: settings.cartonsPerPallet,
          leadTimeDays: settings.leadTimeDays,
          safetyDays: settings.safetyDays,
          targetDays: settings.targetDays,
          supplyRoute,
          awdBufferDays: settings.awdBufferDays,
          shelfLifeDays: settings.shelfLifeDays,
          minimumRemainingDays: settings.minimumRemainingDays,
          factory: settings.factory,
          notes: settings.notes,
        },
        displayName,
        asin,
        fnSku,
      }),
    );
  }
}
