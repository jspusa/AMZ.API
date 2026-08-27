import { describe, expect, it, vi } from "vitest";
import { SpApiError } from "../src/main/amazon/sp-api-error";
import type { VariationDemoRuntime } from
  "../src/main/amazon/variation-demo-runtime";
import type {
  VariationFamilyMember,
  VariationFamilySnapshot,
} from "../src/main/amazon/variation-family";
import type {
  FbaVariationGroupingData,
  VariationGroupingSourceRow,
} from "../src/main/amazon/variation-catalog-reads";
import {
  createVariationGroupingRuntime,
  type VariationGroupingLiveReader,
  type VariationGroupingReadInput,
} from "../src/main/amazon/variation-grouping-runtime";

const US = "ATVPDKIKX0DER" as const;
const NOW = new Date("2026-08-27T07:08:09.000Z");

type SourceRow = Readonly<{
  sellerSku: string;
  asin: string;
  title: string;
  sourceOrdinal: number;
}>;

function sourceRow(
  sellerSku: string,
  asin: string,
  sourceOrdinal: number,
): SourceRow {
  return {
    sellerSku,
    asin,
    title: `Listing ${sellerSku}`,
    sourceOrdinal,
  };
}

function member(input: Readonly<{
  sellerSku: string;
  asin?: string | null;
  role?: "parent" | "child" | "standalone";
  parentSku?: string | null;
  theme?: string | null;
}>): VariationFamilyMember {
  return {
    sellerSku: input.sellerSku,
    asin: input.asin ?? "B000000001",
    title: `Family ${input.sellerSku}`,
    productType: "PET_SUPPLIES",
    status: ["BUYABLE"],
    role: input.role ?? "standalone",
    parentSku: input.parentSku ?? null,
    childSkus: [],
    variationTheme: input.theme ?? null,
    dimensions: [],
    fba: true,
    issues: [],
    relationshipSources: ["relationships"],
  };
}

function family(queried: VariationFamilyMember): VariationFamilySnapshot {
  return {
    mode: "demo",
    marketplaceId: US,
    queriedSku: queried.sellerSku,
    queriedRole: queried.role,
    queried,
    parent: null,
    children: [],
    excludedChildren: [],
    variationTheme: queried.variationTheme,
    dimensionNames: [],
    familyComplete: true,
    fetchedAt: NOW.toISOString(),
    requestIds: [],
    writable: false,
    boundaries: [],
    notice: "Demo family",
  };
}

function harness(mode: "live" | "demo" = "demo") {
  const readFamily = vi.fn((_: typeof US, sellerSku: string) =>
    family(member({ sellerSku }))
  );
  const demo = {
    readFamily,
  } satisfies Pick<VariationDemoRuntime, "readFamily">;
  const liveCalls: VariationGroupingReadInput<VariationGroupingSourceRow>[] =
    [];
  let nextLiveResult: unknown;
  const readLive: VariationGroupingLiveReader = async <
    Row extends VariationGroupingSourceRow,
  >(
    input: VariationGroupingReadInput<Row>,
  ): Promise<FbaVariationGroupingData<Row>> => {
    liveCalls.push(input);
    if (nextLiveResult) {
      return nextLiveResult as FbaVariationGroupingData<Row>;
    }
    return {
      marketplaceId: input.marketplaceId,
      fetchedAt: NOW.toISOString(),
      rows: input.rows.map((row) => ({
        ...row,
        role: "standalone" as const,
        parentSku: null,
        familyKey: row.sellerSku,
        theme: null,
        status: "complete" as const,
        message: "Live grouping",
      })),
      notice: "Live grouping notice",
    };
  };
  return {
    readFamily,
    liveCalls,
    setLiveResult(value: unknown) {
      nextLiveResult = value;
    },
    runtime: createVariationGroupingRuntime({
      resolveMode: () => mode,
      demo,
      readLive,
      now: () => NOW,
    }),
  };
}

