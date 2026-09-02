import {
  createHash,
  randomUUID as nodeRandomUUID,
} from "node:crypto";
import type { ApiRequest, ApiResponse } from "../shared/contracts";
import { NATIVE_CONFIRMATION_REASON_MAX_LENGTH } from "../shared/native-confirmation-limits";
import {
  MARKETPLACES as MARKETPLACE_METADATA,
  type MarketplaceId,
} from "../shared/marketplaces";
import {
  ContentAuditWorkbookError,
  parseContentAuditWorkbook,
  type ContentAuditWorkbookRowIssue,
  type ParsedContentAuditValues,
} from "./amazon/content-audit-workbook-parser";
import {
  contentAuditEvidenceRowDigest,
  type ContentAuditSnapshotEvidenceReader,
} from "./amazon/content-audit-snapshot-evidence";
import type {
  ListingContentField,
  ListingContentValues,
  ListingContentUpdateResult,
  UpdateListingContentInput,
} from "./amazon/listing-content-types";
import type {
  ListingContentExactBulletReplacement,
} from "./amazon/listing-content-gateway";
import { ListingWriteAcceptedButPendingError } from
  "./amazon/listing-write-readback";
import {
  publicSpApiError,
  publicSpApiListingIssues,
  SpApiError,
  SpApiPreCommitError,
  type ListingIssue,
} from "./amazon/sp-api-error";
import {
  SpExecutionContextError,
  type SpExecutionContext,
  type SpExecutionContextAdapter,
} from "./amazon/sp-execution-context";
import {
  assertListingContentPreparedPreviewBinding,
  assertListingContentUpdateResultBinding,
  LISTING_CONTENT_BATCH_EXACT_BULLET_REPLACEMENT_AUTHORITY,
  type ListingContentMutationsPort,
  type ListingContentPreparedPreview,
  type ListingContentPreviewOptions,
} from "./listing-content-mutations";
import {
  bodyRecord,
  isPlainRecord,
  parseMarketplace,
  parseSellerSku,
  reportIdentifier,
} from "./route-input";
import { invalid, json, routeError } from "./route-response";
import {
  MainWriteGateError,
  type MainWriteGatePort,
  type WriteBinding,
} from "./write-gate";

export type ListingContentBatchMutationCommand = Readonly<{
  operation: "preview" | "commit";
  request: ApiRequest;
}>;

export interface ListingContentBatchMutationsPort {
  handle(command: ListingContentBatchMutationCommand): Promise<ApiResponse>;
  clear(): void;
}

export type ListingContentBatchMutationsDependencies = Readonly<{
  evidence: ContentAuditSnapshotEvidenceReader;
  context: Pick<SpExecutionContextAdapter, "capture" | "assertCurrent">;
  writeGate: MainWriteGatePort;
  content: Pick<
    ListingContentMutationsPort,
    "previewOne" | "attemptOne"
  >;
  now?: () => number;
  randomUUID?: () => string;
}>;

type ContentBatchChange = {
  input: UpdateListingContentInput;
  sourceIdentity: ContentBatchSourceIdentity;
  proposalFingerprint: string;
  validation: ListingContentPreparedPreview;
};

type ContentBatchBlockedChange = Readonly<{
  sellerSku: string;
  code: "CONTENT_READ_INCOMPLETE";
  message: string;
  changedFields: ListingContentField[];
  previous: ListingContentValues;
  requested: ListingContentValues;
}>;

type ContentBatchSkippedRow = Readonly<{
  sellerSku: string | null;
  sourceSheet: string | null;
  rowNumber: number | null;
  stage: "WORKBOOK" | "SOURCE_CHECK" | "LOCAL_VALIDATION" | "AMAZON_PREVIEW";
  code: string;
  fields: string[];
  message: string;
}>;

type ContentBatchValidationFailure = Readonly<{
  sellerSku: string;
  code: string;
  message: string;
  requestId: string | null;
  changedFields: ListingContentField[];
  previous: ListingContentValues;
  requested: ListingContentValues;
  issues: readonly Readonly<{
    code: string | null;
    severity: string;
    message: string;
    attributeNames: readonly string[];
    categories?: readonly string[];
    marketplaceIds?: readonly string[];
  }>[];
  overrideAllowed: false;
}>;

type ContentBatchSourceIdentity = Readonly<{
  asin: string;
  productType: string;
}>;

type ContentBatchRowResult = {
  sellerSku: string;
  state: "verified" | "simulated" | "rejected" | "unknown" | "not-started";
  result: ListingContentUpdateResult | null;
  error: { code: string; message: string; requestId: string | null } | null;
};

type ContentBatchCommitResult = {
  previewId: string;
  marketplaceId: MarketplaceId;
  status:
    | "COMPLETED"
    | "COMPLETED_WITH_ISSUES"
    | "STOPPED_REJECTED"
    | "STOPPED_UNKNOWN";
  rows: ContentBatchRowResult[];
  blockedChanges: ContentBatchBlockedChange[];
  skippedRows: ContentBatchSkippedRow[];
  validationFailures: ContentBatchValidationFailure[];
  completedAt: string;
  notice: string;
};

const ISOLATED_CONTENT_PREVIEW_CODES = new Set([
  "CONTENT_CHANGED",
  "CONTENT_FIELD_READ_ONLY",
  "CONTENT_LIMIT_EXCEEDED",
  "CONTENT_REQUIRED",
  "CONTENT_SELECTOR_UNSAFE",
  "CONTENT_UNCHANGED",
  "FBA_ONLY",
  "LISTING_IDENTITY_MISMATCH",
  "PREVIEW_CHANGED",
  "VALIDATION_FAILED",
]);

const ISOLATED_CONTENT_PRECOMMIT_CODES = new Set([
  ...ISOLATED_CONTENT_PREVIEW_CODES,
  "UPDATE_REJECTED",
]);

function isIsolatedBatchRowFailure(error: unknown): boolean {
  if (error instanceof ListingWriteAcceptedButPendingError) return true;
  if (error instanceof SpApiPreCommitError) {
    return error.status < 500 &&
      ![401, 403, 429].includes(error.status) &&
      ISOLATED_CONTENT_PRECOMMIT_CODES.has(error.code);
  }
  return error instanceof SpApiError &&
    error.status < 500 &&
    ![401, 403, 429].includes(error.status) &&
    ["UPDATE_REJECTED", "VALIDATION_FAILED"].includes(error.code);
}

function isIsolatedContentPreviewFailure(error: unknown): error is SpApiError {
  return error instanceof SpApiError &&
    error.status < 500 &&
    ![401, 403, 429].includes(error.status) &&
    ISOLATED_CONTENT_PREVIEW_CODES.has(error.code);
}

type ContentBatchPlan = {
  previewId: string;
  exportId: string;
  context: SpExecutionContext;
  marketplaceId: MarketplaceId;
  accountScope: string;
  idempotencyKey: string;
  fingerprint: string;
  changes: ContentBatchChange[];
  blockedChanges: ContentBatchBlockedChange[];
  skippedRows: ContentBatchSkippedRow[];
  validationFailures: ContentBatchValidationFailure[];
  expiresAt: number;
  completedExpiresAt: number | null;
  state: "ready" | "committing" | "completed";
  result: ContentBatchCommitResult | null;
};

function publicSkippedRows(
  rows: readonly ContentBatchSkippedRow[],
): ContentBatchSkippedRow[] {
  return rows.map((row) => ({
    sellerSku: row.sellerSku,
    sourceSheet: row.sourceSheet,
    rowNumber: row.rowNumber,
    stage: row.stage,
    code: row.code,
    fields: [...row.fields],
    message: row.message,
  }));
}

function publicValidationFailures(
  rows: readonly ContentBatchValidationFailure[],
): ContentBatchValidationFailure[] {
  return rows.map((row) => ({
    sellerSku: row.sellerSku,
    code: row.code,
    message: row.message,
    requestId: row.requestId,
    changedFields: [...row.changedFields],
    previous: publicContentValues(row.previous),
    requested: publicContentValues(row.requested),
    issues: row.issues.map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      message: issue.message,
      attributeNames: [...issue.attributeNames],
      ...(issue.categories
        ? { categories: [...issue.categories] }
        : {}),
      ...(issue.marketplaceIds
        ? { marketplaceIds: [...issue.marketplaceIds] }
        : {}),
    })),
    overrideAllowed: false,
  }));
}

