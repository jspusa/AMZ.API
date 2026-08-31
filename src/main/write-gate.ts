import { createHash, randomUUID as nodeRandomUUID } from "node:crypto";
import type { MarketplaceId } from "../shared/marketplaces";
import type {
  IdempotentOperationAvailabilityInput,
  LedgerOperationType,
  LocalStore,
} from "./local-store";
import {
  SpExecutionContextError,
  type SpExecutionContext,
  type SpExecutionContextAdapter,
} from "./amazon/sp-execution-context";
import { SpApiError, SpApiPreCommitError } from "./amazon/sp-api-error";

export type WriteOperation = LedgerOperationType | "business_price_repair";

export type WritePreviewFamily =
  | "business-price"
  | "variation-move"
  | "standard-price"
  | "content"
  | "images"
  | "sale-price"
  | "content-batch";

export type WriteIntent = Readonly<{
  intentId: string;
  operation: WriteOperation;
  marketplaceId: MarketplaceId;
  sellerSku: string;
  idempotencyKey: string;
  proposalFingerprint: string;
}>;

export type WriteBinding = Readonly<{
  family: WritePreviewFamily;
  previewKey: string;
  context: SpExecutionContext;
  intents: readonly [WriteIntent, ...WriteIntent[]];
}>;

export type MainWriteAttemptControl<T> = Readonly<{
  /** Saves recoverable target evidence without claiming upstream acceptance. */
  recordDurableEvidence?(response: T): Promise<void>;
  /** Compatibility alias for domains that call this only after ACCEPTED. */
  recordAccepted(response: T): Promise<void>;
  assertCurrent(): Promise<void>;
}>;

export type MainWriteAttemptInput<T> = Readonly<{
  intentId: string;
  execute(control: MainWriteAttemptControl<T>): Promise<T>;
}>;

export interface MainWriteGateSession {
  attempt<T>(input: MainWriteAttemptInput<T>): Promise<T>;
}

export type MainWriteGateCancellationMessage =
  | "操作已取消；Amazon 沒有收到任何變更。"
  | "操作已取消；Amazon 沒有收到任何文案變更。";

export type MainWriteGateExecuteInput<T> = Readonly<{
  binding: WriteBinding;
  approvalReason: string | ((verificationCode: string) => string);
  cancellationMessage?: MainWriteGateCancellationMessage;
  beforeApproval?: () => Promise<void>;
  run(session: MainWriteGateSession): Promise<T>;
}>;

export type MainWriteGateReconcileInput<TSnapshot> = Readonly<{
  context: SpExecutionContext;
  marketplaceId: MarketplaceId;
  sellerSku: string;
  operations: readonly LedgerOperationType[];
  snapshot: TSnapshot;
  project(
    response: unknown,
    operation: LedgerOperationType,
    snapshot: TSnapshot,
  ): unknown | null;
}>;

export type MainWriteGateInspection = Readonly<{
  operationType: LedgerOperationType;
  state: "pending" | "completed" | "unknown";
  response: unknown | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}>;

export type MainWriteGateInspectInput<TResult> = Readonly<{
  context: SpExecutionContext;
  marketplaceId: MarketplaceId;
  sellerSku: string;
  operations: readonly LedgerOperationType[];
  project(inspection: MainWriteGateInspection): TResult | null;
}>;

export interface MainWriteGatePort {
  stagePreview(binding: WriteBinding): Promise<void>;
  execute<T>(input: MainWriteGateExecuteInput<T>): Promise<T>;
  inspect?<TResult>(
    input: MainWriteGateInspectInput<TResult>,
  ): Promise<readonly TResult[]>;
  reconcile<TSnapshot>(
    input: MainWriteGateReconcileInput<TSnapshot>,
  ): Promise<void>;
  clearEphemeral(): void;
}

export type MainWriteGateErrorCode =
  | "PREVIEW_EXPIRED"
  | "PREVIEW_CHANGED"
  | "OPERATION_IN_PROGRESS"
  | "ACTION_CANCELLED"
  | "IDEMPOTENCY_CONFLICT"
  | "WRITE_BINDING_INVALID"
  | "WRITE_SESSION_CLOSED"
  | "WRITE_INTENT_INVALID";

const GATE_ERRORS: Readonly<
  Record<MainWriteGateErrorCode, Readonly<{ status: number; message: string }>>
