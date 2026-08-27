import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function sourceFilePaths(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFilePaths(path);
    if (!entry.isFile() || !/\.tsx?$/u.test(entry.name)) return [];
    return / 2\.tsx?$/u.test(entry.name) ? [] : [path];
  });
}

const MAIN_ROOT = fileURLToPath(new URL("../src/main/", import.meta.url));

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

function methodBody(
  value: string,
  startMarker: string,
  endMarker: string,
): string {
  const start = value.indexOf(startMarker);
  if (start < 0) throw new Error(`Method not found: ${startMarker}`);
  const end = value.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`Method end not found: ${endMarker}`);
  return value.slice(start, end);
}

const ROUTES = [
  {
    key: "GET /api/sp-api/listings",
    family: "standard-price",
    operation: "read",
  },
  {
    key: "POST /api/sp-api/listings",
    family: "standard-price",
    operation: "preview",
  },
  {
    key: "PATCH /api/sp-api/listings",
    family: "standard-price",
    operation: "commit",
  },
  {
    key: "POST /api/sp-api/sale-price",
    family: "sale-price",
    operation: "preview",
  },
  {
    key: "PATCH /api/sp-api/sale-price",
    family: "sale-price",
    operation: "commit",
  },
] as const;

const LEGACY_ROUTER_OWNERSHIP = [
  "priceInput",
  "previewPrice",
  "commitPrice",
  "priceFingerprint",
  "salePriceInput",
  "previewSalePrice",
  "commitSalePrice",
  "saleFingerprint",
  "reconcilePriceWrites",
] as const;

const DIRECT_PRICE_OPERATIONS = [
  "getListingPrice",
  "previewListingPriceUpdate",
  "updateListingPrice",
  "previewListingSalePriceUpdate",
  "updateListingSalePrice",
] as const;

const PRICE_READBACK_HELPERS = [
  "priceReadbackDecision",
  "salePriceReadbackDecision",
  "reconcilePriceWrite",
  "reconcileSalePriceWrite",
] as const;