function workbookSkippedRows(
  issues: readonly ContentAuditWorkbookRowIssue[],
): ContentBatchSkippedRow[] {
  const grouped = new Map<string, ContentAuditWorkbookRowIssue[]>();
  for (const issue of issues) {
    const key = JSON.stringify([
      issue.sourceSheet,
      issue.rowNumber,
      issue.sellerSku,
    ]);
    const matches = grouped.get(key) ?? [];
    matches.push(issue);
    grouped.set(key, matches);
  }
  return [...grouped.values()].map((matches) => {
    const first = matches[0]!;
    return {
      sellerSku: first.sellerSku,
      sourceSheet: first.sourceSheet,
      rowNumber: first.rowNumber,
      stage: "WORKBOOK" as const,
      code: matches.map((issue) => issue.code).join("+"),
      fields: [...new Set(matches.map((issue) => issue.fieldLabel))],
      message: matches
        .map((issue) => `${issue.fieldLabel}：${issue.message}`)
        .join(" "),
    };
  });
}

function publicContentValues(value: ListingContentValues): ListingContentValues {
  return {
    title: value.title,
    itemHighlight: value.itemHighlight,
    bulletPoints: [...value.bulletPoints],
    productDescription: value.productDescription,
    ingredients: value.ingredients,
  };
}

function publicExactBulletReplacement(
  value: ListingContentExactBulletReplacement | null,
): ListingContentExactBulletReplacement | null {
  return value
    ? {
        languageTag: value.languageTag,
        currentExactLanguageBulletPoints: [
          ...value.currentExactLanguageBulletPoints,
        ],
        requestedExactLanguageBulletPoints: [
          ...value.requestedExactLanguageBulletPoints,
        ],
        removedOverflowBulletPoints: [...value.removedOverflowBulletPoints],
      }
    : null;
}

function batchInputValues(input: UpdateListingContentInput): Readonly<{
  previous: ListingContentValues;
  requested: ListingContentValues;
  changedFields: ListingContentField[];
}> {
  const previous: ListingContentValues = {
    title: input.expectedTitle,
    itemHighlight: input.expectedItemHighlight,
    bulletPoints: [...input.expectedBulletPoints],
    productDescription: input.expectedProductDescription,
    ingredients: input.expectedIngredients,
  };
  const requested: ListingContentValues = {
    title: input.title,
    itemHighlight: input.itemHighlight,
    bulletPoints: [...input.bulletPoints],
    productDescription: input.productDescription,
    ingredients: input.ingredients,
  };
  const changedFields: ListingContentField[] = [];
  if (previous.title !== requested.title) changedFields.push("title");
  if (previous.itemHighlight !== requested.itemHighlight) {
    changedFields.push("itemHighlight");
  }
  if (
    previous.bulletPoints.length !== requested.bulletPoints.length ||
    previous.bulletPoints.some(
      (bullet, index) => bullet !== requested.bulletPoints[index],
    )
  ) {
    changedFields.push("bulletPoints");
  }
  if (!changedFields.includes("bulletPoints")) {
    const insertAt = changedFields.findIndex((field) =>
      field === "productDescription" || field === "ingredients"
    );
    changedFields.splice(
      insertAt < 0 ? changedFields.length : insertAt,
      0,
      "bulletPoints",
    );
  }
  if (previous.productDescription !== requested.productDescription) {
    changedFields.push("productDescription");
  }
  if (previous.ingredients !== requested.ingredients) {
    changedFields.push("ingredients");
  }
  return { previous, requested, changedFields };
}

function contentBatchValidationFailure(
  input: UpdateListingContentInput,
  error: SpApiError,
): ContentBatchValidationFailure {
  const publicError = publicSpApiError(error, "Amazon 預檢失敗。");
  const values = literalBatchInputValues(input);
  return {
    sellerSku: input.sellerSku,
    code: publicError.code,
    message: publicError.message,
    requestId: publicError.requestId,
    changedFields: values.changedFields,
    previous: publicContentValues(values.previous),
    requested: publicContentValues(values.requested),
    issues: publicError.issues,
    overrideAllowed: false,
  };
}

function literalBatchInputValues(input: UpdateListingContentInput): Readonly<{
  previous: ListingContentValues;
  requested: ListingContentValues;
  changedFields: ListingContentField[];
}> {
  const values = batchInputValues(input);
  return {
    ...values,
    // W07 intentionally grants every writable row exact bullet replacement
    // authority, even when its bullets are unchanged. Public problem details
    // must still name only literal workbook edits.
    changedFields: values.changedFields.filter((field) =>
      field !== "bulletPoints" ||
      values.previous.bulletPoints.length !== values.requested.bulletPoints.length ||
      values.previous.bulletPoints.some(
        (bullet, index) => bullet !== values.requested.bulletPoints[index],
      )
    ),
  };
}

function assertContentBatchSourceIdentity(
  validation: ListingContentPreparedPreview,
  sourceIdentity: ContentBatchSourceIdentity,
): void {
  if (validation.evidence.asin !== sourceIdentity.asin ||
      validation.evidence.productType !== sourceIdentity.productType) {
    throw new SpApiError(
      "Amazon 上的 SKU 已換綁到另一個 ASIN 或商品類型；此 SKU 已隔離且不會送出，請重新執行全站健檢後再處理。",
      { status: 409, code: "LISTING_IDENTITY_MISMATCH" },
    );
  }
}

function publicListingIssues(issues: readonly ListingIssue[]): ListingIssue[] {
  return publicSpApiListingIssues(issues).map((issue) => ({
    code: issue.code,
    severity: issue.severity,
    message: issue.message,
    attributeNames: [...issue.attributeNames],
    ...(issue.categories ? { categories: [...issue.categories] } : {}),
    ...(issue.marketplaceIds
      ? { marketplaceIds: [...issue.marketplaceIds] }
      : {}),
  }));
}

function batchPreviewOptions(): ListingContentPreviewOptions {
  return {
    exactBulletReplacementAuthority:
      LISTING_CONTENT_BATCH_EXACT_BULLET_REPLACEMENT_AUTHORITY,
  };
}

function publicUpdateResult(
  result: ListingContentUpdateResult,
): ListingContentUpdateResult {
  return {
    mode: result.mode,
    status: result.status,
    marketplaceId: result.marketplaceId,
    sellerSku: result.sellerSku,
    previous: publicContentValues(result.previous),
    requested: publicContentValues(result.requested),
    changedFields: [...result.changedFields],
    acceptedAt: result.acceptedAt,
    submissionId: result.submissionId,
    requestId: result.requestId,
    issues: publicListingIssues(result.issues),
    notice: result.notice,
  };
}

function publicBatchCommitResult(
  result: ContentBatchCommitResult,
): ContentBatchCommitResult {
  return {
    previewId: result.previewId,
    marketplaceId: result.marketplaceId,
    status: result.status,
    rows: result.rows.map((row) => ({
      sellerSku: row.sellerSku,
      state: row.state,
      result: row.result ? publicUpdateResult(row.result) : null,
      error: row.error
        ? {
            code: row.error.code,
            message: row.error.message,
            requestId: row.error.requestId,
          }
        : null,
    })),
    blockedChanges: result.blockedChanges.map((change) => ({
      sellerSku: change.sellerSku,
      code: change.code,
      message: change.message,
      changedFields: [...change.changedFields],
      previous: publicContentValues(change.previous),
      requested: publicContentValues(change.requested),
    })),
    skippedRows: publicSkippedRows(result.skippedRows ?? []),
    validationFailures: publicValidationFailures(
      result.validationFailures ?? [],
    ),
    completedAt: result.completedAt,
    notice: result.notice,
  };
}

const MARKETPLACE_CODES = Object.fromEntries(
  MARKETPLACE_METADATA.map((marketplace) => [
    marketplace.id,
    marketplace.code === "UK" ? "GB" : marketplace.code,
  ]),
) as Record<MarketplaceId, string>;

