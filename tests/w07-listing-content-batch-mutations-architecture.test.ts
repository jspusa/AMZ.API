import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function importSpecifiers(value: string): string[] {
  return [...value.matchAll(/\bfrom\s+["']([^"']+)["']/gmu)].map(
    (match) => match[1]!,
  );
}

function section(value: string, startMarker: string, endMarker: string): string {
  const start = value.indexOf(startMarker);
  if (start < 0) return "";
  const end = value.indexOf(endMarker, start + startMarker.length);
  return end < 0 ? "" : value.slice(start, end);
}

function switchCaseBody(value: string, key: string): string {
  const marker = `case "${key}":`;
  const start = value.indexOf(marker);
  if (start < 0) throw new Error(`Router case not found: ${key}`);
  const remaining = value.slice(start + marker.length);
  const end = remaining.search(/\n\s+(?:case\s+"|default:)/u);
  return end < 0 ? remaining : remaining.slice(0, end);
}

function sourceFilePaths(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFilePaths(filename);
    if (!entry.isFile() || !/\.tsx?$/u.test(entry.name)) return [];
    return / 2\.tsx?$/u.test(entry.name) ? [] : [filename];
  });
}

function portablePath(value: string): string {
  return value.replace(/\\/gu, "/");
}

const SRC_ROOT = fileURLToPath(new URL("../src/", import.meta.url));

