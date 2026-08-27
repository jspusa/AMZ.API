import { abortableDelay } from "../abort-utils";
import {
  MARKETPLACES,
  marketplaceById,
  type MarketplaceId,
  type MarketplaceRegion,
} from "../../shared/marketplaces";
import { spApiUserAgent } from "./sp-api-runtime";
import { SpApiError, SpApiPreCommitError } from "./sp-api-error";

const REGION_ENDPOINTS: Readonly<Record<MarketplaceRegion, string>> = {
  na: "https://sellingpartnerapi-na.amazon.com",
  eu: "https://sellingpartnerapi-eu.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
};

const LISTINGS_WRITE_DEADLINE_MS = 12_000;
const LISTINGS_WRITE_RESPONSE_MAX_BYTES = 1_048_576;

type ListingsWriteIdentity = Readonly<{
  marketplaceId: MarketplaceId;
  sellerSku: string;
  patchBody: unknown;
}>;

export type ListingsValidationPreviewCommand = ListingsWriteIdentity &
  Readonly<{
    includeIdentifiers?: boolean;
  }>;

export type ListingsCommitOnceCommand = ListingsWriteIdentity &
  Readonly<{
    assertBeforeSend: () => Promise<void>;
    recordBeforeSend?: () => Promise<void>;
  }>;

export type ListingsWriteReceipt = Readonly<{
  ok: boolean;
  status: number;
  requestId: string | null;
  retryAfter: string | null;
  payload: unknown | null;
}>;

export interface ListingsWriteProduction {
  validationPreview(
    command: ListingsValidationPreviewCommand,
  ): Promise<ListingsWriteReceipt>;
  commitOnce(command: ListingsCommitOnceCommand): Promise<ListingsWriteReceipt>;
}

export type ListingsWriteProductionDependencies = Readonly<{
  getAccessToken(
    region: MarketplaceRegion,
    forceRefresh?: boolean,
  ): Promise<string>;
  invalidateAccessToken(region: MarketplaceRegion): void;
  getSellerId(region: MarketplaceRegion): string | null;
}>;

type FixedWriteCommand = ListingsWriteIdentity &
  Readonly<{
    intent: "validation-preview" | "commit";
    includeIdentifiers: boolean;
    assertBeforeSend?: () => Promise<void>;
    recordBeforeSend?: () => Promise<void>;
  }>;

function toAmzDate(date = new Date()): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 8_000);
  }
  return Math.min(500 * 2 ** attempt + Math.random() * 250, 5_000);
}

