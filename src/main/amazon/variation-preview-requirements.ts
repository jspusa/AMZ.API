import { publicSpApiListingIssues } from "./sp-api-error";
import { ptdAttributeDefinitions } from "./variation-required-fields";

const ATTRIBUTE_NAME = /^[a-z][a-z0-9_]{0,79}$/u;
const BAD_TEXT =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const MISSING_CODES = new Set(["90220", "4000002"]);
const NON_MISSING_CODES = new Set([
  "4000001",
  "4005011",
  "90225",
  "90226",
  "90194",
  "90199",
]);
const GENERIC_REQUEST_CODES = new Set([
  "InvalidInput",
  "InvalidInputException",
  "BadRequest",
  "BAD_REQUEST",
]);

type RequirementHints = Readonly<{
  requiredNames: string[];
  choiceNames: string[];
  unresolvedReason?: "PTD_UNDECLARED";
  rejectionReason?: "METADATA_REJECTED" | "HTTP_UNSUPPORTED";
  rejectionDetail?: VariationPreviewRejectionDetail;
}>;
export type VariationPreviewRejectionDetail =
  | "ENVELOPE"
  | "RECEIPT_STATUS"
  | "ISSUE_LIST"
  | "ISSUE_TEXT"
  | "ISSUE_SEVERITY"
  | "MARKETPLACE_LIST"
  | "CATEGORY_LIST"
  | "ISSUE_CLASSIFICATION"
  | "ATTRIBUTE_IDENTITY";
const emptyHints = (): RequirementHints => ({
  requiredNames: [],
  choiceNames: [],
});

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactText(value: unknown, limit: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= limit &&
    value === value.trim() &&
    !BAD_TEXT.test(value)
  );
}

function exactList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 30 &&
    value.every((entry) => exactText(entry, 200)) &&
    new Set(value).size === value.length
  );
}

function missingToken(message: string): string | undefined {
  return (
    /^(?:'([^']+)'|"([^"]+)"|`([^`]+)`|([a-z][a-z0-9_]{0,79})) is required but (?:missing|not supplied)\.?$/u
      .exec(message)
      ?.slice(1)
      .find(Boolean) ??
    /^A value for (?:'([^']+)'|"([^"]+)"|`([^`]+)`|([a-z][a-z0-9_]{0,79})) is required\.?$/u
      .exec(message)
      ?.slice(1)
      .find(Boolean)
  );
}

/** Diagnostic signal only. It never proves a field identity or grants a candidate. */
function hasMissingSignal(payload: unknown, httpStatus: number): boolean {
  if (!record(payload)) return false;
  const successfulTransport = httpStatus >= 200 && httpStatus < 300;
  const issues = successfulTransport ? payload.issues : payload.errors;
  if (!Array.isArray(issues) || issues.length > 50) return false;
  const active = issues.filter((issue) =>
    !successfulTransport || !record(issue) || issue.severity !== "WARNING",
  );
  return active.length > 0 && active.every((issue) =>
    record(issue) &&
    (!successfulTransport || typeof issue.severity === "string" &&
      issue.severity.toUpperCase() === "ERROR") &&
    typeof issue.code === "string" && !NON_MISSING_CODES.has(issue.code) &&
    (MISSING_CODES.has(issue.code) || successfulTransport &&
      Array.isArray(issue.categories) && issue.categories.includes("MISSING_ATTRIBUTE")),
  );
}