> = {
  PREVIEW_EXPIRED: {
    status: 409,
    message: "這次 Amazon 預檢已過期，請重新預檢後再送出。",
  },
  PREVIEW_CHANGED: {
    status: 409,
    message: "預檢後的內容已改變，系統已停止送出；請重新預檢。",
  },
  OPERATION_IN_PROGRESS: {
    status: 409,
    message: "同一筆操作正在等待本機確認，系統已阻止重複送出。",
  },
  ACTION_CANCELLED: {
    status: 409,
    message: "操作已取消；Amazon 沒有收到任何變更。",
  },
  IDEMPOTENCY_CONFLICT: {
    status: 409,
    message: "批次包含重複 SKU，已停止送出。",
  },
  WRITE_BINDING_INVALID: {
    status: 500,
    message: "Amazon 寫入安全綁定無效；系統已停止送出。",
  },
  WRITE_SESSION_CLOSED: {
    status: 500,
    message: "Amazon 寫入工作階段已結束；系統已停止送出。",
  },
  WRITE_INTENT_INVALID: {
    status: 500,
    message: "Amazon 寫入意圖無效或已使用；系統已停止送出。",
  },
};

type MainWriteGateMessageOverride =
  | MainWriteGateCancellationMessage
  | "同一 SKU 的商品內容、圖片或價格正在處理，系統已阻止重疊送出。";

export class MainWriteGateError extends Error {
  readonly status: number;
  readonly code: MainWriteGateErrorCode;

  constructor(
    code: MainWriteGateErrorCode,
    messageOverride?: MainWriteGateMessageOverride,
  ) {
    const definition = GATE_ERRORS[code];
    super(messageOverride ?? definition.message);
    this.name = "MainWriteGateError";
    this.status = definition.status;
    this.code = code;
  }
}

type WriteLedgerPort = Pick<
  LocalStore,
  | "runIdempotentOperation"
  | "assertIdempotentOperationsAvailable"
  | "reconcileIdempotentOperations"
> & Partial<Pick<LocalStore, "inspectIdempotentOperations">>;

export type MainWriteGateDependencies = Readonly<{
  store: WriteLedgerPort;
  context: SpExecutionContextAdapter;
  approveWrite(reason: string): Promise<void>;
  now?: () => number;
  randomUUID?: () => string;
}>;

type PreviewTicket = {
  family: WritePreviewFamily;
  previewKey: string;
  context: SpExecutionContext;
  bindingFingerprint: string;
  expiresAt: number;
  generation: number;
  ownerToken: string | null;
};

type DurableIntent = Readonly<{
  intent: WriteIntent;
  idempotencyKey: string;
  fingerprint: string;
  operationType: LedgerOperationType;
  businessPriceDuplicateRepair: boolean;
}>;

const STANDARD_PREVIEW_TTL_MS = 2 * 60_000;
const CONTENT_BATCH_PREVIEW_TTL_MS = 15 * 60_000;

const OPERATIONS_BY_FAMILY: Readonly<
  Record<WritePreviewFamily, ReadonlySet<WriteOperation>>
> = {
  "business-price": new Set([
    "price",
    "business_price",
    "business_price_repair",
  ]),
  "variation-move": new Set(["variation_detach", "variation_attach"]),
  "standard-price": new Set(["price"]),
  content: new Set(["content"]),
  images: new Set(["images"]),
  "sale-price": new Set(["sale_price"]),
  "content-batch": new Set(["content"]),
};

function stableFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sameContext(
  left: SpExecutionContext,
  right: SpExecutionContext,
): boolean {
  return left.marketplaceId === right.marketplaceId &&
    left.region === right.region &&
    left.mode === right.mode &&
    left.accountScope === right.accountScope &&
    left.generation === right.generation;
}

function bindingFingerprint(binding: WriteBinding): string {
  return stableFingerprint([
    binding.family,
    binding.previewKey,
    binding.context.marketplaceId,
    binding.context.region,
    binding.context.mode,
    binding.context.accountScope,
    binding.context.generation,
    binding.intents.map((intent) => [
      intent.intentId,
      intent.operation,
      intent.marketplaceId,
      intent.sellerSku,
      intent.idempotencyKey,
      intent.proposalFingerprint,
    ]),
  ]);
}

function previewTicketKey(binding: WriteBinding): string {
  return `${binding.family}\u0000${binding.previewKey}`;
}

function listingAttributeReservationKey(intent: WriteIntent): string {
  return `${intent.marketplaceId}\u0000${intent.sellerSku}`;
}

function usesListingAttributeReservations(family: WritePreviewFamily): boolean {
  return family === "business-price" ||
    family === "standard-price" ||
    family === "sale-price" ||
    family === "content" ||
    family === "images" ||
    family === "content-batch";
}

function previewTtl(family: WritePreviewFamily): number {
  return family === "content-batch"
    ? CONTENT_BATCH_PREVIEW_TTL_MS
    : STANDARD_PREVIEW_TTL_MS;
}

