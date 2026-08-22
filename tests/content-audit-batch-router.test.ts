import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContentAuditWorkbookV2 } from "../src/main/amazon/xlsx";
import { SpApiError } from "../src/main/amazon/sp-api";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import type {
  ContentAuditSnapshotEvidence,
  ContentAuditSnapshotEvidenceInput,
  LocalStore,
} from "../src/main/local-store";
import type { ApiRequest } from "../src/shared/contracts";

const MARKETPLACE_ID = "ATVPDKIKX0DER";
const ACCOUNT_SCOPE = "a".repeat(64);
const MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const SP_ENV_KEYS = Object.keys(process.env).filter((key) =>
  key.startsWith("SP_API_"),
);
const savedEnvironment = new Map(
  SP_ENV_KEYS.map((key) => [key, process.env[key]]),
);

type AuditReply = {
  marketplaceId: string;
  fetchedAt: string;
  exportId: string;
  rows: Array<{
    sellerSku: string;
    asin: string;
    productType: string;
    title: string;
    itemHighlight: string;
    bulletPoints: string[];
    productDescription: string;
    ingredients: string;
    variationRole: string;
    variationParentSku: string | null;
    variationFamilyKey: string | null;
    variationTheme: string | null;
    issues: Array<{ field: string }>;
  }>;
};

function auditRequest(): ApiRequest {
  return {
    requestId: "content-batch-audit-001",
    method: "GET",
    path: "/api/sp-api/listing-content/export",
    query: {
      marketplaceId: MARKETPLACE_ID,
      reportId: `demo-${MARKETPLACE_ID}`,
      documentId: `demo-${MARKETPLACE_ID}`,
      audit: "1",
    },
    headers: {},
  };
}

function importRequest(
  bytes: Uint8Array,
  idempotencyKey: string,
): ApiRequest {
  return {
    requestId: `content-batch-import-${idempotencyKey}`,
    method: "POST",
    path: "/api/sp-api/listing-content/import",
    query: {},
    headers: {},
    body: {
      kind: "multipart",
      fields: { marketplaceId: MARKETPLACE_ID, idempotencyKey },
      file: { name: "content-audit.xlsx", type: MEDIA_TYPE, bytes },
    },
  };
}

function commitRequest(previewId: string, idempotencyKey: string): ApiRequest {
  return {
    requestId: `content-batch-commit-${idempotencyKey}`,
    method: "PATCH",
    path: "/api/sp-api/listing-content/import",
    query: {},
    headers: { "content-type": "application/json" },
    body: {
      kind: "json",
      value: { marketplaceId: MARKETPLACE_ID, previewId, idempotencyKey },
    },
  };
}

function responseValue(response: Awaited<ReturnType<ApiRouter["handle"]>>) {
  if (response.body.kind !== "json") throw new Error("Expected JSON response");
  return response.body.value as Record<string, unknown>;
}

function workbook(snapshot: AuditReply, rowCount = 1): Uint8Array {
  const selectedRows = snapshot.rows.slice(0, rowCount);
  if (selectedRows.length !== rowCount) {
    throw new Error("Demo audit returned too few editable rows");
  }
  return createContentAuditWorkbookV2({
    marketplaceId: snapshot.marketplaceId,
    marketplaceLabel: "US · Amazon.com",
    exportId: snapshot.exportId,
    fetchedAt: snapshot.fetchedAt,
    rows: selectedRows.map((row) => ({
        sellerSku: row.sellerSku,
        asin: row.asin,
        productType: row.productType,
        title: row.title,
        itemHighlight: row.itemHighlight,
        bulletPoints: row.bulletPoints,
        productDescription: row.productDescription,
        ingredients: row.ingredients,
        variationRole: row.variationRole,
        variationParentSku: row.variationParentSku ?? "",
        variationFamilyKey: row.variationFamilyKey ?? "",
        variationTheme: row.variationTheme ?? "",
        auditType: "測試問題",
        auditDescription: "測試 round trip",
      })),
  });
}

function replaceCell(
  bytes: Uint8Array,
  reference: "D2" | "E2",
  value: string,
): Uint8Array {
  const archive = unzipSync(bytes);
  const name = "xl/worksheets/sheet2.xml";
  const source = archive[name];
  if (!source) throw new Error("Missing data worksheet");
  const xml = strFromU8(source);
  const expression = new RegExp(`<c r="${reference}"[^>]*>.*?<\\/c>`, "su");
  if (!expression.test(xml)) throw new Error(`Missing ${reference}`);
  const escaped = value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  archive[name] = strToU8(xml.replace(
    expression,
    `<c r="${reference}" s="7" t="inlineStr"><is><t xml:space="preserve">${escaped}</t></is></c>`,
  ));
  return zipSync(archive, { level: 6 });
}