/** Bounded raw metadata from the fixed Validation Preview call, never cleaned UI text. */
export function resolveVariationPreviewRequirements(
  input: Readonly<{
    schema: unknown;
    marketplaceId: string;
    sellerSku: string;
    httpStatus: number;
    payload: unknown;
  }>,
): RequirementHints {
  const reject = (
    detail: VariationPreviewRejectionDetail,
    reason: NonNullable<RequirementHints["rejectionReason"]> = "METADATA_REJECTED",
  ): RequirementHints => ({
    ...emptyHints(),
    ...(hasMissingSignal(input.payload, input.httpStatus)
      ? { rejectionReason: reason, rejectionDetail: detail }
      : {}),
  });
  const required = new Set<string>();
  const choices = new Set<string>();
  let unresolvedReason: RequirementHints["unresolvedReason"];
  const definitions = ptdAttributeDefinitions(input.schema);
  if (!record(input.payload)) return reject("ENVELOPE");
  const rejectedRequest = input.httpStatus === 400 || input.httpStatus === 422;
  // 400 ErrorList is documented. 422 is a narrow App compatibility policy,
  // with identical checks; neither response is represented as a valid receipt.
  if (
    !rejectedRequest &&
    (input.httpStatus !== 200 ||
      (input.payload.status !== "VALID" && input.payload.status !== "INVALID"))
  )
    return reject(
      "RECEIPT_STATUS",
      input.httpStatus === 200 ? "METADATA_REJECTED" : "HTTP_UNSUPPORTED",
    );
  if (
    rejectedRequest &&
    Object.keys(input.payload).some((key) => key !== "errors")
  )
    return reject("ENVELOPE");
  if (!rejectedRequest && input.payload.sku !== input.sellerSku)
    return reject("ENVELOPE");
  if (!rejectedRequest && Object.hasOwn(input.payload, "errors"))
    return reject("ENVELOPE");
  const issues = rejectedRequest ? input.payload.errors : input.payload.issues;
  if (!Array.isArray(issues) || !issues.length || issues.length > 50)
    return reject("ISSUE_LIST");
  for (const issue of issues) {
    if (
      !record(issue) ||
      !exactText(issue.code, 100) ||
      !exactText(issue.message, 500) ||
      /<[^>]*>/u.test(issue.message) ||
      publicSpApiListingIssues([
        {
          code: "PREVIEW_REQUIREMENT",
          severity: "ERROR",
          message: issue.message,
        },
      ])[0]?.message !== issue.message
    )
      return reject("ISSUE_TEXT");
    if (!rejectedRequest && issue.severity === "WARNING") continue;
    if (!rejectedRequest && issue.severity !== "ERROR") return reject("ISSUE_SEVERITY");
    if (
      rejectedRequest &&
      (Object.keys(issue).some(
        (key) => !["code", "message", "details"].includes(key),
      ) ||
        (Object.hasOwn(issue, "details") &&
          (typeof issue.details !== "string" ||
            issue.details.length > 2_000 ||
            BAD_TEXT.test(issue.details))))
    )
      return reject("ENVELOPE");
    if (
      Object.hasOwn(issue, "marketplaceIds") &&
      (!exactList(issue.marketplaceIds) ||
        issue.marketplaceIds.length > 1 ||
        (issue.marketplaceIds.length === 1 &&
          issue.marketplaceIds[0] !== input.marketplaceId))
    )
      return reject("MARKETPLACE_LIST");
    if (Object.hasOwn(issue, "categories") && !exactList(issue.categories))
      return reject("CATEGORY_LIST");
    const categories = Array.isArray(issue.categories) ? issue.categories : [];
    const typedMissing =
      MISSING_CODES.has(issue.code) ||
      (!rejectedRequest && categories.includes("MISSING_ATTRIBUTE"));
    const token = missingToken(issue.message);
    if (
      NON_MISSING_CODES.has(issue.code) ||
      categories.some((category) => category !== "MISSING_ATTRIBUTE")
    )
      return reject("ISSUE_CLASSIFICATION");
    if (
      !typedMissing &&
      !(
        rejectedRequest &&
        token &&
        (GENERIC_REQUEST_CODES.has(issue.code) ||
          /^[0-9]{1,10}$/u.test(issue.code))
      )
    )
      return reject("ISSUE_CLASSIFICATION");

    const plural = Object.hasOwn(issue, "attributeNames");
    const singular = Object.hasOwn(issue, "attributeName");
    if (
      (plural && singular) ||
      (plural && !exactList(issue.attributeNames)) ||
      (singular &&
        (!exactText(issue.attributeName, 80) ||
          !ATTRIBUTE_NAME.test(issue.attributeName)))
    )
      return reject("ATTRIBUTE_IDENTITY");
    const names = plural
      ? (issue.attributeNames as string[])
      : singular
        ? [issue.attributeName as string]
        : [];
    if (names.some((name) => !ATTRIBUTE_NAME.test(name))) return reject("ATTRIBUTE_IDENTITY");
    if (names.length) {
      // Explicit structured identity cannot be overridden by a display message.
      if (names.every((name) => definitions.has(name)))
        names.forEach((name) => required.add(name));
      else {
        unresolvedReason = "PTD_UNDECLARED";
        definitions.forEach((_titles, name) => choices.add(name));
      }
      continue;
    }
    // Exact full-token title matching is our conservative lookup strategy,
    // not an Amazon identifier guarantee. No fuzzy matching or translation.
    const matches = token
      ? [...definitions]
          .filter(([name, titles]) => name === token || titles.includes(token))
          .map(([name]) => name)
      : [];
    if (typedMissing && matches.length === 1) required.add(matches[0]!);
    else {
      if (!matches.length && (token || !definitions.size))
        unresolvedReason = "PTD_UNDECLARED";
      (matches.length ? matches : [...definitions.keys()]).forEach((name) =>
        choices.add(name),
      );
    }
  }
  return {
    requiredNames: [...required],
    choiceNames: [...choices].filter((name) => !required.has(name)),
    ...(unresolvedReason ? { unresolvedReason } : {}),
  };
}
