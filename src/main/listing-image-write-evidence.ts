import { createHash } from "node:crypto";
import type { ListingImageUpdateResult } from "./amazon/listing-image-types";
import type { ListingIssue } from "./amazon/sp-api-error";
import type { ListingImageSlot } from "./amazon/listing-image-gateway";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validReadbackIssue(value: unknown): value is ListingIssue {
  return isRecord(value) && (value.code === null || typeof value.code === "string")
    && typeof value.severity === "string" && ["ERROR", "WARNING", "INFO"].includes(value.severity)
    && typeof value.message === "string" && Array.isArray(value.attributeNames)
    && value.attributeNames.every(name => typeof name === "string")
    && [value.categories, value.marketplaceIds].every(items => items === undefined
      || (Array.isArray(items) && items.every(item => typeof item === "string")));
}

export function expectedOldHash(values: readonly (string | null)[]): string {
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

export type ListingImageWriteEvidence = Readonly<{
  version: 1 | 2;
  asin: string;
  productType: string;
  fulfillment: "FBA";
  expectedOldHash: string;
  previousUrls: readonly (string | null)[];
  requestedUrls: readonly (string | null)[];
  changedSlots: readonly ListingImageSlot[];
}>;

function exactUrlVector(value: unknown, length: number): value is readonly (string | null)[] {
  return Array.isArray(value) &&
    value.length === length &&
    value.every((url) => url === null || typeof url === "string");
}

function exactChangedSlots(
  value: unknown,
  previousUrls: readonly (string | null)[],
  requestedUrls: readonly (string | null)[],
): value is readonly ListingImageSlot[] {
  if (!Array.isArray(value) || value.length === 0 ||
      !value.every((slot) =>
        Number.isSafeInteger(slot) && slot >= 0 && slot < requestedUrls.length
      )) return false;
  const expected = requestedUrls.flatMap((url, index) =>
    url === previousUrls[index] ? [] : [index]
  );
  return value.length === expected.length &&
    value.every((slot, index) => slot === expected[index]);
}

export function imageWriteEvidence(
  result: ListingImageUpdateResult,
): ListingImageWriteEvidence | null {
  const raw = (result as ListingImageUpdateResult & {
    imageWriteEvidence?: unknown;
  }).imageWriteEvidence;
  // Version 1 receipts retain their original nine-slot bytes and hash. New
  // writes bind all ten slots; a later GET never invents a tenth legacy target.
  const length = isRecord(raw) && raw.version === 1 ? 9 : 10;
  if (!isRecord(raw) ||
      (raw.version !== 1 && raw.version !== 2) ||
      typeof raw.asin !== "string" ||
      !/^[A-Z0-9]{10}$/u.test(raw.asin) ||
      typeof raw.productType !== "string" ||
      !raw.productType ||
      raw.fulfillment !== "FBA" ||
      typeof raw.expectedOldHash !== "string" ||
      !/^[a-f0-9]{64}$/u.test(raw.expectedOldHash) ||
      !exactUrlVector(raw.previousUrls, length) ||
      !exactUrlVector(raw.requestedUrls, length) ||
      !exactChangedSlots(raw.changedSlots, raw.previousUrls, raw.requestedUrls) ||
      raw.expectedOldHash !== expectedOldHash(raw.previousUrls) ||
      !raw.requestedUrls[0]) {
    return null;
  }
  if (!exactUrlVector(result.previousUrls, length) ||
      !exactUrlVector(result.requestedUrls, length) ||
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

function validatedImageWriteResult(
  response: unknown,
  identity: Readonly<{ marketplaceId: string; sellerSku: string }>,
  mode: "live" | "demo",
  status: "ACCEPTED" | "SIMULATED",
): Readonly<{ result: ListingImageUpdateResult; asin: string; productType: string }> | null {
  if (!isRecord(response) || response.mode !== mode || response.status !== status ||
      response.marketplaceId !== identity.marketplaceId || response.sellerSku !== identity.sellerSku ||
      typeof response.completedAt !== "string" || !Number.isFinite(Date.parse(response.completedAt)) ||
      !(response.submissionId === null || typeof response.submissionId === "string") ||
      !(response.requestId === null || typeof response.requestId === "string") ||
      !Array.isArray(response.issues) || !response.issues.every(validReadbackIssue) || typeof response.notice !== "string") return null;
  const result = response as unknown as ListingImageUpdateResult;
  const evidence = imageWriteEvidence(result);
  if (!evidence || [...evidence.previousUrls, ...evidence.requestedUrls].some(url => {
    if (url === null) return false;
    try { const parsed = new URL(url); return parsed.protocol !== "https:" || Boolean(parsed.username || parsed.password || parsed.hash); }
    catch { return true; }
  })) return null;
  return { result, asin: evidence.asin, productType: evidence.productType };
}

/** Rebuilds only a validated accepted target; never derives one from a null/unknown receipt. */
export function recoverableImageWrite(
  response: unknown,
  identity: Readonly<{ marketplaceId: string; sellerSku: string }>,
): Readonly<{ result: ListingImageUpdateResult; asin: string; productType: string }> | null {
  return validatedImageWriteResult(response, identity, "live", "ACCEPTED");
}

/** Only an exact, complete simulation receipt can be excluded from live recovery. */
export function isSimulatedImageWrite(response: unknown, identity: Readonly<{ marketplaceId: string; sellerSku: string }>): boolean {
  return validatedImageWriteResult(response, identity, "demo", "SIMULATED") !== null;
}
