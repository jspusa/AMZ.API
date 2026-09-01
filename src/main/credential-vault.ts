import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { safeStorage } from "electron";
import type {
  CredentialInput,
  CredentialSummary,
  ImageStorageCredentialInput,
  SpApiRegion,
} from "../shared/contracts";
import { MARKETPLACES } from "../shared/marketplaces";

type StoredRegionCredentials = {
  refreshToken: string;
  sellerId: string;
};

export type StoredImageStorageCredentials = Required<ImageStorageCredentialInput>;

type StoredCredentials = {
  version: 1;
  lwaClientId: string;
  lwaClientSecret: string;
  regions: Record<SpApiRegion, StoredRegionCredentials>;
  imageStorage: StoredImageStorageCredentials | null;
  replenishmentSkillUrl: string;
  updatedAt: string;
};

type StoredOperationsBoardReader = {
  version: 1;
  publicBaseUrl: string;
  updatedAt: string;
};

const EMPTY_REGION = Object.freeze({ refreshToken: "", sellerId: "" });
const KNOWN_MARKETPLACE_IDS = new Set<string>(
  MARKETPLACES.map((marketplace) => marketplace.id),
);
const ENVIRONMENT_KEYS = [
  "SP_API_LWA_CLIENT_ID",
  "SP_API_LWA_CLIENT_SECRET",
  "SP_API_REFRESH_TOKEN",
  "SP_API_REFRESH_TOKEN_NA",
  "SP_API_REFRESH_TOKEN_FE",
  "SP_API_REFRESH_TOKEN_EU",
  "SP_API_SELLER_ID",
  "SP_API_SELLER_ID_NA",
  "SP_API_SELLER_ID_FE",
  "SP_API_SELLER_ID_EU",
  "SP_API_IMAGE_PUBLIC_BASE_URL",
  "AMAZON_REPLENISHMENT_SKILL_URL",
] as const;

function emptyCredentials(): StoredCredentials {
  return {
    version: 1,
    lwaClientId: "",
    lwaClientSecret: "",
    regions: {
      na: { ...EMPTY_REGION },
      fe: { ...EMPTY_REGION },
      eu: { ...EMPTY_REGION },
    },
    imageStorage: null,
    replenishmentSkillUrl: "",
    updatedAt: "",
  };
}

function cleanText(value: unknown, maximum: number): string {
  if (typeof value !== "string") return "";
  const result = value.trim();
  if (result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) {
    throw new Error("輸入內容包含無效字元或超過長度上限。");
  }
  return result;
}

