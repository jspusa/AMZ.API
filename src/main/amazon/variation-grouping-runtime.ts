import { throwIfAborted } from "../abort-utils";
import type { MarketplaceId } from "../../shared/marketplaces";
import { SpApiError } from "./sp-api-error";
import type { VariationDemoRuntime } from "./variation-demo-runtime";
import {
  completeVariationGroupingRow,
  type FbaVariationGroupingData,
  type FbaVariationGroupingRow,
  type VariationGroupingSourceRow,
} from "./variation-catalog-reads";

export type VariationGroupingProgress = Readonly<{
  completedBatches: number;
  totalBatches: number;
}>;

export type VariationGroupingReadInput<
  Row extends VariationGroupingSourceRow,
> = Readonly<{
  marketplaceId: MarketplaceId;
  rows: readonly Row[];
  signal?: AbortSignal;
  onProgress?: (
    progress: VariationGroupingProgress,
  ) => void | Promise<void>;
}>;

export type VariationGroupingLiveReader = <
  Row extends VariationGroupingSourceRow,
>(
  input: VariationGroupingReadInput<Row>,
) => Promise<FbaVariationGroupingData<Row>>;

export type VariationGroupingRuntimeDependencies = Readonly<{
  resolveMode(marketplaceId: MarketplaceId): "live" | "demo";
  demo: Pick<VariationDemoRuntime, "readFamily">;
  readLive: VariationGroupingLiveReader;
  now?: () => Date;
}>;

export interface VariationGroupingRuntime {
  read<Row extends VariationGroupingSourceRow>(
    input: VariationGroupingReadInput<Row>,
  ): Promise<FbaVariationGroupingData<Row>>;
}

function incompleteDemoRow<Row extends VariationGroupingSourceRow>(
  row: Row,
  message: string,
): FbaVariationGroupingRow<Row> {
  return {
    ...row,
    role: "unknown",
    parentSku: null,
    familyKey: row.sellerSku,
    theme: null,
    status: "incomplete",
    message,
  };
}

/**
 * Selects deterministic demo grouping or the fixed live grouping reader.
 * The runtime owns no Amazon transport and forwards the complete live input,
 * including its signal and identity-free progress callback, without changes.
 */
export function createVariationGroupingRuntime(
  dependencies: VariationGroupingRuntimeDependencies,
): VariationGroupingRuntime {
  const now = dependencies.now ?? (() => new Date());

  return Object.freeze({
    async read<Row extends VariationGroupingSourceRow>(
      input: VariationGroupingReadInput<Row>,
    ): Promise<FbaVariationGroupingData<Row>> {
      throwIfAborted(input.signal);
      if (dependencies.resolveMode(input.marketplaceId) === "live") {
        return dependencies.readLive(input);
      }

      const seenSellerSkus = new Set<string>();
      const rows = input.rows.map((row): FbaVariationGroupingRow<Row> => {
        throwIfAborted(input.signal);
        if (seenSellerSkus.has(row.sellerSku)) {
          throw new SpApiError(
            "全商品匯出含有重複 Seller SKU，已停止變體分組。",
            { status: 409, code: "PAGINATION_CHANGED" },
          );
        }
        seenSellerSkus.add(row.sellerSku);
        try {
          const member = dependencies.demo.readFamily(
            input.marketplaceId,
            row.sellerSku,
          ).queried;
          if (
            member.sellerSku !== row.sellerSku ||
            (member.asin ?? "") !== row.asin
          ) {
            return incompleteDemoRow(
              row,
              "展示 relationships 的 SKU／ASIN 與匯出列不一致；未建立 family 分組。",
            );
          }
          return completeVariationGroupingRow(row, member);
        } catch (error) {
          return incompleteDemoRow(
            row,
            error instanceof SpApiError
              ? error.message
              : "展示 relationships 無法安全判定。",
          );
        }
      });
      return {
        marketplaceId: input.marketplaceId,
        fetchedAt: now().toISOString(),
        rows,
        notice:
          "展示資料沿用內建 parent／child relationships；不以商品名稱或 ASIN 相似度猜測 family。",
      };
    },
  });
}