function normalizeAmbiguousExecutionError(error: unknown): unknown {
  if (
    error instanceof SpApiPreCommitError ||
    !(error instanceof SpApiError) ||
    ![401, 429].includes(error.status) ||
    error.code === "UPDATE_STATUS_UNKNOWN"
  ) {
    return error;
  }
  return new SpApiError(
    `${error.message} Amazon 可能已收到這筆 PATCH；系統已禁止重送，請先回查。`,
    {
      status: error.status,
      code: "UPDATE_STATUS_UNKNOWN",
      requestId: error.requestId,
      retryAfter: error.retryAfter,
      issues: [...error.issues],
      operation: error.operation,
      upstreamCode: error.upstreamCode,
    },
  );
}

export class MainWriteGate implements MainWriteGatePort {
  private readonly store: WriteLedgerPort;
  private readonly context: SpExecutionContextAdapter;
  private readonly approveWrite: (reason: string) => Promise<void>;
  private readonly now: () => number;
  private readonly randomUUID: () => string;
  private readonly tickets = new Map<string, PreviewTicket>();
  private readonly listingAttributeReservations = new Map<string, string>();
  private ephemeralGeneration = 0;

  constructor(input: MainWriteGateDependencies) {
    this.store = input.store;
    this.context = input.context;
    this.approveWrite = input.approveWrite;
    this.now = input.now ?? Date.now;
    this.randomUUID = input.randomUUID ?? nodeRandomUUID;
  }

  async stagePreview(binding: WriteBinding): Promise<void> {
    this.assertValidBinding(binding);
    const generation = this.ephemeralGeneration;
    await this.context.assertCurrent(binding.context);
    if (generation !== this.ephemeralGeneration) {
      throw new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "Amazon 執行環境已更新；請重新開始這次操作。",
      );
    }