function cleanSellerId(value: unknown): string {
  const result = cleanText(value, 128);
  if (!result) return "";
  if (KNOWN_MARKETPLACE_IDS.has(result)) {
    throw new Error(
      "Seller ID 不可填 Marketplace ID；請使用 Seller Central 顯示的 Merchant Token。",
    );
  }
  if (/\s|[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(result)) {
    throw new Error("Seller ID 含有空白或不可見字元，請重新複製 Merchant Token。");
  }
  return result;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error(`${label}包含不支援的欄位。`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  assertOnlyKeys(value, expected, label);
  if (expected.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new Error(`${label}缺少必要欄位。`);
  }
}

function validateCredentialInput(input: unknown): asserts input is CredentialInput {
  if (!isPlainRecord(input)) throw new Error("憑證輸入格式無效。");
  assertOnlyKeys(
    input,
    [
      "lwaClientId",
      "lwaClientSecret",
      "regions",
      "imageStorage",
      "operationsBoardPublicBaseUrl",
      "replenishmentSkillUrl",
    ],
    "憑證輸入",
  );
  if (input.regions !== undefined) {
    if (!isPlainRecord(input.regions)) throw new Error("區域憑證格式無效。");
    assertOnlyKeys(input.regions, ["na", "fe", "eu"], "區域憑證");
    for (const region of ["na", "fe", "eu"] as const) {
      const value = input.regions[region];
      if (value === undefined) continue;
      if (!isPlainRecord(value)) throw new Error(`${region.toUpperCase()} 憑證格式無效。`);
      assertOnlyKeys(value, ["refreshToken", "sellerId"], `${region.toUpperCase()} 憑證`);
    }
  }
  if (input.imageStorage !== undefined) {
    if (!isPlainRecord(input.imageStorage)) throw new Error("R2 圖片空間格式無效。");
    assertOnlyKeys(
      input.imageStorage,
      ["accountId", "accessKeyId", "secretAccessKey", "bucket", "publicBaseUrl"],
      "R2 圖片空間",
    );
  }
}

function requireHttps(value: string, label: string): string {
  if (!value) return "";
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} 必須是有效的 HTTPS 網址。`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    throw new Error(`${label} 必須是沒有帳密或錨點的 HTTPS 網址。`);
  }
  return parsed.toString().replace(/\/$/, "");
}

function requireOperationsBoardPublicBaseUrl(value: string): string {
  if (!value) return "";
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("公布欄唯讀網址必須是有效的 HTTPS 網址。");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("公布欄唯讀網址必須是不含帳密、連接埠、查詢或錨點的 HTTPS 網址。");
  }
  return parsed.toString().replace(/\/$/u, "");
}

function hint(value: string): string | null {
  if (!value) return null;
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function safeParse(value: string): StoredCredentials {
  const raw: unknown = JSON.parse(value);
  if (!isPlainRecord(raw) || raw.version !== 1) {
    throw new Error("憑證保存格式無效。");
  }
  assertExactKeys(
    raw,
    [
      "version",
      "lwaClientId",
      "lwaClientSecret",
      "regions",
      "imageStorage",
      "replenishmentSkillUrl",
      "updatedAt",
    ],
    "憑證保存資料",
  );
  if (!isPlainRecord(raw.regions)) throw new Error("區域憑證保存格式無效。");
  assertExactKeys(raw.regions, ["na", "fe", "eu"], "區域憑證保存資料");
  const result = emptyCredentials();
  for (const key of [
    "lwaClientId",
    "lwaClientSecret",
    "replenishmentSkillUrl",
    "updatedAt",
  ] as const) {
    if (typeof raw[key] !== "string") throw new Error("憑證保存格式無效。");
  }
  result.lwaClientId = cleanText(raw.lwaClientId, 512);
  result.lwaClientSecret = cleanText(raw.lwaClientSecret, 4_096);
  for (const region of ["na", "fe", "eu"] as const) {
    const storedRegion = raw.regions[region];
    if (!isPlainRecord(storedRegion)) throw new Error("區域憑證保存格式無效。");
    assertExactKeys(storedRegion, ["refreshToken", "sellerId"], "區域憑證保存資料");
    if (
      typeof storedRegion.refreshToken !== "string" ||
      typeof storedRegion.sellerId !== "string"
    ) {
      throw new Error("區域憑證保存格式無效。");
    }
    result.regions[region] = {
      refreshToken: cleanText(storedRegion.refreshToken, 8_192),
      sellerId: cleanText(storedRegion.sellerId, 128),
    };
  }
  if (raw.imageStorage !== null) {
    if (!isPlainRecord(raw.imageStorage)) throw new Error("R2 憑證保存格式無效。");
    assertExactKeys(
      raw.imageStorage,
      ["accountId", "accessKeyId", "secretAccessKey", "bucket", "publicBaseUrl"],
      "R2 憑證保存資料",
    );
    if (Object.values(raw.imageStorage).some((item) => typeof item !== "string")) {
      throw new Error("R2 憑證保存格式無效。");
    }
    result.imageStorage = {
      accountId: cleanText(raw.imageStorage.accountId, 128),
      accessKeyId: cleanText(raw.imageStorage.accessKeyId, 512),
      secretAccessKey: cleanText(raw.imageStorage.secretAccessKey, 4_096),
      bucket: cleanText(raw.imageStorage.bucket, 128),
      publicBaseUrl: requireHttps(
        cleanText(raw.imageStorage.publicBaseUrl, 2_000),
        "圖片公開網址",
      ),
    };
  }
  result.replenishmentSkillUrl = requireHttps(
    cleanText(raw.replenishmentSkillUrl, 2_000),
    "補貨 Skill 網址",
  );
  result.updatedAt = cleanText(raw.updatedAt, 64);
  return result;
}

function safeParseOperationsBoardReader(value: string): StoredOperationsBoardReader {
  const raw: unknown = JSON.parse(value);
  if (!isPlainRecord(raw) || raw.version !== 1) {
    throw new Error("公布欄唯讀設定保存格式無效。");
  }
  assertExactKeys(raw, ["version", "publicBaseUrl", "updatedAt"], "公布欄唯讀設定");
  if (typeof raw.publicBaseUrl !== "string" || typeof raw.updatedAt !== "string") {
    throw new Error("公布欄唯讀設定保存格式無效。");
  }
  return {
    version: 1,
    publicBaseUrl: requireOperationsBoardPublicBaseUrl(
      cleanText(raw.publicBaseUrl, 2_000),
    ),
    updatedAt: cleanText(raw.updatedAt, 64),
  };
}

function validateCompleteness(value: StoredCredentials): void {
  if (Boolean(value.lwaClientId) !== Boolean(value.lwaClientSecret)) {
    throw new Error("LWA Client ID 與 Client Secret 必須一起填寫。");
  }
  for (const [region, credential] of Object.entries(value.regions)) {
    if (Boolean(credential.refreshToken) !== Boolean(credential.sellerId)) {
      throw new Error(`${region.toUpperCase()} 的 Refresh Token 與 Seller ID 必須一起填寫。`);
    }
  }
  if (value.imageStorage) {
    const fields = Object.values(value.imageStorage);
    if (fields.some(Boolean) && !fields.every(Boolean)) {
      throw new Error("R2 圖片空間的五個欄位必須全部填寫。");
    }
    if (fields.every(Boolean)) {
      if (!/^[a-f0-9]{32}$/i.test(value.imageStorage.accountId)) {
        throw new Error("R2 Account ID 必須是 Cloudflare 提供的 32 位十六進位值。");
      }
      const bucket = value.imageStorage.bucket;
      if (
        !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
        bucket.includes("..") ||
        /^\d{1,3}(?:\.\d{1,3}){3}$/.test(bucket)
      ) {
        throw new Error("R2 Bucket 名稱格式無效。");
      }
    }
  }
}

export class CredentialVault {
  readonly filePath: string;
  readonly operationsBoardFilePath: string;
  private cache: StoredCredentials | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.operationsBoardFilePath = join(dirname(filePath), "operations-board-reader.enc");
  }

  async encryptionAvailable(): Promise<boolean> {
    return safeStorage.isAsyncEncryptionAvailable();
  }

  async load(): Promise<StoredCredentials> {
    if (this.cache) return structuredClone(this.cache);
    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyCredentials();
      }
      throw error;
    }
    if (!(await this.encryptionAvailable())) {
      throw new Error("本機系統安全儲存區目前無法使用，因此系統拒絕解密 Amazon 憑證。");
    }
    const decrypted = await safeStorage.decryptStringAsync(encrypted);
    const parsed = safeParse(decrypted.result);
    validateCompleteness(parsed);
    if (decrypted.shouldReEncrypt) await this.writeEncrypted(parsed);
    this.cache = parsed;
    return structuredClone(parsed);
  }

  async save(input: CredentialInput): Promise<CredentialSummary> {
    validateCredentialInput(input);
    if (!(await this.encryptionAvailable())) {
      throw new Error("本機系統安全儲存區目前無法使用；系統不會用明文保存憑證。");
    }
    const current = await this.load();
    const next: StoredCredentials = structuredClone(current);
    const clientId = cleanText(input.lwaClientId, 512);
    const clientSecret = cleanText(input.lwaClientSecret, 4_096);
    if (clientId) next.lwaClientId = clientId;
    if (clientSecret) next.lwaClientSecret = clientSecret;
    for (const region of ["na", "fe", "eu"] as const) {
      const incoming = input.regions?.[region];
      if (!incoming) continue;
      const refreshToken = cleanText(incoming.refreshToken, 8_192);
      const sellerId = cleanSellerId(incoming.sellerId);
      if (
        refreshToken &&
        refreshToken !== current.regions[region].refreshToken &&
        !sellerId
      ) {
        throw new Error(
          `${region.toUpperCase()} 更新 Refresh Token 時必須一併填入同一帳號的 Seller ID。`,
        );
      }
      if (refreshToken) next.regions[region].refreshToken = refreshToken;
      if (sellerId) next.regions[region].sellerId = sellerId;
    }
    if (input.imageStorage) {
      const currentImage = next.imageStorage ?? {
        accountId: "",
        accessKeyId: "",
        secretAccessKey: "",
        bucket: "",
        publicBaseUrl: "",
      };
      const merged: StoredImageStorageCredentials = {
        accountId:
          cleanText(input.imageStorage.accountId, 128) || currentImage.accountId,
        accessKeyId:
          cleanText(input.imageStorage.accessKeyId, 512) || currentImage.accessKeyId,
        secretAccessKey:
          cleanText(input.imageStorage.secretAccessKey, 4_096) ||
          currentImage.secretAccessKey,
        bucket: cleanText(input.imageStorage.bucket, 128) || currentImage.bucket,
        publicBaseUrl:
          requireHttps(
            cleanText(input.imageStorage.publicBaseUrl, 2_000),
            "圖片公開網址",
          ) || currentImage.publicBaseUrl,
      };
      next.imageStorage = Object.values(merged).some(Boolean) ? merged : null;
    }
    const operationsBoardPublicBaseUrl = requireOperationsBoardPublicBaseUrl(
      cleanText(input.operationsBoardPublicBaseUrl, 2_000),
    );
    const currentOperationsBoardReader =
      !operationsBoardPublicBaseUrl && current.updatedAt
        ? await this.loadOperationsBoardReaderOrNull()
        : null;
    const preservedOperationsBoardPublicBaseUrl =
      current.updatedAt &&
      currentOperationsBoardReader?.updatedAt === current.updatedAt
        ? currentOperationsBoardReader.publicBaseUrl
        : "";
    const skillUrl = requireHttps(
      cleanText(input.replenishmentSkillUrl, 2_000),
      "補貨 Skill 網址",
    );
    if (skillUrl) next.replenishmentSkillUrl = skillUrl;
    next.updatedAt = new Date().toISOString();
    validateCompleteness(next);
    const nextOperationsBoardPublicBaseUrl =
      operationsBoardPublicBaseUrl || preservedOperationsBoardPublicBaseUrl;
    if (nextOperationsBoardPublicBaseUrl) {
      await this.writeCredentialsAndOperationsBoardReader(next, {
        version: 1,
        publicBaseUrl: nextOperationsBoardPublicBaseUrl,
        updatedAt: next.updatedAt,
      });
    } else {
      await this.writeEncrypted(next);
    }
    this.cache = next;
    this.applyToEnvironment(next);
    return this.summary(next, true);
  }

  async clear(): Promise<CredentialSummary> {
    const readerBackupPath =
      `${this.operationsBoardFilePath}.${crypto.randomUUID()}.clear-backup`;
    let readerBackedUp = false;
    try {
      try {
        await rename(this.operationsBoardFilePath, readerBackupPath);
        readerBackedUp = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      try {
        await unlink(this.filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    } catch (error) {
      if (readerBackedUp) {
        try {
          await rename(readerBackupPath, this.operationsBoardFilePath);
        } catch (restoreError) {
          throw new AggregateError(
            [error, restoreError],
            "清除主憑證失敗，且公布欄唯讀設定無法還原。",
          );
        }
      }
      throw error;
    }
    if (readerBackedUp) {
      await unlink(readerBackupPath).catch(() => undefined);
    }
    this.cache = null;
    this.applyToEnvironment(emptyCredentials());
    return this.summary(emptyCredentials(), await this.encryptionAvailable());
  }

  async initializeEnvironment(): Promise<void> {
    this.applyToEnvironment(await this.load());
  }

  async getImageStorage(): Promise<StoredImageStorageCredentials | null> {
    const value = await this.load();
    return value.imageStorage && Object.values(value.imageStorage).every(Boolean)
      ? structuredClone(value.imageStorage)
      : null;
  }

  async getOperationsBoardPublicBaseUrl(): Promise<string | null> {
    const value = await this.load();
    const reader = value.updatedAt
      ? await this.loadOperationsBoardReader()
      : null;
    const publicBaseUrl =
      (reader?.updatedAt === value.updatedAt ? reader.publicBaseUrl : "") ||
      value.imageStorage?.publicBaseUrl ||
      "";
    return publicBaseUrl
      ? requireOperationsBoardPublicBaseUrl(publicBaseUrl)
      : null;
  }

  async getAccountScope(region: SpApiRegion): Promise<string> {
    const value = await this.load();
    const sellerId = value.regions[region].sellerId || `demo-${region}`;
    const clientId = value.lwaClientId || "demo-client";
    return createHash("sha256")
      .update(`${region}\0${sellerId}\0${clientId}`)
      .digest("hex");
  }

  async getSummary(): Promise<CredentialSummary> {
    const [value, encryptionAvailable] = await Promise.all([
      this.load(),
      this.encryptionAvailable(),
    ]);
    return this.summary(value, encryptionAvailable);
  }

  private async writeEncrypted(value: StoredCredentials): Promise<void> {
    await this.writeEncryptedJson(this.filePath, value);
  }

  private async writeOperationsBoardReader(
    value: StoredOperationsBoardReader,
  ): Promise<void> {
    await this.writeEncryptedJson(this.operationsBoardFilePath, value);
  }

  private async writeEncryptedJson(filePath: string, value: unknown): Promise<void> {
    const temporaryPath = await this.prepareEncryptedJson(filePath, value);
    try {
      await rename(temporaryPath, filePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  private async prepareEncryptedJson(filePath: string, value: unknown): Promise<string> {
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
    const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(value));
    const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporaryPath, encrypted, { mode: 0o600, flag: "wx" });
    await chmod(temporaryPath, 0o600);
    return temporaryPath;
  }

  private async writeCredentialsAndOperationsBoardReader(
    credentials: StoredCredentials,
    reader: StoredOperationsBoardReader,
  ): Promise<void> {
    const credentialsTemporaryPath = await this.prepareEncryptedJson(
      this.filePath,
      credentials,
    );
    let readerTemporaryPath: string;
    try {
      readerTemporaryPath = await this.prepareEncryptedJson(
        this.operationsBoardFilePath,
        reader,
      );
    } catch (error) {
      await unlink(credentialsTemporaryPath).catch(() => undefined);
      throw error;
    }

    const readerBackupPath =
      `${this.operationsBoardFilePath}.${crypto.randomUUID()}.backup`;
    let readerBackedUp = false;
    let readerCommitted = false;
    try {
      try {
        await rename(this.operationsBoardFilePath, readerBackupPath);
        readerBackedUp = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await rename(readerTemporaryPath, this.operationsBoardFilePath);
      readerCommitted = true;
      await rename(credentialsTemporaryPath, this.filePath);
    } catch (error) {
      if (readerCommitted) {
        await unlink(this.operationsBoardFilePath).catch(() => undefined);
      }
      if (readerBackedUp) {
        await rename(readerBackupPath, this.operationsBoardFilePath)
          .catch(() => undefined);
      }
      await Promise.all([
        unlink(credentialsTemporaryPath).catch(() => undefined),
        unlink(readerTemporaryPath).catch(() => undefined),
      ]);
      throw error;
    }
    if (readerBackedUp) {
      await unlink(readerBackupPath).catch(() => undefined);
    }
  }

  private async loadOperationsBoardReader(): Promise<StoredOperationsBoardReader | null> {
    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.operationsBoardFilePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (!(await this.encryptionAvailable())) {
      throw new Error("本機系統安全儲存區目前無法使用，因此系統拒絕解密公布欄設定。");
    }
    const decrypted = await safeStorage.decryptStringAsync(encrypted);
    const parsed = safeParseOperationsBoardReader(decrypted.result);
    if (decrypted.shouldReEncrypt) await this.writeOperationsBoardReader(parsed);
    return parsed;
  }

  private async loadOperationsBoardReaderOrNull(): Promise<StoredOperationsBoardReader | null> {
    try {
      return await this.loadOperationsBoardReader();
    } catch {
      return null;
    }
  }

  private applyToEnvironment(value: StoredCredentials): void {
    for (const key of ENVIRONMENT_KEYS) delete process.env[key];
    if (value.lwaClientId) process.env.SP_API_LWA_CLIENT_ID = value.lwaClientId;
    if (value.lwaClientSecret) {
      process.env.SP_API_LWA_CLIENT_SECRET = value.lwaClientSecret;
    }
    for (const region of ["na", "fe", "eu"] as const) {
      const suffix = region.toUpperCase();
      const credential = value.regions[region];
      if (credential.refreshToken) {
        process.env[`SP_API_REFRESH_TOKEN_${suffix}`] = credential.refreshToken;
      }
      if (credential.sellerId) {
        process.env[`SP_API_SELLER_ID_${suffix}`] = credential.sellerId;
      }
    }
    if (value.imageStorage?.publicBaseUrl) {
      process.env.SP_API_IMAGE_PUBLIC_BASE_URL = value.imageStorage.publicBaseUrl;
    }
    if (value.replenishmentSkillUrl) {
      process.env.AMAZON_REPLENISHMENT_SKILL_URL = value.replenishmentSkillUrl;
    }
  }

  private summary(value: StoredCredentials, encryptionAvailable: boolean): CredentialSummary {
    const regionSummary = (region: SpApiRegion) => ({
      configured: Boolean(
        value.lwaClientId &&
          value.lwaClientSecret &&
          value.regions[region].refreshToken &&
          value.regions[region].sellerId,
      ),
      refreshTokenHint: hint(value.regions[region].refreshToken),
      sellerIdHint: hint(value.regions[region].sellerId),
    });
    return {
      encryptionAvailable,
      hasVault: Boolean(value.updatedAt),
      lwaConfigured: Boolean(value.lwaClientId && value.lwaClientSecret),
      regions: {
        na: regionSummary("na"),
        fe: regionSummary("fe"),
        eu: regionSummary("eu"),
      },
      imageStorageConfigured: Boolean(
        value.imageStorage && Object.values(value.imageStorage).every(Boolean),
      ),
      imagePublicBaseUrl: value.imageStorage?.publicBaseUrl ?? null,
      replenishmentSkillConfigured: Boolean(value.replenishmentSkillUrl),
      updatedAt: value.updatedAt || null,
    };
  }
}
