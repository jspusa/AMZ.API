import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type {
  OperationsBoardItem,
  OperationsBoardReadResult,
  OperationsBoardSnapshot,
} from "../shared/operations-board";
import { MARKETPLACES } from "../shared/marketplaces";
import type {
  CredentialVault,
  StoredImageStorageCredentials,
} from "./credential-vault";

export const OPERATIONS_BOARD_OBJECT_KEY = "operations-board/v1.json";
export const OPERATIONS_BOARD_DEFAULT_PUBLIC_BASE_URL =
  "https://jspusa.github.io/AMZ.API";
export const OPERATIONS_BOARD_MAX_BYTES = 128 * 1024;
const OPERATIONS_BOARD_WRITE_TIMEOUT_MS = 10_000;
const MAX_ITEMS = 100;
const EMPTY_UPDATED_AT = "1970-01-01T00:00:00.000Z";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MARKETPLACE_IDS = new Set<string>(MARKETPLACES.map((marketplace) => marketplace.id));

type BoardReadTarget = Readonly<{
  key: typeof OPERATIONS_BOARD_OBJECT_KEY;
  publicUrl: string;
}>;

type BoardStorageTarget = BoardReadTarget & Readonly<{
  endpoint: string;
  credentials: Readonly<{ accessKeyId: string; secretAccessKey: string }>;
  bucket: string;
}>;

type RemoteRead = Readonly<{
  snapshot: OperationsBoardSnapshot;
  etag: string | null;
}>;

export interface OperationsBoardRemoteStorePort {
  read(target: BoardReadTarget): Promise<RemoteRead | null>;
  put(
    target: BoardStorageTarget,
    input: Readonly<{
      snapshot: OperationsBoardSnapshot;
      ifMatch?: string;
      ifNoneMatch?: "*";
    }>,
  ): Promise<void>;
}

export interface OperationsBoardPort {
  read(): Promise<OperationsBoardReadResult>;
  replace(input: Readonly<{
    baseRevision: number;
    items: readonly OperationsBoardItem[];
  }>): Promise<OperationsBoardSnapshot>;
}

export class OperationsBoardError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OperationsBoardError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value);
  if (actual.some((key) => !expected.includes(key))) {
    throw new Error(`${label}包含不支援的欄位。`);
  }
  if (expected.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new Error(`${label}缺少必要欄位。`);
  }
}

function boundedText(
  value: unknown,
  maximum: number,
  label: string,
  required = false,
): string {
  if (typeof value !== "string") throw new Error(`${label}格式無效。`);
  const clean = value.trim();
  if (
    (required && !clean) ||
    clean.length > maximum ||
    /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u.test(clean)
  ) {
    throw new Error(`${label}格式無效或超過長度上限。`);
  }
  return clean;
}

