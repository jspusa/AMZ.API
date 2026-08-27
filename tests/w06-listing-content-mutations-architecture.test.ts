import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function optionalSource(path: string): string {
  const url = new URL(path, import.meta.url);
  return existsSync(url) ? readFileSync(url, "utf8") : "";
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

function importSpecifiers(value: string): string[] {
  return [...value.matchAll(/\bfrom\s+["']([^"']+)["']/gmu)].map(
    (match) => match[1]!,
  );
}

function switchCaseBody(value: string, key: string): string {
  const marker = `case "${key}":`;
  const start = value.indexOf(marker);
  if (start < 0) throw new Error(`Router case not found: ${key}`);
  const remaining = value.slice(start + marker.length);
  const end = remaining.search(/\n\s+(?:case\s+"|default:)/u);
  return end < 0 ? remaining : remaining.slice(0, end);
}

function section(
  value: string,
  startMarker: string,
  endMarker: string,
): string {
  const start = value.indexOf(startMarker);
  if (start < 0) return "";
  const end = value.indexOf(endMarker, start + startMarker.length);
  return end < 0 ? "" : value.slice(start, end);
}

const SRC_ROOT = fileURLToPath(new URL("../src/", import.meta.url));

const ROUTES = [
  ["GET /api/sp-api/listing-content", "read"],
  ["POST /api/sp-api/listing-content", "preview"],
  ["PATCH /api/sp-api/listing-content", "commit"],
] as const;

const PUBLIC_CONTENT_TYPES = [
  "ListingContentFieldCapability",
  "ListingContentField",
  "ListingContentSnapshot",
  "ListingContentValues",
  "UpdateListingContentInput",
  "ListingContentValidationResult",
  "ListingContentUpdateResult",
] as const;

const LEGACY_SP_FACADES = [
  "getListingContent",
  "previewListingContentUpdate",
  "updateListingContent",
] as const;

describe("W06 single-SKU Listing Content mutation architecture", () => {
  it("delegates the three exact public routes directly to one closed owner", () => {
    const router = source("../src/main/api-router.ts");

    for (const [key, operation] of ROUTES) {
      const body = switchCaseBody(router, key);
      expect(body, `${key} must delegate without a legacy fallback`).toMatch(
        new RegExp(
          String.raw`^\s*return\s+this\.listingContentMutations\.handle\(\{\s*operation:\s*"${operation}",\s*request,?\s*\}\);?\s*$`,
          "u",
        ),
      );
    }
  });

  it("keeps Router limited to dispatch and production composition", () => {
    const router = source("../src/main/api-router.ts");
    const legacyOwners = [
      "listingContent",
      "previewContent",
      "commitContent",
      "contentFingerprint",
      "reconcileContentWrites",
    ].filter((symbol) =>
      new RegExp(`private (?:async )?${symbol}\\b`, "u").test(router)
    );
    const directOperations = [
      ...LEGACY_SP_FACADES,
      "contentReadbackDecision",
      "reconcileContentWrite",
    ].filter((symbol) => new RegExp(`\\b${symbol}\\b`, "u").test(router));

    expect(legacyOwners).toEqual([]);
    expect(directOperations).toEqual([]);
    expect(router).toMatch(/createListingContentMutations\s*\(/u);
    expect(router).toMatch(
      /createListingContentMutations\(\{(?=[^}]*\bcontext:\s*this\.spExecutionContext)(?=[^}]*\bwriteGate:\s*this\.writeGate)(?=[^}]*\bgateway:\s*listingContentGatewayProduction)[^}]*\}\)/su,
    );
    expect(router).not.toMatch(
      /listingContentGatewayProduction\.(?:read|validationPreview|commitOnce|replaceDemoContent)/u,
    );
  });

  it("keeps one main-only deep owner behind the central Write Gate", () => {
    const owner = optionalSource("../src/main/listing-content-mutations.ts");
    const forbiddenImports = importSpecifiers(owner).filter((specifier) =>
      /(?:^|\/)(?:renderer|preload)(?:\/|$)/u.test(specifier) ||
      /(?:^|\/)api-router(?:\.ts)?$/u.test(specifier) ||
      /(?:^|\/)local-store(?:\.ts)?$/u.test(specifier) ||
      /(?:^|\/)(?:advertising-)?credential-vault(?:\.ts)?$/u.test(specifier) ||
      /(?:^|\/)native-confirmation(?:\.ts)?$/u.test(specifier) ||
      /(?:audit|export|xlsx|report-library)/u.test(specifier)
    );

    expect(owner, "the W06 Listing Content owner must exist").not.toBe("");
    expect(forbiddenImports).toEqual([]);
    expect(importSpecifiers(owner)).not.toContain("./amazon/sp-api");
    expect(owner).toMatch(
      /import\s*\{[^;]*\bMainWriteGatePort\b[^;]*\}\s*from\s*["']\.\/write-gate["'];/mu,
    );
    expect(owner).toMatch(/\bwriteGate:\s*MainWriteGatePort\s*;/u);
    expect(owner).not.toMatch(
      /export\s+(?:interface|type)\s+ListingContentMutationOperations\b/u,
    );
    expect(owner).not.toMatch(
      /export\s+function\s+createListingContentMutationOperations\b/u,
    );
  });

  it("keeps the owner public port limited to four semantic operations", () => {
    const owner = optionalSource("../src/main/listing-content-mutations.ts");
    const port = section(
      owner,
      "export interface ListingContentMutationsPort {",
      "\n}",
    );
    const methods = [...port.matchAll(
      /^\s{2}([A-Za-z][A-Za-z0-9]*)\s*\(/gmu,
    )].map((match) => match[1]);

    expect(port, "the Listing Content owner port must exist").not.toBe("");
    expect(methods).toEqual([
      "handle",
      "readOne",
      "previewOne",
      "attemptOne",
    ]);
    expect(port).not.toMatch(/\bcommitOne\b/u);
    expect(port).not.toMatch(/\bfence\b/u);
    expect(port).not.toMatch(/\brecordDurable(?:Evidence)?\b/u);
  });

  it("moves the unchanged public DTOs to the neutral content types module", () => {
    const publicTypes = source(
      "../src/main/amazon/listing-content-types.ts",
    );
    const spApi = source("../src/main/amazon/sp-api.ts");

    expect(importSpecifiers(publicTypes)).not.toContain("./sp-api");
    const duplicateTypes = PUBLIC_CONTENT_TYPES.filter((symbol) =>
      new RegExp(`\\bexport\\s+type\\s+${symbol}\\s*=`, "u").test(spApi)
    );
    for (const symbol of PUBLIC_CONTENT_TYPES) {
      expect(publicTypes).toMatch(
        new RegExp(`\\bexport\\s+type\\s+${symbol}\\b`, "u"),
      );
    }
    expect(duplicateTypes).toEqual([]);
    expect(
      /from\s+["']\.\/listing-content-types["']/u.test(spApi),
    ).toBe(true);
  });

  it("keeps a fixed gateway with opaque source and PTD evidence", () => {
    const gateway = source(
      "../src/main/amazon/listing-content-gateway.ts",
    );
    const port = section(
      gateway,
      "export interface ListingContentGateway {",
      "\n}",
    );
    const read = section(
      gateway,
      "export type ListingContentGatewayRead = Readonly<{",
      "\n}>;",
    );
    const descriptor = section(
      gateway,
      "export type ListingContentPatchDescriptor = ListingContentIdentity & Readonly<{",
      "\n}>;",
    );
    const validationReceipt = section(
      gateway,
      "export type ListingContentValidationReceipt = Readonly<{",
      "\n}>;",
    );

    expect(importSpecifiers(gateway)).not.toContain("./sp-api");
    expect(gateway).toMatch(
      /declare const listingContentSourceEvidenceBrand:\s*unique symbol/u,
    );
    expect(gateway).toMatch(
      /declare const listingContentPtdEvidenceBrand:\s*unique symbol/u,
    );
    expect(gateway).toMatch(
      /sourceEvidence:\s*ListingContentSourceEvidence/u,
    );
    expect(gateway).toMatch(/ptdEvidence:\s*ListingContentPtdEvidence/u);
    for (const hash of [
      "rawContentGuardHash",
      "capabilityGuardHash",
      "fbaEvidenceHash",
    ]) {
      expect(read).toMatch(new RegExp(`\\b${hash}:\\s*string\\b`, "u"));
    }
    expect(descriptor).toMatch(
      /expectedCanonicalPatchHash:\s*string\s*\|\s*null/u,
    );
    expect(descriptor).not.toMatch(/\bcanonicalPatchHash\s*:/u);
    expect(validationReceipt).toMatch(/\bcanonicalPatchHash:\s*string/u);
    expect(port).toMatch(
      /read\(\s*identity:\s*ListingContentIdentity,\s*purpose:\s*"read-only"\s*\|\s*"mutation"/su,
    );
    expect(port).toMatch(/\bvalidationPreview\s*\(/u);
    expect(port).toMatch(
      /commitOnce\s*\(\s*patch:\s*ListingContentPatchDescriptor,\s*fence:\s*ListingWriteExecutionFence,\s*recordDispatch:\s*\(\)\s*=>\s*Promise<void>/su,
    );
    expect(port).toMatch(
      /replaceDemoContent\s*\(\s*patch:\s*ListingContentPatchDescriptor,\s*fence:\s*ListingWriteExecutionFence/su,
    );
    expect(port).not.toMatch(/(?:fence|recordDispatch)\?:/u);
    expect(port).not.toMatch(
      /\b(?:url|endpoint|method|headers|sellerId|accessToken|refreshToken|retry|retryCount|body|patches|payload|rawPayload)\s*:/u,
    );
  });

  it("records dispatch before the fixed live transport call", () => {
    const spApi = source("../src/main/amazon/sp-api.ts");
    const productionGateway = section(
      spApi,
      "export const listingContentGatewayProduction: ListingContentGateway = {",
      "\n};",
    );

    expect(productionGateway).not.toBe("");
    expect(productionGateway).toMatch(
      /commitOnce:\s*async\s*\(patch,\s*fence,\s*recordDispatch\)\s*=>/u,
    );
    expect(productionGateway).toMatch(
      /assertBeforeSend:\s*\(\)\s*=>\s*fence\.assertCurrent\(\)/u,
    );
    expect(productionGateway).toMatch(
      /recordBeforeSend:\s*recordDispatch/u,
    );
  });

  it("keeps renderer, preload, audits and exports outside the write gateway", () => {
    const files = sourceFilePaths(SRC_ROOT);
    const consumers = files.flatMap((filename) => {
      const value = readFileSync(filename, "utf8");
      const imports = importSpecifiers(value);
      return imports.some((specifier) =>
          /(?:^|\/)listing-content-(?:gateway|mutations)(?:\.ts)?$/u.test(
            specifier,
          )) || /\blistingContentGatewayProduction\b/u.test(value)
        ? [portablePath(relative(SRC_ROOT, filename))]
        : [];
    });
    const forbiddenConsumers = consumers.filter((filename) =>
      /^(?:renderer|preload)\//u.test(filename) ||
      /(?:audit|export|xlsx|report-library)/u.test(filename)
    );

    expect(forbiddenConsumers).toEqual([]);
  });

  it("keeps the W07 batch bridge on owner preview and attempt operations only", () => {
    const router = source("../src/main/api-router.ts");
    const batch = section(
      router,
      "  private contentBatchPreviewPayload(",
      "  private async startExport(",
    );
    const ownerCalls = [...new Set([...batch.matchAll(
      /this\.listingContentMutations\.([A-Za-z][A-Za-z0-9]*)\s*\(/gmu,
    )].map((match) => match[1]))];
    const forbidden = [
      ...LEGACY_SP_FACADES,
      "listingContentGatewayProduction",
      "commitWithCanonicalReadback",
      "contentReadbackDecision",
      "reconcileContentWrite",
    ].filter((symbol) => new RegExp(`\\b${symbol}\\b`, "u").test(batch));

    expect(batch, "the content batch compatibility section must exist").not
      .toBe("");
    expect(ownerCalls).toEqual(["previewOne", "attemptOne"]);
    expect(forbidden).toEqual([]);
  });

  it("passes the captured SKU Command context into the content owner read", () => {
    const router = source("../src/main/api-router.ts");
    const command = source("../src/main/amazon/sku-command.ts");

    expect(command).toMatch(
      /content\(\s*identity:\s*SkuCommandIdentity,\s*context:\s*SpExecutionContext,?\s*\):\s*Promise<ListingContentSnapshot>/su,
    );
    expect(command).toMatch(/this\.reads\.content\(identity,\s*context\)/u);
    expect(router).toMatch(
      /content:\s*\(identity,\s*context\)\s*=>\s*this\.listingContentMutations\.readOne\(identity,\s*context\)/su,
    );
  });

  it("removes superseded content facades and generic content readback", () => {
    const owner = optionalSource("../src/main/listing-content-mutations.ts");
    const spApi = source("../src/main/amazon/sp-api.ts");
    const readback = source(
      "../src/main/amazon/listing-write-readback.ts",
    );

    const legacyFacades = LEGACY_SP_FACADES.filter((symbol) =>
      new RegExp(
        `\\bexport\\s+(?:async\\s+)?function\\s+${symbol}\\b`,
        "u",
      ).test(spApi)
    );
    const legacyPolicy = [
      "verifyContentChange",
      "buildContentPatch",
      "prepareLiveContentUpdate",
    ].filter((symbol) => new RegExp(`\\b${symbol}\\b`, "u").test(spApi));

    expect(legacyFacades).toEqual([]);
    expect(legacyPolicy).toEqual([]);
    for (const symbol of [
      "contentReadbackDecision",
      "reconcileContentWrite",
    ]) {
      expect(readback).not.toMatch(
        new RegExp(`\\bexport\\s+function\\s+${symbol}\\b`, "u"),
      );
      expect(owner).toMatch(
        new RegExp(`\\b(?:export\\s+)?function\\s+${symbol}\\b`, "u"),
      );
    }
  });
});
