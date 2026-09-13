import { createHash, randomUUID } from "node:crypto";

export const LISTING_IMAGE_SERVICE_ORIGIN = "https://supply-boss.brave-prawn-0848.chatgpt.site";
const MAX_BYTES = 10 * 1024 * 1024;
type ImageType = "image/png" | "image/jpeg";

/** Fixed public vocabulary only; upstream messages are never returned verbatim. */
export function publicListingImagePreparationError(error: unknown): Readonly<{ code: string; message: string; status: number }> {
  if (error instanceof ImageServiceResponseError && error.status === 429) {
    return { code: "IMAGE_SERVICE_BUSY", message: "圖片服務目前忙碌或已達準備上限；檔案仍保留在工作台，請稍後再準備。", status: 429 };
  }
  return { code: "IMAGE_PREPARATION_INCOMPLETE", message: "圖片準備尚未完成，檔案仍保留在工作台。請稍後重新準備圖片以確認結果。", status: 503 };
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

/** Fixed image-only preparation service. No credential or native approval capability. */
export class HostedListingImages implements HostedListingImagePort {
  private generation = 0;
  private controllers = new Set<AbortController>();
  private operations = new Map<string, { id: string; verified: boolean; rejected: boolean }>();

  constructor(private readonly input: Readonly<{
    fetch?: typeof fetch;
    uuid?: () => string;
  }> = {}) {}

  clear(): void {
    this.generation += 1;
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
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new ImageServiceResponseError(response.status, response.status === 429 ? "圖片服務忙碌，請稍後再確認。" : "圖片上傳尚未確認；已保留檔案，可再次準備以查詢結果。");
    }
    if (!response.headers.get("content-type")?.startsWith("application/json")) throw new Error("圖片服務回覆格式無效。");
    const value: unknown = JSON.parse(new TextDecoder().decode(await this.bounded(response, 8192)));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("圖片服務回覆格式無效。");
    return value as Record<string, unknown>;
  }

  async prepare(input: Parameters<HostedListingImagePort["prepare"]>[0]): Promise<Readonly<{ url: string; key: string }>> {
    const generation = this.generation;
    const fence = async (): Promise<void> => {
      await input.assertCurrent();
      if (generation !== this.generation) throw new Error("圖片工作環境已切換，請重新準備。");
    };
    await fence();
    if (!input.bytes.length || input.bytes.length > MAX_BYTES || !["image/png", "image/jpeg"].includes(input.contentType)
      || !Number.isInteger(input.width) || !Number.isInteger(input.height) || input.width < 500 || input.height < 500
      || input.width > 40_000 || input.height > 40_000 || input.width * input.height > 100_000_000) {
      throw new Error("圖片格式、大小或尺寸無效。");
    }
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const identity = createHash("sha256").update(JSON.stringify([input.contextKey, sha256])).digest("hex");
    let existing = this.operations.get(identity);
    let recovered: Record<string, unknown> | undefined;
    if (existing?.rejected) {
      try {
        recovered = await this.request(`/api/listing-images/v2/${existing.id}`, { method: "GET" }, response => this.receipt(response)) as Record<string, unknown>;
      } catch (error) {
        await fence();
        if (!(error instanceof ImageServiceResponseError) || error.status !== 404) throw error;
        // This is a new user preparation: a definitive pre-write rejection plus
        // confirmed absence permits a fresh conditional operation.
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
    const path = `/api/listing-images/v2/${operation.id}`;
    let result: Record<string, unknown>;
    try {
      result = recovered ?? await this.request(path, existing ? { method: "GET" } : {
        method: "PUT", headers: { "content-type": input.contentType, "content-length": String(input.bytes.length), "x-content-sha256": sha256 }, body: Buffer.from(input.bytes),
      }, (response) => this.receipt(response)) as Record<string, unknown>;
    } catch (error) {
      await fence();
      if (existing) throw error;
      operation.rejected = error instanceof ImageServiceResponseError && [400, 413, 415, 422, 429].includes(error.status);
      // A lost PUT response is resolved only by GET, including subsequent preparation attempts.
      try {
        result = await this.request(path, { method: "GET" }, (response) => this.receipt(response)) as Record<string, unknown>;
      } catch (readError) {
        await fence();
        if (operation.rejected && readError instanceof ImageServiceResponseError && readError.status === 404) {
          this.operations.delete(identity);
          throw error;
        }
        throw readError;
      }
    }
    await fence();
    const extension = input.contentType === "image/png" ? "png" : "jpg";
    const publicPath = `/listing-images/v2/${operation.id}/${sha256}.${extension}`;
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