function boundedNote(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label}格式無效。`);
  const clean = value.replace(/\r\n?/gu, "\n").trim();
  if (
    clean.length > 500 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u
      .test(clean)
  ) {
    throw new Error(`${label}格式無效或超過長度上限。`);
  }
  return clean;
}

function calendarDate(value: unknown, label: string): string {
  const clean = boundedText(value, 10, label, true);
  const match = DATE_PATTERN.exec(clean);
  if (!match) throw new Error(`${label}日期格式無效。`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`${label}日期不存在。`);
  }
  return clean;
}

function parseItem(value: unknown, schemaVersion: 1 | 2): OperationsBoardItem {
  if (!isRecord(value)) throw new Error("公布欄項目格式無效。");
  if (value.type === "expiry") {
    exactKeys(
      value,
      schemaVersion === 1
        ? ["id", "type", "marketplaceId", "sellerSku", "expiryDate", "note"]
        : ["id", "type", "marketplaceId", "sellerSku", "expiryDate", "stopSaleDate", "note"],
      "即期品項目",
    );
    const id = boundedText(value.id, 36, "項目 ID", true);
    if (!UUID_PATTERN.test(id)) throw new Error("公布欄項目 ID 格式無效。");
    const marketplaceId = boundedText(value.marketplaceId, 32, "Amazon 站點", true);
    if (!MARKETPLACE_IDS.has(marketplaceId)) throw new Error("Amazon 站點無效。");
    const expiryDate = calendarDate(value.expiryDate, "效期");
    const stopSaleDate = schemaVersion === 2 && value.stopSaleDate !== null
      ? calendarDate(value.stopSaleDate, "停售日")
      : null;
    if (stopSaleDate && stopSaleDate > expiryDate) {
      throw new Error("停售日不可晚於效期。");
    }
    return {
      id,
      type: "expiry",
      marketplaceId,
      sellerSku: boundedText(value.sellerSku, 40, "Seller SKU", true),
      expiryDate,
      stopSaleDate,
      note: boundedNote(value.note, "即期品備註"),
    };
  }
  if (value.type === "promotion") {
    exactKeys(
      value,
      schemaVersion === 1
        ? ["id", "type", "date", "title", "note", "countdown"]
        : ["id", "type", "startDate", "endDate", "title", "note", "countdown"],
      "促銷檔期項目",
    );
    const id = boundedText(value.id, 36, "項目 ID", true);
    if (!UUID_PATTERN.test(id)) throw new Error("公布欄項目 ID 格式無效。");
    if (typeof value.countdown !== "boolean") throw new Error("倒數設定格式無效。");
    const startDate = calendarDate(
      schemaVersion === 1 ? value.date : value.startDate,
      "促銷開始日",
    );
    const endDate = calendarDate(
      schemaVersion === 1 ? value.date : value.endDate,
      "促銷結束日",
    );
    if (endDate < startDate) throw new Error("促銷結束日不可早於開始日。");
    return {
      id,
      type: "promotion",
      startDate,
      endDate,
      title: boundedText(value.title, 120, "促銷名稱", true),
      note: boundedNote(value.note, "促銷備註"),
      countdown: value.countdown,
    };
  }
  throw new Error("公布欄項目類型無效。");
}

export function parseOperationsBoardSnapshot(value: unknown): OperationsBoardSnapshot {
  if (!isRecord(value)) throw new Error("公布欄資料格式無效。");
  exactKeys(value, ["schemaVersion", "revision", "updatedAt", "items"], "公布欄資料");
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2) {
    throw new Error("公布欄資料版本不支援。");
  }
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0) {
    throw new Error("公布欄版本格式無效。");
  }
  const updatedAt = boundedText(value.updatedAt, 64, "公布欄更新時間", true);
  if (!ISO_PATTERN.test(updatedAt) || Number.isNaN(Date.parse(updatedAt))) {
    throw new Error("公布欄更新時間格式無效。");
  }
  if (!Array.isArray(value.items)) throw new Error("公布欄項目格式無效。");
  if (value.items.length > MAX_ITEMS) throw new Error("公布欄最多只能有 100 個項目。");
  const items = value.items.map((item) => parseItem(item, value.schemaVersion as 1 | 2));
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error("公布欄項目 ID 不可重複。");
  }
  return {
    schemaVersion: 2,
    revision: Number(value.revision),
    updatedAt,
    items,
  };
}

export function emptyOperationsBoardSnapshot(): OperationsBoardSnapshot {
  return { schemaVersion: 2, revision: 0, updatedAt: EMPTY_UPDATED_AT, items: [] };
}

function readTargetFromPublicBaseUrl(publicBaseUrl: string): BoardReadTarget {
  let publicBase: URL;
  try {
    publicBase = new URL(publicBaseUrl);
  } catch {
    throw new OperationsBoardError("OPERATIONS_BOARD_STORAGE_INVALID", "公布欄唯讀網址無效。");
  }
  if (
    publicBase.protocol !== "https:" ||
    publicBase.username ||
    publicBase.password ||
    publicBase.port ||
    publicBase.hash ||
    publicBase.search
  ) {
    throw new OperationsBoardError(
      "OPERATIONS_BOARD_STORAGE_INVALID",
      "公布欄唯讀網址未通過安全檢查。",
    );
  }
  const base = publicBase.toString().replace(/\/$/u, "");
  return {
    key: OPERATIONS_BOARD_OBJECT_KEY,
    publicUrl: `${base}/${OPERATIONS_BOARD_OBJECT_KEY}`,
  };
}

function targetFromStorage(storage: StoredImageStorageCredentials): BoardStorageTarget {
  const expectedHost = `${storage.accountId}.r2.cloudflarestorage.com`;
  let endpoint: URL;
  try {
    endpoint = new URL(`https://${expectedHost}`);
  } catch {
    throw new OperationsBoardError("OPERATIONS_BOARD_STORAGE_INVALID", "R2 公布欄設定無效。");
  }
  if (
    !/^[a-f0-9]{32}$/iu.test(storage.accountId) ||
    !storage.accessKeyId ||
    !storage.secretAccessKey ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(storage.bucket) ||
    storage.bucket.includes("..") ||
    endpoint.protocol !== "https:" ||
    endpoint.hostname !== expectedHost ||
    endpoint.username ||
    endpoint.password ||
    endpoint.port
  ) {
    throw new OperationsBoardError("OPERATIONS_BOARD_STORAGE_INVALID", "R2 公布欄設定未通過安全檢查。");
  }
  const readTarget = readTargetFromPublicBaseUrl(storage.publicBaseUrl);
  return {
    ...readTarget,
    endpoint: endpoint.toString(),
    credentials: {
      accessKeyId: storage.accessKeyId,
      secretAccessKey: storage.secretAccessKey,
    },
    bucket: storage.bucket,
  };
}