const CONTENT_BATCH_PREVIEW_TTL_MS = 15 * 60 * 1_000;
const CONTENT_BATCH_TERMINAL_REPLAY_TTL_MS = 24 * 60 * 60 * 1_000;
const CONTENT_BATCH_MAX_CHANGED_SKUS = 500;

function sameContentAuditValues(
  left: ParsedContentAuditValues,
  right: ParsedContentAuditValues,
): boolean {
  return left.title === right.title &&
    left.itemHighlight === right.itemHighlight &&
    left.productDescription === right.productDescription &&
    left.ingredients === right.ingredients &&
    left.bulletPoints.length === right.bulletPoints.length &&
    left.bulletPoints.every((value, index) => value === right.bulletPoints[index]);
}

const CONTENT_AUDIT_LEGACY_LINE_BREAK_CANDIDATES = [
  "\r",
  "\r\n",
  "\u0085",
  "\u2028",
  "\u2029",
] as const;
const CONTENT_AUDIT_LEGACY_MAX_NORMALIZED_BREAKS = 64;
const CONTENT_AUDIT_LEGACY_MAX_RECOVERED_ROWS = 500;
const CONTENT_AUDIT_LEGACY_MAX_CANDIDATE_WORK = 500;
const CONTENT_AUDIT_LEGACY_MAX_HASH_WORK = 1_000;
const CONTENT_AUDIT_LEGACY_MAX_CANDIDATE_BYTES = 2 * 1024 * 1024;

/**
 * Older v2 workbooks could pass literal XML line-break code points through a
 * spreadsheet consumer that normalized them to LF. These candidates never
 * authorize a row by themselves: the caller must find exactly one candidate
 * whose complete immutable digest already exists in the main-owned snapshot.
 */
function* legacyContentAuditSourceCandidates(
  values: ParsedContentAuditValues,
): Generator<ParsedContentAuditValues> {
  type StringField =
    | "title"
    | "itemHighlight"
    | "productDescription"
    | "ingredients";
  const locations: Array<
    | { field: StringField; index: number }
    | { field: "bulletPoints"; bulletIndex: number; index: number }
  > = [];
  const collect = (
    value: string,
    createLocation: (index: number) => (typeof locations)[number],
  ) => {
    let index = value.indexOf("\n");
    while (index >= 0) {
      locations.push(createLocation(index));
      if (locations.length > CONTENT_AUDIT_LEGACY_MAX_NORMALIZED_BREAKS) return;
      index = value.indexOf("\n", index + 1);
    }
  };
  collect(values.title, (index) => ({ field: "title", index }));
  collect(values.itemHighlight, (index) => ({ field: "itemHighlight", index }));
  values.bulletPoints.forEach((value, bulletIndex) =>
    collect(value, (index) => ({
      field: "bulletPoints",
      bulletIndex,
      index,
    })));
  collect(values.productDescription, (index) => ({
    field: "productDescription",
    index,
  }));
  collect(values.ingredients, (index) => ({ field: "ingredients", index }));
  if (
    !locations.length ||
    locations.length > CONTENT_AUDIT_LEGACY_MAX_NORMALIZED_BREAKS
  ) {
    return;
  }

  const clone = (): ParsedContentAuditValues => ({
    title: values.title,
    itemHighlight: values.itemHighlight,
    bulletPoints: [...values.bulletPoints],
    productDescription: values.productDescription,
    ingredients: values.ingredients,
  });
  const replaceAt = (value: string, index: number, replacement: string) =>
    `${value.slice(0, index)}${replacement}${value.slice(index + 1)}`;

  for (const location of locations) {
    for (const replacement of CONTENT_AUDIT_LEGACY_LINE_BREAK_CANDIDATES) {
      const candidate = clone();
      if (location.field === "bulletPoints") {
        candidate.bulletPoints[location.bulletIndex] = replaceAt(
          candidate.bulletPoints[location.bulletIndex] ?? "",
          location.index,
          replacement,
        );
      } else {
        candidate[location.field] = replaceAt(
          candidate[location.field],
          location.index,
          replacement,
        );
      }
      yield candidate;
    }
  }
  for (const replacement of CONTENT_AUDIT_LEGACY_LINE_BREAK_CANDIDATES) {
    yield {
      title: values.title.replaceAll("\n", replacement),
      itemHighlight: values.itemHighlight.replaceAll("\n", replacement),
      bulletPoints: values.bulletPoints.map((value) =>
        value.replaceAll("\n", replacement)),
      productDescription: values.productDescription.replaceAll("\n", replacement),
      ingredients: values.ingredients.replaceAll("\n", replacement),
    };
  }
}

function contentAuditProposedWithRecoveredSource(input: {
  parsedOriginal: ParsedContentAuditValues;
  recoveredOriginal: ParsedContentAuditValues;
  proposed: ParsedContentAuditValues;
}): ParsedContentAuditValues {
  const recoverUnchanged = (parsed: string, recovered: string, proposed: string) =>
    proposed === parsed ? recovered : proposed;
  return {
    title: recoverUnchanged(
      input.parsedOriginal.title,
      input.recoveredOriginal.title,
      input.proposed.title,
    ),
    itemHighlight: recoverUnchanged(
      input.parsedOriginal.itemHighlight,
      input.recoveredOriginal.itemHighlight,
      input.proposed.itemHighlight,
    ),
    bulletPoints: input.proposed.bulletPoints.map((value, index) =>
      recoverUnchanged(
        input.parsedOriginal.bulletPoints[index] ?? "",
        input.recoveredOriginal.bulletPoints[index] ?? "",
        value,
      )),
    productDescription: recoverUnchanged(
      input.parsedOriginal.productDescription,
      input.recoveredOriginal.productDescription,
      input.proposed.productDescription,
    ),
    ingredients: recoverUnchanged(
      input.parsedOriginal.ingredients,
      input.recoveredOriginal.ingredients,
      input.proposed.ingredients,
    ),
  };
}

function contentAuditLegacyRecoveredFieldWasEdited(input: {
  parsedOriginal: ParsedContentAuditValues;
  recoveredOriginal: ParsedContentAuditValues;
  proposed: ParsedContentAuditValues;
}): boolean {
  const editedRecovered = (parsed: string, recovered: string, proposed: string) =>
    recovered !== parsed && proposed !== parsed;
  return editedRecovered(
      input.parsedOriginal.title,
      input.recoveredOriginal.title,
      input.proposed.title,
    ) ||
    editedRecovered(
      input.parsedOriginal.itemHighlight,
      input.recoveredOriginal.itemHighlight,
      input.proposed.itemHighlight,
    ) ||
    input.proposed.bulletPoints.some((value, index) =>
      editedRecovered(
        input.parsedOriginal.bulletPoints[index] ?? "",
        input.recoveredOriginal.bulletPoints[index] ?? "",
        value,
      )) ||
    editedRecovered(
      input.parsedOriginal.productDescription,
      input.recoveredOriginal.productDescription,
      input.proposed.productDescription,
    ) ||
    editedRecovered(
      input.parsedOriginal.ingredients,
      input.recoveredOriginal.ingredients,
      input.proposed.ingredients,
    );
}

function parseText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string" || value.length > maximum) return null;
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
    ? null
    : value;
}

function parseBullets(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 5) return null;
  const result: string[] = [];
  for (const item of value) {
    const parsed = parseText(item, 5_000);
    if (parsed === null) return null;
    result.push(parsed);
  }
  return result;
}

function idempotencyKey(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9-]{8,80}$/u.test(value)
    ? value
    : null;
}

function acknowledgedSellerSkus(value: unknown): string[] | null {
  if (!isPlainRecord(value) ||
      Object.keys(value).some((key) =>
        key !== "acknowledged" && key !== "sellerSkus"
      ) ||
      value.acknowledged !== true ||
      !Array.isArray(value.sellerSkus) ||
      !value.sellerSkus.length) {
    return null;
  }
  const sellerSkus: string[] = [];
  for (const candidate of value.sellerSkus) {
    const sellerSku = parseSellerSku(candidate);
    if (!sellerSku || sellerSkus.includes(sellerSku)) return null;
    sellerSkus.push(sellerSku);
  }
  return sellerSkus;
}

function stableFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function apiError(error: unknown, fallback: string): ApiResponse {
  return error instanceof SpApiError
    ? routeError(error, fallback)
    : json({ code: "INTERNAL_ERROR", message: fallback }, 500);
}

function writeApiError(error: unknown, fallback: string): ApiResponse {
  return error instanceof MainWriteGateError
    ? invalid(error.message, error.status, error.code)
    : apiError(error, fallback);
}

export class ListingContentBatchMutations
  implements ListingContentBatchMutationsPort {
  private readonly evidence: ContentAuditSnapshotEvidenceReader;
  private readonly context: Pick<
    SpExecutionContextAdapter,
    "capture" | "assertCurrent"
  >;
  private readonly writeGate: MainWriteGatePort;
  private readonly content: Pick<
    ListingContentMutationsPort,
    "previewOne" | "attemptOne"
  >;
  private readonly now: () => number;
  private readonly randomUUID: () => string;
  private readonly plans = new Map<string, ContentBatchPlan>();
  private readonly buildClaims = new Map<string, object>();
  private lifecycleRevision = 0;

  constructor(input: ListingContentBatchMutationsDependencies) {
    this.evidence = input.evidence;
    this.context = input.context;
    this.writeGate = input.writeGate;
    this.content = input.content;
    this.now = input.now ?? Date.now;
    this.randomUUID = input.randomUUID ?? nodeRandomUUID;
  }

  handle(command: ListingContentBatchMutationCommand): Promise<ApiResponse> {
    return command.operation === "preview"
      ? this.preview(command.request)
      : this.commit(command.request);
  }

  clear(): void {
    this.lifecycleRevision += 1;
    this.plans.clear();
    this.buildClaims.clear();
  }

  private assertLifecycleCurrent(expected: number): void {
    if (expected === this.lifecycleRevision) return;
    throw new SpExecutionContextError(
      "SP_CONTEXT_INVALIDATED",
      "Amazon 執行環境已更新；請重新開始這次操作。",
    );
  }

  private assertPlanLive(plan: ContentBatchPlan): void {
    if (plan.expiresAt > this.now()) return;
    throw new SpApiError(
      "Excel 批次預檢已過期，請重新上傳並預檢。",
      { status: 410, code: "PREVIEW_EXPIRED" },
    );
  }

  private planIsCommitting(plan: ContentBatchPlan): boolean {
    return plan.state === "committing";
  }

  private previewPayload(plan: ContentBatchPlan) {
    return {
      previewId: plan.previewId,
      exportId: plan.exportId,
      marketplaceId: plan.marketplaceId,
      expiresAt: new Date(plan.expiresAt).toISOString(),
      status: "READY",
      changes: plan.changes.map((change) => ({
        sellerSku: change.input.sellerSku,
        changedFields: [...change.validation.changedFields],
        previous: publicContentValues(change.validation.previous),
        requested: publicContentValues(change.validation.requested),
        exactBulletReplacement: publicExactBulletReplacement(
          change.validation.exactBulletReplacement,
        ),
        issues: publicListingIssues(change.validation.issues),
        validationStatus: change.validation.status,
        overrideAllowed: false,
      })),
      blockedChanges: plan.blockedChanges.map((change) => ({
        sellerSku: change.sellerSku,
        code: change.code,
        message: change.message,
        changedFields: [...change.changedFields],
        previous: publicContentValues(change.previous),
        requested: publicContentValues(change.requested),
      })),
      skippedRows: publicSkippedRows(plan.skippedRows),
      validationFailures: publicValidationFailures(plan.validationFailures),
      validationOverride: {
        required: false,
        sellerSkus: [],
      },
      notice: `已逐 SKU 完成 Amazon Validation Preview；${plan.changes.length.toLocaleString()} 個安全 SKU 尚未寫入。${
        plan.blockedChanges.length
          ? ` 另有 ${plan.blockedChanges.length.toLocaleString()} 個 SKU 因原掃描未完整而未納入本次更新，且不會寫入 Amazon。`
          : ""
      }${
        plan.skippedRows.length
          ? ` ${plan.skippedRows.length.toLocaleString()} 個有問題的 SKU 已隔離並略過；上方已一次列出欄位與原因。`
          : ""
      }${
        plan.validationFailures.length
          ? ` ${plan.validationFailures.length.toLocaleString()} 個 Amazon 預檢失敗 SKU 已隔離且不會送出；其餘安全 SKU 可繼續。`
          : ""
      }`,
    };
  }

  private async preview(request: ApiRequest): Promise<ApiResponse> {
    const revision = this.lifecycleRevision;
    let buildClaimKey: string | null = null;
    let buildClaimToken: object | null = null;
    if (request.body?.kind !== "multipart") {
      return invalid(
        "文案 Excel 預檢必須使用單一 .xlsx 檔案表單。",
        415,
        "UNSUPPORTED_MEDIA_TYPE",
      );
    }
    const marketplaceId = parseMarketplace(request.body.fields.marketplaceId);
    const key = idempotencyKey(request.body.fields.idempotencyKey);
    if (!marketplaceId || !key) {
      return invalid("Excel 預檢缺少有效站點或批次確認碼。");
    }
    const file = request.body.file;
    try {
      const parsed = parseContentAuditWorkbook({
        bytes: file.bytes,
        fileName: file.name,
        mediaType: file.type,
      });
      if (parsed.metadata.marketplaceId !== marketplaceId) {
        return invalid(
          "Excel 所屬站點與目前選擇的 Amazon 站點不同，已停止預檢。",
          409,
          "MARKETPLACE_CHANGED",
        );
      }
      this.prunePlans();
      const context = await this.context.capture(marketplaceId);
      this.assertLifecycleCurrent(revision);
      const { accountScope, mode } = context;
      const lookup = await this.evidence.getContentAuditSnapshotEvidence({
        exportId: parsed.metadata.exportId,
        marketplaceId,
        accountScope,
        mode,
      });
      this.assertLifecycleCurrent(revision);
      if (lookup.status === "account-scope-changed") {
        return invalid(
          "Amazon 帳號範圍已改變，舊 Excel 不可用於更新。",
          409,
          "ACCOUNT_SCOPE_CHANGED",
        );
      }
      if (lookup.status === "marketplace-changed") {
        return invalid(
          "Excel 掃描快照所屬站點已改變，請重新執行全站健檢。",
          409,
          "MARKETPLACE_CHANGED",
        );
      }
      if (lookup.status === "mode-changed") {
        return invalid(
          "App 展示／真實模式已改變，舊 Excel 不可用於更新。",
          409,
          "REPORT_MODE_CHANGED",
        );
      }
      if (lookup.status !== "available") {
        return invalid(
          "這份文案 Excel 的掃描快照已過期，請重新執行全站健檢。",
          410,
          "SNAPSHOT_EXPIRED",
        );
      }
      const stored = lookup.evidence;
      if (stored.fetchedAt !== parsed.metadata.fetchedAt) {
        return invalid(
          "Excel 的掃描時間已被修改或與本機快照不符。",
          409,
          "WORKBOOK_TAMPERED",
        );
      }

      const rowDigests = new Set(stored.rowDigests);
      const inputRows: Array<Readonly<{
        input: UpdateListingContentInput;
        sourceIdentity: ContentBatchSourceIdentity;
      }>> = [];
      const blockedChanges: ContentBatchBlockedChange[] = [];
      const skippedRows: ContentBatchSkippedRow[] = workbookSkippedRows(
        parsed.issues,
      );
      let legacyRecoveredRows = 0;
      let legacyCandidateWork = 0;
      let legacyHashWork = 0;
      let legacyCandidateBytes = 0;
      for (const row of parsed.rows) {
        const digest = (
          values: ParsedContentAuditValues,
          readStatus: "complete" | "incomplete",
        ) =>
          contentAuditEvidenceRowDigest({
            accountScope,
            marketplaceId,
            mode,
            exportId: parsed.metadata.exportId,
            fetchedAt: parsed.metadata.fetchedAt,
            sellerSku: row.sellerSku,
            asin: row.asin,
            productType: row.productType,
            variationFamilyKey: row.variationFamilyKey,
            values,
            readStatus,
          });
        const sourceMatches: Array<{
          readStatus: "complete" | "incomplete";
          values: ParsedContentAuditValues;
        }> = [];
        const seenCandidateMatches = new Set<string>();
        const collectMatches = (
          candidates: readonly ParsedContentAuditValues[],
        ) => {
          for (const values of candidates) {
            for (const readStatus of ["complete", "incomplete"] as const) {
              if (!rowDigests.has(digest(values, readStatus))) continue;
              const matchKey = JSON.stringify([readStatus, values]);
              if (seenCandidateMatches.has(matchKey)) continue;
              seenCandidateMatches.add(matchKey);
              sourceMatches.push({ readStatus, values });
            }
          }
        };
        collectMatches([row.original]);
        if (sourceMatches.length === 0) {
          for (const values of legacyContentAuditSourceCandidates(row.original)) {
            legacyCandidateWork += 1;
            legacyHashWork += 2;
            legacyCandidateBytes += Buffer.byteLength(
              JSON.stringify(values),
              "utf8",
            );
            if (
              legacyCandidateWork > CONTENT_AUDIT_LEGACY_MAX_CANDIDATE_WORK ||
              legacyHashWork > CONTENT_AUDIT_LEGACY_MAX_HASH_WORK ||
              legacyCandidateBytes > CONTENT_AUDIT_LEGACY_MAX_CANDIDATE_BYTES
            ) {
              return invalid(
                "舊版 Excel 相容核對超過安全上限；請重新執行全站健檢並匯出新檔。",
                409,
                "WORKBOOK_REEXPORT_REQUIRED",
              );
            }
            collectMatches([values]);
          }
        }
        if (sourceMatches.length !== 1) {
          skippedRows.push({
            sellerSku: row.sellerSku,
            sourceSheet: row.sourceSheet,
            rowNumber: row.sourceRowNumber,
            stage: "SOURCE_CHECK",
            code: "WORKBOOK_TAMPERED",
            fields: ["Seller SKU／ASIN／Product Type／原始文案"],
            message:
              "識別欄、變體分類或 Amazon 原始文案與匯出快照不一致；此 SKU 已隔離且不會送出。",
          });
          continue;
        }
        const [{ readStatus: sourceReadStatus, values: sourceOriginal }] =
          sourceMatches;
        const recoveredLegacySource = !sameContentAuditValues(
          row.original,
          sourceOriginal,
        );
        if (recoveredLegacySource) {
          legacyRecoveredRows += 1;
          if (legacyRecoveredRows > CONTENT_AUDIT_LEGACY_MAX_RECOVERED_ROWS) {
            return invalid(
              "這份舊版 Excel 有過多列需要相容復原；請重新執行全站健檢並匯出新檔。",
              409,
              "WORKBOOK_REEXPORT_REQUIRED",
            );
          }
        }
        if (
          recoveredLegacySource &&
          contentAuditLegacyRecoveredFieldWasEdited({
            parsedOriginal: row.original,
            recoveredOriginal: sourceOriginal,
            proposed: row.proposed,
          })
        ) {
          skippedRows.push({
            sellerSku: row.sellerSku,
            sourceSheet: row.sourceSheet,
            rowNumber: row.sourceRowNumber,
            stage: "SOURCE_CHECK",
            code: "WORKBOOK_REEXPORT_REQUIRED",
            fields: ["原始文案／更新文案"],
            message:
              "舊版 Excel 的換行字元欄位同時被編輯，無法唯一復原原文；此 SKU 已隔離，請重新匯出後再修改。",
          });
          continue;
        }
        const proposed = contentAuditProposedWithRecoveredSource({
          parsedOriginal: row.original,
          recoveredOriginal: sourceOriginal,
          proposed: row.proposed,
        });
        if (sameContentAuditValues(sourceOriginal, proposed)) continue;
        const title = parseText(proposed.title, 2_000);
        const expectedTitle = parseText(sourceOriginal.title, 2_000);
        const itemHighlight = parseText(proposed.itemHighlight, 2_000);
        const expectedItemHighlight = parseText(sourceOriginal.itemHighlight, 2_000);
        const bulletPoints = parseBullets(proposed.bulletPoints);
        const expectedBulletPoints = parseBullets(sourceOriginal.bulletPoints);
        const productDescription = parseText(proposed.productDescription, 50_000);
        const expectedProductDescription = parseText(
          sourceOriginal.productDescription,
          50_000,
        );
        const ingredients = parseText(proposed.ingredients, 20_000);
        const expectedIngredients = parseText(sourceOriginal.ingredients, 20_000);
        const invalidLocalFields: string[] = [];
        if (title === null || expectedTitle === null) {
          invalidLocalFields.push("產品名稱");
        }
        if (itemHighlight === null || expectedItemHighlight === null) {
          invalidLocalFields.push("產品亮點");
        }
        if (bulletPoints === null || expectedBulletPoints === null) {
          invalidLocalFields.push("產品要點");
        }
        if (
          productDescription === null ||
          expectedProductDescription === null
        ) {
          invalidLocalFields.push("產品敘述");
        }
        if (ingredients === null || expectedIngredients === null) {
          invalidLocalFields.push("成分");
        }
        if (
          title === null ||
          expectedTitle === null ||
          itemHighlight === null ||
          expectedItemHighlight === null ||
          bulletPoints === null ||
          expectedBulletPoints === null ||
          productDescription === null ||
          expectedProductDescription === null ||
          ingredients === null ||
          expectedIngredients === null
        ) {
          skippedRows.push({
            sellerSku: row.sellerSku,
            sourceSheet: row.sourceSheet,
            rowNumber: row.sourceRowNumber,
            stage: "LOCAL_VALIDATION",
            code: "CONTENT_INVALID",
            fields: invalidLocalFields,
            message:
              `${invalidLocalFields.join("、")}含有不支援的控制字元或超過本機安全長度；此 SKU 已隔離且不會送出。`,
          });
          continue;
        }
        const input: UpdateListingContentInput = {
          marketplaceId,
          sellerSku: row.sellerSku,
          title,
          expectedTitle,
          itemHighlight,
          expectedItemHighlight,
          bulletPoints,
          expectedBulletPoints,
          productDescription,
          expectedProductDescription,
          ingredients,
          expectedIngredients,
        };
        if (sourceReadStatus !== "complete") {
          const values = literalBatchInputValues(input);
          blockedChanges.push({
            sellerSku: row.sellerSku,
            code: "CONTENT_READ_INCOMPLETE",
            message:
              `SKU ${row.sellerSku} 的 Amazon 原文在健檢時未完整讀取；此列未納入本次更新且不會寫入 Amazon。請先用「完整編輯」確認，或重新掃描後再回傳 Excel。`,
            changedFields: [...values.changedFields],
            previous: publicContentValues(values.previous),
            requested: publicContentValues(values.requested),
          });
          continue;
        }
        inputRows.push({
          input,
          sourceIdentity: {
            asin: row.asin,
            productType: row.productType,
          },
        });
      }
      if (
        inputRows.length + blockedChanges.length + skippedRows.length >
          CONTENT_BATCH_MAX_CHANGED_SKUS
      ) {
        return invalid(
          `一次最多更新 ${CONTENT_BATCH_MAX_CHANGED_SKUS} 個 SKU；請先保留本批要更新的列。`,
          413,
          "CONTENT_BATCH_TOO_LARGE",
        );
      }
      if (!inputRows.length) {
        if (skippedRows.length) {
          return json({
            code: "CONTENT_BATCH_ALL_SKIPPED",
            message:
              `${skippedRows.length.toLocaleString()} 個有問題的 SKU 已全部隔離；已一次列出欄位與原因，Amazon 寫入數為 0。`,
            skippedRows: publicSkippedRows(skippedRows),
            blockedChanges,
            writeCount: 0,
          }, 422);
        }
        if (blockedChanges.length) {
          return json({
            code: "CONTENT_READ_INCOMPLETE",
            message:
              `${blockedChanges.length.toLocaleString()} 個已編輯 SKU 的 Amazon 原文在健檢時未完整讀取，因此全部略過且沒有任何列會寫入。請先用「完整編輯」確認，或重新掃描後再回傳 Excel。`,
            blockedChanges,
            writeCount: 0,
          }, 422);
        }
        return invalid(
          "Excel 完整性核對通過；更新欄位與原始值相同，沒有需要預檢的變更。請只在「更新…」欄位填入新文案後再試。",
          422,
          "CONTENT_UNCHANGED",
        );
      }

      buildClaimKey = stableFingerprint([
        "content-batch-plan-build-v1",
        accountScope,
        marketplaceId,
        key,
      ]);
      if (this.buildClaims.has(buildClaimKey)) {
        buildClaimKey = null;
        return invalid(
          "這個批次確認碼正在預檢，已阻止建立第二份計畫。",
          409,
          "OPERATION_IN_PROGRESS",
        );
      }
      buildClaimToken = {};
      this.buildClaims.set(buildClaimKey, buildClaimToken);
      this.assertLifecycleCurrent(revision);

      const changes: ContentBatchChange[] = [];
      const validationErrors: ContentBatchValidationFailure[] = [];
      for (const { input, sourceIdentity } of inputRows) {
        await this.context.assertCurrent(context);
        this.assertLifecycleCurrent(revision);
        let validation: ListingContentPreparedPreview;
        try {
          validation = await this.content.previewOne(
            input,
            batchPreviewOptions(),
          );
        } catch (error) {
          if (error instanceof SpExecutionContextError) throw error;
          if (!isIsolatedContentPreviewFailure(error)) throw error;
          validationErrors.push(
            contentBatchValidationFailure(input, error),
          );
          continue;
        }
        this.assertLifecycleCurrent(revision);
        // Result binding is a global trust boundary. It deliberately lives
        // outside the row-isolation catch, so a wrong SKU, marketplace, mode,
        // content payload, or proposal stops the whole batch.
        assertListingContentPreparedPreviewBinding(
          validation,
          input,
          context,
          undefined,
          batchPreviewOptions(),
        );
        if (validation.status === "INVALID") {
          throw new SpApiError(
            "Amazon 回傳了未授權的 INVALID 預檢結果；整批已停止且沒有任何 SKU 會寫入。",
            {
              status: 502,
              code: "VALIDATION_STATUS_UNKNOWN",
              issues: [...validation.issues],
              operation: "patchListingsItemPreview",
            },
          );
        }
        try {
          assertContentBatchSourceIdentity(validation, sourceIdentity);
        } catch (error) {
          if (
            !(error instanceof SpApiError) ||
            error.code !== "LISTING_IDENTITY_MISMATCH"
          ) {
            throw error;
          }
          validationErrors.push(contentBatchValidationFailure(input, error));
          continue;
        }
        changes.push({
          input,
          sourceIdentity,
          proposalFingerprint: validation.proposalFingerprint,
          validation,
        });
      }
      await this.context.assertCurrent(context);
      this.assertLifecycleCurrent(revision);
      if (validationErrors.length && !changes.length) {
        return json(
          {
            code: "CONTENT_BATCH_VALIDATION_FAILED",
            message:
              `${validationErrors.length.toLocaleString()} 個 SKU 未通過預檢；有問題的 SKU 已全部隔離，Amazon 寫入數為 0。`,
            rows: publicValidationFailures(validationErrors),
            blockedChanges,
            skippedRows: publicSkippedRows(skippedRows),
            writeCount: 0,
          },
          422,
        );
      }
      if (stored.expiresAt <= this.now()) {
        return invalid(
          "這份文案 Excel 的掃描快照已過期，請重新執行全站健檢。",
          410,
          "SNAPSHOT_EXPIRED",
        );
      }

      const batchFingerprint = stableFingerprint([
        marketplaceId,
        parsed.metadata.exportId,
        key,
        changes.map((change) => [
          change.input.sellerSku,
          stableFingerprint([accountScope, change.proposalFingerprint]),
          change.validation.changedFields,
          change.validation.exactBulletReplacement,
          change.validation.status,
        ]),
        blockedChanges.map((change) => [
          change.sellerSku,
          change.code,
          change.changedFields,
          change.previous,
          change.requested,
        ]),
        skippedRows,
        validationErrors,
      ]);
      this.prunePlans();
      const conflictingPlan = [...this.plans.values()].find(
        (plan) =>
          plan.accountScope === accountScope &&
          plan.marketplaceId === marketplaceId &&
          plan.idempotencyKey === key &&
          plan.state !== "completed",
      );
      if (conflictingPlan) {
        if (conflictingPlan.fingerprint === batchFingerprint) {
          return json(this.previewPayload(conflictingPlan));
        }
        return invalid(
          "這個批次確認碼已用於另一份 Excel。",
          409,
          "IDEMPOTENCY_CONFLICT",
        );
      }
      const plan: ContentBatchPlan = {
        previewId: this.randomUUID(),
        exportId: parsed.metadata.exportId,
        context,
        marketplaceId,
        accountScope,
        idempotencyKey: key,
        fingerprint: batchFingerprint,
        changes,
        blockedChanges,
        skippedRows,
        validationFailures: validationErrors,
        expiresAt: Math.min(
          stored.expiresAt,
          this.now() + CONTENT_BATCH_PREVIEW_TTL_MS,
        ),
        completedExpiresAt: null,
        state: "ready",
        result: null,
      };
      this.assertLifecycleCurrent(revision);
      await this.stagePreview(this.writeBinding(plan));
      this.assertLifecycleCurrent(revision);
      this.assertPlanLive(plan);
      this.plans.set(plan.previewId, plan);
      return json(this.previewPayload(plan));
    } catch (error) {
      if (error instanceof ContentAuditWorkbookError) {
        return json({ code: error.code, message: error.message }, error.status);
      }
      return apiError(error, "文案 Excel 預檢時發生未預期的錯誤。");
    } finally {
      if (
        buildClaimKey &&
        buildClaimToken &&
        this.buildClaims.get(buildClaimKey) === buildClaimToken
      ) {
        this.buildClaims.delete(buildClaimKey);
      }
    }
  }

  private async commit(request: ApiRequest): Promise<ApiResponse> {
    const revision = this.lifecycleRevision;
    const body = bodyRecord(request);
    if (!body) {
      return invalid(
        "文案 Excel 更新必須使用 JSON。",
        415,
        "UNSUPPORTED_MEDIA_TYPE",
      );
    }
    const marketplaceId = parseMarketplace(body.marketplaceId);
    const previewId = reportIdentifier(body.previewId);
    const key = idempotencyKey(body.idempotencyKey);
    if (!marketplaceId || !previewId || !key) {
      return invalid("Excel 更新缺少有效的站點、previewId 或批次確認碼。");
    }
    this.prunePlans();
    const plan = this.plans.get(previewId);
    if (!plan) {
      return invalid(
        "Excel 批次預檢已過期，請重新上傳並預檢。",
        410,
        "PREVIEW_EXPIRED",
      );
    }
    if (
      plan.marketplaceId !== marketplaceId ||
      plan.idempotencyKey !== key
    ) {
      return invalid(
        "Excel 批次預檢與目前的站點或確認碼不一致。",
        409,
        "PREVIEW_CHANGED",
      );
    }
    if (this.planIsCommitting(plan)) {
      return invalid(
        "這份 Excel 批次正在處理，已阻止重複送出。",
        409,
        "OPERATION_IN_PROGRESS",
      );
    }
    const context = await this.context.capture(marketplaceId);
    this.assertLifecycleCurrent(revision);
    try {
      await this.context.assertCurrent(plan.context);
      this.assertLifecycleCurrent(revision);
    } catch (error) {
      this.plans.delete(previewId);
      throw error;
    }
    if (plan.accountScope !== context.accountScope) {
      this.plans.delete(previewId);
      throw new SpExecutionContextError(
        "ACCOUNT_SCOPE_CHANGED",
        "Amazon 帳號範圍已改變；本次操作已停止。",
      );
    }
    if (plan.state === "completed" && plan.result) {
      return json(publicBatchCommitResult(plan.result));
    }
    if (plan.expiresAt <= this.now()) {
      this.plans.delete(previewId);
      return invalid(
        "Excel 批次預檢已過期，請重新上傳並預檢。",
        410,
        "PREVIEW_EXPIRED",
      );
    }
    if (this.planIsCommitting(plan)) {
      return invalid(
        "這份 Excel 批次正在處理，已阻止重複送出。",
        409,
        "OPERATION_IN_PROGRESS",
      );
    }

    const suppliedOverrideSellerSkus = body.validationOverride === undefined
      ? []
      : acknowledgedSellerSkus(body.validationOverride);
    if (
      suppliedOverrideSellerSkus === null ||
      suppliedOverrideSellerSkus.length > 0
    ) {
      return json({
        code: "VALIDATION_OVERRIDE_REQUIRED",
        message:
          "Amazon Validation Preview 未通過的 SKU 不允許強制送出；它們已隔離，Amazon 寫入數為 0。",
        sellerSkus: [],
        writeCount: 0,
      }, 422);
    }

    const exactBulletReplacementChanges = plan.changes.filter(
      (change) => change.validation.exactBulletReplacement !== null,
    );
    const exactBulletReplacementSellerSkus =
      exactBulletReplacementChanges.map((change) => change.input.sellerSku);
    const suppliedExactBulletReplacementSellerSkus =
      body.exactBulletReplacement === undefined
        ? []
        : acknowledgedSellerSkus(body.exactBulletReplacement);
    if (suppliedExactBulletReplacementSellerSkus === null) {
      return json({
        code: "EXACT_BULLET_REPLACEMENT_ACKNOWLEDGEMENT_REQUIRED",
        message:
          "Amazon 第 6 項後產品要點的刪除確認格式無效；Amazon 寫入數為 0。",
        sellerSkus: exactBulletReplacementSellerSkus,
        writeCount: 0,
      }, 422);
    }
    if (
      exactBulletReplacementSellerSkus.length !==
        suppliedExactBulletReplacementSellerSkus.length ||
      exactBulletReplacementSellerSkus.some(
        (sellerSku, index) =>
          sellerSku !== suppliedExactBulletReplacementSellerSkus[index],
      )
    ) {
      return json({
        code: "EXACT_BULLET_REPLACEMENT_ACKNOWLEDGEMENT_REQUIRED",
        message: exactBulletReplacementSellerSkus.length
          ? "必須逐項核對並明確確認所有會刪除 Amazon 第 6 項後產品要點的 SKU，才可繼續；Amazon 寫入數為 0。"
          : "這份批次沒有需要刪除第 6 項後產品要點的 SKU；Amazon 寫入數為 0。",
        sellerSkus: exactBulletReplacementSellerSkus,
        writeCount: 0,
      }, 422);
    }

    const approvalReason = (verificationCode: string): string => {
      // beforeApproval may isolate a row after its fresh Amazon Preview. Build
      // the native summary lazily so it names only the SKUs still eligible to
      // write, while the original Write Gate binding remains the conservative
      // superset reserved before revalidation.
      const currentChanges = plan.changes;
      const sellerSkus = currentChanges.map((change) => change.input.sellerSku);
      const shownSkus = sellerSkus.slice(0, 5).join("、");
      const remaining = Math.max(0, sellerSkus.length - 5);
      const nativeRiskChanges = currentChanges.filter((change) =>
        change.validation.exactBulletReplacement !== null
      );
      const nativeRiskSummary = nativeRiskChanges
        .map((change) => {
          const risks: string[] = [];
          const disclosure = change.validation.exactBulletReplacement;
          if (disclosure) {
            risks.push(
              `要點 ${disclosure.currentExactLanguageBulletPoints.length}→${disclosure.requestedExactLanguageBulletPoints.length}／刪${disclosure.removedOverflowBulletPoints.length}`,
            );
          }
          return `${change.input.sellerSku}（${risks.join("；")}）`;
        })
        .join("、");
      const removedOverflowBulletCount = currentChanges.reduce(
        (total, change) =>
          total +
          (change.validation.exactBulletReplacement
            ?.removedOverflowBulletPoints.length ?? 0),
        0,
      );
      const detailed =
        `確認 Excel 批次文案｜${MARKETPLACE_CODES[marketplaceId]}｜${sellerSkus.length} SKU${
          nativeRiskChanges.length
            ? `｜高風險：${nativeRiskSummary}`
            : `｜${shownSkus}${remaining ? ` 等另 ${remaining} 個` : ""}`
        }｜驗證碼 ${verificationCode}`;
      return detailed.length <= NATIVE_CONFIRMATION_REASON_MAX_LENGTH
        ? detailed
        : `確認 Excel 批次文案｜${MARKETPLACE_CODES[marketplaceId]}｜${sellerSkus.length} SKU｜高風險 ${nativeRiskChanges.length} SKU／刪除要點 ${removedOverflowBulletCount} 項｜已在 App 逐項核對｜驗證碼 ${verificationCode}`;
    };
    let preflightResponse: ApiResponse | null = null;
    plan.state = "committing";
    try {
      this.assertLifecycleCurrent(revision);
      const result = await this.writeGate.execute<ContentBatchCommitResult>({
        binding: this.writeBinding(plan),
        approvalReason,
        cancellationMessage: "操作已取消；Amazon 沒有收到任何文案變更。",
        beforeApproval: async () => {
          try {
            this.assertLifecycleCurrent(revision);
            this.assertPlanLive(plan);
            const revalidated: ContentBatchChange[] = [];
            const newlyIsolated: ContentBatchValidationFailure[] = [];
            for (const change of plan.changes) {
              await this.context.assertCurrent(context);
              this.assertLifecycleCurrent(revision);
              let fresh: ListingContentPreparedPreview;
              try {
                fresh = await this.content.previewOne(
                  change.input,
                  batchPreviewOptions(),
                );
              } catch (error) {
                if (error instanceof SpExecutionContextError) throw error;
                if (!isIsolatedContentPreviewFailure(error)) throw error;
                newlyIsolated.push(
                  contentBatchValidationFailure(change.input, error),
                );
                continue;
              }
              this.assertLifecycleCurrent(revision);
              // A mismatched returned preview is a global trust failure and
              // must never be downgraded to one row's validation problem.
              assertListingContentPreparedPreviewBinding(
                fresh,
                change.input,
                context,
                {
                  evidence: change.validation.evidence,
                  exactBulletReplacement:
                    change.validation.exactBulletReplacement,
                  proposalFingerprint: change.proposalFingerprint,
                  status: change.validation.status,
                },
                batchPreviewOptions(),
              );
              if (fresh.status === "INVALID") {
                throw new SpApiError(
                  "Amazon 回傳了未授權的 INVALID 重新預檢結果；整批已停止且沒有任何 SKU 會寫入。",
                  {
                    status: 502,
                    code: "VALIDATION_STATUS_UNKNOWN",
                    issues: [...fresh.issues],
                    operation: "patchListingsItemPreview",
                  },
                );
              }
              try {
                assertContentBatchSourceIdentity(fresh, change.sourceIdentity);
              } catch (error) {
                if (
                  !(error instanceof SpApiError) ||
                  error.code !== "LISTING_IDENTITY_MISMATCH"
                ) {
                  throw error;
                }
                newlyIsolated.push(
                  contentBatchValidationFailure(change.input, error),
                );
                continue;
              }
              revalidated.push({ ...change, validation: fresh });
            }
            await this.context.assertCurrent(context);
            this.assertLifecycleCurrent(revision);
            this.assertPlanLive(plan);
            plan.validationFailures = [
              ...plan.validationFailures,
              ...newlyIsolated,
            ];
            if (!revalidated.length) {
              const message =
                `${plan.validationFailures.length.toLocaleString()} 個 SKU 在送出前重新預檢時未通過；已全部隔離，Amazon 寫入數為 0。`;
              preflightResponse = json({
                code: "CONTENT_BATCH_VALIDATION_FAILED",
                message,
                rows: publicValidationFailures(plan.validationFailures),
                blockedChanges: plan.blockedChanges,
                skippedRows: publicSkippedRows(plan.skippedRows),
                writeCount: 0,
              }, 422);
              throw new SpApiError(message, {
                status: 422,
                code: "CONTENT_BATCH_VALIDATION_FAILED",
              });
            }
            plan.changes = revalidated;
          } catch (error) {
            this.plans.delete(previewId);
            if (!preflightResponse) {
              const response = apiError(
                error,
                "整批送出前的 Amazon 重新讀取或 Validation Preview 失敗。",
              );
              preflightResponse = response.body.kind === "json" &&
                  isPlainRecord(response.body.value)
                ? json({
                    ...response.body.value,
                    message:
                      `${String(response.body.value.message ?? "整批重新預檢失敗。")} Amazon 寫入數為 0，請重新上傳 Excel。`,
                    writeCount: 0,
                  }, response.status, response.headers)
                : response;
            }
            throw error;
          }
        },
        run: async (session) => {
          this.assertLifecycleCurrent(revision);
          this.assertPlanLive(plan);
          const rows: ContentBatchRowResult[] = plan.changes.map((change) => ({
            sellerSku: change.input.sellerSku,
            state: "not-started",
            result: null,
            error: null,
          }));
          let status: ContentBatchCommitResult["status"] =
            plan.validationFailures.length
              ? "COMPLETED_WITH_ISSUES"
              : "COMPLETED";
          for (let index = 0; index < plan.changes.length; index += 1) {
            this.assertLifecycleCurrent(revision);
            const change = plan.changes[index]!;
            await this.context.assertCurrent(context);
            this.assertLifecycleCurrent(revision);
            let returnedUnverifiedResult = false;
            try {
              const rowResult = await this.content.attemptOne(
                change.input,
                change.validation.evidence,
                session,
                change.input.sellerSku,
                batchPreviewOptions(),
              );
              returnedUnverifiedResult = true;
              this.assertLifecycleCurrent(revision);
              assertListingContentUpdateResultBinding(
                rowResult,
                change.input,
                context,
                batchPreviewOptions(),
              );
              rows[index] = {
                sellerSku: change.input.sellerSku,
                state: rowResult.mode === "demo" ? "simulated" : "verified",
                result: rowResult,
                error: null,
              };
            } catch (error) {
              const unknown =
                !(error instanceof SpApiPreCommitError) &&
                (!(error instanceof SpApiError) ||
                  error.code === "UPDATE_STATUS_UNKNOWN" ||
                  error.status >= 500 ||
                  [401, 403, 429].includes(error.status));
              const publicError = error instanceof SpApiError
                ? publicSpApiError(
                    error,
                    unknown
                      ? "Amazon 寫入結果尚未確認。"
                      : "Amazon 拒絕這筆商品內容變更。",
                  )
                : null;
              rows[index] = {
                sellerSku: change.input.sellerSku,
                state: unknown ? "unknown" : "rejected",
                result: null,
                error: {
                  code: publicError?.code ?? "UPDATE_STATUS_UNKNOWN",
                  message: publicError?.message ?? "Amazon 寫入結果尚未確認。",
                  requestId: publicError?.requestId ?? null,
                },
              };
              if (
                !returnedUnverifiedResult &&
                isIsolatedBatchRowFailure(error)
              ) {
                status = "COMPLETED_WITH_ISSUES";
                continue;
              }
              status = unknown ? "STOPPED_UNKNOWN" : "STOPPED_REJECTED";
              break;
            }
          }
          const completedCount = rows.filter((row) =>
            row.state === "verified" || row.state === "simulated").length;
          const rejectedCount = rows.filter((row) =>
            row.state === "rejected").length;
          const unknownCount = rows.filter((row) =>
            row.state === "unknown").length;
          return {
            previewId,
            marketplaceId,
            status,
            rows,
            blockedChanges: plan.blockedChanges.map((change) => ({
              sellerSku: change.sellerSku,
              code: change.code,
              message: change.message,
              changedFields: [...change.changedFields],
              previous: publicContentValues(change.previous),
              requested: publicContentValues(change.requested),
            })),
            skippedRows: publicSkippedRows(plan.skippedRows),
            validationFailures: publicValidationFailures(
              plan.validationFailures,
            ),
            completedAt: new Date(this.now()).toISOString(),
            notice: status === "COMPLETED"
              ? `已完成 ${completedCount.toLocaleString()} 個 SKU；每筆皆經正式回讀或展示模擬核對。${
                plan.blockedChanges.length
                  ? ` 另有 ${plan.blockedChanges.length.toLocaleString()} 個原掃描未完整的 SKU 已略過且未寫入。`
                  : ""
              }`
              : status === "COMPLETED_WITH_ISSUES"
                ? `已完成處理 ${(completedCount + rejectedCount + unknownCount).toLocaleString()} 個 SKU：${completedCount.toLocaleString()} 個成功、${rejectedCount.toLocaleString()} 個未送出或遭拒、${unknownCount.toLocaleString()} 個結果不明；其餘安全 SKU 均已繼續。結果不明的 SKU 請先回查 Amazon，系統不會自動重送。${
                  plan.validationFailures.length
                    ? ` 另有 ${plan.validationFailures.length.toLocaleString()} 個 SKU 在 Amazon 預檢時已隔離且未送出。`
                    : ""
                }${
                  plan.blockedChanges.length
                    ? ` 另有 ${plan.blockedChanges.length.toLocaleString()} 個原掃描未完整的 SKU 已略過且未寫入。`
                    : ""
                }`
                : status === "STOPPED_UNKNOWN"
                  ? `已完成 ${completedCount.toLocaleString()} 個 SKU；遇到無法安全隔離的結果後已停止。結果不明的 SKU 請先回查 Amazon，系統不會自動重送。${
                    plan.blockedChanges.length
                      ? ` 另有 ${plan.blockedChanges.length.toLocaleString()} 個原掃描未完整的 SKU 已略過且未寫入。`
                      : ""
                  }`
                  : `已完成 ${completedCount.toLocaleString()} 個 SKU；遇到整批安全條件失效後已停止。${
                    plan.blockedChanges.length
                      ? ` 另有 ${plan.blockedChanges.length.toLocaleString()} 個原掃描未完整的 SKU 已略過且未寫入。`
                      : ""
                  }`,
          };
        },
      });
      this.assertLifecycleCurrent(revision);
      plan.result = publicBatchCommitResult(result);
      plan.state = "completed";
      plan.completedExpiresAt =
        this.now() + CONTENT_BATCH_TERMINAL_REPLAY_TTL_MS;
      return json(publicBatchCommitResult(plan.result));
    } catch (error) {
      if (plan.state === "committing") plan.state = "ready";
      if (preflightResponse) return preflightResponse;
      return writeApiError(
        error,
        "Excel 批次文案更新時發生未預期的錯誤。",
      );
    }
  }

  private prunePlans(now = this.now()): void {
    for (const [previewId, plan] of this.plans) {
      const expired = plan.state === "completed"
        ? plan.completedExpiresAt !== null && plan.completedExpiresAt <= now
        : plan.state !== "committing" && plan.expiresAt <= now;
      if (expired) {
        this.plans.delete(previewId);
      }
    }
  }

  private async stagePreview(binding: WriteBinding): Promise<void> {
    if (binding.intents.some((intent) => !idempotencyKey(intent.idempotencyKey))) {
      return;
    }
    await this.writeGate.stagePreview(binding);
  }

  private writeBinding(plan: ContentBatchPlan): WriteBinding {
    const intents = plan.changes.map((change) => ({
      intentId: change.input.sellerSku,
      operation: "content" as const,
      marketplaceId: plan.marketplaceId,
      sellerSku: change.input.sellerSku,
      idempotencyKey: plan.idempotencyKey,
      proposalFingerprint: change.proposalFingerprint,
    }));
    const first = intents[0];
    if (!first) throw new Error("Content batch plan has no write intents.");
    return {
      family: "content-batch",
      previewKey: plan.previewId,
      context: plan.context,
      intents: [first, ...intents.slice(1)],
    };
  }
}

export function createListingContentBatchMutations(
  input: ListingContentBatchMutationsDependencies,
): ListingContentBatchMutationsPort {
  return new ListingContentBatchMutations(input);
}
