import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContentAuditWorkbookV2 } from "../src/main/amazon/xlsx";
import type { FixedReportBroker } from "../src/main/amazon/report-broker";
import { SpApiError } from "../src/main/amazon/sp-api";
import type {
  ListingContentUpdateResult,
  UpdateListingContentInput,
} from
  "../src/main/amazon/listing-content-types";
import {
  createScriptedSpExecutionContextAdapter,
  SpExecutionContextError,
  type SpExecutionContextAdapter,
} from
  "../src/main/amazon/sp-execution-context";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import { createListingContentBatchMutations } from
  "../src/main/listing-content-batch-mutations";
import type {
  ListingContentMutationsPort,
  ListingContentPreparedPreview,
} from
  "../src/main/listing-content-mutations";
import type {
  ContentAuditSnapshotEvidence,
  ContentAuditSnapshotEvidenceInput,
  LocalStore,
  SharedReportLease,
} from "../src/main/local-store";
import type { MainWriteGatePort } from "../src/main/write-gate";
import type { ApiRequest } from "../src/shared/contracts";

const MARKETPLACE_ID = "ATVPDKIKX0DER";
const ACCOUNT_SCOPE = "a".repeat(64);
const REPORT_LEASE_ID = "content-audit-batch-router";
const MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const SP_ENV_KEYS = Object.keys(process.env).filter((key) =>
  key.startsWith("SP_API_"),
);
const savedEnvironment = new Map(
  SP_ENV_KEYS.map((key) => [key, process.env[key]]),
);
const preparedIdentityBySku = new Map<
  string,
  Readonly<{ asin: string; productType: string }>
>();

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

function auditRequest(reportId: string, documentId: string): ApiRequest {
  return {
    requestId: "content-batch-audit-001",
    method: "GET",
    path: "/api/sp-api/listing-content/export",
    query: {
      marketplaceId: MARKETPLACE_ID,
      reportId,
      documentId,
      audit: "1",
    },
    headers: {},
  };
}

async function issuedAllListingsHandles(router: ApiRouter): Promise<{
  reportId: string;
  documentId: string;
}> {
  const broker = (router as unknown as { reportBroker: FixedReportBroker })
    .reportBroker;
  const leg = await broker.projectDurableLeg({
    intent: "all-listings",
    marketplaceId: MARKETPLACE_ID,
  });
  if (!leg?.reportId || !leg.documentId) {
    throw new Error("Expected broker-issued completed All Listings handles");
  }
  return { reportId: leg.reportId, documentId: leg.documentId };
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

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJsonValue(entry)]),
    );
  }
  return value;
}

function canonicalSha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalJsonValue(value)))
    .digest("hex");
}

function preparedPreview(
  input: UpdateListingContentInput,
  identity?: Readonly<{
    asin: string;
    productType: string;
  }>,
): ListingContentPreparedPreview {
  const resolvedIdentity = identity ?? preparedIdentityBySku.get(input.sellerSku) ??
    { asin: "B000000001", productType: "PET_FOOD" };
  const previous = {
    title: input.expectedTitle,
    itemHighlight: input.expectedItemHighlight,
    bulletPoints: [...input.expectedBulletPoints],
    productDescription: input.expectedProductDescription,
    ingredients: input.expectedIngredients,
  };
  const requested = {
    title: input.title,
    itemHighlight: input.itemHighlight,
    bulletPoints: [...input.bulletPoints],
    productDescription: input.productDescription,
    ingredients: input.ingredients,
  };
  const changedFields = ["title" as const];
  const evidence = {
    version: 1 as const,
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    asin: resolvedIdentity.asin,
    productType: resolvedIdentity.productType,
    languageTag: "en_US",
    fulfillment: "FBA" as const,
    expectedOldHash: canonicalSha256(previous),
    rawContentGuardHash: "2".repeat(64),
    capabilityGuardHash: "3".repeat(64),
    fbaEvidenceHash: "4".repeat(64),
    schemaChecksum: "schema-v1",
    canonicalPatchHash: "5".repeat(64),
    validationIssuesHash: canonicalSha256([]),
    changedFields,
  };
  return {
    mode: "demo",
    status: "SIMULATED",
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    previous,
    requested,
    changedFields,
    validatedAt: new Date(0).toISOString(),
    issues: [],
    notice: "test-only demo preview",
    proposalFingerprint: canonicalSha256([
      evidence.marketplaceId,
      evidence.sellerSku,
      previous.title,
      previous.itemHighlight,
      previous.bulletPoints,
      previous.productDescription,
      previous.ingredients,
      requested.title,
      requested.itemHighlight,
      requested.bulletPoints,
      requested.productDescription,
      requested.ingredients,
      evidence.changedFields,
      evidence.asin,
      evidence.productType,
      evidence.languageTag,
      evidence.fulfillment,
      evidence.expectedOldHash,
      evidence.rawContentGuardHash,
      evidence.capabilityGuardHash,
      evidence.fbaEvidenceHash,
      evidence.schemaChecksum,
      evidence.canonicalPatchHash,
      evidence.validationIssuesHash,
    ]),
    evidence,
  };
}

function simulatedUpdateResult(
  input: UpdateListingContentInput,
): ListingContentUpdateResult {
  const preview = preparedPreview(input);
  return {
    mode: "demo",
    status: "SIMULATED",
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    previous: structuredClone(preview.previous),
    requested: structuredClone(preview.requested),
    changedFields: [...preview.changedFields],
    acceptedAt: new Date(0).toISOString(),
    submissionId: null,
    requestId: null,
    issues: [],
    notice: "test-only simulated update",
  };
}

function responseValue(response: Awaited<ReturnType<ApiRouter["handle"]>>) {
  if (response.body.kind !== "json") throw new Error("Expected JSON response");
  return response.body.value as Record<string, unknown>;
}

function nestedObjectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(nestedObjectKeys);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, entry]) => [
    key,
    ...nestedObjectKeys(entry),
  ]);
}