async function responseTextBounded(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > OPERATIONS_BOARD_MAX_BYTES) {
    throw new OperationsBoardError("OPERATIONS_BOARD_TOO_LARGE", "共享公布欄檔案超過 128 KiB 上限。");
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > OPERATIONS_BOARD_MAX_BYTES) {
        await reader.cancel();
        throw new OperationsBoardError(
          "OPERATIONS_BOARD_TOO_LARGE",
          "共享公布欄檔案超過 128 KiB 上限。",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function snapshotBytes(snapshot: OperationsBoardSnapshot): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  if (bytes.byteLength > OPERATIONS_BOARD_MAX_BYTES) {
    throw new OperationsBoardError(
      "OPERATIONS_BOARD_TOO_LARGE",
      "共享公布欄檔案超過 128 KiB 上限。",
    );
  }
  return bytes;
}

function errorHttpStatus(error: unknown): unknown {
  if (!error || typeof error !== "object") return undefined;
  const metadata = Reflect.get(error, "$metadata");
  if (!metadata || typeof metadata !== "object") return undefined;
  return Reflect.get(metadata, "httpStatusCode");
}

export function operationsBoardPutFailure(
  error: unknown,
  aborted: boolean,
): OperationsBoardError {
  if (error instanceof OperationsBoardError) return error;
  if (aborted) {
    return new OperationsBoardError(
      "OPERATIONS_BOARD_WRITE_UNKNOWN",
      "公布欄寫入逾時，結果不明；系統不會自動重送，請重新同步確認。",
    );
  }
  const status = errorHttpStatus(error);
  if (status === 409 || status === 412) {
    return new OperationsBoardError(
      "OPERATIONS_BOARD_CONFLICT",
      "公布欄已被其他人更新，請重新載入後再確認一次。",
    );
  }
  if ([400, 401, 403, 404].includes(Number(status))) {
    return new OperationsBoardError(
      "OPERATIONS_BOARD_WRITE_REJECTED",
      "共享儲存拒絕公布欄更新；資料未發布，請檢查 R2 寫入設定。",
    );
  }
  return new OperationsBoardError(
    "OPERATIONS_BOARD_WRITE_UNKNOWN",
    "公布欄寫入結果不明；系統不會自動重送，請先重新同步確認。",
  );
}

export function createR2OperationsBoardRemoteStore(
  request: typeof fetch = fetch,
): OperationsBoardRemoteStorePort {
  return {
    async read(target): Promise<RemoteRead | null> {
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 10_000);
      try {
        const response = await request(target.publicUrl, {
          method: "GET",
          headers: { accept: "application/json" },
          redirect: "error",
          cache: "no-store",
          credentials: "omit",
          signal: abort.signal,
        });
        if (response.status === 404) return null;
        if (!response.ok) {
          throw new OperationsBoardError(
            "OPERATIONS_BOARD_READ_FAILED",
            `共享公布欄讀取失敗（HTTP ${response.status}）。`,
          );
        }
        const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
        if (contentType !== "application/json" && !contentType.endsWith("+json")) {
          throw new OperationsBoardError("OPERATIONS_BOARD_CONTENT_TYPE", "共享公布欄不是 JSON 檔案。");
        }
        const raw: unknown = JSON.parse(await responseTextBounded(response));
        return {
          snapshot: parseOperationsBoardSnapshot(raw),
          etag: response.headers.get("etag"),
        };
      } finally {
        clearTimeout(timeout);
      }
    },
    async put(target, input): Promise<void> {
      const body = snapshotBytes(input.snapshot);
      const client = new S3Client({
        region: "auto",
        endpoint: target.endpoint,
        credentials: target.credentials,
        maxAttempts: 1,
      });
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), OPERATIONS_BOARD_WRITE_TIMEOUT_MS);
      try {
        await client.send(new PutObjectCommand({
          Bucket: target.bucket,
          Key: target.key,
          Body: body,
          ContentType: "application/json; charset=utf-8",
          CacheControl: "no-store, max-age=0",
          IfMatch: input.ifMatch,
          IfNoneMatch: input.ifNoneMatch,
          Metadata: { schema: "operations-board-v2" },
        }), { abortSignal: abort.signal });
      } catch (error) {
        throw operationsBoardPutFailure(error, abort.signal.aborted);
      } finally {
        clearTimeout(timeout);
        client.destroy();
      }
    },
  };
}

