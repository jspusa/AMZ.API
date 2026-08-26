import { MARKETPLACES } from "../../shared/marketplaces";

export type ListingIssue = {
  code: string | null;
  severity: string;
  message: string;
  attributeNames: string[];
  categories?: string[];
  marketplaceIds?: string[];
};

export type SpApiOperation =
  | "getListingsItem"
  | "searchListingsItems"
  | "getAplusContentPublishRecords"
  | "getAplusContentDocuments"
  | "getAplusContentDocumentAsinRelations"
  | "getItemReviewTopics"
  | "getDefinitionsProductType"
  | "patchListingsItemPreview"
  | "patchListingsItem";

export type PublicListingIssue = Readonly<{
  code: string | null;
  severity: string;
  message: string;
  attributeNames: readonly string[];
  categories?: readonly string[];
  marketplaceIds?: readonly string[];
}>;

export type PublicSpApiError = Readonly<{
  status: number;
  code: string;
  message: string;
  requestId: string | null;
  retryAfter: string | null;
  issues: readonly PublicListingIssue[];
  operation: SpApiOperation | null;
  upstreamCode: string | null;
}>;

const PUBLIC_ERROR_FALLBACK = "Amazon 服務暫時無法使用。";
const PUBLIC_MESSAGE_LIMIT = 2_048;
const PUBLIC_ISSUE_MESSAGE_LIMIT = 1_024;
const PUBLIC_ISSUE_LIMIT = 100;
const PUBLIC_ISSUE_IDENTIFIER_LIMIT = 100;
const PUBLIC_METADATA_LIMIT = 128;

const PUBLIC_MARKETPLACE_IDS: ReadonlySet<string> = new Set(
  MARKETPLACES.map((marketplace) => marketplace.id),
);

const SP_API_OPERATIONS: ReadonlySet<string> = new Set([
  "getListingsItem",
  "searchListingsItems",
  "getAplusContentPublishRecords",
  "getAplusContentDocuments",
  "getAplusContentDocumentAsinRelations",
  "getItemReviewTopics",
  "getDefinitionsProductType",
  "patchListingsItemPreview",
  "patchListingsItem",
]);

const INVISIBLE_OR_CONTROL_CHARACTERS =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/gu;
const URL_PATTERN = /(?:\b(?:https?|file):\/\/|\bwww\.|\b(?:data|javascript):)/iu;
const CREDENTIAL_QUERY_PATTERN =
  /[?&](?:client[_-]?secret|refresh[_-]?token|access[_-]?token|seller[_-]?id|merchant[_-]?token|authorization|x-amz-security-token)=/iu;
const SENSITIVE_VALUE_PATTERN =
  /(?:\bbearer\s+\S+|\batz[ar]\|\S+|(?:client[_\s-]*secret|refresh[_\s-]*token|access[_\s-]*token|seller[_\s-]*id|merchant[_\s-]*token|account[_\s-]*scope|report[_\s-]*id|document[_\s-]*id)\s*(?::|=)\s*["']?\S+)/iu;
const LABELED_PRIVATE_VALUE_PATTERN =
  /(?:seller[_\s-]*id|merchant[_\s-]*token)\s+A[A-Z0-9]{12,15}\b|(?:account[_\s-]*scope|report[_\s-]*id|document[_\s-]*id)\s+[A-Za-z0-9][A-Za-z0-9._:-]{3,}/iu;
const AMAZON_ACCOUNT_IDENTIFIER_PATTERN = /\bA[A-Z0-9]{12,15}\b/gu;
const OPAQUE_ACCOUNT_SCOPE_PATTERN = /\b[a-f0-9]{64}\b/iu;
const AMAZON_REPORT_DOCUMENT_IDENTIFIER_PATTERN =
  /\bamzn1\.spdoc(?:\.[A-Za-z0-9_:-]+)+\b/iu;
const AMAZON_REPORT_IDENTIFIER_PATTERN = /\b\d{10,20}\b/u;
const SAFE_METADATA_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const SAFE_ISSUE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u;
const RETRY_AFTER_SECONDS_PATTERN = /^\d+(?:\.\d+)?$/u;
const RETRY_AFTER_HTTP_DATE_PATTERN =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (?:0[1-9]|[12]\d|3[01]) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d GMT$/u;

function stripInvisibleAndControlCharacters(value: string): string {
  return value.replace(INVISIBLE_OR_CONTROL_CHARACTERS, "");
}

function containsPrivateMaterial(value: string): boolean {
  if (
    URL_PATTERN.test(value) ||
    CREDENTIAL_QUERY_PATTERN.test(value) ||
    SENSITIVE_VALUE_PATTERN.test(value) ||
    LABELED_PRIVATE_VALUE_PATTERN.test(value) ||
    OPAQUE_ACCOUNT_SCOPE_PATTERN.test(value) ||
    AMAZON_REPORT_DOCUMENT_IDENTIFIER_PATTERN.test(value) ||
    AMAZON_REPORT_IDENTIFIER_PATTERN.test(value)
  ) {
    return true;
  }
  for (const match of value.matchAll(AMAZON_ACCOUNT_IDENTIFIER_PATTERN)) {
    if (!PUBLIC_MARKETPLACE_IDS.has(match[0])) return true;
  }
  return false;
}

function boundCodePoints(value: string, maximum: number): string {
  const codePoints = [...value];
  return codePoints.length <= maximum
    ? value
    : codePoints.slice(0, maximum).join("");
}

function publicText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const stripped = stripInvisibleAndControlCharacters(value);
  if (!stripped || containsPrivateMaterial(stripped)) return null;
  return boundCodePoints(stripped, maximum);
}

function publicFallback(value: unknown): string {
  return publicText(value, PUBLIC_MESSAGE_LIMIT) ?? PUBLIC_ERROR_FALLBACK;
}

function publicMetadata(value: unknown, maximum = PUBLIC_METADATA_LIMIT): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    return null;
  }
  if (
    stripInvisibleAndControlCharacters(value) !== value ||
    containsPrivateMaterial(value) ||
    !SAFE_METADATA_PATTERN.test(value)
  ) {
    return null;
  }
  return value;
}

