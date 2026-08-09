import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { safeStorage } from "electron";
import type {
  AdvertisingApiRegion,
  AdvertisingCredentialInput,
  AdvertisingCredentialSummary,
} from "../shared/contracts";

export type StoredAdvertisingCredentials = {
  version: 1;
  lwaClientId: string;
  lwaClientSecret: string;
  refreshToken: string;
  oauthRegion: AdvertisingApiRegion;
  updatedAt: string;
};

function emptyCredentials(): StoredAdvertisingCredentials {
  return {
    version: 1,
    lwaClientId: "",
    lwaClientSecret: "",
    refreshToken: "",
    oauthRegion: "na",
    updatedAt: "",
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cleanText(value: unknown, maximum: number): string {
  if (typeof value !== "string") return "";
  const result = value.trim();
  if (result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw new Error("Amazon Ads 憑證包含無效字元或超過長度上限。");
  }
  return result;
}

function cleanRegion(value: unknown, fallback: AdvertisingApiRegion): AdvertisingApiRegion {
  if (value === undefined || value === "") return fallback;
  if (value === "na" || value === "eu" || value === "fe") return value;
  throw new Error("Amazon Ads OAuth 區域無效。");
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const keys = Object.keys(value);
  if (
    keys.some((key) => !expected.includes(key)) ||
    expected.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) {
    throw new Error(`${label}格式無效。`);
  }
}

function validateInput(input: unknown): asserts input is AdvertisingCredentialInput {
  if (!isPlainRecord(input)) throw new Error("Amazon Ads 憑證輸入格式無效。");
  const allowed = ["lwaClientId", "lwaClientSecret", "refreshToken", "oauthRegion"];
  if (Object.keys(input).some((key) => !allowed.includes(key))) {
    throw new Error("Amazon Ads 憑證輸入包含不支援的欄位。");
  }
}

function parseStored(value: string): StoredAdvertisingCredentials {
  const raw: unknown = JSON.parse(value);
  if (!isPlainRecord(raw) || raw.version !== 1) {
    throw new Error("Amazon Ads 憑證保存格式無效。");
  }
  assertExactKeys(
    raw,
    ["version", "lwaClientId", "lwaClientSecret", "refreshToken", "oauthRegion", "updatedAt"],
    "Amazon Ads 憑證保存資料",
  );
  const result: StoredAdvertisingCredentials = {
    version: 1,
    lwaClientId: cleanText(raw.lwaClientId, 512),
    lwaClientSecret: cleanText(raw.lwaClientSecret, 4_096),
    refreshToken: cleanText(raw.refreshToken, 2_048),
    oauthRegion: cleanRegion(raw.oauthRegion, "na"),
    updatedAt: cleanText(raw.updatedAt, 64),
  };
  validateCompleteness(result);
  return result;
}

function validateCompleteness(value: StoredAdvertisingCredentials): void {
  const fields = [value.lwaClientId, value.lwaClientSecret, value.refreshToken];
  if (fields.some(Boolean) && !fields.every(Boolean)) {
    throw new Error("Ads LWA Client ID、Client Secret 與 Refresh Token 必須全部填寫。");
  }
}

export class AdvertisingCredentialVault {
  readonly filePath: string;
  private cache: StoredAdvertisingCredentials | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async encryptionAvailable(): Promise<boolean> {
    return safeStorage.isAsyncEncryptionAvailable();
  }

  async load(): Promise<StoredAdvertisingCredentials> {
    if (this.cache) return structuredClone(this.cache);
    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyCredentials();
      throw error;
    }
    if (!(await this.encryptionAvailable())) {
      throw new Error("macOS Keychain 目前無法使用，因此系統拒絕解密 Amazon Ads 憑證。");
    }
    const decrypted = await safeStorage.decryptStringAsync(encrypted);
    const parsed = parseStored(decrypted.result);
    if (decrypted.shouldReEncrypt) await this.writeEncrypted(parsed);
    this.cache = parsed;
    return structuredClone(parsed);
  }

  async save(input: AdvertisingCredentialInput): Promise<AdvertisingCredentialSummary> {
    validateInput(input);
    if (!(await this.encryptionAvailable())) {
      throw new Error("macOS Keychain 目前無法使用；系統不會用明文保存 Ads 憑證。");
    }
    const current = await this.load();
    const next = structuredClone(current);
    const clientId = cleanText(input.lwaClientId, 512);
    const clientSecret = cleanText(input.lwaClientSecret, 4_096);
    const refreshToken = cleanText(input.refreshToken, 2_048);
    if (clientId) next.lwaClientId = clientId;
    if (clientSecret) next.lwaClientSecret = clientSecret;
    if (refreshToken) next.refreshToken = refreshToken;
    next.oauthRegion = cleanRegion(input.oauthRegion, current.oauthRegion);
    next.updatedAt = new Date().toISOString();
    validateCompleteness(next);
    if (!next.lwaClientId || !next.lwaClientSecret || !next.refreshToken) {
      throw new Error("Ads LWA Client ID、Client Secret 與 Refresh Token 必須全部填寫。");
    }
    await this.writeEncrypted(next);
    this.cache = next;
    return this.summary(next, true);
  }

  async clear(): Promise<AdvertisingCredentialSummary> {
    try {
      await unlink(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.cache = null;
    return this.summary(emptyCredentials(), await this.encryptionAvailable());
  }

  async getSummary(): Promise<AdvertisingCredentialSummary> {
    const [value, encryptionAvailable] = await Promise.all([
      this.load(),
      this.encryptionAvailable(),
    ]);
    return this.summary(value, encryptionAvailable);
  }

  async getAccountScope(): Promise<string> {
    const value = await this.load();
    return createHash("sha256")
      .update(`${value.oauthRegion}\0${value.lwaClientId}\0${value.refreshToken}`)
      .digest("hex");
  }

  private async writeEncrypted(value: StoredAdvertisingCredentials): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(value));
    const temporaryPath = `${this.filePath}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporaryPath, encrypted, { mode: 0o600, flag: "wx" });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, this.filePath);
    await chmod(this.filePath, 0o600);
  }

  private summary(
    value: StoredAdvertisingCredentials,
    encryptionAvailable: boolean,
  ): AdvertisingCredentialSummary {
    return {
      encryptionAvailable,
      hasVault: Boolean(value.updatedAt),
      configured: Boolean(value.lwaClientId && value.lwaClientSecret && value.refreshToken),
      lwaConfigured: Boolean(value.lwaClientId && value.lwaClientSecret),
      refreshTokenConfigured: Boolean(value.refreshToken),
      oauthRegion: value.oauthRegion,
      updatedAt: value.updatedAt || null,
    };
  }
}
