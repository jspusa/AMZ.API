import { abortableDelay, throwIfAborted } from "../abort-utils";
import { SpApiError } from "./sp-api-error";
import type {
  ListingContentSnapshot,
  ListingContentUpdateResult,
} from "./sp-api";

export type ListingWriteLifecycleEvidence = Readonly<{
  state: "verified";
  verified: true;
  authoritative: true;
  acceptedAt: string;
  verifiedAt: string;
  attempts: number;
}>;

export type VerifiedListingWrite<T> = T & Readonly<{
  writeLifecycle: ListingWriteLifecycleEvidence;
}>;

type ReadbackDecision = "verified" | "pending";

type ReadbackInput<TResult, TSnapshot> = Readonly<{
  commit: () => Promise<TResult>;
  onAccepted?: (result: TResult) => Promise<void>;
  assertCurrent?: () => Promise<void>;
  read: () => Promise<TSnapshot>;
  decide: (result: TResult, snapshot: TSnapshot) => ReadbackDecision;
  signal?: AbortSignal;
  delaysMs?: readonly number[];
  delay?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  now?: () => Date;
}>;

async function assertAcceptedReadbackContext(
  assertCurrent: (() => Promise<void>) | undefined,
): Promise<void> {
  if (!assertCurrent) return;
  try {
    await assertCurrent();
  } catch (error) {
    throw new SpApiError(
      "Amazon 可能已接受寫入，但執行環境在安全回查前改變；系統已禁止重送，請重新讀取 Amazon 確認。",
      {
        status: 503,
        code: "UPDATE_STATUS_UNKNOWN",
        requestId: error instanceof SpApiError ? error.requestId : null,
      },
    );
  }
}

