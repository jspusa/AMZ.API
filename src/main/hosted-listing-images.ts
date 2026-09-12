import { createHash, randomUUID } from "node:crypto";
import { validListingImagePassword, LISTING_IMAGE_VAULT_ERROR, LISTING_IMAGE_VAULT_UNAVAILABLE } from "./listing-image-credential-vault";
import { NATIVE_BIOMETRIC_REQUIRED_MESSAGE, NATIVE_CONFIRMATION_BUSY_MESSAGE, NATIVE_CONFIRMATION_CANCELLED_MESSAGE, WINDOWS_HELLO_REQUIRED_MESSAGE } from "./native-confirmation";

export const LISTING_IMAGE_PREPARATION_MESSAGES = Object.freeze({
  IMAGE_PASSWORD_REJECTED: "圖片服務密碼已失效或不正確，請更新下載頁密碼。",
  IMAGE_LOGIN_UNAVAILABLE: "圖片服務目前無法連線或忙碌；已保留登入設定，請稍後重新準備圖片。",
  IMAGE_LOGIN_INVALID_RESPONSE: "圖片服務登入回覆無效；已保留登入設定，請稍後再試。",
  IMAGE_LOGIN_CANCELLED: "圖片服務身分驗證已取消或未通過；檔案仍保留在工作台。",
  IMAGE_BIOMETRIC_REQUIRED: "圖片服務需要可用的 Touch ID／Windows Hello；登入設定尚未解鎖，檔案仍保留在工作台。",
  IMAGE_WINDOWS_HELLO_REQUIRED: "請先在 Windows 設定中啟用 Windows Hello（指紋、臉部或 PIN）；圖片服務登入設定尚未解鎖。",
  IMAGE_LOGIN_BUSY: "另一個本機身分驗證正在進行；請完成後重新準備圖片。",
  IMAGE_VAULT_UNAVAILABLE: LISTING_IMAGE_VAULT_UNAVAILABLE,
  IMAGE_VAULT_ERROR: LISTING_IMAGE_VAULT_ERROR,
  IMAGE_PREPARATION_INCOMPLETE: "圖片準備尚未完成，檔案仍保留在工作台。請稍後重新準備圖片。",
});

export const LISTING_IMAGE_SERVICE_ORIGIN = "https://supply-boss.brave-prawn-0848.chatgpt.site";
const MAX_BYTES = 10 * 1024 * 1024;
type ImageType = "image/png" | "image/jpeg";
export class ListingImageLoginError extends Error {
  constructor(readonly code: "invalid-password" | "unavailable" | "invalid-response") {
    super(code === "invalid-password" ? LISTING_IMAGE_PREPARATION_MESSAGES.IMAGE_PASSWORD_REJECTED
      : code === "unavailable" ? LISTING_IMAGE_PREPARATION_MESSAGES.IMAGE_LOGIN_UNAVAILABLE
      : LISTING_IMAGE_PREPARATION_MESSAGES.IMAGE_LOGIN_INVALID_RESPONSE);
  }
}

/** Fixed public vocabulary only; upstream/OS messages are never returned verbatim. */
export function publicListingImagePreparationError(error: unknown): Readonly<{ code: string; message: string; status: number }> {
  let code: keyof typeof LISTING_IMAGE_PREPARATION_MESSAGES = "IMAGE_PREPARATION_INCOMPLETE";
  if (error instanceof ListingImageLoginError) {
    code = error.code === "invalid-password" ? "IMAGE_PASSWORD_REJECTED" : error.code === "unavailable" ? "IMAGE_LOGIN_UNAVAILABLE" : "IMAGE_LOGIN_INVALID_RESPONSE";
  } else if (error instanceof Error) {
    const known = new Map<string, keyof typeof LISTING_IMAGE_PREPARATION_MESSAGES>([
      [NATIVE_CONFIRMATION_CANCELLED_MESSAGE, "IMAGE_LOGIN_CANCELLED"],
      ["圖片登入已取消或工作環境已切換，請重新準備圖片。", "IMAGE_LOGIN_CANCELLED"],
      [NATIVE_BIOMETRIC_REQUIRED_MESSAGE, "IMAGE_BIOMETRIC_REQUIRED"],
      [WINDOWS_HELLO_REQUIRED_MESSAGE, "IMAGE_WINDOWS_HELLO_REQUIRED"],
      [NATIVE_CONFIRMATION_BUSY_MESSAGE, "IMAGE_LOGIN_BUSY"],
      [LISTING_IMAGE_VAULT_ERROR, "IMAGE_VAULT_ERROR"],
      [LISTING_IMAGE_VAULT_UNAVAILABLE, "IMAGE_VAULT_UNAVAILABLE"],
    ]);
    code = known.get(error.message) ?? code;
  }
  return { code, message: LISTING_IMAGE_PREPARATION_MESSAGES[code], status: code === "IMAGE_LOGIN_CANCELLED" || code === "IMAGE_LOGIN_BUSY" ? 409 : 503 };
}