describe("variation grouping runtime", () => {
  it("keeps generic source fields while grouping exact demo families", async () => {
    const state = harness();
    state.readFamily.mockImplementation((_, sellerSku) =>
      family(member(
        sellerSku === "CHILD"
          ? {
              sellerSku,
              asin: "B000000001",
              role: "child",
              parentSku: "PARENT",
              theme: "SIZE_NAME",
            }
          : {
              sellerSku,
              asin: "B000000002",
              role: "standalone",
            },
      ))
    );
    const rows = [
      sourceRow("CHILD", "B000000001", 1),
      sourceRow("STANDALONE", "B000000002", 2),
    ];

    const grouped = await state.runtime.read({
      marketplaceId: US,
      rows,
    });

    expect(grouped).toEqual({
      marketplaceId: US,
      fetchedAt: NOW.toISOString(),
      rows: [
        {
          ...rows[0],
          role: "child",
          parentSku: "PARENT",
          familyKey: "PARENT",
          theme: "SIZE_NAME",
          status: "complete",
          message:
            "Amazon relationships 已證明此 SKU 屬於 parent PARENT。",
        },
        {
          ...rows[1],
          role: "standalone",
          parentSku: null,
          familyKey: "STANDALONE",
          theme: null,
          status: "complete",
          message: "Amazon relationships 已證明此 SKU 為 standalone。",
        },
      ],
      notice:
        "展示資料沿用內建 parent／child relationships；不以商品名稱或 ASIN 相似度猜測 family。",
    });
    expect(grouped.rows.map((row) => row.sourceOrdinal)).toEqual([1, 2]);
    expect(state.liveCalls).toEqual([]);
  });

  it("stops on a duplicate exact Seller SKU before reading it twice", async () => {
    const state = harness();
    const rows = [
      sourceRow("DUPLICATE", "B000000001", 1),
      sourceRow("DUPLICATE", "B000000001", 2),
    ];

    await expect(state.runtime.read({ marketplaceId: US, rows }))
      .rejects.toMatchObject({
        status: 409,
        code: "PAGINATION_CHANGED",
        message: "全商品匯出含有重複 Seller SKU，已停止變體分組。",
      });
    expect(state.readFamily).toHaveBeenCalledOnce();
  });

  it("keeps a SKU or ASIN mismatch as an incomplete original row", async () => {
    const state = harness();
    state.readFamily.mockReturnValue(family(member({
      sellerSku: "OTHER-SKU",
      asin: "B000000099",
    })));
    const row = sourceRow("EXPECTED-SKU", "B000000001", 7);

    await expect(state.runtime.read({ marketplaceId: US, rows: [row] }))
      .resolves.toMatchObject({
        rows: [{
          ...row,
          role: "unknown",
          parentSku: null,
          familyKey: "EXPECTED-SKU",
          theme: null,
          status: "incomplete",
          message:
            "展示 relationships 的 SKU／ASIN 與匯出列不一致；未建立 family 分組。",
        }],
      });
  });

  it("preserves SpApiError messages and stabilizes unknown demo failures", async () => {
    const state = harness();
    const rows = [
      sourceRow("SP-ERROR", "B000000001", 1),
      sourceRow("UNKNOWN-ERROR", "B000000002", 2),
    ];
    state.readFamily.mockImplementation((_, sellerSku) => {
      if (sellerSku === "SP-ERROR") {
        throw new SpApiError("展示資料找不到這個 SKU。", {
          status: 404,
          code: "SKU_NOT_FOUND",
        });
      }
      throw new Error("private failure");
    });

    const grouped = await state.runtime.read({ marketplaceId: US, rows });

    expect(grouped.rows.map((row) => row.message)).toEqual([
      "展示資料找不到這個 SKU。",
      "展示 relationships 無法安全判定。",
    ]);
    expect(grouped.rows.every((row) => row.status === "incomplete")).toBe(
      true,
    );
  });

  it("forwards the exact live input, signal and progress callback unchanged", async () => {
    const state = harness("live");
    const controller = new AbortController();
    const onProgress = vi.fn();
    const input = {
      marketplaceId: US,
      rows: [sourceRow("LIVE-SKU", "B000000001", 3)],
      signal: controller.signal,
      onProgress,
    };
    const expected = {
      marketplaceId: US,
      fetchedAt: NOW.toISOString(),
      rows: [{
        ...input.rows[0],
        role: "standalone" as const,
        parentSku: null,
        familyKey: "LIVE-SKU",
        theme: null,
        status: "complete" as const,
        message: "Live result",
      }],
      notice: "Live notice",
    };
    state.setLiveResult(expected);

    const grouped = await state.runtime.read(input);

    expect(grouped).toBe(expected);
    expect(state.liveCalls).toHaveLength(1);
    expect(state.liveCalls[0]).toBe(input);
    expect(state.readFamily).not.toHaveBeenCalled();
  });

  it("honors an already-aborted signal before selecting either mode", async () => {
    const state = harness();
    const controller = new AbortController();
    const reason = new Error("stop grouping");
    controller.abort(reason);

    await expect(state.runtime.read({
      marketplaceId: US,
      rows: [sourceRow("SKU", "B000000001", 1)],
      signal: controller.signal,
    })).rejects.toBe(reason);
    expect(state.readFamily).not.toHaveBeenCalled();
    expect(state.liveCalls).toEqual([]);
  });
});
