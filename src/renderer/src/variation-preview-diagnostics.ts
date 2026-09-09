import { MARKETPLACES } from "../../shared/marketplaces";

const marketplaceIds = new Set<string>(MARKETPLACES.map((item) => item.id));
const operations = new Set([
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
const invisible =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/u;
const credentialQuery =
  /[?&](?:client[_-]?secret|refresh[_-]?token|access[_-]?token|seller[_-]?id|merchant[_-]?token|authorization|x-amz-security-token)=/iu;
const privateText =
  /(?:\b(?:https?|file):\/\/|\bwww\.|\b(?:data|javascript):|<[^>]*>|\bbearer\s+\S+|\batz[ar]\|\S+|(?:client[_\s-]*secret|refresh[_\s-]*token|access[_\s-]*token|seller[_\s-]*id|merchant[_\s-]*token|account[_\s-]*scope|report[_\s-]*id|document[_\s-]*id)\s*(?::|=)\s*["']?\S+|\b[a-f0-9]{64}\b|\bamzn1\.spdoc(?:\.[A-Za-z0-9_:-]+)+\b|\b\d{10,20}\b)/iu;

/** Mirror main's public-text boundary without importing any main capability. */
export function safeVariationDiagnosticText(
  value: unknown,
  limit = 2_048,
): string | null {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > limit ||
    value !== value.trim() ||
    invisible.test(value) ||
    privateText.test(value) ||
    credentialQuery.test(value)
  )
    return null;
  if (
    [...value.matchAll(/\bA[A-Z0-9]{12,15}\b/gu)].some(
      ([id]) => !marketplaceIds.has(id),
    )
  )
    return null;
  if (
    /(?:account[_\s-]*scope|report[_\s-]*id|document[_\s-]*id)\s+[A-Za-z0-9][A-Za-z0-9._:-]{3,}/iu.test(
      value,
    )
  )
    return null;
  return value;
}

function identifier(value: unknown): string | null {
  return typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)
    ? safeVariationDiagnosticText(value, 128)
    : null;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function identifiers(value: unknown, markets = false): string[] | null {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > 30 ||
    new Set(value).size !== value.length ||
    value.some(
      (item) => !identifier(item) || (markets && !marketplaceIds.has(item)),
    )
  )
    return null;
  return [...value] as string[];
}

export type VariationPreviewDiagnosticIssue = {
  code: string | null;
  severity: "ERROR" | "WARNING" | "INFO";
  attributeNames: string[] | null;
  categories: string[] | null;
  marketplaceIds: string[] | null;
};

export type VariationPreviewDiagnostics = {
  localStatus: number;
  code: string | null;
  upstreamCode: string | null;
  operation: string | null;
  requestId: string | null;
  issues: VariationPreviewDiagnosticIssue[];
  omittedIssues: number;
  issuesUnavailable: boolean;
};

/** Display-only projection: no raw response, product values, messages or write authority. */
export function parseVariationPreviewDiagnostics(
  raw: unknown,
  localStatus: number,
): VariationPreviewDiagnostics | null {
  if (
    !record(raw) ||
    !Number.isInteger(localStatus) ||
    localStatus < 400 ||
    localStatus > 599
  )
    return null;
  const issues: VariationPreviewDiagnosticIssue[] = [];
  if (Array.isArray(raw.issues))
    for (const issue of raw.issues.slice(0, 20)) {
      if (
        !record(issue) ||
        (issue.severity !== "ERROR" &&
          issue.severity !== "WARNING" &&
          issue.severity !== "INFO")
      )
        continue;
      issues.push({
        code: identifier(issue.code),
        severity: issue.severity,
        attributeNames: identifiers(issue.attributeNames),
        categories: identifiers(issue.categories),
        marketplaceIds: identifiers(issue.marketplaceIds, true),
      });
    }
  return {
    localStatus,
    code: identifier(raw.code),
    upstreamCode: identifier(raw.upstreamCode),
    operation:
      typeof raw.operation === "string" && operations.has(raw.operation)
        ? raw.operation
        : null,
    requestId: identifier(raw.requestId),
    issues,
    omittedIssues: Array.isArray(raw.issues)
      ? raw.issues.length - issues.length
      : 0,
    issuesUnavailable: !Array.isArray(raw.issues),
  };
}
