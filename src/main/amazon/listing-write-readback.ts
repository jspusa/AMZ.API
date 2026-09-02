import { abortableDelay, throwIfAborted } from "../abort-utils";
import { SpApiError } from "./sp-api-error";

/**
 * Trusted evidence that one exact write was accepted and every bounded
 * canonical GET completed successfully, but the target value was not visible
 * before the readback window ended. Batch owners may isolate this exact intent
 * without treating an auth, throttling, transport, or server error as local.
 */
export class ListingWriteAcceptedButPendingError extends SpApiError {
  constructor() {
    super(
      "Amazon 已接受寫入，但在安全回查期限內尚未取得相符結果。系統已禁止自動重送，請重新讀取 Amazon 確認。",
      { status: 503, code: "UPDATE_STATUS_UNKNOWN" },
    );
    this.name = "ListingWriteAcceptedButPendingError";
  }
}

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

  if (lastError === null) {
    throw new ListingWriteAcceptedButPendingError();
  }
  throw new SpApiError(
    "Amazon 已接受寫入，但安全回查遇到無法安全歸屬單一商品的錯誤。系統已禁止自動重送，請重新讀取 Amazon 確認。",
    {
      status: 503,
      code: "UPDATE_STATUS_UNKNOWN",
      requestId: lastError instanceof SpApiError ? lastError.requestId : null,
    },
  );
}
