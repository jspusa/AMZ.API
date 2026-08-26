import { createHash } from "node:crypto";
import type { ApiRequest, ApiResponse } from "../shared/contracts";
import {
  marketplaceById,
} from "../shared/marketplaces";
import type { ListingWriteExecutionFence } from
  "./amazon/listing-write-execution-fence";
import type {
  ListingImageGateway,
  ListingImageGatewayRead,
  ListingImagePatchDescriptor,
  ListingImageSlot,
  ListingImageUrlVector,
} from "./amazon/listing-image-gateway";
import type {
  ListingImageIdentity,
  ListingImageSnapshot,
  ListingImageUpdateResult,
  UpdateListingImagesInput,
} from "./amazon/listing-image-types";
import { normalizeListingIssues, throwListingsPayloadError } from
  "./amazon/listings-response-error";
import {
  publicSpApiIssueIdentifier,
  publicSpApiListingIssues,
  publicSpApiRequestId,
  SpApiError,
  SpApiPreCommitError,
  type ListingIssue,
} from "./amazon/sp-api-error";
import { commitWithCanonicalReadback } from
  "./amazon/listing-write-readback";
import type {
  SpExecutionContext,
  SpExecutionContextAdapter,
} from "./amazon/sp-execution-context";
import {
  bodyRecord,
  parseMarketplace,
  parseSellerSku,
} from "./route-input";
import { invalid, json, routeError } from "./route-response";
import {
  MainWriteGateError,
  type MainWriteGatePort,
  type WriteBinding,
} from "./write-gate";

export type ListingImageMutationCommand = Readonly<{
  operation: "read" | "preview" | "commit";
  request: ApiRequest;
}>;

export interface ListingImageMutationsPort {
  handle(command: ListingImageMutationCommand): Promise<ApiResponse>;
  read(
    input: ListingImageIdentity,
    context: SpExecutionContext,
  ): Promise<ListingImageSnapshot>;
}

export interface ListingImageMutationOperations {
  read(input: ListingImageIdentity): Promise<ListingImageGatewayRead>;
  preview(input: UpdateListingImagesInput): Promise<ListingImageUpdateResult>;
  commit(
    input: UpdateListingImagesInput,
    fence: ListingWriteExecutionFence,
  ): Promise<ListingImageUpdateResult>;
}

