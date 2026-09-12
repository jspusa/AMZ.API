import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { PrivateLocalJsonCodec } from "./private-local-json";

export interface ListingImageCredentialPort {
  hasCredentials(): Promise<boolean>;
  read(assertCurrent: () => Promise<void>): Promise<string>;
  save(password: string, assertCurrent: () => Promise<void>): Promise<void>;
}

const MAX_BYTES = 8192;
export const LISTING_IMAGE_VAULT_ERROR = "無法確認圖片服務加密登入設定的讀寫結果；請稍後再試。";
const STORAGE_ERROR = LISTING_IMAGE_VAULT_ERROR;
export const LISTING_IMAGE_VAULT_UNAVAILABLE = "本機安全儲存區目前無法使用；圖片服務不會用明文保存或讀取密碼。";
const UNAVAILABLE = LISTING_IMAGE_VAULT_UNAVAILABLE;

export function validListingImagePassword(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(value);
}

/** No plaintext cache: each read follows a fresh main-owned native approval. */
export class ListingImageCredentialVault implements ListingImageCredentialPort {
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly input: Readonly<{ path: string; codec: PrivateLocalJsonCodec }>) {}

  async hasCredentials(): Promise<boolean> {
    await this.queue.catch(() => undefined);
    try {
      const info = await lstat(this.input.path);
      if (!info.isFile() || info.size < 1 || info.size > MAX_BYTES) throw new Error(STORAGE_ERROR);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return false;
      throw new Error(STORAGE_ERROR);
    }
  }

  private async requireEncryption(): Promise<void> {
    let available = false;
    try { available = await this.input.codec.isAvailable(); } catch { /* fail closed */ }
    if (!available) throw new Error(UNAVAILABLE);
  }

  async read(assertCurrent: () => Promise<void>): Promise<string> {
    await assertCurrent();
    await this.queue.catch(() => undefined);
    await this.requireEncryption();
    await assertCurrent();
    let encrypted: Buffer;
    try {
      const file = await open(this.input.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await file.stat();
        if (!info.isFile() || info.size < 1 || info.size > MAX_BYTES) throw new Error(STORAGE_ERROR);
        encrypted = await file.readFile();
        if (encrypted.length > MAX_BYTES) throw new Error(STORAGE_ERROR);
      } finally { await file.close(); }
    } catch { throw new Error(STORAGE_ERROR); }
    await assertCurrent();
    let decoded: string;
    try { decoded = await this.input.codec.decrypt(encrypted); }
    catch { throw new Error(STORAGE_ERROR); }
    await assertCurrent();
    try {
      if (Buffer.byteLength(decoded) > MAX_BYTES) throw new Error(STORAGE_ERROR);
      const value: unknown = JSON.parse(decoded);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(STORAGE_ERROR);
      const record = value as Record<string, unknown>;
      if (Object.keys(record).length !== 2 || record.version !== 1 || !validListingImagePassword(record.password)) throw new Error(STORAGE_ERROR);
      return record.password;
    } catch { throw new Error(STORAGE_ERROR); }
  }

  save(password: string, assertCurrent: () => Promise<void>): Promise<void> {
    if (!validListingImagePassword(password)) return Promise.reject(new Error("請輸入有效的下載頁密碼。"));
    const work = this.queue.catch(() => undefined).then(async () => {
      await assertCurrent();
      await this.requireEncryption();
      await assertCurrent();
      let encrypted: Buffer;
      try { encrypted = await this.input.codec.encrypt(JSON.stringify({ version: 1, password })); }
      catch { throw new Error(STORAGE_ERROR); }
      await assertCurrent();
      if (!encrypted.length || encrypted.length > MAX_BYTES) throw new Error(STORAGE_ERROR);
      const temporary = `${this.input.path}.${randomUUID()}.tmp`;
      try {
        try {
          await mkdir(dirname(this.input.path), { recursive: true, mode: 0o700 });
          const file = await open(temporary, "wx", 0o600);
          try { await file.writeFile(encrypted); await file.sync(); }
          finally { await file.close(); }
        } catch { throw new Error(STORAGE_ERROR); }
        await assertCurrent();
        try {
          await rename(temporary, this.input.path);
          try {
            const directory = await open(dirname(this.input.path), "r");
            try { await directory.sync(); } finally { await directory.close(); }
          } catch (error) {
            if (process.platform !== "win32" || !["EPERM", "EISDIR", "EINVAL", "ENOTSUP", "EBADF"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
          }
        } catch { throw new Error(STORAGE_ERROR); }
        await assertCurrent();
      } finally { await rm(temporary, { force: true }).catch(() => undefined); }
    });
    this.queue = work;
    return work;
  }
}
