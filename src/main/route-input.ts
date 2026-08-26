import type { ApiRequest } from "../shared/contracts";
import {
  marketplaceById,
  type MarketplaceId,
} from "../shared/marketplaces";
import { isDateOnly } from "./amazon/marketplace-calendar";

export type JsonRecord = Record<string, unknown>;

export function isPlainRecord(value: unknown): value is JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function bodyRecord(request: ApiRequest): JsonRecord | null {
  return request.body?.kind === "json" && isPlainRecord(request.body.value)
    ? request.body.value
    : null;
}

export function parseMarketplace(value: unknown): MarketplaceId | null {
  return typeof value === "string" && marketplaceById(value)
    ? value as MarketplaceId
    : null;
}

export function parseSellerSku(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const sellerSku = value.trim();
  if (
    !sellerSku ||
    sellerSku.length > 40 ||
    /[\u0000-\u001f\u007f]/u.test(sellerSku)
  ) {
    return null;
  }
  return sellerSku;
}

export function parseAsin(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z0-9]{10}$/u.test(value)
    ? value
    : null;
}

export function reportIdentifier(value: unknown): string | null {
  // Amazon reportDocumentId values commonly use the `amzn1.spdoc...`
  // namespace, so a dot is expected and is not a path separator here.
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,200}$/u.test(value)
    ? value
    : null;
}

export function integer(
  value: unknown,
  fallback: number | null,
  minimum: number,
  maximum: number,
): number | null {
  if (
    (value === null || value === undefined || value === "") &&
    fallback !== null
  ) {
    return fallback;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

export function optionalInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  const parsed = integer(value, null, minimum, maximum);
  return parsed === null ? undefined : parsed;
}

export function optionalDate(
  value: unknown,
): string | null | undefined {
  if (value === null || value === "" || value === undefined) return null;
  return isDateOnly(value) ? value : undefined;
}

export function shortText(
  value: unknown,
  maximum: number,
): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const result = value.trim();
  if (
    !result ||
    result.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(result)
  ) {
    return undefined;
  }
  return result;
}

export function multiLineText(
  value: unknown,
  maximum: number,
): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const result = value.replace(/\r\n?/gu, "\n").trim();
  if (
    !result ||
    result.length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(result)
  ) {
    return undefined;
  }
  return result;
}
