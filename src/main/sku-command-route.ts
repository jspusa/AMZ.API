import type { ApiRequest, ApiResponse } from "../shared/contracts";
import type { SkuCommand } from "./amazon/sku-command";
import { parseMarketplace, parseSellerSku } from "./route-input";
import { invalid, json } from "./route-response";

export interface SkuCommandRoutePort {
  skuCommand(request: ApiRequest): Promise<ApiResponse>;
}

export type SkuCommandRouteDependencies = Readonly<{
  command: Pick<SkuCommand, "read">;
}>;

/** Exact public route adapter for the read-only SKU Command semantic owner. */
export class SkuCommandRoute implements SkuCommandRoutePort {
  private readonly command: Pick<SkuCommand, "read">;

  constructor(input: SkuCommandRouteDependencies) {
    this.command = input.command;
  }

  async skuCommand(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const sellerSku = parseSellerSku(request.query.sku);
    if (!marketplaceId || !sellerSku) {
      return invalid("請選擇站點並輸入完整 SKU。");
    }
    return json(await this.command.read({ marketplaceId, sellerSku }));
  }
}
