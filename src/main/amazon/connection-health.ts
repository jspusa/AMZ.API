import type { ConnectionTestResult } from "../../shared/contracts";
import { SpApiError } from "./sp-api";

type RegionResult = NonNullable<ConnectionTestResult["regions"]["na"]>;

type OrdersProbe = Readonly<{
  mode: "live" | "demo";
  requestId: string | null;
}>;

type ListingsProbe = Readonly<{
  requestId: string | null;
  compatibilityFallback: boolean;
}>;

function failed(stage: "Orders" | "Listings", error: unknown): RegionResult {
  if (!(error instanceof SpApiError)) {
    return {
      ok: false,
      message: `${stage} 連線測試失敗。`,
      requestId: null,
    };
  }
  let guidance = "";
  if (stage === "Listings" && error.status === 400) {
    guidance = " 請核對 Merchant Token 是否與目前 Refresh Token 屬於同一 Seller 帳號。";
  } else if (error.status === 401 || error.status === 403) {
    guidance = stage === "Orders"
      ? " 請確認 Orders 角色後重新授權 App。"
      : " 請確認 Product Listing 角色後重新授權 App。";
  }
  return {
    ok: false,
    message: `${stage} 驗證失敗：${error.message}${guidance}`,
    requestId: error.requestId,
  };
}

/** Runs the two independent permissions in order and keeps error attribution. */
export async function testRegionConnections(input: Readonly<{
  orders: () => Promise<OrdersProbe>;
  listings: () => Promise<ListingsProbe>;
}>): Promise<RegionResult> {
  let orders: OrdersProbe;
  try {
    orders = await input.orders();
  } catch (error) {
    return failed("Orders", error);
  }
  if (orders.mode !== "live") {
    return {
      ok: false,
      message: "目前仍是展示模式。",
      requestId: orders.requestId,
    };
  }

  let listings: ListingsProbe;
  try {
    listings = await input.listings();
  } catch (error) {
    return failed("Listings", error);
  }
  return {
    ok: true,
    message: listings.compatibilityFallback
      ? "Orders 與 Listings 連線成功；Listings 使用唯讀相容參數。"
      : "Orders 與 Listings 連線成功。",
    requestId: listings.requestId ?? orders.requestId,
  };
}