class ImageServiceResponseError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export interface HostedListingImagePort {
  prepare(input: Readonly<{
    bytes: Uint8Array; contentType: ImageType; width: number; height: number;
    contextKey: string; assertCurrent(): Promise<void>;
  }>): Promise<Readonly<{ url: string; key: string }>>;
}

/** Dedicated employee image session; never receives or reuses board/download tokens. */
export class HostedListingImages implements HostedListingImagePort {
  private session: { token: string; expires: number } | null = null;
  private generation = 0;
  private loginFlight: Promise<void> | null = null;
  private controllers = new Set<AbortController>();
  private operations = new Map<string, { id: string; verified: boolean; rejected: boolean }>();

  constructor(private readonly input: Readonly<{
    requestLogin(assertCurrent: () => Promise<void>): Promise<void>;
    fetch?: typeof fetch;
    uuid?: () => string;
    now?: () => number;
  }>) {}

  private now(): number { return this.input.now?.() ?? Date.now(); }
  authenticated(): boolean { return Boolean(this.session && this.session.expires > this.now()); }
  clear(): void {
    this.generation += 1;
    this.session = null;
    this.loginFlight = null;
    for (const controller of this.controllers) controller.abort();
  }

  private async request(path: string, init: RequestInit, consume: (response: Response) => Promise<unknown>): Promise<unknown> {
    const controller = new AbortController();
    this.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await (this.input.fetch ?? fetch)(LISTING_IMAGE_SERVICE_ORIGIN + path, {
        ...init, redirect: "error", cache: "no-store", credentials: "omit", signal: controller.signal,
      });
      return await consume(response);
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(controller);
    }
  }

  private async bounded(response: Response, maximum: number): Promise<Uint8Array> {
    const declared = response.headers.get("content-length");
    if (declared && (!/^\d+$/u.test(declared) || Number(declared) > maximum)) throw new Error("圖片服務回覆超過大小限制。");
    if (!response.body) throw new Error("圖片服務未回傳內容。");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > maximum) { await reader.cancel(); throw new Error("圖片服務回覆超過大小限制。"); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  }

  private async receipt(response: Response): Promise<Record<string, unknown>> {
    if (response.status === 401) { this.session = null; throw new ImageServiceResponseError(401, "圖片服務登入已到期，請重新準備圖片。"); }
    if (!response.ok) throw new ImageServiceResponseError(response.status, response.status === 429 ? "圖片服務忙碌，請稍後再確認。" : "圖片上傳尚未確認；已保留檔案，可再次準備以查詢結果。");
    if (!response.headers.get("content-type")?.startsWith("application/json")) throw new Error("圖片服務回覆格式無效。");
    const value: unknown = JSON.parse(new TextDecoder().decode(await this.bounded(response, 8192)));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("圖片服務回覆格式無效。");
    return value as Record<string, unknown>;
  }

  async login(password: unknown, assertCurrent: () => Promise<void> = async () => {}, onVerified?: () => Promise<void>): Promise<void> {
    if (!validListingImagePassword(password)) throw new Error("請輸入有效的下載頁密碼。");
    const generation = this.generation;
    const startedAt = this.now();
    const fence = async (): Promise<void> => {
      await assertCurrent();
      if (generation !== this.generation) throw new Error("圖片登入已取消或工作環境已切換，請重新準備圖片。");
    };
    await fence();
    let result: Record<string, unknown>;
    try {
      result = await this.request("/api/listing-images/login", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }),
      }, async (response) => {
        if (!response.ok) {
          await response.body?.cancel();
          throw new ListingImageLoginError(response.status === 401 ? "invalid-password" : "unavailable");
        }
        try { return await this.receipt(response); }
        catch { throw new ListingImageLoginError("invalid-response"); }
      }) as Record<string, unknown>;
    } catch (error) {
      await fence();
      if (error instanceof ListingImageLoginError) throw error;
      throw new ListingImageLoginError("unavailable");
    }
    await fence();
    const expires = typeof result.expiresAt === "string" ? Date.parse(result.expiresAt) : NaN;
    if (typeof result.token !== "string" || result.token.length < 32 || result.token.length > 4096 || /[\r\n]/u.test(result.token) || !Number.isFinite(expires) || expires <= this.now() || expires > startedAt + 8 * 60 * 60_000 + 60_000) throw new ListingImageLoginError("invalid-response");
    // Initial setup persists only the verified password; the session is not
    // published until persistence and the final context fence both succeed.
    await onVerified?.();
    await fence();
    this.session = { token: result.token, expires: Math.min(expires, startedAt + 8 * 60 * 60_000) };
  }

  async prepare(input: Parameters<HostedListingImagePort["prepare"]>[0]): Promise<Readonly<{ url: string; key: string }>> {
    const generation = this.generation;
    const fence = async (): Promise<void> => {
      await input.assertCurrent();
      if (generation !== this.generation) throw new Error("圖片工作環境已切換，請重新準備。");
    };
    await fence();
    if (!this.authenticated()) {
      if (!this.loginFlight) {
        const flight = this.input.requestLogin(fence).finally(() => { if (this.loginFlight === flight) this.loginFlight = null; });
        this.loginFlight = flight;
      }
      await this.loginFlight;
    }
    await fence();
    if (!this.authenticated() || !this.session) throw new Error("圖片服務尚未登入；檔案仍保留在工作台。");
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const identity = createHash("sha256").update(JSON.stringify([input.contextKey, sha256])).digest("hex");
    let existing = this.operations.get(identity);
    const headers = { authorization: `Bearer ${this.session.token}` };
    let recovered: Record<string, unknown> | undefined;
    if (existing?.rejected) {
      try {
        recovered = await this.request(`/api/listing-images/${existing.id}`, { method: "GET", headers }, response => this.receipt(response)) as Record<string, unknown>;
      } catch (error) {
        await fence();
        if (!(error instanceof ImageServiceResponseError) || error.status !== 404) throw error;
        // This is a new user preparation: a definitive pre-write rejection plus
        // authenticated absence permits a fresh conditional operation.
        this.operations.delete(identity);
        existing = undefined;
      }
    }
    if (!existing && this.operations.size >= 500) {
      for (const [key, operation] of this.operations) if (operation.verified) this.operations.delete(key);
      if (this.operations.size >= 500) throw new Error("尚未確認的圖片過多，請先確認既有上傳結果。");
    }
    const operation = existing ?? { id: (this.input.uuid ?? randomUUID)(), verified: false, rejected: false };
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(operation.id)) throw new Error("圖片工作編號無效。");
    this.operations.set(identity, operation);
    const path = `/api/listing-images/${operation.id}`;
    let result: Record<string, unknown>;
    try {
      result = recovered ?? await this.request(path, existing ? { method: "GET", headers } : {
        method: "PUT", headers: { ...headers, "content-type": input.contentType }, body: Buffer.from(input.bytes),
      }, (response) => this.receipt(response)) as Record<string, unknown>;
    } catch (error) {
      await fence();
      if (existing) throw error;
      operation.rejected = error instanceof ImageServiceResponseError && [400, 401, 413, 415, 422].includes(error.status);
      // A lost PUT response is resolved only by GET, including subsequent preparation attempts.
      try {
        result = await this.request(path, { method: "GET", headers }, (response) => this.receipt(response)) as Record<string, unknown>;
      } catch (readError) {
        if (operation.rejected && readError instanceof ImageServiceResponseError && readError.status === 404) this.operations.delete(identity);
        throw readError;
      }
    }
    await fence();
    const extension = input.contentType === "image/png" ? "png" : "jpg";
    const publicPath = `/listing-images/${operation.id}/${sha256}.${extension}`;
    const url = LISTING_IMAGE_SERVICE_ORIGIN + publicPath;
    if (result.operationId !== operation.id || result.sha256 !== sha256 || result.size !== input.bytes.length || result.width !== input.width || result.height !== input.height || result.contentType !== input.contentType || result.url !== url) throw new Error("圖片服務回傳的檔案與原檔不一致。");
    await this.request(publicPath, { method: "GET" }, async (response) => {
      if (!response.ok || response.headers.get("content-type") !== input.contentType) throw new Error("圖片尚無法公開讀取，請再次準備圖片以確認。");
      const bytes = await this.bounded(response, MAX_BYTES);
      if (bytes.length !== input.bytes.length || createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error("公開圖片內容與原檔不一致。");
      return null;
    });
    await fence();
    operation.verified = true;
    return { url, key: operation.id };
  }
}