function expectNoPrivateBatchKeys(value: unknown): void {
  const forbidden = nestedObjectKeys(value).filter((key) =>
    /^(?:_writeEvidence|evidence|proposalFingerprint|accountScope|generation|ownerToken|expectedOldHash|rawContentGuardHash|capabilityGuardHash|fbaEvidenceHash|schemaChecksum|canonicalPatchHash|validationIssuesHash)$/u
      .test(key)
  );
  expect(forbidden).toEqual([]);
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

function replaceEveryProposedTitle(
  bytes: Uint8Array,
  prefix = "Batch title",
): Uint8Array {
  const archive = unzipSync(bytes);
  for (const [name, source] of Object.entries(archive)) {
    if (!/^xl\/worksheets\/sheet[2-9]\d*\.xml$/u.test(name)) continue;
    const xml = strFromU8(source);
    archive[name] = strToU8(xml.replace(
      /<c r="E(\d+)"[^>]*>.*?<\/c>/gsu,
      (cell, rowNumber: string) =>
        rowNumber === "1"
          ? cell
          : `<c r="E${rowNumber}" s="7" t="inlineStr"><is><t xml:space="preserve">${prefix} ${rowNumber}</t></is></c>`,
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
  type MockIdempotentResult = Record<string, unknown> & Readonly<{
    mode: string;
    status: string;
    marketplaceId: string;
    sellerSku: string;
  }>;

  const runPreparedIdempotentOperation = async (
    rawInput: unknown,
  ): Promise<MockIdempotentResult> => {
    const input = rawInput as Readonly<{
      execute(control: Readonly<{
        recordAccepted(response: MockIdempotentResult): Promise<void>;
      }>): Promise<MockIdempotentResult>;
    }>;
    return input.execute({ recordAccepted: async () => undefined });
  };

  const contentAuditEvidence = new Map<
    string,
    ContentAuditSnapshotEvidence
  >();
  const approveWrite = vi.fn(async (_reason: string) => undefined);
  const assertIdempotentOperationsAvailable = vi.fn(async () => undefined);
  const runIdempotentOperation = vi.fn(runPreparedIdempotentOperation);
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
  const createRouter = () => new ApiRouter({
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
  let router: ApiRouter;
  let reportHandle: string;
  let documentHandle: string;

  beforeEach(async () => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    contentAuditEvidence.clear();
    preparedIdentityBySku.clear();
    approveWrite.mockClear();
    assertIdempotentOperationsAvailable.mockClear();
    runIdempotentOperation.mockReset();
    runIdempotentOperation.mockImplementation(runPreparedIdempotentOperation);
    saveContentAuditSnapshotEvidence.mockClear();
    getContentAuditSnapshotEvidence.mockClear();
    router = createRouter();
    ({ reportId: reportHandle, documentId: documentHandle } =
      await issuedAllListingsHandles(router));
  });

  afterEach(() => {
    router.dispose();
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    for (const [key, value] of savedEnvironment) {
      if (value !== undefined) process.env[key] = value;
    }
  });

  async function audit(): Promise<AuditReply> {
    const response = await router.handle(auditRequest(reportHandle, documentHandle));
    expect(response.status).toBe(200);
    const snapshot = responseValue(response) as unknown as AuditReply;
    for (const row of snapshot.rows) {
      preparedIdentityBySku.set(row.sellerSku, {
        asin: row.asin,
        productType: row.productType,
      });
    }
    return snapshot;
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
    expectNoPrivateBatchKeys(previewBody);
    expect(approveWrite).not.toHaveBeenCalled();
    expect(runIdempotentOperation).not.toHaveBeenCalled();

    const previewId = String(previewBody.previewId);
    runIdempotentOperation.mockImplementationOnce(async (rawInput) => {
      const input = rawInput as Readonly<{
        execute(control: Readonly<{
          recordAccepted(response: MockIdempotentResult): Promise<void>;
        }>): Promise<MockIdempotentResult>;
      }>;
      const rawResult = await input.execute({
        recordAccepted: async () => undefined,
      });
      expect(rawResult).toHaveProperty("_writeEvidence");
      return rawResult;
    });
    const commit = await router.handle(commitRequest(previewId, key));
    expect(commit.status).toBe(200);
    const commitBody = responseValue(commit) as unknown as {
      status: string;
      rows: Array<{
        state: string;
        result: {
          sellerSku: string;
          requested: { title: string };
        } | null;
      }>;
    };
    expect(commitBody).toMatchObject({
      status: "COMPLETED",
      rows: [expect.objectContaining({ state: "simulated" })],
    });
    expectNoPrivateBatchKeys(commitBody);
    expect(approveWrite).toHaveBeenCalledOnce();
    expect(assertIdempotentOperationsAvailable).toHaveBeenCalledOnce();
    expect(runIdempotentOperation).toHaveBeenCalledOnce();
    const pristine = structuredClone(commitBody);
    const exposedResult = commitBody.rows[0]!.result!;
    exposedResult.sellerSku = "CALLER-POISONED-SKU";
    exposedResult.requested.title = "caller-poisoned terminal title";

    const repeated = await router.handle(commitRequest(previewId, key));
    expect(repeated.status).toBe(200);
    const repeatedBody = responseValue(repeated) as unknown as typeof commitBody;
    expect(repeatedBody).toEqual(pristine);
    expect(repeatedBody.rows[0]!.result).not.toBe(exposedResult);
    expect(approveWrite).toHaveBeenCalledOnce();
    expect(runIdempotentOperation).toHaveBeenCalledOnce();
  });

  it("does not expose main-owned preview values through nested references", async () => {
    const snapshot = await audit();
    const edited = replaceCell(
      workbook(snapshot),
      "E2",
      "Reference-isolated preview title",
    );
    const key = "content-batch-preview-isolation-001";
    const request = importRequest(edited, key);
    const first = await router.handle(request);
    expect(first.status).toBe(200);
    const firstBody = responseValue(first) as unknown as {
      previewId: string;
      changes: Array<{
        changedFields: string[];
        previous: { title: string };
        requested: { title: string; bulletPoints: string[] };
        issues: unknown[];
      }>;
    };
    const pristine = structuredClone(firstBody.changes);
    const exposed = firstBody.changes[0]!;
    exposed.changedFields[0] = "ingredients";
    exposed.previous.title = "caller-poisoned previous";
    exposed.requested.title = "caller-poisoned requested";
    exposed.requested.bulletPoints[0] = "caller-poisoned bullet";

    const repeated = await router.handle(request);
    const repeatedBody = responseValue(repeated) as unknown as typeof firstBody;

    expect(repeated.status).toBe(200);
    expect(repeatedBody.previewId).toBe(firstBody.previewId);
    expect(repeatedBody.changes).toEqual(pristine);
    expect(repeatedBody.changes).not.toBe(firstBody.changes);
    expect(repeatedBody.changes[0]).not.toBe(exposed);
    expect(repeatedBody.changes[0]!.previous).not.toBe(exposed.previous);
    expect(repeatedBody.changes[0]!.requested).not.toBe(exposed.requested);
    expect(approveWrite).not.toHaveBeenCalled();
    expect(runIdempotentOperation).not.toHaveBeenCalled();
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

  it("uses the central Write Gate verification code in the one batch approval", async () => {
    const snapshot = await audit();
    const edited = replaceCell(
      workbook(snapshot),
      "E2",
      "Gate-owned verification code title",
    );
    let approvalReasonKind = "not-called";
    let approvalReason = "";
    const writeGate = {
      stagePreview: vi.fn(async () => undefined),
      execute: vi.fn(async (input) => {
        await input.beforeApproval?.();
        approvalReasonKind = typeof input.approvalReason;
        approvalReason = typeof input.approvalReason === "function"
          ? input.approvalReason("gate-owned-123")
          : input.approvalReason;
        return {
          previewId: input.binding.previewKey,
          marketplaceId: MARKETPLACE_ID,
          status: "COMPLETED",
          rows: [],
          completedAt: new Date(0).toISOString(),
          notice: "test",
        };
      }),
      reconcile: vi.fn(async () => undefined),
      clearEphemeral: vi.fn(),
    } as unknown as MainWriteGatePort;
    const gateRouter = new ApiRouter({
      store: {
        saveContentAuditSnapshotEvidence,
        getContentAuditSnapshotEvidence,
        getSharedReport: vi.fn(async () => completedAllListingsLease()),
      } as unknown as LocalStore,
      vault: {
        getAccountScope: async () => ACCOUNT_SCOPE,
      } as unknown as CredentialVault,
      approveWrite,
      writeGate,
    });
    const key = "content-batch-gate-code-001";
    const preview = await gateRouter.handle(importRequest(edited, key));
    expect(preview.status).toBe(200);

    const response = await gateRouter.handle(commitRequest(
      String(responseValue(preview).previewId),
      key,
    ));

    expect(response.status).toBe(200);
    expect(approvalReasonKind).toBe("function");
    expect(approvalReason).toContain("驗證碼 gate-owned-123");
    gateRouter.dispose();
  });

  it("fresh-previews every SKU before one approval and the first attempt", async () => {
    const snapshot = await audit();
    const edited = replaceEveryProposedTitle(
      workbook(snapshot, 3),
      "Full-batch preflight title",
    );
    const events: string[] = [];
    const localApproveWrite = vi.fn(async () => {
      events.push("approval");
    });
    const content = {
      handle: vi.fn(async () => {
        throw new Error("Single-SKU route is outside this batch test.");
      }),
      readOne: vi.fn(async () => {
        throw new Error("Read route is outside this batch test.");
      }),
      previewOne: vi.fn(async (input: UpdateListingContentInput) => {
        events.push(`preview:${input.sellerSku}`);
        return preparedPreview(input);
      }),
      attemptOne: vi.fn(async (
        input: UpdateListingContentInput,
        _evidence: ListingContentPreparedPreview["evidence"],
        session: Parameters<ListingContentMutationsPort["attemptOne"]>[2],
        intentId: string,
      ) => {
        events.push(`attempt:${input.sellerSku}`);
        return session.attempt<ListingContentUpdateResult>({
          intentId,
          execute: async ({ recordAccepted }) => {
            const result = simulatedUpdateResult(input);
            await recordAccepted(result);
            return result;
          },
        });
      }),
    } satisfies ListingContentMutationsPort;
    const integrationRouter = new ApiRouter({
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
      approveWrite: localApproveWrite,
      listingContentMutations: content,
    });
    const key = "content-batch-full-preflight-001";
    const preview = await integrationRouter.handle(importRequest(edited, key));
    expect(preview.status).toBe(200);
    const sellerSkus = (
      responseValue(preview).changes as Array<{ sellerSku: string }>
    ).map((change) => change.sellerSku);
    expect(sellerSkus).toHaveLength(3);
    events.length = 0;

    const response = await integrationRouter.handle(commitRequest(
      String(responseValue(preview).previewId),
      key,
    ));
    integrationRouter.dispose();

    expect(response.status).toBe(200);
    expect(responseValue(response)).toMatchObject({ status: "COMPLETED" });
    expect(events).toEqual([
      ...sellerSkus.map((sellerSku) => `preview:${sellerSku}`),
      "approval",
      ...sellerSkus.map((sellerSku) => `attempt:${sellerSku}`),
    ]);
    expect(localApproveWrite).toHaveBeenCalledOnce();
    expect(assertIdempotentOperationsAvailable).toHaveBeenCalledOnce();
    expect(runIdempotentOperation).toHaveBeenCalledTimes(3);
  });

  it("does not stage a plan when snapshot evidence expires during preview", async () => {
    const snapshot = await audit();
    const edited = replaceCell(
      workbook(snapshot),
      "E2",
      "Snapshot must remain live through staging",
    );
    const stored = structuredClone(contentAuditEvidence.get(snapshot.exportId)!);
    let now = 1_800_000_000_000;
    stored.createdAt = now - 1_000;
    stored.expiresAt = now + 1;
    const stagePreview = vi.fn(async () => undefined);
    const batch = createListingContentBatchMutations({
      evidence: {
        getContentAuditSnapshotEvidence: vi.fn(async () => ({
          status: "available" as const,
          evidence: structuredClone(stored),
        })),
      },
      context: createScriptedSpExecutionContextAdapter((marketplaceId) => ({
        marketplaceId,
        mode: "demo",
        accountScope: ACCOUNT_SCOPE,
      })),
      writeGate: {
        stagePreview,
        execute: vi.fn(),
        reconcile: vi.fn(async () => undefined),
        clearEphemeral: vi.fn(),
      } as unknown as MainWriteGatePort,
      content: {
        previewOne: vi.fn(async (input) => {
          now = stored.expiresAt;
          return preparedPreview(input);
        }),
        attemptOne: vi.fn(),
      },
      now: () => now,
      randomUUID: () => "content-batch-expired-during-preview",
    });

    const response = await batch.handle({
      operation: "preview",
      request: importRequest(edited, "content-batch-expired-during-preview-001"),
    });

    expect(response.status).toBe(410);
    expect(responseValue(response)).toMatchObject({ code: "SNAPSHOT_EXPIRED" });
    expect(stagePreview).not.toHaveBeenCalled();
  });

  it("does not publish a plan when snapshot evidence expires while staging", async () => {
    const snapshot = await audit();
    const edited = replaceCell(
      workbook(snapshot),
      "E2",
      "Snapshot must remain live after staging",
    );
    const stored = structuredClone(contentAuditEvidence.get(snapshot.exportId)!);
    let now = 1_800_000_000_000;
    stored.createdAt = now - 1_000;
    stored.expiresAt = now + 1;
    const stagePreview = vi.fn(async () => {
      now = stored.expiresAt;
    });
    const batch = createListingContentBatchMutations({
      evidence: {
        getContentAuditSnapshotEvidence: vi.fn(async () => ({
          status: "available" as const,
          evidence: structuredClone(stored),
        })),
      },
      context: createScriptedSpExecutionContextAdapter((marketplaceId) => ({
        marketplaceId,
        mode: "demo",
        accountScope: ACCOUNT_SCOPE,
      })),
      writeGate: {
        stagePreview,
        execute: vi.fn(),
        reconcile: vi.fn(async () => undefined),
        clearEphemeral: vi.fn(),
      } as unknown as MainWriteGatePort,
      content: {
        previewOne: vi.fn(async (input) => preparedPreview(input)),
        attemptOne: vi.fn(),
      },
      now: () => now,
      randomUUID: () => "content-batch-expired-while-staging",
    });

    const response = await batch.handle({
      operation: "preview",
      request: importRequest(edited, "content-batch-expired-staging-001"),
    });

    expect(response.status).toBe(410);
    expect(responseValue(response)).toMatchObject({ code: "PREVIEW_EXPIRED" });
    expect(stagePreview).toHaveBeenCalledOnce();
  });

  it("never extends the main-owned snapshot evidence TTL", async () => {
    const snapshot = await audit();
    const edited = replaceCell(
      workbook(snapshot),
      "E2",
      "Evidence TTL constrained title",
    );
    const stored = structuredClone(contentAuditEvidence.get(snapshot.exportId)!);
    let now = 1_800_000_000_000;
    stored.createdAt = now - 1_000;
    stored.expiresAt = now + 1;
    const execute = vi.fn(async (input) => ({
      previewId: input.binding.previewKey,
      marketplaceId: MARKETPLACE_ID,
      status: "COMPLETED",
      rows: [],
      completedAt: new Date(now).toISOString(),
      notice: "should not execute",
    }));
    const batch = createListingContentBatchMutations({
      evidence: {
        getContentAuditSnapshotEvidence: vi.fn(async () => ({
          status: "available" as const,
          evidence: structuredClone(stored),
        })),
      },
      context: createScriptedSpExecutionContextAdapter((marketplaceId) => ({
        marketplaceId,
        mode: "demo",
        accountScope: ACCOUNT_SCOPE,
      })),
      writeGate: {
        stagePreview: vi.fn(async () => undefined),
        execute,
        reconcile: vi.fn(async () => undefined),
        clearEphemeral: vi.fn(),
      } as unknown as MainWriteGatePort,
      content: {
        previewOne: vi.fn(async (input) => preparedPreview(input)),
        attemptOne: vi.fn(),
      },
      now: () => now,
      randomUUID: () => "content-batch-evidence-ttl-preview",
    });
    const key = "content-batch-evidence-ttl-001";
    const preview = await batch.handle({
      operation: "preview",
      request: importRequest(edited, key),
    });
    expect(preview.status).toBe(200);
    now = stored.expiresAt;

    const response = await batch.handle({
      operation: "commit",
      request: commitRequest(
        String(responseValue(preview).previewId),
        key,
      ),
    });

    expect(response.status).toBe(410);
    expect(responseValue(response)).toMatchObject({ code: "PREVIEW_EXPIRED" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not begin SKU attempts if the snapshot expires around approval", async () => {
    const snapshot = await audit();
    const edited = replaceCell(
      workbook(snapshot),
      "E2",
      "Expired approval must remain zero-write",
    );
    const stored = structuredClone(contentAuditEvidence.get(snapshot.exportId)!);
    let now = 1_800_000_000_000;
    stored.createdAt = now - 1_000;
    stored.expiresAt = now + 100;
    const attemptOne = vi.fn(async (input: UpdateListingContentInput) =>
      simulatedUpdateResult(input));
    const batch = createListingContentBatchMutations({
      evidence: {
        getContentAuditSnapshotEvidence: vi.fn(async () => ({
          status: "available" as const,
          evidence: structuredClone(stored),
        })),
      },
      context: createScriptedSpExecutionContextAdapter((marketplaceId) => ({
        marketplaceId,
        mode: "demo",
        accountScope: ACCOUNT_SCOPE,
      })),
      writeGate: {
        stagePreview: vi.fn(async () => undefined),
        execute: vi.fn(async (input) => {
          await input.beforeApproval?.();
          now = stored.expiresAt;
          return input.run({} as never);
        }),
        reconcile: vi.fn(async () => undefined),
        clearEphemeral: vi.fn(),
      } as unknown as MainWriteGatePort,
      content: {
        previewOne: vi.fn(async (input) => preparedPreview(input)),
        attemptOne,
      },
      now: () => now,
      randomUUID: () => "content-batch-expired-at-approval",
    });
    const key = "content-batch-expired-at-approval-001";
    const preview = await batch.handle({
      operation: "preview",
      request: importRequest(edited, key),
    });
    expect(preview.status).toBe(200);

    const response = await batch.handle({
      operation: "commit",
      request: commitRequest(String(responseValue(preview).previewId), key),
    });

    expect(response.status).toBe(410);
    expect(responseValue(response)).toMatchObject({ code: "PREVIEW_EXPIRED" });
    expect(attemptOne).not.toHaveBeenCalled();
  });

  it("does not let a second commit delete an expired in-flight plan", async () => {
    const snapshot = await audit();
    const edited = replaceCell(
      workbook(snapshot),
      "E2",
      "In-flight plan retains lifecycle ownership",
    );
    const stored = structuredClone(contentAuditEvidence.get(snapshot.exportId)!);
    let now = 1_800_000_000_000;
    stored.createdAt = now - 1_000;
    stored.expiresAt = now + 100;
    let enterExecute!: () => void;
    const executeEntered = new Promise<void>((resolve) => {
      enterExecute = resolve;
    });
    let releaseExecute!: () => void;
    const executeReleased = new Promise<void>((resolve) => {
      releaseExecute = resolve;
    });
    const batch = createListingContentBatchMutations({
      evidence: {
        getContentAuditSnapshotEvidence: vi.fn(async () => ({
          status: "available" as const,
          evidence: structuredClone(stored),
        })),
      },
      context: createScriptedSpExecutionContextAdapter((marketplaceId) => ({
        marketplaceId,
        mode: "demo",
        accountScope: ACCOUNT_SCOPE,
      })),
      writeGate: {
        stagePreview: vi.fn(async () => undefined),
        execute: vi.fn(async (input) => {
          enterExecute();
          await executeReleased;
          return {
            previewId: input.binding.previewKey,
            marketplaceId: MARKETPLACE_ID,
            status: "COMPLETED",
            rows: [],
            completedAt: new Date(now).toISOString(),
            notice: "test-only completed result",
          };
        }),
        reconcile: vi.fn(async () => undefined),
        clearEphemeral: vi.fn(),
      } as unknown as MainWriteGatePort,
      content: {
        previewOne: vi.fn(async (input) => preparedPreview(input)),
        attemptOne: vi.fn(),
      },
      now: () => now,
      randomUUID: () => "content-batch-expired-in-flight",
    });
    const key = "content-batch-expired-in-flight-001";
    const preview = await batch.handle({
      operation: "preview",
      request: importRequest(edited, key),
    });
    const previewId = String(responseValue(preview).previewId);
    const firstPending = batch.handle({
      operation: "commit",
      request: commitRequest(previewId, key),
    });
    await executeEntered;
    now = stored.expiresAt;

    const second = await batch.handle({
      operation: "commit",
      request: commitRequest(previewId, key),
    });
    releaseExecute();
    await firstPending;

    expect(second.status).toBe(409);
    expect(responseValue(second)).toMatchObject({
      code: "OPERATION_IN_PROGRESS",
    });
  });

  it("replays a completed result after the authorization TTL elapses", async () => {
    const snapshot = await audit();
    const edited = replaceCell(
      workbook(snapshot),
      "E2",
      "Completed result retains bounded replay",
    );
    const stored = structuredClone(contentAuditEvidence.get(snapshot.exportId)!);
    let now = 1_800_000_000_000;
    stored.createdAt = now - 1_000;
    stored.expiresAt = now + 100;
    const attemptOne = vi.fn(async (input: UpdateListingContentInput) => {
      now = stored.expiresAt + 1;
      return simulatedUpdateResult(input);
    });
    const execute = vi.fn(async (input) => {
      await input.beforeApproval?.();
      return input.run({} as never);
    });
    const batch = createListingContentBatchMutations({
      evidence: {
        getContentAuditSnapshotEvidence: vi.fn(async () => ({
          status: "available" as const,
          evidence: structuredClone(stored),
        })),
      },
      context: createScriptedSpExecutionContextAdapter((marketplaceId) => ({
        marketplaceId,
        mode: "demo",
        accountScope: ACCOUNT_SCOPE,
      })),
      writeGate: {
        stagePreview: vi.fn(async () => undefined),
        execute,
        reconcile: vi.fn(async () => undefined),
        clearEphemeral: vi.fn(),
      } as unknown as MainWriteGatePort,
      content: {
        previewOne: vi.fn(async (input) => preparedPreview(input)),
        attemptOne,
      },
      now: () => now,
      randomUUID: () => "content-batch-completed-retention",
    });
    const key = "content-batch-completed-retention-001";
    const preview = await batch.handle({
      operation: "preview",
      request: importRequest(edited, key),
    });
    const request = commitRequest(String(responseValue(preview).previewId), key);

    const first = await batch.handle({ operation: "commit", request });
    const replay = await batch.handle({ operation: "commit", request });

    expect(first.status).toBe(200);
    expect(responseValue(replay)).toEqual(responseValue(first));
    expect(execute).toHaveBeenCalledOnce();
    expect(attemptOne).toHaveBeenCalledOnce();
  });

  it("does not resurrect a preview plan after the batch owner is cleared", async () => {
    const snapshot = await audit();
    const edited = replaceCell(
      workbook(snapshot),
      "E2",
      "Late preview must not resurrect",
    );
    const stored = structuredClone(contentAuditEvidence.get(snapshot.exportId)!);
    let releasePreview!: () => void;
    const previewReleased = new Promise<void>((resolve) => {
      releasePreview = resolve;
    });
    let enterPreview!: () => void;
    const previewEntered = new Promise<void>((resolve) => {
      enterPreview = resolve;
    });
    const stagePreview = vi.fn(async () => undefined);
    const execute = vi.fn();
    const batch = createListingContentBatchMutations({
      evidence: {
        getContentAuditSnapshotEvidence: vi.fn(async () => ({
          status: "available" as const,
          evidence: structuredClone(stored),
        })),
      },
      context: createScriptedSpExecutionContextAdapter((marketplaceId) => ({
        marketplaceId,
        mode: "demo",
        accountScope: ACCOUNT_SCOPE,
      })),
      writeGate: {
        stagePreview,
        execute,
        reconcile: vi.fn(async () => undefined),
        clearEphemeral: vi.fn(),
      } as unknown as MainWriteGatePort,
      content: {
        previewOne: vi.fn(async (input) => {
          enterPreview();
          await previewReleased;
          return preparedPreview(input);
        }),
        attemptOne: vi.fn(),
      },
      randomUUID: () => "content-batch-late-preview",
    });
    const key = "content-batch-late-preview-001";
    const pending = batch.handle({
      operation: "preview",
      request: importRequest(edited, key),
    });
    await previewEntered;
    batch.clear();
    releasePreview();

    const response = await pending;

    expect(response.status).toBe(409);
    expect(responseValue(response)).toMatchObject({
      code: "SP_CONTEXT_INVALIDATED",
    });
    expect(stagePreview).not.toHaveBeenCalled();
    const repeated = await batch.handle({
      operation: "commit",
      request: commitRequest("content-batch-late-preview", key),
    });
    expect(repeated.status).toBe(410);
    expect(execute).not.toHaveBeenCalled();
  });

  it("reserves one scoped plan build for concurrent previews with the same key", async () => {
    const snapshot = await audit();
    const firstWorkbook = replaceCell(
      workbook(snapshot),
      "E2",
      "Concurrent first workbook title",
    );
    const secondWorkbook = replaceCell(
      workbook(snapshot),
      "E2",
      "Concurrent second workbook title",
    );
    const stored = structuredClone(contentAuditEvidence.get(snapshot.exportId)!);
    let enterFirstStage!: () => void;
    const firstStageEntered = new Promise<void>((resolve) => {
      enterFirstStage = resolve;
    });
    let releaseFirstStage!: () => void;
    const firstStageReleased = new Promise<void>((resolve) => {
      releaseFirstStage = resolve;
    });
    let stageCalls = 0;
    const stagePreview = vi.fn(async () => {
      stageCalls += 1;
      if (stageCalls !== 1) return;
      enterFirstStage();
      await firstStageReleased;
    });
    let nextPreviewId = 0;
    const batch = createListingContentBatchMutations({
      evidence: {
        getContentAuditSnapshotEvidence: vi.fn(async () => ({
          status: "available" as const,
          evidence: structuredClone(stored),
        })),
      },
      context: createScriptedSpExecutionContextAdapter((marketplaceId) => ({
        marketplaceId,
        mode: "demo",
        accountScope: ACCOUNT_SCOPE,
      })),
      writeGate: {
        stagePreview,
        execute: vi.fn(),
        reconcile: vi.fn(async () => undefined),
        clearEphemeral: vi.fn(),
      } as unknown as MainWriteGatePort,
      content: {
        previewOne: vi.fn(async (input) => preparedPreview(input)),
        attemptOne: vi.fn(),
      },
      randomUUID: () => `content-batch-concurrent-${++nextPreviewId}`,
    });
    const key = "content-batch-concurrent-key-001";
    const firstPending = batch.handle({
      operation: "preview",
      request: importRequest(firstWorkbook, key),
    });
    await firstStageEntered;

    const second = await batch.handle({
      operation: "preview",
      request: importRequest(secondWorkbook, key),
    });
    releaseFirstStage();
    const first = await firstPending;

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(responseValue(second)).toMatchObject({
      code: "OPERATION_IN_PROGRESS",
    });
    expect(stagePreview).toHaveBeenCalledOnce();
  });

  it("prunes a ready plan that expires during a repeated preview build", async () => {
    const snapshot = await audit();
    const edited = replaceCell(
      workbook(snapshot),
      "E2",
      "Expired repeated plan must be replaced",
    );
    const stored = structuredClone(contentAuditEvidence.get(snapshot.exportId)!);
    let now = stored.createdAt + 1;
    let advanceDuringPreview = false;
    let firstExpiresAt = 0;
    let nextPreviewId = 0;
    const stagePreview = vi.fn(async () => undefined);
    const batch = createListingContentBatchMutations({
      evidence: {
        getContentAuditSnapshotEvidence: vi.fn(async () => ({
          status: "available" as const,
          evidence: structuredClone(stored),
        })),
      },
      context: createScriptedSpExecutionContextAdapter((marketplaceId) => ({
        marketplaceId,
        mode: "demo",
        accountScope: ACCOUNT_SCOPE,
      })),
      writeGate: {
        stagePreview,
        execute: vi.fn(),
        reconcile: vi.fn(async () => undefined),
        clearEphemeral: vi.fn(),
      } as unknown as MainWriteGatePort,
      content: {
        previewOne: vi.fn(async (input) => {
          if (advanceDuringPreview) now = firstExpiresAt;
          return preparedPreview(input);
        }),
        attemptOne: vi.fn(),
      },
      now: () => now,
      randomUUID: () => `content-batch-repeated-${++nextPreviewId}`,
    });
    const key = "content-batch-repeated-expiry-001";
    const request = importRequest(edited, key);
    const first = await batch.handle({ operation: "preview", request });
    expect(first.status).toBe(200);
    firstExpiresAt = Date.parse(String(responseValue(first).expiresAt));
    now = firstExpiresAt - 1;
    advanceDuringPreview = true;

    const repeated = await batch.handle({ operation: "preview", request });

    expect(repeated.status).toBe(200);
    expect(responseValue(repeated).previewId).not.toBe(
      responseValue(first).previewId,
    );
    expect(stagePreview).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the W06 preview crosses the captured execution identity", async () => {
    const snapshot = await audit();
    const edited = replaceCell(
      workbook(snapshot),
      "E2",
      "Cross-context preview must be rejected",
    );
    const stored = structuredClone(contentAuditEvidence.get(snapshot.exportId)!);
    const stagePreview = vi.fn(async () => undefined);
    const batch = createListingContentBatchMutations({
      evidence: {
        getContentAuditSnapshotEvidence: vi.fn(async () => ({
          status: "available" as const,
          evidence: structuredClone(stored),
        })),
      },
      context: createScriptedSpExecutionContextAdapter((marketplaceId) => ({
        marketplaceId,
        mode: "demo",
        accountScope: ACCOUNT_SCOPE,
      })),
      writeGate: {
        stagePreview,
        execute: vi.fn(),
        reconcile: vi.fn(async () => undefined),
        clearEphemeral: vi.fn(),
      } as unknown as MainWriteGatePort,
      content: {
        previewOne: vi.fn(async (input) => ({
          ...preparedPreview(input),
          mode: "live" as const,
          status: "VALID" as const,
        })),
        attemptOne: vi.fn(),
      },
      randomUUID: () => "content-batch-cross-context",
    });

    const response = await batch.handle({
      operation: "preview",
      request: importRequest(edited, "content-batch-cross-context-001"),
    });

    expect(response.status).toBe(422);
    expect(responseValue(response)).toMatchObject({
      code: "CONTENT_BATCH_VALIDATION_FAILED",
      rows: [expect.objectContaining({ code: "PREVIEW_CHANGED" })],
      writeCount: 0,
    });
    expect(stagePreview).not.toHaveBeenCalled();
  });

  it("rejects a W06 preview rebound to a different ASIN or product type", async () => {
    const snapshot = await audit();
    const edited = replaceCell(
      workbook(snapshot),
      "E2",
      "Rebound SKU identity must be rejected",
    );
    const stored = structuredClone(contentAuditEvidence.get(snapshot.exportId)!);
    const stagePreview = vi.fn(async () => undefined);
    const batch = createListingContentBatchMutations({
      evidence: {
        getContentAuditSnapshotEvidence: vi.fn(async () => ({
          status: "available" as const,
          evidence: structuredClone(stored),
        })),
      },
      context: createScriptedSpExecutionContextAdapter((marketplaceId) => ({
        marketplaceId,
        mode: "demo",
        accountScope: ACCOUNT_SCOPE,
      })),
      writeGate: {
        stagePreview,
        execute: vi.fn(),
        reconcile: vi.fn(async () => undefined),
        clearEphemeral: vi.fn(),
      } as unknown as MainWriteGatePort,
      content: {
        previewOne: vi.fn(async (input) => preparedPreview(input, {
          asin: "B000000009",
          productType: "CAT_FOOD",
        })),
        attemptOne: vi.fn(),
      },
      randomUUID: () => "content-batch-rebound-identity",
    });

    const response = await batch.handle({
      operation: "preview",
      request: importRequest(edited, "content-batch-rebound-identity-001"),
    });

    expect(response.status).toBe(422);
    expect(responseValue(response)).toMatchObject({
      code: "CONTENT_BATCH_VALIDATION_FAILED",
      rows: [expect.objectContaining({ code: "LISTING_IDENTITY_MISMATCH" })],
      writeCount: 0,
    });
    expect(stagePreview).not.toHaveBeenCalled();
  });

  it("rejects changed W06 FBA evidence before approval or any SKU attempt", async () => {
    const snapshot = await audit();
    const edited = replaceCell(
      workbook(snapshot),
      "E2",
      "Fresh FBA evidence must still match",
    );
    const stored = structuredClone(contentAuditEvidence.get(snapshot.exportId)!);
    let previewCalls = 0;
    let passedPreapproval = false;
    const attemptOne = vi.fn();
    const execute = vi.fn(async (input) => {
      await input.beforeApproval?.();
      passedPreapproval = true;
      return input.run({} as never);
    });
    const batch = createListingContentBatchMutations({
      evidence: {
        getContentAuditSnapshotEvidence: vi.fn(async () => ({
          status: "available" as const,
          evidence: structuredClone(stored),
        })),
      },
      context: createScriptedSpExecutionContextAdapter((marketplaceId) => ({
        marketplaceId,
        mode: "demo",
        accountScope: ACCOUNT_SCOPE,
      })),
      writeGate: {
        stagePreview: vi.fn(async () => undefined),
        execute,
        reconcile: vi.fn(async () => undefined),
        clearEphemeral: vi.fn(),
      } as unknown as MainWriteGatePort,
      content: {
        previewOne: vi.fn(async (input) => {
          previewCalls += 1;
          const valid = preparedPreview(input);
          return previewCalls === 1
            ? valid
            : {
                ...valid,
                evidence: {
                  ...valid.evidence,
                  fulfillment: "MFN" as never,
                },
              };
        }),
        attemptOne,
      },
      randomUUID: () => "content-batch-fba-evidence-change",
    });
    const key = "content-batch-fba-evidence-change-001";
    const preview = await batch.handle({
      operation: "preview",
      request: importRequest(edited, key),
    });
    expect(preview.status).toBe(200);

    const response = await batch.handle({
      operation: "commit",
      request: commitRequest(String(responseValue(preview).previewId), key),
    });

    expect(response.status).toBe(409);
    expect(responseValue(response)).toMatchObject({
      code: "PREVIEW_CHANGED",
      writeCount: 0,
    });
    expect(passedPreapproval).toBe(false);
    expect(attemptOne).not.toHaveBeenCalled();
  });

  it("stops after a known rejection and replays a detached terminal result", async () => {
    const snapshot = await audit();
    const edited = replaceEveryProposedTitle(
      workbook(snapshot, 3),
      "Known rejection title",
    );
    const key = "content-batch-rejected-001";
    const preview = await router.handle(importRequest(edited, key));
    expect(preview.status).toBe(200);
    const [firstSku, rejectedSku, untouchedSku] = (
      responseValue(preview).changes as Array<{ sellerSku: string }>
    ).map((change) => change.sellerSku);
    const previewId = String(responseValue(preview).previewId);
    runIdempotentOperation
      .mockImplementationOnce(runPreparedIdempotentOperation)
      .mockRejectedValueOnce(new SpApiError(
        "Amazon 明確拒絕第二筆商品內容變更。",
        {
          status: 422,
          code: "UPDATE_REJECTED",
          requestId: "REQ-REJECTED-002",
        },
      ));

    const first = await router.handle(commitRequest(previewId, key));
    expect(first.status, JSON.stringify(responseValue(first))).toBe(200);
    const firstBody = responseValue(first) as unknown as {
      status: string;
      rows: Array<{
        sellerSku: string;
        state: string;
        result: unknown;
        error: {
          code: string;
          message: string;
          requestId: string | null;
        } | null;
      }>;
    };
    expect(firstBody).toMatchObject({
      status: "STOPPED_REJECTED",
      rows: [
        { sellerSku: firstSku, state: "simulated", error: null },
        {
          sellerSku: rejectedSku,
          state: "rejected",
          result: null,
          error: {
            code: "UPDATE_REJECTED",
            message: "Amazon 明確拒絕第二筆商品內容變更。",
            requestId: "REQ-REJECTED-002",
          },
        },
        {
          sellerSku: untouchedSku,
          state: "not-started",
          result: null,
          error: null,
        },
      ],
    });
    expect(approveWrite).toHaveBeenCalledOnce();
    expect(assertIdempotentOperationsAvailable).toHaveBeenCalledOnce();
    expect(runIdempotentOperation).toHaveBeenCalledTimes(2);
    const pristine = structuredClone(firstBody);
    const exposedError = firstBody.rows[1]!.error!;
    exposedError.message = "caller-poisoned rejection";

    const replay = await router.handle(commitRequest(previewId, key));
    const replayBody = responseValue(replay) as unknown as typeof firstBody;

    expect(replay.status).toBe(200);
    expect(replayBody).toEqual(pristine);
    expect(replayBody.rows[1]!.error).not.toBe(exposedError);
    expect(approveWrite).toHaveBeenCalledOnce();
    expect(assertIdempotentOperationsAvailable).toHaveBeenCalledOnce();
    expect(runIdempotentOperation).toHaveBeenCalledTimes(2);
  });

  it("stops later SKUs after an unknown result and does not blindly retry", async () => {
    const snapshot = await audit();
    const edited = replaceEveryProposedTitle(workbook(snapshot, 3));
    const key = "content-batch-unknown-001";
    const preview = await router.handle(importRequest(edited, key));
    expect(preview.status, JSON.stringify(responseValue(preview))).toBe(200);
    const previewId = String(responseValue(preview).previewId);
    runIdempotentOperation
      .mockImplementationOnce(runPreparedIdempotentOperation)
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

  it("stops after an unbound W06 result before attempting later SKUs", async () => {
    const snapshot = await audit();
    const edited = replaceEveryProposedTitle(
      workbook(snapshot, 3),
      "Malformed cached result title",
    );
    const stored = structuredClone(contentAuditEvidence.get(snapshot.exportId)!);
    const attemptOne = vi.fn(async (input: UpdateListingContentInput) => ({
      ...simulatedUpdateResult(input),
      sellerSku: "WRONG-SKU",
    }));
    const execute = vi.fn(async (input) => {
      await input.beforeApproval?.();
      return input.run({} as never);
    });
    const batch = createListingContentBatchMutations({
      evidence: {
        getContentAuditSnapshotEvidence: vi.fn(async () => ({
          status: "available" as const,
          evidence: structuredClone(stored),
        })),
      },
      context: createScriptedSpExecutionContextAdapter((marketplaceId) => ({
        marketplaceId,
        mode: "demo",
        accountScope: ACCOUNT_SCOPE,
      })),
      writeGate: {
        stagePreview: vi.fn(async () => undefined),
        execute,
        reconcile: vi.fn(async () => undefined),
        clearEphemeral: vi.fn(),
      } as unknown as MainWriteGatePort,
      content: {
        previewOne: vi.fn(async (input) => preparedPreview(input)),
        attemptOne,
      },
      randomUUID: () => "content-batch-unbound-result",
    });
    const key = "content-batch-unbound-result-001";
    const preview = await batch.handle({
      operation: "preview",
      request: importRequest(edited, key),
    });
    expect(preview.status).toBe(200);

    const response = await batch.handle({
      operation: "commit",
      request: commitRequest(String(responseValue(preview).previewId), key),
    });

    expect(response.status).toBe(200);
    expect(responseValue(response)).toMatchObject({
      status: "STOPPED_UNKNOWN",
      rows: [
        expect.objectContaining({
          state: "unknown",
          result: null,
          error: expect.objectContaining({ code: "UPDATE_STATUS_UNKNOWN" }),
        }),
        expect.objectContaining({ state: "not-started" }),
        expect.objectContaining({ state: "not-started" }),
      ],
    });
    expect(attemptOne).toHaveBeenCalledOnce();
    expectNoPrivateBatchKeys(responseValue(response));
  });

  it("stops before the next SKU when the router context is invalidated mid-batch", async () => {
    const snapshot = await audit();
    const edited = replaceEveryProposedTitle(workbook(snapshot, 3));
    const key = "content-batch-context-fence-001";
    const contextRouter = new ApiRouter({
      store: {
        assertIdempotentOperationsAvailable,
        runIdempotentOperation,
        saveContentAuditSnapshotEvidence,
        getContentAuditSnapshotEvidence,
        getSharedReport: vi.fn(async () => completedAllListingsLease()),
      } as unknown as LocalStore,
      vault: {} as CredentialVault,
      approveWrite,
      spExecutionContext: createScriptedSpExecutionContextAdapter(
        (marketplaceId) => ({
          marketplaceId,
          mode: "demo",
          accountScope: ACCOUNT_SCOPE,
        }),
      ),
    });
    const preview = await contextRouter.handle(importRequest(edited, key));
    expect(preview.status).toBe(200);
    const previewId = String(responseValue(preview).previewId);
    let enterFirstRow!: () => void;
    const firstRowEntered = new Promise<void>((resolve) => {
      enterFirstRow = resolve;
    });
    let releaseFirstRow!: () => void;
    const firstRowReleased = new Promise<void>((resolve) => {
      releaseFirstRow = resolve;
    });
    runIdempotentOperation.mockImplementationOnce(async (input) => {
      enterFirstRow();
      await firstRowReleased;
      return runPreparedIdempotentOperation(input);
    });

    const pending = contextRouter.handle(commitRequest(previewId, key));
    await firstRowEntered;
    contextRouter.invalidateContext("lock-screen");
    releaseFirstRow();
    const response = await pending;

    expect(response.status).toBe(409);
    expect(responseValue(response)).toMatchObject({
      code: "SP_CONTEXT_INVALIDATED",
    });
    expect(runIdempotentOperation).toHaveBeenCalledOnce();
    const repeated = await contextRouter.handle(commitRequest(previewId, key));
    expect(repeated.status).toBe(410);
    expect(runIdempotentOperation).toHaveBeenCalledOnce();
    contextRouter.dispose();
  });

  it("preserves the canonical context error before native batch approval", async () => {
    let assertions = 0;
    let armed = false;
    const context = Object.freeze({
      marketplaceId: MARKETPLACE_ID,
      region: "na" as const,
      mode: "demo" as const,
      accountScope: ACCOUNT_SCOPE as never,
      generation: 0,
    });
    const spExecutionContext = {
      capture: vi.fn(async () => context),
      assertCurrent: vi.fn(async () => {
        assertions += 1;
        if (armed && assertions === 3) {
          throw new SpExecutionContextError(
            "SP_CONTEXT_INVALIDATED",
            "Amazon 執行環境已更新；請重新開始這次操作。",
          );
        }
      }),
      invalidate: vi.fn(),
    } satisfies SpExecutionContextAdapter;
    const contextRouter = new ApiRouter({
      store: {
        assertIdempotentOperationsAvailable,
        runIdempotentOperation,
        saveContentAuditSnapshotEvidence,
        getContentAuditSnapshotEvidence,
        getSharedReport: vi.fn(async () => completedAllListingsLease()),
      } as unknown as LocalStore,
      vault: {} as CredentialVault,
      approveWrite,
      spExecutionContext,
    });
    const contextHandles = await issuedAllListingsHandles(contextRouter);
    const snapshot = await (async (): Promise<AuditReply> => {
      const response = await contextRouter.handle(auditRequest(
        contextHandles.reportId,
        contextHandles.documentId,
      ));
      expect(response.status).toBe(200);
      return responseValue(response) as unknown as AuditReply;
    })();
    const key = "content-batch-pre-approval-context-001";
    const preview = await contextRouter.handle(importRequest(
      replaceCell(workbook(snapshot), "E2", "Context-safe title"),
      key,
    ));
    expect(preview.status).toBe(200);
    assertions = 0;
    armed = true;

    const response = await contextRouter.handle(commitRequest(
      String(responseValue(preview).previewId),
      key,
    ));

    expect(response.status).toBe(409);
    expect(responseValue(response)).toMatchObject({
      code: "SP_CONTEXT_INVALIDATED",
      message: "Amazon 執行環境已更新；請重新開始這次操作。",
    });
    expect(responseValue(response)).not.toMatchObject({ code: "ACTION_CANCELLED" });
    expect(approveWrite).not.toHaveBeenCalled();
    expect(runIdempotentOperation).not.toHaveBeenCalled();
    contextRouter.dispose();
  });
});