const IMAGE_ATTRIBUTE_NAMES = [
  "main_product_image_locator",
  "other_product_image_locator_1",
  "other_product_image_locator_2",
  "other_product_image_locator_3",
  "other_product_image_locator_4",
  "other_product_image_locator_5",
  "other_product_image_locator_6",
  "other_product_image_locator_7",
  "other_product_image_locator_8",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactToken(value: unknown): value is string {
  return typeof value === "string" &&
    Boolean(value.trim()) &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(value);
}

function submissionIssuesAreWellFormed(issues: unknown): boolean {
  if (issues === undefined) return true;
  return Array.isArray(issues) && issues.every((issue) => {
    if (!isRecord(issue) ||
        !exactToken(issue.code) ||
        !exactToken(issue.message) ||
        !exactToken(issue.severity) ||
        !["ERROR", "WARNING", "INFO"].includes(issue.severity.toUpperCase()) ||
        !Array.isArray(issue.categories) ||
        issue.categories.some((value) => !exactToken(value))) {
      return false;
    }
    for (const key of ["attributeNames", "categories", "marketplaceIds"]) {
      if (key in issue &&
          (!Array.isArray(issue[key]) ||
            issue[key].some((value) => !exactToken(value)))) {
        return false;
      }
    }
    if ("attributeNames" in issue && "attributeName" in issue) return false;
    return !("attributeName" in issue) ||
      issue.attributeName === undefined ||
      exactToken(issue.attributeName);
  });
}

function normalizeImageUrls(
  values: readonly (string | null)[],
): ListingImageUrlVector {
  return IMAGE_ATTRIBUTE_NAMES.map((_, index) => {
    const value = values[index];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }) as unknown as ListingImageUrlVector;
}

function expectedOldHash(values: ListingImageUrlVector): string {
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

function assertCanonicalObservation(
  observation: ListingImageGatewayRead,
  identity: ListingImageIdentity,
  mode: "live" | "demo",
): ListingImageSnapshot {
  const snapshot = observation.snapshot;
  const exactSlots = snapshot.images.length === IMAGE_ATTRIBUTE_NAMES.length &&
    snapshot.images.every((image, index) =>
      image.attributeName === IMAGE_ATTRIBUTE_NAMES[index] &&
      image.capability.attributeName === IMAGE_ATTRIBUTE_NAMES[index]
    );
  if (
    observation.fulfillment !== "FBA" ||
    snapshot.mode !== mode ||
    snapshot.marketplaceId !== identity.marketplaceId ||
    snapshot.sellerSku !== identity.sellerSku ||
    typeof snapshot.asin !== "string" ||
    !/^[A-Z0-9]{10}$/u.test(snapshot.asin) ||
    !snapshot.productType ||
    snapshot.productType !== snapshot.productType.trim() ||
    snapshot.productType.toUpperCase() === "PRODUCT" ||
    !exactSlots
  ) {
    throw new SpApiError(
      "Amazon 圖片回應的站點、SKU、ASIN、商品類型、FBA 身分或圖片位置不一致，已停止使用。",
      { status: 409, code: "LISTING_IDENTITY_MISMATCH" },
    );
  }
  return snapshot;
}

function assertImageUrl(value: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new SpApiError(`${label}不是有效的圖片 URL。`, {
      status: 422,
      code: "INVALID_IMAGE_URL",
    });
  }
  if ((parsed.protocol !== "https:" && parsed.protocol !== "s3:") ||
      value.length > 2_000) {
    throw new SpApiError(
      value.length > 2_000
        ? `${label} URL 過長。`
        : `${label}必須使用 HTTPS 或已授權的 S3 URL。`,
      { status: 422, code: "INVALID_IMAGE_URL" },
    );
  }
}

function preparePatch(
  observation: ListingImageGatewayRead,
  input: UpdateListingImagesInput,
  mode: "live" | "demo",
): ListingImagePatchDescriptor {
  const snapshot = assertCanonicalObservation(observation, input, mode);
  if (!snapshot.attributesPresent) {
    throw new SpApiError(
      "Amazon Listing 圖片欄位無法完整確認，已停止寫入。",
      { status: 409, code: "LISTING_ATTRIBUTES_UNAVAILABLE" },
    );
  }
  const previousUrls = normalizeImageUrls(
    snapshot.images.map((image) => image.url),
  );
  const expectedUrls = normalizeImageUrls(input.expectedUrls);
  if (previousUrls.some((url, index) => url !== expectedUrls[index])) {
    throw new SpApiError(
      "Amazon 圖片已被其他人更新。請重新查詢 SKU，再套用這次排序。",
      { status: 409, code: "STALE_LISTING" },
    );
  }
  const requestedUrls = normalizeImageUrls(input.urls);
  if (!requestedUrls[0]) {
    throw new SpApiError("主圖不可留空。請先上傳或貼上主圖 URL。", {
      status: 422,
      code: "MAIN_IMAGE_REQUIRED",
    });
  }
  const populated = requestedUrls.filter(
    (url): url is string => url !== null,
  );
  if (new Set(populated).size !== populated.length) {
    throw new SpApiError("同一個圖片網址不能重複放在不同位置。", {
      status: 422,
      code: "DUPLICATE_IMAGE_URL",
    });
  }
  requestedUrls.forEach((url, index) => {
    if (url) assertImageUrl(url, index === 0 ? "主圖" : `副圖 ${index}`);
  });
  const changedSlots = requestedUrls.flatMap((requestedUrl, index) =>
    requestedUrl === previousUrls[index]
      ? []
      : [index as ListingImageSlot]
  );
  if (!changedSlots.length) {
    throw new SpApiError("圖片與 Amazon 目前內容相同，沒有需要送出的變更。", {
      status: 422,
      code: "NO_CHANGES",
    });
  }
  for (const slot of changedSlots) {
    const capability = snapshot.images[slot]?.capability;
    if (!capability?.supported || !capability.editable) {
      throw new SpApiError(
        capability?.reason ||
          `${slot === 0 ? "主圖" : `副圖 ${slot}`}不可由 API 修改。`,
        { status: 422, code: "IMAGE_FIELD_READ_ONLY" },
      );
    }
    if (!requestedUrls[slot] && capability.required) {
      throw new SpApiError(`${capability.label}是 Amazon 必填欄位，不能清除。`, {
        status: 422,
        code: "MAIN_IMAGE_REQUIRED",
      });
    }
  }
  return {
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    asin: snapshot.asin!,
    productType: snapshot.productType,
    expectedOldHash: expectedOldHash(previousUrls),
    previousUrls,
    requestedUrls,
    changes: changedSlots.map((slot) => ({
      slot,
      previousUrl: previousUrls[slot],
      requestedUrl: requestedUrls[slot],
    })),
    sourceEvidence: observation.sourceEvidence,
  };
}

function previewIssues(payload: Record<string, unknown>): ListingIssue[] {
  return normalizeListingIssues(payload.issues);
}

function publicListingIssues(value: unknown): ListingIssue[] {
  return publicSpApiListingIssues(value).map((issue) => ({
    code: issue.code,
    severity: issue.severity,
    message: issue.message,
    attributeNames: [...issue.attributeNames],
    ...(issue.categories === undefined
      ? {}
      : { categories: [...issue.categories] }),
    ...(issue.marketplaceIds === undefined
      ? {}
      : { marketplaceIds: [...issue.marketplaceIds] }),
  }));
}

function throwUnknownImageCommit(
  requestId: string | null,
  issues: ListingIssue[] = [],
): never {
  throw new SpApiError(
    "Amazon 已收到圖片請求，但未回傳明確接受狀態。請重新查詢 SKU，不要直接重送。",
    {
      status: 503,
      code: "UPDATE_STATUS_UNKNOWN",
      requestId,
      issues,
    },
  );
}

async function prepareLivePreview(
  gateway: ListingImageGateway,
  input: UpdateListingImagesInput,
): Promise<Readonly<{
  patch: ListingImagePatchDescriptor;
  issues: ListingIssue[];
}>> {
  const observation = await gateway.read(input, "mutation");
  const patch = preparePatch(observation, input, "live");
  const reply = await gateway.validationPreview(patch);
  if (!reply.ok) {
    return throwListingsPayloadError({
      status: reply.status,
      operation: "read",
      apiOperation: "patchListingsItemPreview",
      requestId: reply.requestId,
      retryAfter: reply.retryAfter,
      payload: isRecord(reply.payload) ? reply.payload : null,
    });
  }
  if (!isRecord(reply.payload)) {
    throw new SpApiError("Amazon 圖片預檢回應無法辨識，已停止送出。", {
      status: 502,
      code: "VALIDATION_STATUS_UNKNOWN",
      requestId: reply.requestId,
    });
  }
  if (!submissionIssuesAreWellFormed(reply.payload.issues)) {
    throw new SpApiError(
      "Amazon 圖片預檢回應的 issues 結構無法辨識，已停止送出。",
      {
        status: 502,
        code: "VALIDATION_STATUS_UNKNOWN",
        requestId: reply.requestId,
      },
    );
  }
  const issues = previewIssues(reply.payload);
  if (reply.payload.status === "INVALID" ||
      issues.some((issue) => issue.severity === "ERROR")) {
    throw new SpApiError(
      issues.find((issue) => issue.severity === "ERROR")?.message ||
        "Amazon 圖片預檢未通過，尚未寫入任何變更。",
      {
        status: 422,
        code: "VALIDATION_FAILED",
        requestId: reply.requestId,
        issues,
      },
    );
  }
  if (reply.payload.status !== "VALID") {
    throw new SpApiError(
      "Amazon 圖片預檢沒有回傳明確的 VALID 狀態，已停止送出。",
      {
        status: 502,
        code: "VALIDATION_STATUS_UNKNOWN",
        requestId: reply.requestId,
        issues,
      },
    );
  }
  return { patch, issues };
}

async function prepareImageCommit<T>(prepare: () => Promise<T>): Promise<T> {
  try {
    return await prepare();
  } catch (error) {
    if (error instanceof SpApiPreCommitError) throw error;
    const cause = error instanceof SpApiError
      ? error
      : new SpApiError(
          "圖片正式寫入前的重新讀取或 Validation Preview 失敗。",
          {
            status: 500,
            code: "PRECOMMIT_FAILED",
            operation: "patchListingsItemPreview",
          },
        );
    throw new SpApiPreCommitError(cause);
  }
}

function updateResult(
  mode: "live" | "demo",
  status: "VALID" | "ACCEPTED" | "SIMULATED",
  patch: ListingImagePatchDescriptor,
  input: Readonly<{
    submissionId?: string | null;
    requestId?: string | null;
    issues?: ListingIssue[];
    notice: string;
  }>,
): ListingImageUpdateResult {
  return {
    mode,
    status,
    marketplaceId: patch.marketplaceId,
    sellerSku: patch.sellerSku,
    previousUrls: [...patch.previousUrls],
    requestedUrls: [...patch.requestedUrls],
    changedSlots: patch.changes.map((change) => change.slot),
    completedAt: new Date().toISOString(),
    submissionId: publicSpApiIssueIdentifier(input.submissionId),
    requestId: publicSpApiRequestId(input.requestId),
    issues: publicListingIssues(input.issues ?? []),
    notice: input.notice,
  };
}

type ListingImageWriteEvidence = Readonly<{
  version: 1;
  asin: string;
  productType: string;
  fulfillment: "FBA";
  expectedOldHash: string;
  previousUrls: ListingImageUrlVector;
  requestedUrls: ListingImageUrlVector;
  changedSlots: readonly ListingImageSlot[];
}>;

type DurableListingImageUpdateResult = ListingImageUpdateResult & Readonly<{
  imageWriteEvidence: ListingImageWriteEvidence;
}>;

function durableUpdateResult(
  result: ListingImageUpdateResult,
  patch: ListingImagePatchDescriptor,
): DurableListingImageUpdateResult {
  return {
    ...result,
    imageWriteEvidence: {
      version: 1,
      asin: patch.asin,
      productType: patch.productType,
      fulfillment: "FBA",
      expectedOldHash: patch.expectedOldHash,
      previousUrls: patch.previousUrls,
      requestedUrls: patch.requestedUrls,
      changedSlots: patch.changes.map((change) => change.slot),
    },
  };
}

function canonicalImageUrl(value: string | null): string | null {
  if (value === null) return null;
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

function exactUrlVector(value: unknown): value is ListingImageUrlVector {
  return Array.isArray(value) &&
    value.length === IMAGE_ATTRIBUTE_NAMES.length &&
    value.every((url) => url === null || typeof url === "string");
}

function exactChangedSlots(
  value: unknown,
  previousUrls: ListingImageUrlVector,
  requestedUrls: ListingImageUrlVector,
): value is readonly ListingImageSlot[] {
  if (!Array.isArray(value) || value.length === 0 ||
      !value.every((slot) =>
        Number.isSafeInteger(slot) && slot >= 0 && slot < IMAGE_ATTRIBUTE_NAMES.length
      )) return false;
  const expected = requestedUrls.flatMap((url, index) =>
    url === previousUrls[index] ? [] : [index]
  );
  return value.length === expected.length &&
    value.every((slot, index) => slot === expected[index]);
}

function imageWriteEvidence(
  result: ListingImageUpdateResult,
): ListingImageWriteEvidence | null {
  const raw = (result as ListingImageUpdateResult & {
    imageWriteEvidence?: unknown;
  }).imageWriteEvidence;
  if (!isRecord(raw) ||
      raw.version !== 1 ||
      typeof raw.asin !== "string" ||
      !/^[A-Z0-9]{10}$/u.test(raw.asin) ||
      typeof raw.productType !== "string" ||
      !raw.productType ||
      raw.fulfillment !== "FBA" ||
      typeof raw.expectedOldHash !== "string" ||
      !/^[a-f0-9]{64}$/u.test(raw.expectedOldHash) ||
      !exactUrlVector(raw.previousUrls) ||
      !exactUrlVector(raw.requestedUrls) ||
      !exactChangedSlots(raw.changedSlots, raw.previousUrls, raw.requestedUrls) ||
      raw.expectedOldHash !== expectedOldHash(raw.previousUrls) ||
      !raw.requestedUrls[0]) {
    return null;
  }
  if (!exactUrlVector(result.previousUrls) ||
      !exactUrlVector(result.requestedUrls) ||
      JSON.stringify(result.previousUrls) !== JSON.stringify(raw.previousUrls) ||
      JSON.stringify(result.requestedUrls) !== JSON.stringify(raw.requestedUrls) ||
      !exactChangedSlots(
        result.changedSlots,
        raw.previousUrls,
        raw.requestedUrls,
      ) ||
      JSON.stringify(result.changedSlots) !== JSON.stringify(raw.changedSlots)) {
    return null;
  }
  return raw as unknown as ListingImageWriteEvidence;
}

export function imageReadbackDecision(
  result: ListingImageUpdateResult,
  observation: ListingImageGatewayRead,
): "verified" | "pending" {
  const snapshot = observation.snapshot;
  const evidence = imageWriteEvidence(result);
  if (!evidence ||
      result.mode !== "live" ||
      result.status !== "ACCEPTED" ||
      observation.fulfillment !== "FBA" ||
      snapshot.mode !== "live" ||
      result.marketplaceId !== snapshot.marketplaceId ||
      result.sellerSku !== snapshot.sellerSku ||
      evidence.asin !== snapshot.asin ||
      evidence.productType !== snapshot.productType ||
      !snapshot.attributesPresent ||
      snapshot.images.length !== IMAGE_ATTRIBUTE_NAMES.length ||
      snapshot.images.some((image, index) =>
        image.attributeName !== IMAGE_ATTRIBUTE_NAMES[index]
      ) ||
      snapshot.issues.some((issue) => issue.severity === "ERROR")) {
    return "pending";
  }
  return evidence.requestedUrls.every((requested, index) => {
    const actual = snapshot.images[index]?.url ?? null;
    if (requested === null) return actual === null;
    const canonicalActual = canonicalImageUrl(actual);
    const canonicalRequested = canonicalImageUrl(requested);
    return canonicalActual !== null &&
      canonicalRequested !== null &&
      canonicalActual === canonicalRequested;
  }) ? "verified" : "pending";
}

export function reconcileImageWrite(
  response: unknown,
  observation: ListingImageGatewayRead,
  now: () => Date = () => new Date(),
): unknown | null {
  if (!isRecord(response) ||
      response.mode !== "live" ||
      response.status !== "ACCEPTED" ||
      typeof response.marketplaceId !== "string" ||
      typeof response.sellerSku !== "string" ||
      typeof response.completedAt !== "string" ||
      !(response.submissionId === null ||
        typeof response.submissionId === "string") ||
      !(response.requestId === null || typeof response.requestId === "string") ||
      !Array.isArray(response.issues) ||
      typeof response.notice !== "string") {
    return null;
  }
  const result = response as unknown as ListingImageUpdateResult;
  if (imageReadbackDecision(result, observation) !== "verified") return null;
  return {
    ...response,
    notice: `${result.notice} 主程序唯讀回查已確認此次目標值。`,
    writeLifecycle: {
      state: "verified",
      verified: true,
      authoritative: true,
      acceptedAt: result.completedAt,
      verifiedAt: now().toISOString(),
      attempts: 0,
    },
  };
}

export function createListingImageMutationOperations(
  gateway: ListingImageGateway,
): ListingImageMutationOperations {
  return {
    read: async (identity) => {
      const observation = await gateway.read(identity, "read-only");
      assertCanonicalObservation(
        observation,
        identity,
        gateway.mode(identity.marketplaceId),
      );
      return observation;
    },
    preview: async (input) => {
      if (gateway.mode(input.marketplaceId) === "demo") {
        const observation = await gateway.read(input, "mutation");
        const patch = preparePatch(observation, input, "demo");
        return updateResult("demo", "SIMULATED", patch, {
          notice: "展示預檢已通過；最終送出只會模擬。",
        });
      }
      const prepared = await prepareLivePreview(gateway, input);
      return updateResult("live", "VALID", prepared.patch, {
        issues: prepared.issues,
        notice: "Amazon 圖片預檢通過；尚未寫入 Listing。",
      });
    },
    commit: async (input, fence) => {
      if (gateway.mode(input.marketplaceId) === "demo") {
        const observation = await gateway.read(input, "mutation");
        const patch = preparePatch(observation, input, "demo");
        await fence.assertCurrent();
        await gateway.replaceDemoImages(patch, fence);
        return durableUpdateResult(
          updateResult("demo", "SIMULATED", patch, {
            notice: "模擬圖片更新完成；Amazon 真實圖片沒有變更。",
          }),
          patch,
        );
      }
      const prepared = await prepareImageCommit(() =>
        prepareLivePreview(gateway, input)
      );
      await fence.assertCurrent();
      const reply = await gateway.commitOnce(prepared.patch, fence);
      const receipt = isRecord(reply.payload) ? reply.payload : null;
      if (!reply.ok) {
        if (receipt && "status" in receipt &&
            (receipt.status !== "INVALID" ||
              !submissionIssuesAreWellFormed(receipt.issues))) {
          return throwUnknownImageCommit(reply.requestId);
        }
        return throwListingsPayloadError({
          status: reply.status,
          operation: "write",
          apiOperation: "patchListingsItem",
          requestId: reply.requestId,
          retryAfter: reply.retryAfter,
          payload: receipt,
        });
      }
      if (!receipt || !submissionIssuesAreWellFormed(receipt.issues)) {
        return throwUnknownImageCommit(reply.requestId);
      }
      const issues = normalizeListingIssues(receipt.issues);
      if (receipt.status === "INVALID") {
        throw new SpApiError(
          issues.find((issue) => issue.severity === "ERROR")?.message ||
            "Amazon 未接受這次圖片更新。",
          {
            status: 422,
            code: "UPDATE_REJECTED",
            requestId: reply.requestId,
            issues,
          },
        );
      }
      if (receipt.status !== "ACCEPTED") {
        return throwUnknownImageCommit(reply.requestId, issues);
      }
      return durableUpdateResult(
        updateResult("live", "ACCEPTED", prepared.patch, {
          submissionId: typeof receipt.submissionId === "string"
            ? receipt.submissionId
            : null,
          requestId: reply.requestId,
          issues,
          notice: "Amazon 已接受圖片更新；圖片下載與審核完成前，買家頁可能仍顯示舊圖。",
        }),
        prepared.patch,
      );
    },
  };
}

type ListingImageRouteInput = UpdateListingImagesInput & Readonly<{
  confirmationSku: string;
  idempotencyKey: string;
}>;

function parseUrls(value: unknown): Array<string | null> | null {
  if (!Array.isArray(value) || value.length > 9) return null;
  const urls: Array<string | null> = [];
  for (const item of value) {
    if (item === null || item === "") {
      urls.push(null);
    } else if (typeof item === "string" &&
        item.length <= 2_000 &&
        !/[\u0000-\u001f\u007f]/u.test(item)) {
      urls.push(item.trim() || null);
    } else {
      return null;
    }
  }
  return urls;
}

function validIdempotencyKey(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9-]{8,80}$/u.test(value)
    ? value
    : null;
}

function marketplaceCode(marketplaceId: ListingImageIdentity["marketplaceId"]): string {
  const code = marketplaceById(marketplaceId)?.code ?? "";
  return code === "UK" ? "GB" : code;
}

function proposalFingerprint(input: UpdateListingImagesInput): string {
  return createHash("sha256").update(JSON.stringify([
    input.marketplaceId,
    input.sellerSku,
    input.expectedUrls,
    input.urls,
  ])).digest("hex");
}

function publicImageResult<T>(value: T): T {
  if (!isRecord(value)) return value;
  const { imageWriteEvidence: _internal, ...rest } = value;
  const publicValue: Record<string, unknown> = { ...rest };
  if ("requestId" in publicValue) {
    publicValue.requestId = publicSpApiRequestId(publicValue.requestId);
  }
  if ("submissionId" in publicValue) {
    publicValue.submissionId = publicSpApiIssueIdentifier(
      publicValue.submissionId,
    );
  }
  if ("issues" in publicValue) {
    publicValue.issues = publicListingIssues(publicValue.issues);
  }
  return publicValue as T;
}

export class ListingImageMutations implements ListingImageMutationsPort {
  private readonly context: SpExecutionContextAdapter;
  private readonly writeGate: MainWriteGatePort;
  private readonly operations: ListingImageMutationOperations;

  constructor(input: Readonly<{
    context: SpExecutionContextAdapter;
    writeGate: MainWriteGatePort;
    operations: ListingImageMutationOperations;
  }>) {
    this.context = input.context;
    this.writeGate = input.writeGate;
    this.operations = input.operations;
  }

  async handle(command: ListingImageMutationCommand): Promise<ApiResponse> {
    if (command.operation === "read") return this.readRoute(command.request);
    if (command.operation === "preview") {
      return this.previewRoute(command.request);
    }
    return this.commitRoute(command.request);
  }

  async read(
    input: ListingImageIdentity,
    context: SpExecutionContext,
  ): Promise<ListingImageSnapshot> {
    const observation = await this.operations.read(input);
    if (observation.snapshot.mode !== context.mode ||
        observation.snapshot.marketplaceId !== context.marketplaceId) {
      throw new SpApiError(
        "商品圖片讀取結果不屬於目前的 Amazon 執行環境，已停止使用。",
        { status: 409, code: "SP_CONTEXT_INVALIDATED" },
      );
    }
    await this.context.assertCurrent(context);
    await this.writeGate.reconcile({
      context,
      marketplaceId: input.marketplaceId,
      sellerSku: input.sellerSku,
      operations: ["images"],
      snapshot: observation,
      project: (response, _operation, canonical) =>
        reconcileImageWrite(response, canonical),
    });
    return publicImageResult(observation.snapshot);
  }

  private async readRoute(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const sellerSku = parseSellerSku(request.query.sku);
    if (!marketplaceId || !sellerSku) {
      return invalid("請選擇站點並輸入完整 SKU。");
    }
    try {
      const context = await this.context.capture(marketplaceId);
      return json(await this.read({ marketplaceId, sellerSku }, context));
    } catch (error) {
      return routeError(error, "查詢商品圖片時發生未預期的錯誤。");
    }
  }

  private imageInput(request: ApiRequest): ListingImageRouteInput | ApiResponse {
    const body = bodyRecord(request);
    if (!body) {
      return invalid(
        "商品圖片請求必須使用 JSON。",
        415,
        "UNSUPPORTED_MEDIA_TYPE",
      );
    }
    const marketplaceId = parseMarketplace(body.marketplaceId);
    const sellerSku = parseSellerSku(body.sellerSku);
    const expectedUrls = parseUrls(body.expectedUrls);
    const urls = parseUrls(body.urls);
    if (!marketplaceId || !sellerSku || !expectedUrls || !urls) {
      return invalid("請提供有效的站點、SKU 與最多九個圖片 URL。");
    }
    const populated = urls.filter((value): value is string => Boolean(value));
    if (new Set(populated).size !== populated.length) {
      return invalid(
        "同一個圖片網址不能重複放在不同位置。",
        422,
        "DUPLICATE_IMAGE_URL",
      );
    }
    return {
      marketplaceId,
      sellerSku,
      expectedUrls,
      urls,
      confirmationSku: typeof body.confirmationSku === "string"
        ? body.confirmationSku
        : "",
      idempotencyKey: typeof body.idempotencyKey === "string"
        ? body.idempotencyKey
        : "",
    };
  }

  private binding(
    input: ListingImageRouteInput,
    context: SpExecutionContext,
    key: string,
  ): WriteBinding {
    return {
      family: "images",
      previewKey: key,
      context,
      intents: [{
        intentId: "primary",
        operation: "images",
        marketplaceId: input.marketplaceId,
        sellerSku: input.sellerSku,
        idempotencyKey: key,
        proposalFingerprint: proposalFingerprint(input),
      }],
    };
  }

  private async previewRoute(request: ApiRequest): Promise<ApiResponse> {
    const input = this.imageInput(request);
    if ("status" in input) return input;
    try {
      const context = await this.context.capture(input.marketplaceId);
      const result = await this.operations.preview(input);
      await this.context.assertCurrent(context);
      const key = validIdempotencyKey(input.idempotencyKey);
      if (key) {
        await this.writeGate.stagePreview(this.binding(input, context, key));
      }
      return json(publicImageResult(result));
    } catch (error) {
      return error instanceof MainWriteGateError
        ? invalid(error.message, error.status, error.code)
        : routeError(error, "商品圖片預檢時發生未預期的錯誤。");
    }
  }

  private async commitRoute(request: ApiRequest): Promise<ApiResponse> {
    const input = this.imageInput(request);
    if ("status" in input) return input;
    const key = validIdempotencyKey(input.idempotencyKey);
    if (!key) return invalid("這次預檢已失效，請重新預檢。");
    if (input.confirmationSku !== input.sellerSku) {
      return invalid(
        "送出圖片前，請重新輸入完整 SKU。",
        400,
        "CONFIRMATION_REQUIRED",
      );
    }
    const context = await this.context.capture(input.marketplaceId);
    const changedSlots = normalizeImageUrls(input.urls).flatMap((value, index) =>
      value === normalizeImageUrls(input.expectedUrls)[index] ? [] : [index + 1]
    );
    try {
      const result = await this.writeGate.execute({
        binding: this.binding(input, context, key),
        approvalReason: (verificationCode) =>
          `確認圖片｜${marketplaceCode(input.marketplaceId)} ${input.sellerSku}｜位置 ${changedSlots.join("、")}｜驗證碼 ${verificationCode}`,
        run: (session) => session.attempt({
          intentId: "primary",
          execute: ({ recordAccepted, assertCurrent }) =>
            commitWithCanonicalReadback({
              commit: () => this.operations.commit(input, { assertCurrent }),
              onAccepted: recordAccepted,
              assertCurrent,
              read: () => this.operations.read({
                marketplaceId: input.marketplaceId,
                sellerSku: input.sellerSku,
              }),
              decide: imageReadbackDecision,
            }),
        }),
      });
      return json(publicImageResult(result));
    } catch (error) {
      return error instanceof MainWriteGateError
        ? invalid(error.message, error.status, error.code)
        : routeError(error, "送出商品圖片時發生未預期的錯誤。");
    }
  }
}

export function createListingImageMutations(input: Readonly<{
  context: SpExecutionContextAdapter;
  writeGate: MainWriteGatePort;
  gateway: ListingImageGateway;
}>): ListingImageMutationsPort {
  return new ListingImageMutations({
    context: input.context,
    writeGate: input.writeGate,
    operations: createListingImageMutationOperations(input.gateway),
  });
}
