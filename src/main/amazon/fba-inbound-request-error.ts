import { SpApiError } from "./sp-api-error";

export type FbaInboundRequestErrorBodyState = "parsed" | "empty" | "malformed" | "oversize" | "timed-out" | "unavailable" | "not-read";
export type FbaInboundRequestErrorCode = "BadRequest" | "InvalidInput" | "unknown";
export type FbaInboundRequestErrorReason = "legacy-v0-plan-unsupported" | "inbound-plan-unavailable" | "invalid-status" | "other-input" | "unknown";
export type FbaInboundRequestDiagnostic = Readonly<{
  state: FbaInboundRequestErrorBodyState;
  code: FbaInboundRequestErrorCode;
  reason: FbaInboundRequestErrorReason;
}>;

/** Fixed main-only evidence; raw upstream text never belongs in this seam. */
export class FbaInboundRequestError extends SpApiError {
  readonly requestDiagnostic: FbaInboundRequestDiagnostic;

  constructor(cause: SpApiError, diagnostic: FbaInboundRequestDiagnostic) {
    super(cause.message, cause);
    this.name = "FbaInboundRequestError";
    this.requestDiagnostic = Object.freeze({
      state: diagnostic.state,
      code: diagnostic.code,
      reason: diagnostic.reason,
    });
  }
}
