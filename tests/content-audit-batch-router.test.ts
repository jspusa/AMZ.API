import { createHash } from "node:crypto";
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
  SharedReportLease,
} from "../src/main/local-store";
import type { ApiRequest } from "../src/shared/contracts";

vi.mock("../src/main/amazon/sp-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/main/amazon/sp-api")>();
  return {
    ...actual,
    getFixedReportsDocumentText: vi.fn(async () => "synthetic all-listings document"),
  };
});

const MARKETPLACE_ID = "ATVPDKIKX0DER";
const ACCOUNT_SCOPE = "a".repeat(64);
const REPORT_LEASE_ID = "content-audit-batch-router";
const REPORT_HANDLE = `report-lease.${REPORT_LEASE_ID}`;
const DOCUMENT_HANDLE = `report-document.${REPORT_LEASE_ID}`;
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
      reportId: REPORT_HANDLE,
      documentId: DOCUMENT_HANDLE,
      audit: "1",
    },
    headers: {},
  };
}

function completedAllListingsLease(): SharedReportLease {
  const now = Date.now();
  return {
    leaseId: REPORT_LEASE_ID,
    accountScope: ACCOUNT_SCOPE,
    marketplaceId: MARKETPLACE_ID,
    mode: "demo",
    reportType: "GET_MERCHANT_LISTINGS_ALL_DATA",
    optionsKey: "preferredReportDocumentLocale=en_US",
    report: {
      reportId: "synthetic-all-listings-report",
      documentId: "synthetic-all-listings-document",
      status: "DONE",
      createdAt: now,
      terminal: null,
      terminalAt: null,
    },
    createdAt: now,
    updatedAt: now,
    expiresAt: Number.MAX_SAFE_INTEGER,
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
  reference: string,
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

function contentSnapshotDigest(input: {
  evidence: ContentAuditSnapshotEvidence;
  row: AuditReply["rows"][number];
  bulletPoints: string[];
  readStatus?: "complete" | "incomplete";
}): string {
  return createHash("sha256").update(JSON.stringify([
    "content-audit-snapshot-row-v1",
    input.evidence.accountScope,
    input.evidence.marketplaceId,
    input.evidence.mode,
    input.evidence.exportId,
    input.evidence.fetchedAt,
    input.row.sellerSku,
    input.row.asin,
    input.row.productType,
    input.row.variationRole === "standalone"
      ? "STANDALONE"
      : input.row.variationRole === "child" && input.row.variationFamilyKey
        ? input.row.variationFamilyKey
        : "DATA_INCOMPLETE",
    input.row.title,
    input.row.itemHighlight,
    input.bulletPoints,
    input.row.productDescription,
    input.row.ingredients,
    input.readStatus ?? "complete",
  ])).digest("hex");
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

function normalizeAllU2028ToLf(bytes: Uint8Array): Uint8Array {
  const archive = unzipSync(bytes);
  for (const [name, source] of Object.entries(archive)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/u.test(name)) continue;
    archive[name] = strToU8(strFromU8(source).replaceAll("&#x2028;", "\n"));
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
      getSharedReport: vi.fn(async () => completedAllListingsLease()),
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
    expect(responseValue(response)).toMatchObject({
      code: "CONTENT_UNCHANGED",
      message:
        "Excel 完整性核對通過；更新欄位與原始值相同，沒有需要預檢的變更。請只在「更新…」欄位填入新文案後再試。",
    });
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

  it("uniquely reconciles a legacy U+2028-normalized workbook through strict evidence", async () => {
    const snapshot = await audit();
    const sourceRow = snapshot.rows[0]!;
    const sourceBullet = `Line one\u2028Line two`;
    const bulletPoints = [...sourceRow.bulletPoints];
    bulletPoints[3] = sourceBullet;
    const sourceSnapshot: AuditReply = {
      ...snapshot,
      rows: [{ ...sourceRow, bulletPoints }],
    };
    const evidence = contentAuditEvidence.get(snapshot.exportId)!;
    evidence.rowDigests = [contentSnapshotDigest({
      evidence,
      row: sourceRow,
      bulletPoints,
    })];
    let legacy = workbook(sourceSnapshot);
    legacy = replaceCell(legacy, "N2", sourceBullet.replace("\u2028", "\n"));
    legacy = replaceCell(legacy, "O2", sourceBullet.replace("\u2028", "\n"));

    const noOp = await router.handle(
      importRequest(legacy, "content-batch-legacy-line-noop-001"),
    );
    expect(noOp.status).toBe(422);
    expect(responseValue(noOp)).toMatchObject({
      code: "CONTENT_UNCHANGED",
      message:
        "Excel 完整性核對通過；更新欄位與原始值相同，沒有需要預檢的變更。請只在「更新…」欄位填入新文案後再試。",
    });
    expect(approveWrite).not.toHaveBeenCalled();
    expect(runIdempotentOperation).not.toHaveBeenCalled();

    const editedRecoveredField = replaceCell(
      legacy,
      "O2",
      "Line one\nLine two edited",
    );
    const editedRecoveredReply = await router.handle(
      importRequest(
        editedRecoveredField,
        "content-batch-legacy-line-same-field-001",
      ),
    );
    expect(editedRecoveredReply.status).toBe(409);
    expect(responseValue(editedRecoveredReply)).toMatchObject({
      code: "WORKBOOK_REEXPORT_REQUIRED",
    });

    const edited = replaceCell(
      legacy,
      "E2",
      "Legacy-safe updated product title",
    );
    const preview = await router.handle(
      importRequest(edited, "content-batch-legacy-line-edit-001"),
    );
    expect(preview.status).toBe(422);
    expect(responseValue(preview)).toMatchObject({
      code: "CONTENT_BATCH_VALIDATION_FAILED",
      rows: [expect.objectContaining({ code: "CONTENT_CHANGED" })],
      writeCount: 0,
    });
    expect(approveWrite).not.toHaveBeenCalled();
    expect(runIdempotentOperation).not.toHaveBeenCalled();
  });

  it("applies a request-wide budget to legacy digest recovery", async () => {
    const snapshot = await audit();
    const selected = snapshot.rows.slice(0, 2);
    expect(selected).toHaveLength(2);
    const manySeparators = Array.from({ length: 61 }, () => "Line")
      .join("\u2028");
    const sourceRows = selected.map((row) => {
      const bulletPoints = [...row.bulletPoints];
      bulletPoints[3] = manySeparators;
      return { ...row, bulletPoints };
    });
    const evidence = contentAuditEvidence.get(snapshot.exportId)!;
    evidence.rowDigests = sourceRows.map((row) => contentSnapshotDigest({
      evidence,
      row,
      bulletPoints: row.bulletPoints,
    }));
    const sourceSnapshot: AuditReply = { ...snapshot, rows: sourceRows };
    const legacy = normalizeAllU2028ToLf(workbook(sourceSnapshot, 2));

    const response = await router.handle(
      importRequest(legacy, "content-batch-legacy-request-budget-001"),
    );
    expect(response.status).toBe(409);
    expect(responseValue(response)).toMatchObject({
      code: "WORKBOOK_REEXPORT_REQUIRED",
    });
    expect(approveWrite).not.toHaveBeenCalled();
    expect(runIdempotentOperation).not.toHaveBeenCalled();
  });

  it("fails closed when legacy line-break recovery is ambiguous or over budget", async () => {
    const snapshot = await audit();
    const sourceRow = snapshot.rows[0]!;
    const evidence = contentAuditEvidence.get(snapshot.exportId)!;
    const u2028Bullets = [...sourceRow.bulletPoints];
    const u0085Bullets = [...sourceRow.bulletPoints];
    u2028Bullets[3] = "Line one\u2028Line two";
    u0085Bullets[3] = "Line one\u0085Line two";
    evidence.rowDigests = [u2028Bullets, u0085Bullets].map((bulletPoints) =>
      contentSnapshotDigest({ evidence, row: sourceRow, bulletPoints }));
    const ambiguousSnapshot: AuditReply = {
      ...snapshot,
      rows: [{ ...sourceRow, bulletPoints: u2028Bullets }],
    };
    let ambiguous = workbook(ambiguousSnapshot);
    ambiguous = replaceCell(ambiguous, "N2", "Line one\nLine two");
    ambiguous = replaceCell(ambiguous, "O2", "Line one\nLine two");
    const ambiguousReply = await router.handle(
      importRequest(ambiguous, "content-batch-legacy-ambiguous-001"),
    );
    expect(ambiguousReply.status).toBe(409);
    expect(responseValue(ambiguousReply)).toMatchObject({
      code: "WORKBOOK_TAMPERED",
    });

    const manySeparators = Array.from({ length: 66 }, () => "Line")
      .join("\u2028");
    const overBudgetBullets = [...sourceRow.bulletPoints];
    overBudgetBullets[3] = manySeparators;
    evidence.rowDigests = [contentSnapshotDigest({
      evidence,
      row: sourceRow,
      bulletPoints: overBudgetBullets,
    })];
    const overBudgetSnapshot: AuditReply = {
      ...snapshot,
      rows: [{ ...sourceRow, bulletPoints: overBudgetBullets }],
    };
    let overBudget = workbook(overBudgetSnapshot);
    overBudget = replaceCell(
      overBudget,
      "N2",
      manySeparators.replaceAll("\u2028", "\n"),
    );
    overBudget = replaceCell(
      overBudget,
      "O2",
      manySeparators.replaceAll("\u2028", "\n"),
    );
    const overBudgetReply = await router.handle(
      importRequest(overBudget, "content-batch-legacy-budget-001"),
    );
    expect(overBudgetReply.status).toBe(409);
    expect(responseValue(overBudgetReply)).toMatchObject({
      code: "WORKBOOK_TAMPERED",
    });
    expect(approveWrite).not.toHaveBeenCalled();
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
