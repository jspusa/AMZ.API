import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { safeStorage } from "electron";
import type { OperationsBoardAdminSummary } from "../shared/operations-board";
import type { OperationsBoardAdminRotationInput } from "../shared/operations-board";

type StoredAdmin = Readonly<{
  version: 1;
  username: string;
  salt: string;
  verifier: string;
  updatedAt: string;
}>;

function cleanUsername(value: unknown): string {
  if (typeof value !== "string") throw new Error("管理帳號格式無效。");
  const result = value.trim();
  if (!result || result.length > 64 || /[^A-Za-z0-9._-]/u.test(result)) {
    throw new Error("管理帳號只能使用 1–64 個英數字、句點、底線或連字號。");
  }
  return result;
}

function cleanPassword(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 8 ||
    value.length > 128 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error("管理密碼必須是 8–128 個有效字元。");
  }
  return value;
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseStored(value: string): StoredAdmin {
  const raw: unknown = JSON.parse(value);
  if (!isRecord(raw)) throw new Error("公布欄管理設定格式無效。");
  const keys = ["version", "username", "salt", "verifier", "updatedAt"];
  if (
    raw.version !== 1 ||
    Object.keys(raw).length !== keys.length ||
    keys.some((key) => !Object.prototype.hasOwnProperty.call(raw, key)) ||
    typeof raw.salt !== "string" ||
    typeof raw.verifier !== "string" ||
    typeof raw.updatedAt !== "string"
  ) {
    throw new Error("公布欄管理設定格式無效。");
  }
  const salt = Buffer.from(raw.salt, "base64");
  const verifier = Buffer.from(raw.verifier, "base64");
  if (salt.length !== 16 || verifier.length !== 32 || Number.isNaN(Date.parse(raw.updatedAt))) {
    throw new Error("公布欄管理設定格式無效。");
  }
  return {
    version: 1,
    username: cleanUsername(raw.username),
    salt: salt.toString("base64"),
    verifier: verifier.toString("base64"),
    updatedAt: raw.updatedAt,
  };
}

export class OperationsBoardAdminVault {
  readonly filePath: string;
  private cache: StoredAdmin | null | undefined;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async encryptionAvailable(): Promise<boolean> {
    return safeStorage.isAsyncEncryptionAvailable();
  }

  private async load(): Promise<StoredAdmin | null> {
    if (this.cache !== undefined) return this.cache ? { ...this.cache } : null;
    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.cache = null;
        return null;
      }
      throw error;
    }
    if (!(await this.encryptionAvailable())) {
      throw new Error("本機系統安全儲存區目前無法使用。");
    }
    const decrypted = await safeStorage.decryptStringAsync(encrypted);
    const stored = parseStored(decrypted.result);
    if (decrypted.shouldReEncrypt) await this.write(stored);
    this.cache = stored;
    return { ...stored };
  }

  async summary(): Promise<OperationsBoardAdminSummary> {
    const stored = await this.load();
    return { configured: Boolean(stored), username: stored?.username ?? null };
  }

  async enroll(input: Readonly<{ username: string; password: string }>): Promise<OperationsBoardAdminSummary> {
    if (await this.load()) throw new Error("公布欄管理帳號已設定。");
    if (!(await this.encryptionAvailable())) {
      throw new Error("本機系統安全儲存區目前無法使用；系統拒絕保存管理設定。");
    }
    const username = cleanUsername(input.username);
    const password = cleanPassword(input.password);
    const salt = randomBytes(16);
    const verifier = await derive(password, salt);
    const stored: StoredAdmin = {
      version: 1,
      username,
      salt: salt.toString("base64"),
      verifier: verifier.toString("base64"),
      updatedAt: new Date().toISOString(),
    };
    await this.write(stored);
    this.cache = stored;
    return { configured: true, username };
  }

  async verify(input: Readonly<{ username: string; password: string }>): Promise<boolean> {
    const stored = await this.load();
    if (!stored) return false;
    let username: string;
    let password: string;
    try {
      username = cleanUsername(input.username);
      password = cleanPassword(input.password);
    } catch {
      return false;
    }
    const candidate = await derive(password, Buffer.from(stored.salt, "base64"));
    const expected = Buffer.from(stored.verifier, "base64");
    const usernameExpected = Buffer.from(stored.username.padEnd(64, "\0"));
    const usernameCandidate = Buffer.from(username.padEnd(64, "\0").slice(0, 64));
    return timingSafeEqual(expected, candidate) &&
      usernameExpected.length === usernameCandidate.length &&
      timingSafeEqual(usernameExpected, usernameCandidate);
  }

  async rotate(input: OperationsBoardAdminRotationInput): Promise<OperationsBoardAdminSummary> {
    const stored = await this.load();
    if (!stored) throw new Error("公布欄管理帳號尚未設定。");
    if (!(await this.encryptionAvailable())) {
      throw new Error("本機系統安全儲存區目前無法使用；系統拒絕更新管理設定。");
    }
    if (!(await this.verify({
      username: input.currentUsername,
      password: input.currentPassword,
    }))) {
      throw new Error("目前的管理帳號或密碼不正確。");
    }
    const username = cleanUsername(input.newUsername);
    const password = cleanPassword(input.newPassword);
    const salt = randomBytes(16);
    const verifier = await derive(password, salt);
    const next: StoredAdmin = {
      version: 1,
      username,
      salt: salt.toString("base64"),
      verifier: verifier.toString("base64"),
      updatedAt: new Date().toISOString(),
    };
    await this.write(next);
    this.cache = next;
    return { configured: true, username };
  }

  private async write(value: StoredAdmin): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(value));
    const temporaryPath = `${this.filePath}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporaryPath, encrypted, { mode: 0o600, flag: "wx" });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, this.filePath);
    await chmod(this.filePath, 0o600);
  }
}
