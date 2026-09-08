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
}>;
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
  const required = new Set<string>();
  const choices = new Set<string>();
  const definitions = ptdAttributeDefinitions(input.schema);
  if (!record(input.payload)) return emptyHints();
  const rejectedRequest = input.httpStatus === 400 || input.httpStatus === 422;
  // 400 ErrorList is documented. 422 is a narrow App compatibility policy,
  // with identical checks; neither response is represented as a valid receipt.
  if (
    !rejectedRequest &&
    (input.httpStatus !== 200 ||
      (input.payload.status !== "VALID" && input.payload.status !== "INVALID"))
  )
    return emptyHints();
  if (
    rejectedRequest &&
    Object.keys(input.payload).some((key) => key !== "errors")
  )
    return emptyHints();
  if (!rejectedRequest && input.payload.sku !== input.sellerSku)
    return emptyHints();
  if (!rejectedRequest && Object.hasOwn(input.payload, "errors"))
    return emptyHints();
  const issues = rejectedRequest ? input.payload.errors : input.payload.issues;
  if (!Array.isArray(issues) || !issues.length || issues.length > 50)
    return emptyHints();
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
      return emptyHints();
    if (!rejectedRequest && issue.severity === "WARNING") continue;
    if (!rejectedRequest && issue.severity !== "ERROR") return emptyHints();
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
      return emptyHints();
    if (
      Object.hasOwn(issue, "marketplaceIds") &&
      (!exactList(issue.marketplaceIds) ||
        issue.marketplaceIds.length > 1 ||
        (issue.marketplaceIds.length === 1 &&
          issue.marketplaceIds[0] !== input.marketplaceId))
    )
      return emptyHints();
    if (Object.hasOwn(issue, "categories") && !exactList(issue.categories))
      return emptyHints();
    const categories = Array.isArray(issue.categories) ? issue.categories : [];
    const typedMissing =
      MISSING_CODES.has(issue.code) ||
      (!rejectedRequest && categories.includes("MISSING_ATTRIBUTE"));
    const token = missingToken(issue.message);
    if (
      NON_MISSING_CODES.has(issue.code) ||
      categories.some((category) => category !== "MISSING_ATTRIBUTE")
    )
      return emptyHints();
    if (
      !typedMissing &&
      !(
        rejectedRequest &&
        token &&
        (GENERIC_REQUEST_CODES.has(issue.code) ||
          /^[0-9]{1,10}$/u.test(issue.code))
      )
    )
      return emptyHints();

    const plural = Object.hasOwn(issue, "attributeNames");
    const singular = Object.hasOwn(issue, "attributeName");
    if (
      (plural && singular) ||
      (plural && !exactList(issue.attributeNames)) ||
      (singular &&
        (!exactText(issue.attributeName, 80) ||
          !ATTRIBUTE_NAME.test(issue.attributeName)))
    )
      return emptyHints();
    const names = plural
      ? (issue.attributeNames as string[])
      : singular
        ? [issue.attributeName as string]
        : [];
    if (names.some((name) => !ATTRIBUTE_NAME.test(name))) return emptyHints();
    if (names.length) {
      // Explicit structured identity cannot be overridden by a display message.
      if (names.every((name) => definitions.has(name)))
        names.forEach((name) => required.add(name));
      else definitions.forEach((_titles, name) => choices.add(name));
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
    else
      (matches.length ? matches : [...definitions.keys()]).forEach((name) =>
        choices.add(name),
      );
  }
  return {
    requiredNames: [...required],
    choiceNames: [...choices].filter((name) => !required.has(name)),
  };
}