async function readResponseJson(
  response: Response,
  signal: AbortSignal,
  isCommit: boolean,
): Promise<unknown | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let totalBytes = 0;
  let rejectAborted: ((reason: Error) => void) | null = null;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAborted = reject;
  });
  const onAbort = () => rejectAborted?.(new Error("Listings write aborted"));
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), aborted]);
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > LISTINGS_WRITE_RESPONSE_MAX_BYTES) {
        throw new SpApiError(
          isCommit
            ? "Amazon Listing 更新回應超過安全上限，送出結果無法確認。請先回查 SKU。"
            : "Amazon Listings API 回應超過安全上限。",
          {
            status: isCommit ? 503 : 502,
            code: isCommit
              ? "UPDATE_STATUS_UNKNOWN"
              : "UPSTREAM_UNAVAILABLE",
            operation: "patchListingsItem",
          },
        );
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    if (!text.trim()) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (error instanceof SpApiError) throw error;
    throw new SpApiError(
      signal.aborted
        ? isCommit
          ? "Amazon Listing 更新請求逾時，結果可能仍在處理。請先重新查詢 SKU，不要直接重送。"
          : "Amazon Listings API 回應逾時，請稍後再試。"
        : isCommit
          ? "Amazon Listing 更新回應中斷，結果可能仍在處理。請先重新查詢 SKU。"
          : "Amazon Listings API 回應中斷，請稍後再試。",
      {
        status: signal.aborted ? 504 : 502,
        code: isCommit ? "UPDATE_STATUS_UNKNOWN" : "UPSTREAM_UNAVAILABLE",
        operation: "patchListingsItem",
      },
    );
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function assertBeforeSend(
  assertion: (() => Promise<void>) | undefined,
): Promise<void> {
  if (!assertion) return;
  try {
    await assertion();
  } catch (error) {
    const cause = error instanceof SpApiError
      ? error
      : new SpApiError(
          "Amazon 執行環境在正式 Listing PATCH 前改變，已停止送出。",
          { status: 409, code: "SP_CONTEXT_INVALIDATED" },
        );
    throw new SpApiPreCommitError(cause);
  }
}

function immutableReceipt(
  response: Response,
  payload: unknown | null,
): ListingsWriteReceipt {
  return Object.freeze({
    ok: response.ok,
    status: response.status,
    requestId: response.headers.get("x-amzn-requestid"),
    retryAfter: response.headers.get("retry-after"),
    payload,
  });
}

export function createListingsWriteProduction(
  dependencies: ListingsWriteProductionDependencies,
): ListingsWriteProduction {
  const send = async (
    command: FixedWriteCommand,
    forceTokenRefresh = false,
  ): Promise<Readonly<{ response: Response; receipt: ListingsWriteReceipt }>> => {
    const marketplace = marketplaceById(command.marketplaceId);
    if (!marketplace) {
      throw new SpApiError("不支援的 Amazon 站點。", {
        status: 400,
        code: "UNSUPPORTED_MARKETPLACE",
      });
    }
    const sellerId = dependencies.getSellerId(marketplace.region);
    if (!sellerId) {
      const label = marketplace.label.replace(/站$/u, "");
      throw new SpApiError(
        `${label}站尚未設定 Seller ID，SKU 寫入功能仍未啟用。`,
        { status: 503, code: "LISTINGS_NOT_CONFIGURED" },
      );
    }

    const token = await dependencies.getAccessToken(
      marketplace.region,
      forceTokenRefresh,
    );
    const query = new URLSearchParams({
      marketplaceIds: command.marketplaceId,
      issueLocale: marketplace.locale.replace("-", "_"),
      includedData:
        command.intent === "validation-preview" && command.includeIdentifiers
          ? "identifiers,issues"
          : "issues",
    });
    if (command.intent === "validation-preview") {
      query.set("mode", "VALIDATION_PREVIEW");
    }
    const url = `${REGION_ENDPOINTS[marketplace.region]}/listings/2021-08-01/items/${encodeURIComponent(
      sellerId,
    )}/${encodeURIComponent(command.sellerSku)}?${query}`;

    await assertBeforeSend(command.assertBeforeSend);
    if (command.recordBeforeSend) {
      try {
        await command.recordBeforeSend();
      } catch {
        throw new SpApiPreCommitError(new SpApiError(
          "正式 Listing PATCH 送出前無法保存防重送證據，已停止送出。",
          { status: 500, code: "PRECOMMIT_FAILED" },
        ));
      }
    }
    await assertBeforeSend(command.assertBeforeSend);

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      LISTINGS_WRITE_DEADLINE_MS,
    );
    const isCommit = command.intent === "commit";
    try {
      const response = await fetch(url, {
        method: "PATCH",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-amz-access-token": token,
          "x-amz-date": toAmzDate(),
          "user-agent": spApiUserAgent(),
        },
        body: JSON.stringify(command.patchBody),
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      const payload = await readResponseJson(
        response,
        controller.signal,
        isCommit,
      );
      return Object.freeze({
        response,
        receipt: immutableReceipt(response, payload),
      });
    } catch (error) {
      if (error instanceof SpApiError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new SpApiError(
          isCommit
            ? "Amazon Listing 更新請求逾時，結果可能仍在處理。請先重新查詢 SKU，不要直接重送。"
            : "Amazon Listings API 回應逾時，請稍後再試。",
          {
            status: 504,
            code: isCommit
              ? "UPDATE_STATUS_UNKNOWN"
              : "UPSTREAM_UNAVAILABLE",
          },
        );
      }
      throw new SpApiError(
        isCommit
          ? "Listing 更新連線中斷，結果可能仍在處理。請先重新查詢 SKU。"
          : "目前無法連線至 Amazon Listings API。",
        {
          status: 502,
          code: isCommit ? "UPDATE_STATUS_UNKNOWN" : "UPSTREAM_UNAVAILABLE",
        },
      );
    } finally {
      clearTimeout(timeout);
    }
  };

  const production: ListingsWriteProduction = {
    validationPreview: async (command) => {
      const fixedCommand: FixedWriteCommand = {
        ...command,
        intent: "validation-preview",
        includeIdentifiers: command.includeIdentifiers === true,
      };
      let result = await send(fixedCommand);
      if (result.response.status === 401) {
        const region = MARKETPLACES.find(
          (marketplace) => marketplace.id === command.marketplaceId,
        )!.region;
        dependencies.invalidateAccessToken(region);
        result = await send(fixedCommand, true);
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (![429, 500, 503].includes(result.response.status)) break;
        await abortableDelay(retryDelayMs(result.response, attempt));
        result = await send(fixedCommand);
      }
      return result.receipt;
    },
    commitOnce: async (command) => {
      const result = await send({
        ...command,
        intent: "commit",
        includeIdentifiers: false,
      });
      return result.receipt;
    },
  };
  return Object.freeze(production);
}