export class OperationsBoard implements OperationsBoardPort {
  private readonly vault: Pick<
    CredentialVault,
    "getImageStorage" | "getOperationsBoardPublicBaseUrl"
  >;
  private readonly remote: OperationsBoardRemoteStorePort;
  private readonly now: () => Date;
  private lastKnownGood: OperationsBoardSnapshot | null = null;

  constructor(input: Readonly<{
    vault: Pick<
      CredentialVault,
      "getImageStorage" | "getOperationsBoardPublicBaseUrl"
    >;
    remote?: OperationsBoardRemoteStorePort;
    now?: () => Date;
  }>) {
    this.vault = input.vault;
    this.remote = input.remote ?? createR2OperationsBoardRemoteStore();
    this.now = input.now ?? (() => new Date());
  }

  async isStorageConfigured(): Promise<boolean> {
    try {
      const [storage, publicBaseUrl] = await Promise.all([
        this.vault.getImageStorage(),
        this.vault.getOperationsBoardPublicBaseUrl(),
      ]);
      if (!storage || !publicBaseUrl) return false;
      return targetFromStorage(storage).publicUrl ===
        readTargetFromPublicBaseUrl(publicBaseUrl).publicUrl;
    } catch {
      return false;
    }
  }

  async read(): Promise<OperationsBoardReadResult> {
    try {
      const remote = await this.remote.read(
        readTargetFromPublicBaseUrl(OPERATIONS_BOARD_DEFAULT_PUBLIC_BASE_URL),
      );
      if (!remote && this.lastKnownGood) {
        return {
          snapshot: this.lastKnownGood,
          source: "last-known-good",
          stale: true,
          status: "unavailable",
          message: "共享公布欄物件目前不存在；暫時保留本次啟動後最後一次成功資料。",
        };
      }
      if (!remote) {
        return {
          snapshot: emptyOperationsBoardSnapshot(),
          source: "empty",
          stale: true,
          status: "unavailable",
          message: "目前找不到共享公布欄檔案；暫不把它視為公告已清空。",
        };
      }
      const snapshot = remote.snapshot;
      this.lastKnownGood = snapshot;
      return { snapshot, source: "shared", stale: false, status: "ready" };
    } catch {
      return {
        snapshot: this.lastKnownGood ?? emptyOperationsBoardSnapshot(),
        source: this.lastKnownGood ? "last-known-good" : "empty",
        stale: true,
        status: "unavailable",
        message: this.lastKnownGood
          ? "目前無法重新讀取共享公布欄；暫時顯示本次啟動後最後一次成功資料。"
          : "目前無法讀取共享公布欄。",
      };
    }
  }

  async replace(input: Readonly<{
    baseRevision: number;
    items: readonly OperationsBoardItem[];
  }>): Promise<OperationsBoardSnapshot> {
    if (!Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0) {
      throw new OperationsBoardError("OPERATIONS_BOARD_INPUT_INVALID", "公布欄基準版本無效。");
    }
    const storage = await this.vault.getImageStorage();
    if (!storage) {
      throw new OperationsBoardError("OPERATIONS_BOARD_NOT_CONFIGURED", "請先設定共用 R2 公布欄空間。");
    }
    const target = targetFromStorage(storage);
    const publicBaseUrl = await this.vault.getOperationsBoardPublicBaseUrl();
    const readTarget = publicBaseUrl
      ? readTargetFromPublicBaseUrl(publicBaseUrl)
      : null;
    if (!readTarget || readTarget.publicUrl !== target.publicUrl) {
      throw new OperationsBoardError(
        "OPERATIONS_BOARD_STORAGE_INVALID",
        "公布欄唯讀網址與 R2 寫入空間不一致；系統拒絕寫入。",
      );
    }
    const current = await this.remote.read(readTarget);
    const currentSnapshot = current?.snapshot ?? emptyOperationsBoardSnapshot();
    if (currentSnapshot.revision !== input.baseRevision) {
      throw new OperationsBoardError(
        "OPERATIONS_BOARD_CONFLICT",
        "公布欄已被其他人更新，請重新載入後再確認一次。",
      );
    }
    if (current && !current.etag) {
      throw new OperationsBoardError(
        "OPERATIONS_BOARD_ETAG_REQUIRED",
        "共享儲存沒有提供版本標記，因此系統拒絕盲目覆寫公布欄。",
      );
    }
    const next = parseOperationsBoardSnapshot({
      schemaVersion: 2,
      revision: currentSnapshot.revision + 1,
      updatedAt: this.now().toISOString(),
      items: input.items,
    });
    snapshotBytes(next);
    await this.remote.put(target, {
      snapshot: next,
      ifMatch: current?.etag ?? undefined,
      ifNoneMatch: current ? undefined : "*",
    });
    this.lastKnownGood = next;
    return next;
  }
}