const DEFAULT_READBACK_DELAYS_MS = [
  0,
  1_000,
  2_000,
  4_000,
  8_000,
  15_000,
  30_000,
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function acceptedBase(value: unknown): value is Record<string, unknown> & {
  mode: "live";
  status: "ACCEPTED";
  marketplaceId: string;
  sellerSku: string;
} {
  return isRecord(value) &&
    value.mode === "live" &&
    value.status === "ACCEPTED" &&
    typeof value.marketplaceId === "string" &&
    typeof value.sellerSku === "string" &&
    stringOrNull(value.submissionId) &&
    stringOrNull(value.requestId) &&
    Array.isArray(value.issues) &&
    typeof value.notice === "string";
}

function verifiedResult<T extends {
  acceptedAt?: string;
  completedAt?: string;
  notice?: string;
}>(
  result: T,
  attempts: number,
  now: () => Date,
): VerifiedListingWrite<T> | null {
  const acceptedAt = result.acceptedAt ?? result.completedAt;
  if (typeof acceptedAt !== "string") return null;
  return {
    ...result,
    ...(typeof result.notice === "string"
      ? { notice: `${result.notice} 主程序唯讀回查已確認此次目標值。` }
      : {}),
    writeLifecycle: {
      state: "verified",
      verified: true,
      authoritative: true,
      acceptedAt,
      verifiedAt: now().toISOString(),
      attempts,
    },
  };
}

function exactIdentity(
  result: { mode: "live" | "demo"; marketplaceId: string; sellerSku: string },
  snapshot: { mode: "live" | "demo"; marketplaceId: string; sellerSku: string },
): boolean {
  return result.mode === "live" &&
    snapshot.mode === "live" &&
    result.marketplaceId === snapshot.marketplaceId &&
    result.sellerSku === snapshot.sellerSku;
}

function canonicalText(value: string): string {
  return value.replace(/\r\n?/gu, "\n").trim();
}

function changedFieldHasError(
  snapshot: ListingContentSnapshot,
  changedFields: ListingContentUpdateResult["changedFields"],
): boolean {
  const attributes = new Set(
    changedFields.flatMap((field) => {
      if (field === "title") return ["item_name", "title"];
      if (field === "itemHighlight") {
        return ["title_differentiation", "itemHighlight"];
      }
      if (field === "bulletPoints") {
        return ["bullet_point", "bulletPoints"];
      }
      if (field === "productDescription") {
        return ["product_description", "productDescription"];
      }
      return ["ingredients"];
    }),
  );
  return snapshot.issues.some((issue) =>
    issue.severity === "ERROR" &&
    (issue.attributeNames.length === 0 ||
      issue.attributeNames.some((name) => attributes.has(name))),
  );
}

export function contentReadbackDecision(
  result: ListingContentUpdateResult,
  snapshot: ListingContentSnapshot,
): ReadbackDecision {
  if (!exactIdentity(result, snapshot) ||
      changedFieldHasError(snapshot, result.changedFields)) {
    return "pending";
  }
  for (const field of result.changedFields) {
    if (field === "title") {
      if (!snapshot.attributePresence.title ||
          canonicalText(snapshot.title) !== canonicalText(result.requested.title)) {
        return "pending";
      }
    }
    if (field === "itemHighlight") {
      if (!snapshot.attributePresence.itemHighlight ||
          canonicalText(snapshot.itemHighlight) !==
            canonicalText(result.requested.itemHighlight)) {
        return "pending";
      }
    }
    if (field === "ingredients") {
      if (!snapshot.attributePresence.ingredients ||
          canonicalText(snapshot.ingredients) !== canonicalText(result.requested.ingredients)) {
        return "pending";
      }
    }
    if (field === "productDescription") {
      if (!snapshot.attributePresence.productDescription ||
          canonicalText(snapshot.productDescription) !==
            canonicalText(result.requested.productDescription)) {
        return "pending";
      }
    }
    if (field === "bulletPoints") {
      if (!snapshot.attributePresence.bulletPoints) return "pending";
      const actual = snapshot.bulletPoints.map(canonicalText);
      const requested = result.requested.bulletPoints.map(canonicalText);
      if (actual.length !== requested.length ||
          actual.some((value, index) => value !== requested[index])) {
        return "pending";
      }
    }
  }
  return "verified";
}

export function reconcileContentWrite(
  response: unknown,
  snapshot: ListingContentSnapshot,
  now: () => Date = () => new Date(),
): unknown | null {
  if (!acceptedBase(response) ||
      typeof response.acceptedAt !== "string" ||
      !isRecord(response.requested) ||
      typeof response.requested.title !== "string" ||
      typeof response.requested.itemHighlight !== "string" ||
      !Array.isArray(response.requested.bulletPoints) ||
      !response.requested.bulletPoints.every((value) => typeof value === "string") ||
      typeof response.requested.productDescription !== "string" ||
      typeof response.requested.ingredients !== "string" ||
      !Array.isArray(response.changedFields) ||
      !response.changedFields.every((value) =>
        value === "title" ||
        value === "itemHighlight" ||
        value === "bulletPoints" ||
        value === "productDescription" ||
        value === "ingredients")) {
    return null;
  }
  const result = response as unknown as ListingContentUpdateResult;
  return contentReadbackDecision(result, snapshot) === "verified"
    ? verifiedResult(result, 0, now)
    : null;
}

/**
 * Runs one write exactly once, then performs only bounded canonical GET reads.
 *
 * The caller's durable idempotency ledger does not mark the operation complete
 * until this function returns. Once a live write has been accepted, every
 * readback failure is deliberately converted to UPDATE_STATUS_UNKNOWN so the
 * ledger blocks automatic re-submission.
 */
export async function commitWithCanonicalReadback<TResult extends {
  mode: "live" | "demo";
  status: "VALID" | "ACCEPTED" | "SIMULATED";
  acceptedAt?: string;
  completedAt?: string;
  notice?: string;
}, TSnapshot>(
  input: ReadbackInput<TResult, TSnapshot>,
): Promise<VerifiedListingWrite<TResult>> {
  throwIfAborted(input.signal);
  await input.assertCurrent?.();
  const result = await input.commit();
  if (result.status === "VALID") {
    throw new SpApiError(
      "Amazon 寫入流程只回傳了預檢狀態，無法證明正式送出；系統已禁止重送。",
      { status: 503, code: "UPDATE_STATUS_UNKNOWN" },
    );
  }
  const acceptedAt = result.acceptedAt ?? result.completedAt;
  if (!acceptedAt) {
    throw new SpApiError(
      "Amazon 寫入已回傳，但缺少可核對的接受時間；系統已禁止重送。",
      { status: 503, code: "UPDATE_STATUS_UNKNOWN" },
    );
  }
  if (result.mode === "demo") {
    await input.assertCurrent?.();
    return verifiedResult(result, 0, input.now ?? (() => new Date()))!;
  }

  await input.onAccepted?.(result);
  await assertAcceptedReadbackContext(input.assertCurrent);

  const delays = input.delaysMs ?? DEFAULT_READBACK_DELAYS_MS;
  const delay = input.delay ?? abortableDelay;
  let lastError: unknown = null;
  for (let index = 0; index < delays.length; index += 1) {
    throwIfAborted(input.signal);
    if (delays[index] > 0) await delay(delays[index], input.signal);
    throwIfAborted(input.signal);
    await assertAcceptedReadbackContext(input.assertCurrent);
    try {
      const snapshot = await input.read();
      await assertAcceptedReadbackContext(input.assertCurrent);
      throwIfAborted(input.signal);
      if (input.decide(result, snapshot) === "verified") {
        return verifiedResult(
          result,
          index + 1,
          input.now ?? (() => new Date()),
        )!;
      }
    } catch (error) {
      lastError = error;
      throwIfAborted(input.signal);
    }
  }

  throw new SpApiError(
    "Amazon 已接受寫入，但在安全回查期限內尚未取得相符結果。系統已禁止自動重送，請重新讀取 Amazon 確認。",
    {
      status: 503,
      code: "UPDATE_STATUS_UNKNOWN",
      requestId: lastError instanceof SpApiError ? lastError.requestId : null,
    },
  );
}