describe("W07 Listing Content batch mutation architecture", () => {
  it("delegates the two exact import routes directly to one batch owner", () => {
    const router = source("../src/main/api-router.ts");
    for (const [key, operation] of [
      ["POST /api/sp-api/listing-content/import", "preview"],
      ["PATCH /api/sp-api/listing-content/import", "commit"],
    ] as const) {
      expect(switchCaseBody(router, key)).toMatch(
        new RegExp(
          String.raw`^\s*return\s+this\.listingContentBatchMutations\.handle\(\{\s*operation:\s*"${operation}",\s*request,?\s*\}\);?\s*$`,
          "u",
        ),
      );
    }
  });

  it("leaves Router with composition, dispatch, and lifecycle clear only", () => {
    const router = source("../src/main/api-router.ts");
    const forbidden = [
      "type ContentBatchPlan",
      "type ContentBatchChange",
      "type ContentBatchCommitResult",
      "contentBatchPlans",
      "CONTENT_BATCH_PREVIEW_TTL_MS",
      "CONTENT_BATCH_MAX_CHANGED_SKUS",
      "contentBatchPreviewPayload",
      "previewContentWorkbookImport",
      "commitContentWorkbookImport",
      "parseContentAuditWorkbook",
      "contentAuditEvidenceRowDigest",
      "CONTENT_AUDIT_LEGACY_LINE_BREAK_CANDIDATES",
    ].filter((symbol) => router.includes(symbol));

    expect(forbidden).toEqual([]);
    expect(router).toMatch(/createListingContentBatchMutations\s*\(/u);
    expect(router).toMatch(
      /createListingContentBatchMutations\(\{(?=[^}]*\bevidence:\s*store)(?=[^}]*\bcontext:\s*this\.spExecutionContext)(?=[^}]*\bwriteGate:\s*this\.writeGate)(?=[^}]*\bcontent:\s*this\.listingContentMutations)[^}]*\}\)/su,
    );
    expect(router).toMatch(/this\.listingContentBatchMutations\.clear\(\)/u);
  });

  it("keeps one main-only owner with a two-method public port", () => {
    const owner = source("../src/main/listing-content-batch-mutations.ts");
    const port = section(
      owner,
      "export interface ListingContentBatchMutationsPort {",
      "\n}",
    );
    const methods = [...port.matchAll(
      /^\s{2}([A-Za-z][A-Za-z0-9]*)\s*\(/gmu,
    )].map((match) => match[1]);
    const forbiddenImports = importSpecifiers(owner).filter((specifier) =>
      /(?:^|\/)(?:renderer|preload)(?:\/|$)/u.test(specifier) ||
      /(?:^|\/)api-router(?:\.ts)?$/u.test(specifier) ||
      /(?:^|\/)(?:advertising-)?credential-vault(?:\.ts)?$/u.test(specifier) ||
      /(?:^|\/)native-confirmation(?:\.ts)?$/u.test(specifier) ||
      /(?:^|\/)content-audit-owner(?:\.ts)?$/u.test(specifier)
    );

    expect(methods).toEqual(["handle", "clear"]);
    expect(forbiddenImports).toEqual([]);
    expect(importSpecifiers(owner)).not.toContain("./amazon/sp-api");
    expect(importSpecifiers(owner)).not.toContain("./local-store");
    expect(owner).toMatch(/private readonly plans = new Map/u);
    expect(owner).toMatch(/private lifecycleRevision = 0/u);
    expect(owner).toMatch(/CONTENT_BATCH_PREVIEW_TTL_MS/u);
    expect(owner).toMatch(/publicBatchCommitResult/u);
  });

  it("uses only W06 preview and attempt primitives behind the central gate", () => {
    const owner = source("../src/main/listing-content-batch-mutations.ts");
    const ownerCalls = [...new Set([...owner.matchAll(
      /this\.content\.([A-Za-z][A-Za-z0-9]*)\s*\(/gmu,
    )].map((match) => match[1]))];
    const forbidden = [
      "listingContentGatewayProduction",
      "createListingContentGatewayProduction",
      "ListingsWriteProduction",
      "commitOnce",
      "replaceDemoContent",
      "contentReadbackDecision",
      "reconcileContentWrite",
      "patchListingsItem",
    ].filter((symbol) => new RegExp(`\\b${symbol}\\b`, "u").test(owner));

    expect(ownerCalls).toEqual(["previewOne", "attemptOne"]);
    expect(forbidden).toEqual([]);
    expect(importSpecifiers(owner)).not.toContain(
      "./amazon/listing-content-gateway-production",
    );
    expect(owner).toMatch(/writeGate:\s*MainWriteGatePort/u);
    expect(owner).toMatch(/this\.writeGate\.execute<ContentBatchCommitResult>/u);
    expect(owner).toMatch(/family:\s*"content-batch"/u);
    expect(owner).toMatch(
      /assertListingContentPreparedPreviewBinding\s*\(/u,
    );
  });

  it("keeps INVALID override authority opaque and exclusive to the W06/W07 seam", () => {
    const capability = "LISTING_CONTENT_BATCH_VALIDATION_OVERRIDE_AUTHORITY";
    const consumers = sourceFilePaths(SRC_ROOT).flatMap((filename) => {
      const value = readFileSync(filename, "utf8");
      return value.includes(capability)
        ? [portablePath(relative(SRC_ROOT, filename))]
        : [];
    }).sort();

    expect(consumers).toEqual([
      "main/listing-content-batch-mutations.ts",
      "main/listing-content-mutations.ts",
    ]);
    expect(source("../src/main/listing-content-mutations.ts")).toMatch(
      /export const LISTING_CONTENT_BATCH_VALIDATION_OVERRIDE_AUTHORITY\s*=\s*Symbol\(/u,
    );
  });

  it("shares evidence through a neutral reader and writer contract", () => {
    const neutral = source(
      "../src/main/amazon/content-audit-snapshot-evidence.ts",
    );
    const auditOwner = source("../src/main/amazon/content-audit-owner.ts");
    const batchOwner = source("../src/main/listing-content-batch-mutations.ts");

    expect(neutral).toMatch(
      /export interface ContentAuditSnapshotEvidenceReader/u,
    );
    expect(neutral).toMatch(
      /export interface ContentAuditSnapshotEvidenceWriter/u,
    );
    expect(neutral).toMatch(/export function contentAuditEvidenceRowDigest/u);
    expect(importSpecifiers(neutral)).toEqual([
      "node:crypto",
      "../../shared/marketplaces",
    ]);
    expect(auditOwner).toMatch(/ContentAuditSnapshotEvidenceWriter/u);
    expect(batchOwner).toMatch(/ContentAuditSnapshotEvidenceReader/u);
    expect(batchOwner).not.toMatch(/ContentAuditSnapshotEvidenceWriter/u);
    expect(auditOwner).not.toMatch(/listing-content-batch-mutations/u);
  });

  it("keeps renderer, preload, and shared code outside the main-only owner", () => {
    const consumers = sourceFilePaths(SRC_ROOT).flatMap((filename) => {
      const value = readFileSync(filename, "utf8");
      const importsOwner = importSpecifiers(value).some((specifier) =>
        /(?:^|\/)listing-content-batch-mutations(?:\.ts)?$/u.test(specifier)
      );
      if (!importsOwner) return [];
      return [portablePath(relative(SRC_ROOT, filename))];
    });
    const forbidden = consumers.filter((filename) =>
      /^(?:renderer|preload|shared)\//u.test(filename)
    );

    expect(forbidden).toEqual([]);
  });

  it("uses one request barrier without duplicate write-only tracking", () => {
    const main = source("../src/main/index.ts");
    const handler = section(
      main,
      'ipcMain.handle("fba:api-request"',
      'ipcMain.on("fba:api-cancel"',
    );

    expect(handler.match(/apiRequestsInFlight \+= 1/gu)).toHaveLength(1);
    expect(handler.match(/apiRequestsInFlight -= 1/gu)).toHaveLength(1);
    expect(main).not.toMatch(/\bamazonWritesInFlight\b/u);
    expect(main).not.toMatch(/\bisAmazonWrite\b/u);
  });
});