describe("W02 Listing Price mutation architecture", () => {
  it("delegates the five exact public route cases directly to one closed owner", () => {
    const router = source("../src/main/api-router.ts");

    for (const route of ROUTES) {
      const body = switchCaseBody(router, route.key);
      const directDelegation = new RegExp(
        String.raw`^\s*return\s+this\.priceMutations\.handle\(\{\s*family:\s*"${route.family}",\s*operation:\s*"${route.operation}",\s*request,?\s*\}\);?\s*$`,
        "u",
      );

      expect(body, `${route.key} must delegate without a legacy fallback`)
        .toMatch(directDelegation);
    }
  });

  it("removes Standard and Sale Price policy and orchestration from Router", () => {
    const router = source("../src/main/api-router.ts");
    const remaining = LEGACY_ROUTER_OWNERSHIP.filter((symbol) =>
      new RegExp(`\\b${symbol}\\s*\\(`, "u").test(router)
    );

    expect(remaining).toEqual([]);
  });

  it("keeps Router free of direct price mutation and price readback imports", () => {
    const router = source("../src/main/api-router.ts");
    const leaked = [
      ...DIRECT_PRICE_OPERATIONS,
      ...PRICE_READBACK_HELPERS,
    ].filter((symbol) => new RegExp(`\\b${symbol}\\b`, "u").test(router));

    expect(leaked).toEqual([]);
  });

  it("routes a captured Business Pricing snapshot through canonical price observation", () => {
    const owner = source("../src/main/business-pricing-mutations.ts");
    const readRoute = methodBody(
      owner,
      "private async readRoute(request: ApiRequest)",
      "private routeInput(request: ApiRequest)",
    );
    const capturedContext = readRoute.indexOf(
      "const context = await this.context.capture(marketplaceId);",
    );
    const canonicalRead = readRoute.indexOf(
      "const snapshot = await this.operations.read(identity);",
    );
    const canonicalObservation = readRoute.indexOf(
      "await this.priceObserver.observeCanonical(identity, snapshot, context);",
    );
    const businessReconciliation = readRoute.indexOf(
      "await this.writeGate.reconcile({",
    );

    expect(capturedContext).toBeGreaterThanOrEqual(0);
    expect(canonicalRead).toBeGreaterThan(capturedContext);
    expect(canonicalObservation).toBeGreaterThan(canonicalRead);
    expect(businessReconciliation).toBeGreaterThan(canonicalObservation);
    expect(readRoute).not.toMatch(/\breconcilePriceWrites\s*\(/u);
  });

  it("keeps the owner main-only and dependent on the central Write Gate port", () => {
    const owner = source("../src/main/listing-price-mutations.ts");
    const forbiddenImports = importSpecifiers(owner).filter((specifier) =>
      /(?:^|\/)(?:renderer|preload)(?:\/|$)/u.test(specifier) ||
      /(?:^|\/)api-router(?:\.ts)?$/u.test(specifier) ||
      /(?:^|\/)local-store(?:\.ts)?$/u.test(specifier) ||
      /(?:^|\/)(?:advertising-)?credential-vault(?:\.ts)?$/u.test(specifier) ||
      /(?:^|\/)native-confirmation(?:\.ts)?$/u.test(specifier)
    );

    expect(forbiddenImports).toEqual([]);
    expect(owner).not.toMatch(
      /\b(?:approveWrite|WriteApproval|confirmSensitiveAction)\b/u,
    );
    expect(owner).toMatch(
      /import\s*\{[^;]*\bMainWriteGatePort\b[^;]*\}\s*from\s*["']\.\/write-gate["'];/mu,
    );
    expect(owner).toMatch(/\bwriteGate:\s*MainWriteGatePort\s*;/u);
  });

  it("keeps Price and Sale semantics out of the legacy SP facade and generic readback", () => {
    const owner = source("../src/main/listing-price-mutations.ts");
    const businessPricing = source(
      "../src/main/business-pricing-mutations.ts",
    );
    const spApi = source("../src/main/amazon/sp-api.ts");
    const readback = source("../src/main/amazon/listing-write-readback.ts");

    expect(importSpecifiers(owner)).not.toContain("./amazon/sp-api");
    for (const symbol of DIRECT_PRICE_OPERATIONS) {
      expect(spApi).not.toMatch(
        new RegExp(`\\b(?:export\\s+)?(?:async\\s+)?function\\s+${symbol}\\b`, "u"),
      );
    }
    for (const symbol of PRICE_READBACK_HELPERS) {
      expect(readback).not.toMatch(
        new RegExp(`\\bexport\\s+function\\s+${symbol}\\b`, "u"),
      );
      expect(owner).toMatch(
        new RegExp(`\\bexport\\s+function\\s+${symbol}\\b`, "u"),
      );
    }
    expect(businessPricing).toMatch(
      /import\s*\{[^}]*\bisPricingListingError\b[^}]*\}\s*from\s*["']\.\/amazon\/business-pricing-evidence["']/su,
    );
    expect(importSpecifiers(readback)).not.toContain(
      "./business-pricing-evidence",
    );
    expect(importSpecifiers(readback)).not.toContain(
      "./business-pricing-types",
    );
  });

  it("keeps the fixed transport gateway free of arbitrary request controls", () => {
    const gateway = source("../src/main/amazon/listing-price-gateway.ts");
    const port = methodBody(
      gateway,
      "export interface ListingPriceGateway {",
      "\n}",
    );

    expect(gateway).toMatch(/\bvalidationPreview\s*\(/u);
    expect(gateway).toMatch(/\bcommitOnce\s*\(/u);
    expect(port).not.toMatch(/\b(?:body|patches)\s*:/u);
    expect(port).not.toMatch(
      /\b(?:url|endpoint|method|headers|sellerId|accessToken|retryCount)\s*:/u,
    );
    expect(gateway).toMatch(/kind:\s*"standard-price"/u);
    expect(gateway).toMatch(/kind:\s*"sale-price"/u);
    expect(port).toMatch(
      /commitOnce\s*\(\s*input:\s*ListingPricePatch,\s*fence:\s*ListingWriteExecutionFence/u,
    );
    expect(port).not.toMatch(/fence\?:\s*ListingWriteExecutionFence/u);
  });

  it("keeps the production gateway and direct operations factory behind the composition root", () => {
    const files = sourceFilePaths(MAIN_ROOT);
    const gatewayConsumers = files
      .filter((path) => readFileSync(path, "utf8").includes(
        "listingPriceGatewayProduction",
      ))
      .map((path) => portablePath(relative(MAIN_ROOT, path)))
      .sort();
    const directOperationsConsumers = files
      .filter((path) => readFileSync(path, "utf8").includes(
        "createListingPriceMutationOperations",
      ))
      .map((path) => portablePath(relative(MAIN_ROOT, path)))
      .sort();
    const router = source("../src/main/api-router.ts");

    expect(portablePath("amazon\\sp-api.ts")).toBe("amazon/sp-api.ts");
    expect(gatewayConsumers).toEqual([
      "amazon/sp-api.ts",
      "api-router.ts",
    ]);
    expect(directOperationsConsumers).toEqual([
      "listing-price-mutations.ts",
    ]);
    expect(router).not.toMatch(
      /listingPriceGatewayProduction\.(?:validationPreview|commitOnce)/u,
    );
    expect(router).toMatch(
      /price:\s*\(identity,\s*context\)\s*=>\s*this\.priceMutations\.read\(identity,\s*context\)/u,
    );
  });
});
