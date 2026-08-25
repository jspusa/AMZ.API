import type { ApiResponse } from "../shared/contracts";
import { publicSpApiError, SpApiError } from "./amazon/sp-api-error";

const JSON_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};

export function json(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
): ApiResponse {
  return {
    status,
    headers: { ...JSON_HEADERS, ...headers },
    body: { kind: "json", value },
  };
}

export function invalid(
  message: string,
  status = 400,
  code = "INVALID_INPUT",
): ApiResponse {
  return json({ code, message }, status);
}

export function routeError(error: unknown, fallback: string): ApiResponse {
  if (error instanceof SpApiError) {
    const publicError = publicSpApiError(error, fallback);
    return json(
      {
        code: publicError.code,
        message: publicError.message,
        requestId: publicError.requestId,
        issues: publicError.issues,
        operation: publicError.operation,
        upstreamCode: publicError.upstreamCode,
      },
      publicError.status,
      publicError.retryAfter ? { "retry-after": publicError.retryAfter } : {},
    );
  }
  return json({ code: "INTERNAL_ERROR", message: fallback }, 500);
}
