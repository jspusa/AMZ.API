import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContentAuditWorkbookV2 } from "../src/main/amazon/xlsx";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import {
  CONTENT_AUDIT_SNAPSHOT_TTL_MS,
  LocalStore,
} from "../src/main/local-store";
import type { ApiRequest } from "../src/shared/contracts";

const MARKETPLACE_ID = "ATVPDKIKX0DER";
const ACCOUNT_SCOPE_A = "a".repeat(64);
const ACCOUNT_SCOPE_B = "b".repeat(64);
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
  }>;
};

function auditStartRequest(): ApiRequest {
  return {
    requestId: "content-audit-durable-start",
    method: "POST",
    path: "/api/sp-api/listing-content/export",
    query: {},
    headers: { "content-type": "application/json" },
    body: {
      kind: "json",
      value: { marketplaceId: MARKETPLACE_ID },
    },
  };
}

function auditRequest(reportId: string, documentId: string): ApiRequest {
  return {
    requestId: "content-audit-durable-scan",
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

function importRequest(bytes: Uint8Array, key: string): ApiRequest {
  return {
    requestId: `content-audit-durable-import-${key}`,
    method: "POST",
    path: "/api/sp-api/listing-content/import",
    query: {},
    headers: {},
    body: {
      kind: "multipart",
      fields: { marketplaceId: MARKETPLACE_ID, idempotencyKey: key },
      file: { name: "content-audit.xlsx", type: MEDIA_TYPE, bytes },
    },
  };
}

function commitRequest(previewId: string, key: string): ApiRequest {
  return {
    requestId: `content-audit-durable-commit-${key}`,
    method: "PATCH",
    path: "/api/sp-api/listing-content/import",
    query: {},
    headers: { "content-type": "application/json" },
    body: {
      kind: "json",
      value: {
        marketplaceId: MARKETPLACE_ID,
        previewId,
        idempotencyKey: key,
      },
    },
  };
}

function responseValue(response: Awaited<ReturnType<ApiRouter["handle"]>>) {
  if (response.body.kind !== "json") throw new Error("Expected JSON response");
  return response.body.value as Record<string, unknown>;
}

function createRouter(store: LocalStore, accountScope = ACCOUNT_SCOPE_A): ApiRouter {
  return new ApiRouter({
    store,
    vault: {
      getAccountScope: async () => accountScope,
    } as unknown as CredentialVault,
    approveWrite: async () => undefined,
  });
}

function workbook(snapshot: AuditReply): Uint8Array {
  const row = snapshot.rows[0];
  if (!row) throw new Error("Demo audit returned no editable row");
  return createContentAuditWorkbookV2({
    marketplaceId: snapshot.marketplaceId,
    marketplaceLabel: "US · Amazon.com",
    exportId: snapshot.exportId,
    fetchedAt: snapshot.fetchedAt,
    rows: [{
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
      auditDescription: "持久快照 round trip",
    }],
  });
}

function replaceProposedTitle(bytes: Uint8Array, value: string): Uint8Array {
  const archive = unzipSync(bytes);
  const name = "xl/worksheets/sheet2.xml";
  const source = archive[name];
  if (!source) throw new Error("Missing content-audit data worksheet");
  const xml = strFromU8(source);
  const expression = /<c r="E2"[^>]*>.*?<\/c>/su;
  if (!expression.test(xml)) throw new Error("Missing proposed title cell");
  const escaped = value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  archive[name] = strToU8(xml.replace(
    expression,
    `<c r="E2" s="7" t="inlineStr"><is><t xml:space="preserve">${escaped}</t></is></c>`,
  ));
  return zipSync(archive, { level: 6 });
}

async function scan(router: ApiRouter): Promise<AuditReply> {
  const started = await router.handle(auditStartRequest());
  expect(started.status, JSON.stringify(responseValue(started))).toBe(200);
  const reference = responseValue(started) as {
    reportId: string;
    documentId: string;
  };
  const response = await router.handle(auditRequest(
    reference.reportId,
    reference.documentId,
  ));
  expect(response.status, JSON.stringify(responseValue(response))).toBe(200);
  return responseValue(response) as unknown as AuditReply;
}

describe("durable content-audit snapshot lifecycle", () => {
  beforeEach(() => {
    vi.useRealTimers();
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    for (const [key, value] of savedEnvironment) {
      if (value !== undefined) process.env[key] = value;
    }
  });

  it("survives clearPreviews and a new Router/LocalStore but rejects account and mode changes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "content-audit-lifecycle-"));
    const filePath = join(directory, "data.json");
    const store = new LocalStore(filePath);
    await store.initialize();
    const router = createRouter(store);
    const snapshot = await scan(router);
    const firstRow = snapshot.rows[0]!;

    const rawEvidence = await readFile(filePath, "utf8");
    expect(rawEvidence).not.toContain(firstRow.sellerSku);
    expect(rawEvidence).not.toContain(firstRow.asin);
    if (firstRow.title) expect(rawEvidence).not.toContain(firstRow.title);
    if (firstRow.productDescription) {
      expect(rawEvidence).not.toContain(firstRow.productDescription);
    }

    const edited = replaceProposedTitle(
      workbook(snapshot),
      "Batch-safe durable product title",
    );
    router.clearPreviews();
    const afterClear = await router.handle(
      importRequest(edited, "durable-after-clear-001"),
    );
    expect(afterClear.status, JSON.stringify(responseValue(afterClear))).toBe(200);

    router.clearPreviews();
    const restartedStore = new LocalStore(filePath);
    await restartedStore.initialize();
    const restartedRouter = createRouter(restartedStore);
    const restartKey = "durable-after-restart-001";
    const afterRestart = await restartedRouter.handle(importRequest(edited, restartKey));
    expect(afterRestart.status, JSON.stringify(responseValue(afterRestart))).toBe(200);

    const wrongAccount = await createRouter(
      restartedStore,
      ACCOUNT_SCOPE_B,
    ).handle(importRequest(edited, "durable-wrong-account-001"));
    expect(wrongAccount.status).toBe(409);
    expect(responseValue(wrongAccount)).toMatchObject({
      code: "ACCOUNT_SCOPE_CHANGED",
    });

    const previewId = String(responseValue(afterRestart).previewId);
    const committed = await restartedRouter.handle(
      commitRequest(previewId, restartKey),
    );
    expect(committed.status, JSON.stringify(responseValue(committed))).toBe(200);
    expect(responseValue(committed)).toMatchObject({
      status: "COMPLETED",
      rows: [expect.objectContaining({ state: "simulated" })],
    });
    const repeated = await restartedRouter.handle(
      commitRequest(previewId, restartKey),
    );
    expect(responseValue(repeated)).toEqual(responseValue(committed));
    const persistedAfterCommit = JSON.parse(await readFile(filePath, "utf8")) as {
      ledger: Record<string, { state: string; operationType: string }>;
    };
    expect(Object.values(persistedAfterCommit.ledger)).toEqual([
      expect.objectContaining({ state: "completed", operationType: "content" }),
    ]);

    process.env.SP_API_LWA_CLIENT_ID = "placeholder-client-id";
    process.env.SP_API_LWA_CLIENT_SECRET = "placeholder-client-secret";
    process.env.SP_API_REFRESH_TOKEN_NA = "placeholder-refresh-token";
    const wrongMode = await createRouter(restartedStore).handle(
      importRequest(edited, "durable-wrong-mode-001"),
    );
    expect(wrongMode.status).toBe(409);
    expect(responseValue(wrongMode)).toMatchObject({
      code: "REPORT_MODE_CHANGED",
    });
  });

  it("rejects the same Excel after the fixed 24-hour TTL on a new LocalStore", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-08-22T00:00:00.000Z"));
    const directory = await mkdtemp(join(tmpdir(), "content-audit-expired-"));
    const filePath = join(directory, "data.json");
    const store = new LocalStore(filePath);
    await store.initialize();
    const snapshot = await scan(createRouter(store));
    const edited = replaceProposedTitle(
      workbook(snapshot),
      "Expired durable product title",
    );

    vi.advanceTimersByTime(CONTENT_AUDIT_SNAPSHOT_TTL_MS);
    const restartedStore = new LocalStore(filePath);
    await restartedStore.initialize();
    const response = await createRouter(restartedStore).handle(
      importRequest(edited, "durable-expired-001"),
    );
    expect(response.status).toBe(410);
    expect(responseValue(response)).toMatchObject({ code: "SNAPSHOT_EXPIRED" });
  });
});
