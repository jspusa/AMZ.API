import { describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

function get(path: string): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method: "GET",
    path,
    query: { deliberatelyInvalidLegacyQuery: "1" },
    headers: {},
  };
}

function post(path: string): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method: "POST",
    path,
    query: {},
    headers: {},
    body: {
      kind: "json",
      value: { deliberatelyInvalidLegacyBody: true },
    },
  };
}

function delegated(owner: "review" | "a-plus", operation: string): ApiResponse {
  return {
    status: 207,
    headers: { "x-r09-owner": owner, "x-r09-operation": operation },
    body: {
      kind: "json",
      value: { owner, operation },
    },
  };
}

describe("R09 long-running coordinator public seam", () => {
  it("delegates every Review and A+ route and clears both coordinators", async () => {
    const reviewStart = delegated("review", "start");
    const reviewObserve = delegated("review", "observe");
    const reviewDownload = delegated("review", "download");
    const aPlusStart = delegated("a-plus", "start");
    const aPlusObserve = delegated("a-plus", "observe");
    const reviewAuditCoordinator = {
      start: vi.fn(async () => reviewStart),
      observe: vi.fn(async () => reviewObserve),
      download: vi.fn(async () => reviewDownload),
      clear: vi.fn(),
    };
    const aPlusAuditCoordinator = {
      start: vi.fn(async () => aPlusStart),
      observe: vi.fn(async () => aPlusObserve),
      clear: vi.fn(),
    };
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      reviewAuditCoordinator,
      aPlusAuditCoordinator,
    } as unknown as ConstructorParameters<typeof ApiRouter>[0]);
    const reviewStartRequest = post("/api/sp-api/review-audit");
    const reviewObserveRequest = get("/api/sp-api/review-audit");
    const reviewDownloadRequest = get("/api/sp-api/review-audit/export");
    const aPlusStartRequest = post("/api/sp-api/a-plus-audit");
    const aPlusObserveRequest = get("/api/sp-api/a-plus-audit");

    const responses = await Promise.all([
      router.handle(reviewStartRequest),
      router.handle(reviewObserveRequest),
      router.handle(reviewDownloadRequest),
      router.handle(aPlusStartRequest),
      router.handle(aPlusObserveRequest),
    ]);
    router.dispose();

    expect(reviewAuditCoordinator.start).toHaveBeenCalledWith(reviewStartRequest);
    expect(reviewAuditCoordinator.observe).toHaveBeenCalledWith(
      reviewObserveRequest,
    );
    expect(reviewAuditCoordinator.download).toHaveBeenCalledWith(
      reviewDownloadRequest,
    );
    expect(aPlusAuditCoordinator.start).toHaveBeenCalledWith(aPlusStartRequest);
    expect(aPlusAuditCoordinator.observe).toHaveBeenCalledWith(
      aPlusObserveRequest,
    );
    expect(responses).toEqual([
      reviewStart,
      reviewObserve,
      reviewDownload,
      aPlusStart,
      aPlusObserve,
    ]);
    expect(reviewAuditCoordinator.clear).toHaveBeenCalledOnce();
    expect(aPlusAuditCoordinator.clear).toHaveBeenCalledOnce();
  });
});
