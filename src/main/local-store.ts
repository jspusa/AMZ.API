import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { SpApiError, SpApiPreCommitError } from "./amazon/sp-api";

export type SupplyRoute = "DIRECT_FBA" | "AWD_TO_FBA";

export type ProductMasterProfile = {
  marketplaceId: string;
  sellerSku: string;
  displayName: string | null;
  asin: string | null;
  fnSku: string | null;
  casePack: number;
  cartonsPerPallet: number;
  leadTimeDays: number;
  safetyDays: number;
  targetDays: number;
  supplyRoute: SupplyRoute;
  awdBufferDays: number;
  shelfLifeDays: number | null;
  minimumRemainingDays: number | null;
  factory: string | null;
  notes: string | null;
  settingsConfigured: boolean;
  lastSyncedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ProductMasterState = {
  profile: ProductMasterProfile;
  found: boolean;
  persistence: "durable";
};

type LedgerState = "pending" | "completed" | "unknown";

type LedgerEntry = {
  operationType:
    | "price"
    | "content"
    | "images"
    | "sale_price"
    | "variation_detach"
    | "variation_attach";
  marketplaceId: string;
  sellerSku: string;
  accountScope: string;
  fingerprint: string;
  ownerToken: string;
  state: LedgerState;
  response: unknown | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};

type StoreData = {
  version: 2;
  profiles: Record<string, ProductMasterProfile>;
  ledger: Record<string, LedgerEntry>;
};

type ProductSettings = Pick<
  ProductMasterProfile,
  | "casePack"
  | "cartonsPerPallet"
  | "leadTimeDays"
  | "safetyDays"
  | "targetDays"
  | "supplyRoute"
  | "awdBufferDays"
  | "shelfLifeDays"
  | "minimumRemainingDays"
  | "factory"
  | "notes"
>;

type OperationInput<T> = {
  idempotencyKey: string;
  operationType: LedgerEntry["operationType"];
  marketplaceId: string;
  sellerSku: string;
  accountScope: string;
  fingerprint: string;
  execute: () => Promise<T>;
};

const OPERATION_TTL_MS = 24 * 60 * 60 * 1_000;
const VARIATION_OPERATION_TYPES = new Set<LedgerEntry["operationType"]>([
  "variation_detach",
  "variation_attach",
]);

function emptyStore(): StoreData {
  return { version: 2, profiles: {}, ledger: {} };
}

function profileKey(accountScope: string, marketplaceId: string, sellerSku: string): string {
  return `${accountScope}:${marketplaceId}:${sellerSku}`;
}

export function defaultProductMaster(
  marketplaceId: string,
  sellerSku: string,
): ProductMasterProfile {
  return {
    marketplaceId,
    sellerSku,
    displayName: null,
    asin: null,
    fnSku: null,
    casePack: 1,
    cartonsPerPallet: 1,
    leadTimeDays: 35,
    safetyDays: 14,
    targetDays: 60,
    supplyRoute: "DIRECT_FBA",
    awdBufferDays: 20,
    shelfLifeDays: null,
    minimumRemainingDays: null,
    factory: null,
    notes: null,
    settingsConfigured: false,
    lastSyncedAt: null,
    createdAt: null,
    updatedAt: null,
  };
}

function operationError(state: LedgerState): SpApiError {
  return new SpApiError(
    state === "unknown"
      ? "前一次送出結果尚未確認。系統已禁止重送，請先回查 Amazon 狀態。"
      : "同一筆操作正在處理。系統已阻止重複送出，請稍後回查。",
    {
      status: 409,
      code: state === "unknown" ? "UPDATE_STATUS_UNKNOWN" : "OPERATION_IN_PROGRESS",
    },
  );
}

function resultMayBeUnknown(error: unknown): boolean {
  if (error instanceof SpApiPreCommitError) return false;
  if (!(error instanceof SpApiError)) return true;
  return (
    error.status >= 500 ||
    ["UPDATE_STATUS_UNKNOWN", "OPERATION_IN_PROGRESS"].includes(error.code)
  );
}

export class LocalStore {
  readonly filePath: string;
  private data: StoreData | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async initialize(): Promise<void> {
    await this.read();
  }

  async isolateCorruptedFile(): Promise<string | null> {
    this.data = null;
    this.mutationQueue = Promise.resolve();
    const backupPath = `${this.filePath}.corrupt-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.bak`;
    try {
      await rename(this.filePath, backupPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.initialize();
      return null;
    }
    await this.initialize();
    return backupPath;
  }

  async getProductMaster(
    accountScope: string,
    marketplaceId: string,
    sellerSku: string,
  ): Promise<ProductMasterState> {
    await this.migrateLegacyProfiles(accountScope, marketplaceId);
    const data = await this.read();
    const profile = data.profiles[profileKey(accountScope, marketplaceId, sellerSku)];
    return {
      profile: profile
        ? structuredClone(profile)
        : defaultProductMaster(marketplaceId, sellerSku),
      found: Boolean(profile),
      persistence: "durable",
    };
  }

  async listProductMasters(input: {
    accountScope: string;
    marketplaceId: string;
    query?: string;
    limit?: number;
  }): Promise<{ items: ProductMasterProfile[]; persistence: "durable" }> {
    await this.migrateLegacyProfiles(input.accountScope, input.marketplaceId);
    const data = await this.read();
    const query = input.query?.trim().toLowerCase() ?? "";
    const limit = Math.max(1, Math.min(20, input.limit ?? 8));
    return {
      items: Object.entries(data.profiles)
        .filter(([key, profile]) =>
          key.startsWith(`${input.accountScope}:`) &&
          profile.marketplaceId === input.marketplaceId,
        )
        .map(([, profile]) => profile)
        .filter(
          (profile) =>
            !query ||
            [profile.sellerSku, profile.displayName ?? "", profile.asin ?? ""]
              .join(" ")
              .toLowerCase()
              .includes(query),
        )
        .sort((left, right) =>
          (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
        )
        .slice(0, limit)
        .map((profile) => structuredClone(profile)),
      persistence: "durable",
    };
  }

  async saveProductMaster(input: {
    accountScope: string;
    marketplaceId: string;
    sellerSku: string;
    settings: ProductSettings;
    displayName?: string | null;
    asin?: string | null;
    fnSku?: string | null;
  }): Promise<ProductMasterState> {
    let saved!: ProductMasterProfile;
    await this.mutate((data) => {
      const key = profileKey(input.accountScope, input.marketplaceId, input.sellerSku);
      const previous = data.profiles[key] ??
        defaultProductMaster(input.marketplaceId, input.sellerSku);
      const now = new Date().toISOString();
      saved = {
        ...previous,
        ...input.settings,
        displayName: input.displayName ?? previous.displayName,
        asin: input.asin ?? previous.asin,
        fnSku: input.fnSku ?? previous.fnSku,
        settingsConfigured: true,
        createdAt: previous.createdAt ?? now,
        updatedAt: now,
      };
      data.profiles[key] = saved;
    });
    return { profile: structuredClone(saved), found: true, persistence: "durable" };
  }

  async syncProductIdentity(input: {
    accountScope: string;
    marketplaceId: string;
    sellerSku: string;
    displayName?: string | null;
    asin?: string | null;
    fnSku?: string | null;
  }): Promise<ProductMasterState> {
    let saved!: ProductMasterProfile;
    await this.mutate((data) => {
      const key = profileKey(input.accountScope, input.marketplaceId, input.sellerSku);
      const previous = data.profiles[key] ??
        defaultProductMaster(input.marketplaceId, input.sellerSku);
      const now = new Date().toISOString();
      saved = {
        ...previous,
        displayName: input.displayName ?? previous.displayName,
        asin: input.asin ?? previous.asin,
        fnSku: input.fnSku ?? previous.fnSku,
        lastSyncedAt: now,
        createdAt: previous.createdAt ?? now,
        updatedAt: now,
      };
      data.profiles[key] = saved;
    });
    return { profile: structuredClone(saved), found: true, persistence: "durable" };
  }

  async runIdempotentOperation<T>(input: OperationInput<T>): Promise<T> {
    const fingerprint = createHash("sha256")
      .update(input.fingerprint)
      .digest("hex");
    const ownerToken = randomUUID();
    let cachedResult: T | undefined;
    let claimed = false;
    await this.mutate((data) => {
      const now = Date.now();
      for (const [key, value] of Object.entries(data.ledger)) {
        if (value.expiresAt < now) delete data.ledger[key];
      }
      const existing = data.ledger[input.idempotencyKey];
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw new SpApiError("這個確認碼已用於另一筆操作。", {
            status: 409,
            code: "IDEMPOTENCY_CONFLICT",
          });
        }
        if (existing.state === "completed") {
          cachedResult = structuredClone(existing.response) as T;
          return;
        }
        throw operationError(existing.state);
      }
      if (VARIATION_OPERATION_TYPES.has(input.operationType)) {
        const activeVariationForSku = Object.values(data.ledger).find(
          (entry) =>
            VARIATION_OPERATION_TYPES.has(entry.operationType) &&
            entry.marketplaceId === input.marketplaceId &&
            entry.sellerSku === input.sellerSku &&
            entry.state !== "completed" &&
            (entry.accountScope === input.accountScope ||
              entry.accountScope === "legacy-unknown"),
        );
        if (activeVariationForSku) {
          throw operationError(activeVariationForSku.state);
        }
      }
      const equivalent = Object.values(data.ledger).find(
        (entry) =>
          entry.operationType === input.operationType &&
          entry.marketplaceId === input.marketplaceId &&
          entry.sellerSku === input.sellerSku &&
          ((entry.accountScope === input.accountScope &&
            entry.fingerprint === fingerprint) ||
            (entry.accountScope === "legacy-unknown" &&
              entry.state !== "completed")),
      );
      if (equivalent) {
        if (equivalent.state === "completed") {
          cachedResult = structuredClone(equivalent.response) as T;
          return;
        }
        throw operationError(equivalent.state);
      }
      data.ledger[input.idempotencyKey] = {
        operationType: input.operationType,
        marketplaceId: input.marketplaceId,
        sellerSku: input.sellerSku,
        accountScope: input.accountScope,
        fingerprint,
        ownerToken,
        state: "pending",
        response: null,
        createdAt: now,
        updatedAt: now,
        expiresAt: now + OPERATION_TTL_MS,
      };
      claimed = true;
    });
    if (!claimed) return cachedResult as T;

    try {
      const result = await input.execute();
      await this.mutate((data) => {
        const entry = data.ledger[input.idempotencyKey];
        if (!entry || entry.ownerToken !== ownerToken) {
          throw new SpApiError(
            "Amazon 寫入可能已完成，但防重送帳本未能保存結果。請先回查 Amazon。",
            { status: 503, code: "UPDATE_STATUS_UNKNOWN" },
          );
        }
        entry.state = "completed";
        entry.response = structuredClone(result);
        entry.updatedAt = Date.now();
      });
      return result;
    } catch (error) {
      await this.mutate((data) => {
        const entry = data.ledger[input.idempotencyKey];
        if (!entry || entry.ownerToken !== ownerToken) return;
        if (resultMayBeUnknown(error)) {
          entry.state = "unknown";
          entry.updatedAt = Date.now();
        } else {
          delete data.ledger[input.idempotencyKey];
        }
      });
      if (error instanceof SpApiError) throw error;
      throw new SpApiError(
        "Amazon 寫入結果尚未確認。系統已禁止重送，請先回查 Amazon 狀態。",
        { status: 503, code: "UPDATE_STATUS_UNKNOWN" },
      );
    }
  }

  private async read(): Promise<StoreData> {
    if (this.data) return this.data;
    try {
      const raw = JSON.parse(await readFile(this.filePath, "utf8")) as {
        version?: unknown;
        profiles?: Record<string, ProductMasterProfile>;
        ledger?: Record<
          string,
          Omit<LedgerEntry, "accountScope"> & { accountScope?: string }
        >;
      };
      if (
        (raw.version !== 1 && raw.version !== 2) ||
        !raw.profiles ||
        !raw.ledger ||
        typeof raw.profiles !== "object" ||
        typeof raw.ledger !== "object"
      ) {
        throw new Error("Unsupported local store version");
      }
      this.data = {
        version: 2,
        profiles: raw.profiles,
        ledger: Object.fromEntries(
          Object.entries(raw.ledger).map(([key, entry]) => [
            key,
            {
              ...entry,
              accountScope:
                typeof entry.accountScope === "string" && entry.accountScope
                  ? entry.accountScope
                  : "legacy-unknown",
            },
          ]),
        ),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.data = emptyStore();
    }
    return this.data;
  }

  private async migrateLegacyProfiles(
    accountScope: string,
    marketplaceId: string,
  ): Promise<void> {
    const data = await this.read();
    const legacyPrefix = `${marketplaceId}:`;
    if (!Object.keys(data.profiles).some((key) => key.startsWith(legacyPrefix))) return;
    await this.mutate((draft) => {
      for (const [key, profile] of Object.entries(draft.profiles)) {
        if (!key.startsWith(legacyPrefix)) continue;
        const scopedKey = profileKey(accountScope, profile.marketplaceId, profile.sellerSku);
        if (!draft.profiles[scopedKey]) draft.profiles[scopedKey] = profile;
        delete draft.profiles[key];
      }
    });
  }

  private async mutate(mutator: (data: StoreData) => void): Promise<void> {
    const task = this.mutationQueue.then(async () => {
      const data = await this.read();
      mutator(data);
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
      const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, this.filePath);
      await chmod(this.filePath, 0o600);
    });
    this.mutationQueue = task.catch(() => undefined);
    return task;
  }
}