export function publicSpApiRequestId(value: unknown): string | null {
  return publicMetadata(value);
}

export function publicSpApiIssueIdentifier(value: unknown): string | null {
  return publicMetadata(value);
}

function publicRetryAfter(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) {
    return null;
  }
  if (RETRY_AFTER_SECONDS_PATTERN.test(value)) {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds >= 0 ? value : null;
  }
  if (!RETRY_AFTER_HTTP_DATE_PATTERN.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toUTCString() === value
    ? value
    : null;
}

function publicIdentifierList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const identifiers: string[] = [];
  for (const candidate of value.slice(0, PUBLIC_ISSUE_IDENTIFIER_LIMIT)) {
    const identifier = publicSpApiIssueIdentifier(candidate);
    if (identifier && SAFE_ISSUE_IDENTIFIER_PATTERN.test(identifier)) {
      identifiers.push(identifier);
    }
  }
  return Object.freeze(identifiers);
}

function publicListingIssue(value: unknown): PublicListingIssue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const issue = value as Partial<ListingIssue>;
  const severity = publicMetadata(issue.severity, 32);
  const message = publicText(issue.message, PUBLIC_ISSUE_MESSAGE_LIMIT);
  if (!severity || !message) return null;

  const categories = Array.isArray(issue.categories)
    ? publicIdentifierList(issue.categories)
    : undefined;
  const marketplaceIds = Array.isArray(issue.marketplaceIds)
    ? publicIdentifierList(issue.marketplaceIds)
    : undefined;
  return Object.freeze({
    code: issue.code === null ? null : publicMetadata(issue.code),
    severity,
    message,
    attributeNames: publicIdentifierList(issue.attributeNames),
    ...(categories === undefined ? {} : { categories }),
    ...(marketplaceIds === undefined ? {} : { marketplaceIds }),
  });
}

function publicIssues(value: unknown): readonly PublicListingIssue[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const issues: PublicListingIssue[] = [];
  for (const candidate of value.slice(0, PUBLIC_ISSUE_LIMIT)) {
    const issue = publicListingIssue(candidate);
    if (issue) issues.push(issue);
  }
  return Object.freeze(issues);
}

export function publicSpApiListingIssues(
  value: unknown,
): readonly PublicListingIssue[] {
  return publicIssues(value);
}

function publicOperation(value: unknown): SpApiOperation | null {
  return typeof value === "string" && SP_API_OPERATIONS.has(value)
    ? value as SpApiOperation
    : null;
}

export class SpApiError extends Error {
  status: number;
  code: string;
  requestId: string | null;
  retryAfter: string | null;
  issues: ListingIssue[];
  operation: SpApiOperation | null;
  upstreamCode: string | null;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: string;
      requestId?: string | null;
      retryAfter?: string | null;
      issues?: ListingIssue[];
      operation?: SpApiOperation | null;
      upstreamCode?: string | null;
    } = {},
  ) {
    super(message);
    this.name = "SpApiError";
    this.status = options.status ?? 500;
    this.code = options.code ?? "UPSTREAM_UNAVAILABLE";
    this.requestId = options.requestId ?? null;
    this.retryAfter = options.retryAfter ?? null;
    this.issues = options.issues ?? [];
    this.operation = options.operation ?? null;
    this.upstreamCode = options.upstreamCode ?? null;
  }
}

export class SpApiPreCommitError extends SpApiError {
  readonly commitPatchSent = false;

  constructor(cause: SpApiError) {
    super(
      `${cause.message} 正式 commit PATCH 尚未送出；可重新預檢後再試。`,
      {
        status: cause.status,
        code: cause.code,
        requestId: cause.requestId,
        retryAfter: cause.retryAfter,
        issues: cause.issues,
        operation: cause.operation,
        upstreamCode: cause.upstreamCode,
      },
    );
    this.name = "SpApiPreCommitError";
  }
}

/**
 * Rebuilds the subset that may cross the main/renderer boundary. The original
 * error remains untouched so local retry and idempotency classification keep
 * their existing semantics.
 */
export function publicSpApiError(
  error: SpApiError,
  fallbackMessage: string,
): PublicSpApiError {
  return Object.freeze({
    status: Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
      ? error.status
      : 500,
    code: publicMetadata(error.code) ?? "UPSTREAM_UNAVAILABLE",
    message: publicText(error.message, PUBLIC_MESSAGE_LIMIT) ??
      publicFallback(fallbackMessage),
    requestId: publicSpApiRequestId(error.requestId),
    retryAfter: publicRetryAfter(error.retryAfter),
    issues: publicIssues(error.issues),
    operation: publicOperation(error.operation),
    upstreamCode: publicMetadata(error.upstreamCode),
  });
}