    this.pruneExpiredTickets();
    const key = previewTicketKey(binding);
    const existing = this.tickets.get(key);
    if (existing?.ownerToken) {
      throw new MainWriteGateError("OPERATION_IN_PROGRESS");
    }
    this.tickets.set(key, {
      family: binding.family,
      previewKey: binding.previewKey,
      context: binding.context,
      bindingFingerprint: bindingFingerprint(binding),
      expiresAt: this.now() + previewTtl(binding.family),
      generation,
      ownerToken: null,
    });
  }

  async execute<T>(input: MainWriteGateExecuteInput<T>): Promise<T> {
    this.assertValidBinding(input.binding);
    await this.context.assertCurrent(input.binding.context);

    const ticketKey = previewTicketKey(input.binding);
    const ownerToken = this.randomUUID();
    const ticket = this.claimTicket(input.binding, ownerToken);
    const reservationKeys = this.claimListingAttributeReservations(
      input.binding,
      ownerToken,
    );
    let sessionClosed = false;
    let ticketConsumed = false;
    const usedIntentIds = new Set<string>();
    const durableIntents = new Map(
      input.binding.intents.map((intent) => {
        const durable = this.durableIntent(input.binding, intent);
        return [intent.intentId, durable] as const;
      }),
    );

    const consumeTicket = () => {
      if (ticketConsumed) return;
      ticketConsumed = true;
      const current = this.tickets.get(ticketKey);
      if (current?.ownerToken === ownerToken) this.tickets.delete(ticketKey);
    };

    const session: MainWriteGateSession = {
      attempt: async <TResult>(attempt: MainWriteAttemptInput<TResult>) => {
        if (sessionClosed) {
          throw new MainWriteGateError("WRITE_SESSION_CLOSED");
        }
        const durable = durableIntents.get(attempt.intentId);
        if (!durable || usedIntentIds.has(attempt.intentId)) {
          throw new MainWriteGateError("WRITE_INTENT_INVALID");
        }
        usedIntentIds.add(attempt.intentId);
        consumeTicket();
        return this.store.runIdempotentOperation<TResult>({
          idempotencyKey: durable.idempotencyKey,
          operationType: durable.operationType,
          marketplaceId: durable.intent.marketplaceId,
          sellerSku: durable.intent.sellerSku,
          accountScope: input.binding.context.accountScope,
          fingerprint: durable.fingerprint,
          businessPriceDuplicateRepair:
            durable.businessPriceDuplicateRepair,
          execute: async ({ recordAccepted }) => {
            try {
              await this.context.assertCurrent(input.binding.context);
              return await attempt.execute({
                recordDurableEvidence: recordAccepted,
                recordAccepted,
                assertCurrent: () =>
                  this.context.assertCurrent(input.binding.context),
              });
            } catch (error) {
              throw normalizeAmbiguousExecutionError(error);
            }
          },
        });
      },
    };

    try {
      await this.store.assertIdempotentOperationsAvailable(
        [...durableIntents.values()].map((durable) =>
          this.availabilityInput(input.binding, durable)),
      );
      this.assertOwnedTicketCurrent(ticketKey, ticket, ownerToken);
      await this.context.assertCurrent(input.binding.context);

      await input.beforeApproval?.();
      this.assertOwnedTicketCurrent(ticketKey, ticket, ownerToken);
      await this.context.assertCurrent(input.binding.context);

      const reason = typeof input.approvalReason === "function"
        ? input.approvalReason(this.verificationCode(input.binding))
        : input.approvalReason;
      try {
        await this.approveWrite(reason);
      } catch {
        throw new MainWriteGateError(
          "ACTION_CANCELLED",
          input.cancellationMessage,
        );
      }

      await this.context.assertCurrent(input.binding.context);
      this.assertOwnedTicketCurrent(ticketKey, ticket, ownerToken);
      return await input.run(session);
    } finally {
      sessionClosed = true;
      if (!ticketConsumed) this.releaseTicket(ticketKey, ownerToken);
      this.releaseListingAttributeReservations(reservationKeys, ownerToken);
    }
  }

  async inspect<TResult>(
    input: MainWriteGateInspectInput<TResult>,
  ): Promise<readonly TResult[]> {
    try {
      if (
        input.context.marketplaceId !== input.marketplaceId ||
        !this.store.inspectIdempotentOperations
      ) {
        return [];
      }
      await this.context.assertCurrent(input.context);
      const inspected = await this.store.inspectIdempotentOperations({
        operationTypes: input.operations,
        marketplaceId: input.marketplaceId,
        sellerSku: input.sellerSku,
        accountScope: input.context.accountScope,
      });
      const projected: TResult[] = [];
      for (const entry of inspected) {
        try {
          const result = input.project(structuredClone(entry));
          if (result !== null) projected.push(structuredClone(result));
        } catch {
          // A malformed or uncloneable domain projection is not evidence.
        }
      }
      await this.context.assertCurrent(input.context);
      return projected;
    } catch {
      // Fail closed: never reveal evidence for a stale or unverified account.
      return [];
    }
  }

  async reconcile<TSnapshot>(
    input: MainWriteGateReconcileInput<TSnapshot>,
  ): Promise<void> {
    try {
      if (input.context.marketplaceId !== input.marketplaceId) return;
      await this.context.assertCurrent(input.context);
      await this.store.reconcileIdempotentOperations({
        operationTypes: input.operations,
        marketplaceId: input.marketplaceId,
        sellerSku: input.sellerSku,
        accountScope: input.context.accountScope,
        reconcile: (response, operation) => {
          try {
            return input.project(response, operation, input.snapshot);
          } catch {
            return null;
          }
        },
      });
    } catch {
      // Fail closed: an unresolved durable entry remains pending or unknown.
    }
  }

  clearEphemeral(): void {
    this.ephemeralGeneration += 1;
    this.tickets.clear();
    // Active listing mutation claims belong to in-flight execute calls. Their
    // finally blocks release them; clearing them here could permit overlap.
  }

  private assertValidBinding(binding: WriteBinding): void {
    if (
      !binding.previewKey ||
      !binding.intents.length ||
      !Number.isSafeInteger(binding.context.generation) ||
      binding.context.generation < 0
    ) {
      throw new MainWriteGateError("WRITE_BINDING_INVALID");
    }
    const intentIds = new Set<string>();
    for (const intent of binding.intents) {
      if (
        !intent.intentId ||
        intentIds.has(intent.intentId) ||
        intent.marketplaceId !== binding.context.marketplaceId ||
        !intent.sellerSku ||
        !intent.idempotencyKey ||
        !intent.proposalFingerprint ||
        !OPERATIONS_BY_FAMILY[binding.family].has(intent.operation)
      ) {
        throw new MainWriteGateError("WRITE_BINDING_INVALID");
      }
      intentIds.add(intent.intentId);
    }
  }

  private pruneExpiredTickets(): void {
    const now = this.now();
    for (const [key, ticket] of this.tickets) {
      if (ticket.expiresAt <= now && ticket.ownerToken === null) {
        this.tickets.delete(key);
      }
    }
  }

  private claimTicket(
    binding: WriteBinding,
    ownerToken: string,
  ): PreviewTicket {
    this.pruneExpiredTickets();
    const key = previewTicketKey(binding);
    const ticket = this.tickets.get(key);
    if (
      !ticket ||
      ticket.expiresAt <= this.now() ||
      ticket.generation !== this.ephemeralGeneration ||
      !sameContext(ticket.context, binding.context)
    ) {
      if (ticket && ticket.ownerToken === null) this.tickets.delete(key);
      throw new MainWriteGateError("PREVIEW_EXPIRED");
    }
    if (ticket.bindingFingerprint !== bindingFingerprint(binding)) {
      throw new MainWriteGateError("PREVIEW_CHANGED");
    }
    if (ticket.ownerToken !== null) {
      throw new MainWriteGateError("OPERATION_IN_PROGRESS");
    }
    ticket.ownerToken = ownerToken;
    return ticket;
  }

  private assertOwnedTicketCurrent(
    key: string,
    ticket: PreviewTicket,
    ownerToken: string,
  ): void {
    const current = this.tickets.get(key);
    if (ticket.generation !== this.ephemeralGeneration) {
      throw new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "Amazon 執行環境已更新；請重新開始這次操作。",
      );
    }
    if (
      current !== ticket ||
      current.ownerToken !== ownerToken ||
      current.expiresAt <= this.now() ||
      current.generation !== ticket.generation
    ) {
      throw new MainWriteGateError("PREVIEW_EXPIRED");
    }
  }

  private releaseTicket(key: string, ownerToken: string): void {
    const ticket = this.tickets.get(key);
    if (!ticket || ticket.ownerToken !== ownerToken) return;
    if (
      ticket.expiresAt <= this.now() ||
      ticket.generation !== this.ephemeralGeneration
    ) {
      this.tickets.delete(key);
      return;
    }
    ticket.ownerToken = null;
  }

  private claimListingAttributeReservations(
    binding: WriteBinding,
    ownerToken: string,
  ): readonly string[] {
    if (!usesListingAttributeReservations(binding.family)) return [];
    const requestedKeys = binding.intents.map(listingAttributeReservationKey);
    if (
      binding.family !== "business-price" &&
      new Set(requestedKeys).size !== requestedKeys.length
    ) {
      this.releaseTicket(previewTicketKey(binding), ownerToken);
      throw new MainWriteGateError("IDEMPOTENCY_CONFLICT");
    }
    const keys = [...new Set(requestedKeys)];
    if (keys.some((key) => this.listingAttributeReservations.has(key))) {
      this.releaseTicket(previewTicketKey(binding), ownerToken);
      throw new MainWriteGateError(
        "OPERATION_IN_PROGRESS",
        "同一 SKU 的商品內容、圖片或價格正在處理，系統已阻止重疊送出。",
      );
    }
    for (const key of keys) {
      this.listingAttributeReservations.set(key, ownerToken);
    }
    return keys;
  }

  private releaseListingAttributeReservations(
    keys: readonly string[],
    ownerToken: string,
  ): void {
    for (const key of keys) {
      if (this.listingAttributeReservations.get(key) === ownerToken) {
        this.listingAttributeReservations.delete(key);
      }
    }
  }

  private durableIntent(
    binding: WriteBinding,
    intent: WriteIntent,
  ): DurableIntent {
    const fingerprint = stableFingerprint([
      binding.context.accountScope,
      intent.proposalFingerprint,
    ]);
    const idempotencyKey = binding.family === "content-batch"
      ? `content-batch-${stableFingerprint([
        intent.idempotencyKey,
        intent.sellerSku,
        fingerprint,
      ]).slice(0, 56)}`
      : intent.idempotencyKey;
    return {
      intent,
      idempotencyKey,
      fingerprint,
      operationType: intent.operation === "business_price_repair"
        ? "business_price"
        : intent.operation,
      businessPriceDuplicateRepair:
        intent.operation === "business_price_repair",
    };
  }

  private availabilityInput(
    binding: WriteBinding,
    durable: DurableIntent,
  ): IdempotentOperationAvailabilityInput {
    return {
      idempotencyKey: durable.idempotencyKey,
      operationType: durable.operationType,
      marketplaceId: durable.intent.marketplaceId,
      sellerSku: durable.intent.sellerSku,
      accountScope: binding.context.accountScope,
      fingerprint: durable.fingerprint,
      businessPriceDuplicateRepair:
        durable.businessPriceDuplicateRepair,
    };
  }

  private verificationCode(binding: WriteBinding): string {
    if (binding.intents.length === 1) {
      return this.durableIntent(binding, binding.intents[0]).fingerprint.slice(0, 12);
    }
    return bindingFingerprint(binding).slice(0, 12);
  }
}