function replaceEveryProposedTitle(bytes: Uint8Array): Uint8Array {
  const archive = unzipSync(bytes);
  for (const [name, source] of Object.entries(archive)) {
    if (!/^xl\/worksheets\/sheet[2-9]\d*\.xml$/u.test(name)) continue;
    const xml = strFromU8(source);
    archive[name] = strToU8(xml.replace(
      /<c r="E(\d+)"[^>]*>.*?<\/c>/gsu,
      (cell, rowNumber: string) =>
        rowNumber === "1"
          ? cell
          : `<c r="E${rowNumber}" s="7" t="inlineStr"><is><t xml:space="preserve">Batch title ${rowNumber}</t></is></c>`,
    ));
  }
  return zipSync(archive, { level: 6 });
}

describe("content audit Excel batch router", () => {
  const contentAuditEvidence = new Map<
    string,
    ContentAuditSnapshotEvidence
  >();
  const approveWrite = vi.fn(async (_reason: string) => undefined);
  const assertIdempotentOperationsAvailable = vi.fn(async () => undefined);
  const runIdempotentOperation = vi.fn(async () => ({
    mode: "demo",
    status: "SIMULATED",
    marketplaceId: MARKETPLACE_ID,
    sellerSku: "demo",
  }));
  const saveContentAuditSnapshotEvidence = vi.fn(
    async (input: ContentAuditSnapshotEvidenceInput) => {
      const now = Date.now();
      const evidence: ContentAuditSnapshotEvidence = {
        ...input,
        schemaVersion: 1,
        rowDigests: [...input.rowDigests],
        createdAt: now,
        expiresAt: now + 24 * 60 * 60 * 1_000,
      };
      contentAuditEvidence.set(input.exportId, evidence);
      return structuredClone(evidence);
    },
  );
  const getContentAuditSnapshotEvidence = vi.fn(async (input: {
    exportId: string;
    accountScope: string;
    marketplaceId: string;
    mode: "live" | "demo";
    now?: number;
  }) => {
    const evidence = contentAuditEvidence.get(input.exportId);
    if (!evidence) return { status: "not-found" as const, evidence: null };
    if (evidence.expiresAt <= (input.now ?? Date.now())) {
      contentAuditEvidence.delete(input.exportId);
      return { status: "expired" as const, evidence: null };
    }
    if (evidence.marketplaceId !== input.marketplaceId) {
      return { status: "marketplace-changed" as const, evidence: null };
    }
    if (evidence.mode !== input.mode) {
      return { status: "mode-changed" as const, evidence: null };
    }
    if (evidence.accountScope !== input.accountScope) {
      return { status: "account-scope-changed" as const, evidence: null };
    }
    return { status: "available" as const, evidence: structuredClone(evidence) };
  });
  const router = new ApiRouter({
    store: {
      assertIdempotentOperationsAvailable,
      runIdempotentOperation,
      saveContentAuditSnapshotEvidence,
      getContentAuditSnapshotEvidence,
    } as unknown as LocalStore,
    vault: {
      getAccountScope: async () => ACCOUNT_SCOPE,
    } as unknown as CredentialVault,
    approveWrite,
  });

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    router.clearPreviews();
    contentAuditEvidence.clear();
    approveWrite.mockClear();
    assertIdempotentOperationsAvailable.mockClear();
    runIdempotentOperation.mockClear();
    saveContentAuditSnapshotEvidence.mockClear();
    getContentAuditSnapshotEvidence.mockClear();
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    for (const [key, value] of savedEnvironment) {
      if (value !== undefined) process.env[key] = value;
    }
  });

  async function audit(): Promise<AuditReply> {
    const response = await router.handle(auditRequest());
    expect(response.status).toBe(200);
    return responseValue(response) as unknown as AuditReply;
  }

  it("previews with zero writes, asks once, and returns cached batch result", async () => {
    const snapshot = await audit();
    const edited = replaceCell(
      workbook(snapshot),
      "E2",
      "Batch-safe updated product title",
    );
    const key = "content-batch-roundtrip-001";
    const preview = await router.handle(importRequest(edited, key));

    expect(preview.status).toBe(200);
    const previewBody = responseValue(preview);
    expect(previewBody).toMatchObject({ marketplaceId: MARKETPLACE_ID });
    expect(previewBody.changes).toEqual([
      expect.objectContaining({ changedFields: ["title"] }),
    ]);
    expect(approveWrite).not.toHaveBeenCalled();
    expect(runIdempotentOperation).not.toHaveBeenCalled();

    const previewId = String(previewBody.previewId);
    const commit = await router.handle(commitRequest(previewId, key));
    expect(commit.status).toBe(200);
    expect(responseValue(commit)).toMatchObject({
      status: "COMPLETED",
      rows: [expect.objectContaining({ state: "simulated" })],
    });
    expect(approveWrite).toHaveBeenCalledOnce();
    expect(assertIdempotentOperationsAvailable).toHaveBeenCalledOnce();
    expect(runIdempotentOperation).toHaveBeenCalledOnce();

    const repeated = await router.handle(commitRequest(previewId, key));
    expect(repeated.status).toBe(200);
    expect(responseValue(repeated)).toEqual(responseValue(commit));
    expect(approveWrite).toHaveBeenCalledOnce();
    expect(runIdempotentOperation).toHaveBeenCalledOnce();
  });

  it("rejects a no-op workbook without approval or a ledger claim", async () => {
    const snapshot = await audit();
    const response = await router.handle(
      importRequest(workbook(snapshot), "content-batch-noop-001"),
    );

    expect(response.status).toBe(422);
    expect(responseValue(response)).toMatchObject({ code: "CONTENT_UNCHANGED" });
    expect(approveWrite).not.toHaveBeenCalled();
    expect(assertIdempotentOperationsAvailable).not.toHaveBeenCalled();
    expect(runIdempotentOperation).not.toHaveBeenCalled();
  });

  it("rejects original-cell tampering before Amazon validation", async () => {
    const snapshot = await audit();
    const tampered = replaceCell(workbook(snapshot), "D2", "Tampered source");
    const response = await router.handle(
      importRequest(tampered, "content-batch-tamper-001"),
    );

    expect(response.status).toBe(409);
    expect(responseValue(response)).toMatchObject({ code: "WORKBOOK_TAMPERED" });
    expect(approveWrite).not.toHaveBeenCalled();
    expect(assertIdempotentOperationsAvailable).not.toHaveBeenCalled();
    expect(runIdempotentOperation).not.toHaveBeenCalled();
  });

  it("keeps the preview reusable after native approval is cancelled", async () => {
    const snapshot = await audit();
    const edited = replaceCell(
      workbook(snapshot),
      "E2",
      "Batch title after native cancellation",
    );
    const key = "content-batch-cancel-001";
    const preview = await router.handle(importRequest(edited, key));
    const previewId = String(responseValue(preview).previewId);
    approveWrite.mockRejectedValueOnce(new Error("userCancel"));

    const cancelled = await router.handle(commitRequest(previewId, key));
    expect(cancelled.status).toBe(409);
    expect(responseValue(cancelled)).toMatchObject({ code: "ACTION_CANCELLED" });
    expect(runIdempotentOperation).not.toHaveBeenCalled();

    const committed = await router.handle(commitRequest(previewId, key));
    expect(committed.status).toBe(200);
    expect(approveWrite).toHaveBeenCalledTimes(2);
    expect(runIdempotentOperation).toHaveBeenCalledOnce();
    expect(
      assertIdempotentOperationsAvailable.mock.invocationCallOrder[0],
    ).toBeLessThan(runIdempotentOperation.mock.invocationCallOrder[0]!);
  });

  it("stops later SKUs after an unknown result and does not blindly retry", async () => {
    const snapshot = await audit();
    const edited = replaceEveryProposedTitle(workbook(snapshot, 3));
    const key = "content-batch-unknown-001";
    const preview = await router.handle(importRequest(edited, key));
    expect(preview.status, JSON.stringify(responseValue(preview))).toBe(200);
    const previewId = String(responseValue(preview).previewId);
    runIdempotentOperation
      .mockImplementationOnce(async () => ({
        mode: "demo",
        status: "SIMULATED",
        marketplaceId: MARKETPLACE_ID,
        sellerSku: "first",
      }))
      .mockRejectedValueOnce(new SpApiError(
        "Amazon 寫入結果尚未確認。",
        { status: 503, code: "UPDATE_STATUS_UNKNOWN" },
      ));

    const response = await router.handle(commitRequest(previewId, key));
    expect(response.status).toBe(200);
    expect(responseValue(response)).toMatchObject({
      status: "STOPPED_UNKNOWN",
      rows: [
        expect.objectContaining({ state: "simulated" }),
        expect.objectContaining({ state: "unknown" }),
        expect.objectContaining({ state: "not-started" }),
      ],
    });
    expect(runIdempotentOperation).toHaveBeenCalledTimes(2);

    const repeated = await router.handle(commitRequest(previewId, key));
    expect(responseValue(repeated)).toEqual(responseValue(response));
    expect(runIdempotentOperation).toHaveBeenCalledTimes(2);
  });
});
