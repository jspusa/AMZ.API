import { randomUUID } from "node:crypto";
import type { MarketplaceId } from "../../shared/marketplaces";
import {
  SpExecutionContextError,
  type SpExecutionContext,
  type SpExecutionContextAdapter,
} from "./sp-execution-context";
import { SpApiError } from "./sp-api-error";

type SnapshotEntry<T> = {
  readonly context: SpExecutionContext;
  readonly marketplaceId: MarketplaceId;
  readonly expiresAt: number;
  readonly snapshot: T;
};

const OPAQUE_SNAPSHOT_CAPABILITY =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type ContextBoundAuditSnapshotStoreOptions = Readonly<{
  context: SpExecutionContextAdapter;
  ttlMs: number;
  now?: () => number;
  createId?: () => string;
  expiredMessage: string;
}>;

/**
 * Small main-only leaf used by one audit owner at a time. It keeps an opaque
 * snapshot capability, its complete SP execution fence, expiry, cloning, and
 * clear/read linearizability together. Each audit module owns a separate
 * instance and chooses its own TTL and public error wording.
 */
export class ContextBoundAuditSnapshotStore<T> {
  private readonly context: SpExecutionContextAdapter;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly expiredMessage: string;
  private readonly entries = new Map<string, SnapshotEntry<T>>();
  private lifecycleRevision = 0;

  constructor(options: ContextBoundAuditSnapshotStoreOptions) {
    if (!Number.isSafeInteger(options.ttlMs) || options.ttlMs < 1) {
      throw new Error("Audit snapshot retention must be a positive integer.");
    }
    this.context = options.context;
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
    this.expiredMessage = options.expiredMessage;
  }

  publish(input: Readonly<{
    context: SpExecutionContext;
    marketplaceId: MarketplaceId;
    snapshotId?: string;
    snapshot: T;
    ttlMs?: number;
  }>): string {
    const ttlMs = input.ttlMs ?? this.ttlMs;
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) {
      throw new Error("Audit snapshot retention must be a positive integer.");
    }
    if (input.context.marketplaceId !== input.marketplaceId) {
      throw new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "Amazon 執行環境已更新；請重新開始這次操作。",
      );
    }
    this.prune();
    const snapshotId = input.snapshotId ?? this.createId();
    if (!OPAQUE_SNAPSHOT_CAPABILITY.test(snapshotId)) {
      throw new Error("Audit snapshot capability is invalid.");
    }
    if (this.entries.has(snapshotId)) {
      throw new Error("Audit snapshot capability already exists.");
    }
    const snapshot = structuredClone(input.snapshot);
    this.entries.set(snapshotId, {
      context: input.context,
      marketplaceId: input.marketplaceId,
      expiresAt: this.now() + ttlMs,
      snapshot,
    });
    return snapshotId;
  }

  async read(input: Readonly<{
    snapshotId: string;
    marketplaceId: MarketplaceId;
  }>): Promise<T> {
    this.prune();
    const revision = this.lifecycleRevision;
    const entry = this.entries.get(input.snapshotId);
    if (!entry || entry.marketplaceId !== input.marketplaceId) {
      throw this.expired();
    }
    try {
      await this.context.assertCurrent(entry.context);
    } catch (error) {
      if (this.entries.get(input.snapshotId) === entry) {
        this.entries.delete(input.snapshotId);
      }
      throw error;
    }
    if (
      revision !== this.lifecycleRevision ||
      this.entries.get(input.snapshotId) !== entry
    ) {
      throw new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "Amazon 執行環境已更新；請重新開始這次操作。",
      );
    }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(input.snapshotId);
      throw this.expired();
    }
    return structuredClone(entry.snapshot);
  }

  clear(): void {
    this.lifecycleRevision += 1;
    this.entries.clear();
  }

  private prune(): void {
    const now = this.now();
    for (const [snapshotId, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(snapshotId);
    }
  }

  private expired(): SpApiError {
    return new SpApiError(this.expiredMessage, {
      status: 410,
      code: "SNAPSHOT_EXPIRED",
    });
  }
}
