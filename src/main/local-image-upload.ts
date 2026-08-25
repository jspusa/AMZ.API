import { createHash, randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { ApiRequest, ApiResponse } from "../shared/contracts";
import type {
  CredentialVault,
  StoredImageStorageCredentials,
} from "./credential-vault";
import type { RouterRequestContextAdapter } from "./router-request-context";
import { parseMarketplace, parseSellerSku } from "./route-input";
import { invalid, json } from "./route-response";

type ImageContentType = "image/png" | "image/jpeg";

export interface ImageObjectStorePort {
  put(input: Readonly<{
    endpoint: string;
    credentials: Readonly<{
      accessKeyId: string;
      secretAccessKey: string;
    }>;
    bucket: string;
    key: string;
    bytes: Uint8Array;
    contentType: ImageContentType;
    metadata: Readonly<Record<string, string>>;
  }>): Promise<void>;
}

export interface LocalImageUploadPort {
  uploadImage(request: ApiRequest): Promise<ApiResponse>;
}

export type LocalImageUploadDependencies = Readonly<{
  context: RouterRequestContextAdapter;
  vault: Pick<CredentialVault, "getImageStorage">;
  objectStore?: ImageObjectStorePort;
  uuid?: () => string;
}>;

function imageContentType(bytes: Uint8Array): ImageContentType | null {
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  return bytes.length >= 4 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    ? "image/jpeg"
    : null;
}

function imageDimensions(
  bytes: Uint8Array,
  type: ImageContentType,
): { width: number; height: number } | null {
  if (type === "image/png") {
    const view = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    );
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) break;
    if (
      [
        0xc0,
        0xc1,
        0xc2,
        0xc3,
        0xc5,
        0xc6,
        0xc7,
        0xc9,
        0xca,
        0xcb,
        0xcd,
        0xce,
        0xcf,
      ].includes(marker)
    ) {
      return {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      };
    }
    offset += length;
  }
  return null;
}

function storagePolicy(
  storage: StoredImageStorageCredentials,
): { endpoint: string; publicBaseUrl: string } | null {
  if (
    !/^[a-f0-9]{32}$/iu.test(storage.accountId) ||
    !storage.accessKeyId ||
    !storage.secretAccessKey ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(storage.bucket) ||
    storage.bucket.includes("..") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(storage.bucket)
  ) {
    return null;
  }
  const expectedHost = `${storage.accountId}.r2.cloudflarestorage.com`;
  let endpoint: URL;
  let publicBase: URL;
  try {
    endpoint = new URL(`https://${expectedHost}`);
    publicBase = new URL(storage.publicBaseUrl);
  } catch {
    return null;
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.hostname !== expectedHost ||
    endpoint.username ||
    endpoint.password ||
    endpoint.port ||
    publicBase.protocol !== "https:" ||
    publicBase.username ||
    publicBase.password ||
    publicBase.hash
  ) {
    return null;
  }
  return {
    endpoint: endpoint.toString(),
    publicBaseUrl: publicBase.toString().replace(/\/$/u, ""),
  };
}

export function createR2ImageObjectStore(): ImageObjectStorePort {
  return {
    async put(input): Promise<void> {
      const client = new S3Client({
        region: "auto",
        endpoint: input.endpoint,
        credentials: input.credentials,
      });
      try {
        await client.send(new PutObjectCommand({
          Bucket: input.bucket,
          Key: input.key,
          Body: input.bytes,
          ContentType: input.contentType,
          CacheControl: "public, max-age=31536000, immutable",
          Metadata: input.metadata,
        }));
      } finally {
        client.destroy();
      }
    },
  };
}

/** Main-process owner for restricted local listing-image uploads. */
export class LocalImageUpload implements LocalImageUploadPort {
  private readonly context: RouterRequestContextAdapter;
  private readonly vault: Pick<CredentialVault, "getImageStorage">;
  private readonly objectStore: ImageObjectStorePort;
  private readonly uuid: () => string;

  constructor(input: LocalImageUploadDependencies) {
    this.context = input.context;
    this.vault = input.vault;
    this.objectStore = input.objectStore ?? createR2ImageObjectStore();
    this.uuid = input.uuid ?? randomUUID;
  }

  async uploadImage(request: ApiRequest): Promise<ApiResponse> {
    if (request.body?.kind !== "multipart") {
      return invalid(
        "圖片上傳必須使用 multipart/form-data。",
        415,
        "UNSUPPORTED_MEDIA_TYPE",
      );
    }
    const marketplaceId = parseMarketplace(request.body.fields.marketplaceId);
    const sellerSku = parseSellerSku(request.body.fields.sellerSku);
    const file = request.body.file;
    if (
      !marketplaceId ||
      !sellerSku ||
      !file ||
      !(file.bytes instanceof Uint8Array)
    ) {
      return invalid("請提供有效的站點、SKU 與圖片檔案。");
    }
    if (file.bytes.byteLength <= 0 || file.bytes.byteLength > 10 * 1024 * 1024) {
      return invalid("圖片必須小於 10 MB。", 413, "IMAGE_TOO_LARGE");
    }
    const contentType = imageContentType(file.bytes);
    if (!contentType) {
      return invalid(
        "只接受內容有效的 JPEG 或 PNG 圖片。",
        415,
        "INVALID_IMAGE",
      );
    }
    const dimensions = imageDimensions(file.bytes, contentType);
    if (!dimensions || dimensions.width < 500 || dimensions.height < 500) {
      return invalid(
        "Amazon 圖片寬高都必須至少 500px；建議 1000px 以上。",
        422,
        "IMAGE_TOO_SMALL",
      );
    }

    const context = await this.context.capture(marketplaceId);
    const skuHash = createHash("sha256")
      .update(sellerSku)
      .digest("hex")
      .slice(0, 16);
    const extension = contentType === "image/png" ? "png" : "jpg";
    const key = `listing-images/${marketplaceId}/${skuHash}/${this.uuid()}.${extension}`;
    const previewUrl =
      `data:${contentType};base64,${Buffer.from(file.bytes).toString("base64")}`;
    const storage = await this.vault.getImageStorage();
    await this.context.assertCurrent(context);
    let amazonUrl: string | null = null;
    if (storage) {
      const policy = storagePolicy(storage);
      if (!policy) {
        return invalid(
          "R2 endpoint 未通過安全檢查。",
          422,
          "INVALID_IMAGE_STORAGE",
        );
      }
      await this.context.assertCurrent(context);
      await this.objectStore.put({
        endpoint: policy.endpoint,
        credentials: {
          accessKeyId: storage.accessKeyId,
          secretAccessKey: storage.secretAccessKey,
        },
        bucket: storage.bucket,
        key,
        bytes: file.bytes,
        contentType,
        metadata: {
          marketplace: marketplaceId,
          sku: skuHash,
          width: String(dimensions.width),
          height: String(dimensions.height),
        },
      });
      await this.context.assertCurrent(context);
      amazonUrl = `${policy.publicBaseUrl}/${key}`;
    }
    return json({
      key,
      previewUrl,
      amazonUrl,
      width: dimensions.width,
      height: dimensions.height,
      contentType,
      readyForAmazon: Boolean(amazonUrl),
      notice: amazonUrl
        ? "圖片已上傳到你自己的 R2，送出後仍需等待 Amazon 下載與驗證。"
        : "圖片已在這台電腦完成格式與像素檢查；設定自己的 R2 公開網域後即可一鍵送交 Amazon。",
    });
  }
}
