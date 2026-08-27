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
  if (start < 0) throw new Error(`Section not found: ${startMarker}`);
  const end = value.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`Section end not found: ${endMarker}`);
  return value.slice(start, end);
}

const MAIN_ROOT = fileURLToPath(new URL("../src/main/", import.meta.url));

const ROUTES = [
  ["GET /api/sp-api/business-pricing", "read"],
  ["POST /api/sp-api/business-pricing", "preview"],
  ["PATCH /api/sp-api/business-pricing", "commit"],
] as const;

const LEGACY_ROUTER_OWNERS = [
  "businessPricingInput",
  "businessPricingFingerprint",
  "previewBusinessPricing",
  "commitBusinessPricing",
  "reconcileBusinessPriceWrites",
] as const;

const LEGACY_SP_FACADE = [
  "getBusinessPricing",
  "previewBusinessPriceUpdate",
  "updateBusinessPrice",
] as const;

const LEGACY_SP_POLICY = [
  "buildBusinessPricePatch",
  "requestedBusinessQuantityDiscountPlan",
  "verifyBusinessPriceChange",
  "businessPricePrecommitEvidence",
  "assertBusinessPricePrecommitEvidence",
  "prepareLiveBusinessPriceUpdate",
] as const;

describe("W05 Business Pricing mutation architecture", () => {
  it("delegates the three exact public routes directly to one closed owner", () => {
    const router = source("../src/main/api-router.ts");

    for (const [key, operation] of ROUTES) {
      const body = switchCaseBody(router, key);
      expect(body, `${key} must delegate without a legacy fallback`).toMatch(
        new RegExp(
          String.raw`^\s*return\s+this\.businessPricingMutations\.handle\(\{\s*operation:\s*"${operation}",\s*request,?\s*\}\);?\s*$`,
          "u",
        ),
      );
    }
  });

  it("keeps Router limited to dispatch and production composition", () => {
    const router = source("../src/main/api-router.ts");
    const legacyOwners = LEGACY_ROUTER_OWNERS.filter((symbol) =>
      new RegExp(`\\b${symbol}\\s*\\(`, "u").test(router)
    );
    const directOperations = [
      ...LEGACY_SP_FACADE,
      "businessPriceReadbackDecision",
      "reconcileBusinessPriceWrite",
    ].filter((symbol) => new RegExp(`\\b${symbol}\\b`, "u").test(router));

    expect(legacyOwners).toEqual([]);
    expect(directOperations).toEqual([]);
    expect(router).toMatch(
      /createBusinessPricingMutations\(\{\s*context:\s*this\.spExecutionContext,\s*writeGate:\s*this\.writeGate,\s*priceObserver:\s*this\.priceMutations,\s*gateway:\s*businessPricingGatewayProduction,\s*\}\)/su,
    );
    expect(router).not.toMatch(
      /businessPricingGatewayProduction\.(?:read|validationPreview|commitOnce|replaceDemoContribution)/u,
    );
  });

  it("keeps one main-only deep owner behind the central Write Gate", () => {
    const owner = source("../src/main/business-pricing-mutations.ts");
    const forbiddenImports = importSpecifiers(owner).filter((specifier) =>
      /(?:^|\/)(?:renderer|preload)(?:\/|$)/u.test(specifier) ||
      /(?:^|\/)api-router(?:\.ts)?$/u.test(specifier) ||
      /(?:^|\/)local-store(?:\.ts)?$/u.test(specifier) ||
      /(?:^|\/)(?:advertising-)?credential-vault(?:\.ts)?$/u.test(specifier) ||
      /(?:^|\/)native-confirmation(?:\.ts)?$/u.test(specifier)
    );

    expect(forbiddenImports).toEqual([]);
    expect(importSpecifiers(owner)).not.toContain("./amazon/sp-api");
    expect(owner).toMatch(
      /import\s*\{[^;]*\bMainWriteGatePort\b[^;]*\}\s*from\s*["']\.\/write-gate["'];/mu,
    );
    expect(owner).toMatch(/\bwriteGate:\s*MainWriteGatePort\s*;/u);
    expect(owner).not.toMatch(
      /export\s+interface\s+BusinessPricingMutationOperations\b/u,
    );
    expect(owner).not.toMatch(
      /export\s+function\s+createBusinessPricingMutationOperations\b/u,
    );
  });

  it("removes superseded B2B mutation facades and policy from sp-api", () => {
    const spApi = source("../src/main/amazon/sp-api.ts");

    for (const symbol of LEGACY_SP_FACADE) {
      expect(spApi).not.toMatch(
        new RegExp(
          `\\bexport\\s+(?:async\\s+)?function\\s+${symbol}\\b`,
          "u",
        ),
      );
    }
    for (const symbol of LEGACY_SP_POLICY) {
      expect(spApi).not.toMatch(new RegExp(`\\b${symbol}\\b`, "u"));
    }
    expect(spApi).toMatch(
      /const\s+businessPricingGatewayRuntime\s*=\s*createBusinessPricingGatewayProduction\(\{/u,
    );
    expect(spApi).toMatch(
      /export\s+const\s+businessPricingGatewayProduction\s*=\s*businessPricingGatewayRuntime\.gateway/u,
    );
    expect(spApi).not.toMatch(
      /\b(?:fetchLiveBusinessPricing|demoBusinessPricing|demoBusinessPriceOverrides|demoBusinessQuantityDiscountOverrides|businessPricingPatchBody)\b/u,
    );
  });

  it("moves B2B reconciliation out of generic Listings readback into the owner", () => {
    const owner = source("../src/main/business-pricing-mutations.ts");
    const readback = source("../src/main/amazon/listing-write-readback.ts");

    for (const symbol of [
      "businessPriceReadbackDecision",
      "reconcileBusinessPriceWrite",
    ]) {
      expect(readback).not.toMatch(
        new RegExp(`\\bexport\\s+function\\s+${symbol}\\b`, "u"),
      );
      expect(owner).toMatch(
        new RegExp(`\\b(?:export\\s+)?function\\s+${symbol}\\b`, "u"),
      );
    }
    expect(importSpecifiers(readback)).not.toContain(
      "./business-pricing-evidence",
    );
    expect(importSpecifiers(readback)).not.toContain(
      "./business-pricing-types",
    );
  });

  it("keeps a fixed B2B gateway with mandatory fence and durable-dispatch callback", () => {
    const gateway = source("../src/main/amazon/business-pricing-gateway.ts");
    const port = section(
      gateway,
      "export interface BusinessPricingGateway {",
      "\n}",
    );

    expect(gateway).toMatch(/kind:\s*"price-only"/u);
    expect(gateway).toMatch(/quantityDiscountPlan:\s*null/u);
    expect(gateway).toMatch(/kind:\s*"combined"/u);
    expect(gateway).toMatch(/audience:\s*"B2B"/u);
    expect(gateway).toMatch(/patch\.kind\s*===\s*"combined"/u);
    expect(port).toMatch(/\bvalidationPreview\s*\(/u);
    expect(port).toMatch(
      /commitOnce\s*\(\s*patch:\s*BusinessPricePatch,\s*fence:\s*ListingWriteExecutionFence,\s*recordDispatch:\s*\(\)\s*=>\s*Promise<void>/su,
    );
    expect(port).toMatch(
      /replaceDemoContribution\s*\(\s*patch:\s*BusinessPricePatch,\s*fence:\s*ListingWriteExecutionFence/su,
    );
    expect(port).not.toMatch(/(?:fence|recordDispatch)\?:/u);
    expect(port).not.toMatch(
      /\b(?:url|endpoint|method|headers|sellerId|accessToken|retryCount|body|patches)\s*:/u,
    );
  });

  it("keeps gateway mapping at the root and fixed transport in its production owner", () => {
    const production = source(
      "../src/main/amazon/business-pricing-gateway-production.ts",
    );
    const transport = source(
      "../src/main/amazon/listings-write-production.ts",
    );
    const productionGateway = section(
      production,
      "  const gateway: BusinessPricingGateway = {",
      "\n  };",
    );
    const files = sourceFilePaths(MAIN_ROOT);
    const productionConsumers = files
      .filter((path) => readFileSync(path, "utf8").includes(
        "businessPricingGatewayProduction",
      ))
      .map((path) => portablePath(relative(MAIN_ROOT, path)))
      .sort();

    expect(portablePath("amazon\\sp-api.ts")).toBe("amazon/sp-api.ts");
    expect(productionConsumers).toEqual([
      "amazon/sp-api.ts",
      "api-router.ts",
    ]);
    const factoryOwners = files
      .filter((path) => /\bcreateBusinessPricingGatewayProduction\(\{/u.test(
        readFileSync(path, "utf8"),
      ))
      .map((path) => portablePath(relative(MAIN_ROOT, path)))
      .sort();
    expect(factoryOwners).toEqual(["amazon/sp-api.ts"]);
    expect(productionGateway).toMatch(
      /commitOnce:\s*async\s*\(patch,\s*fence,\s*recordDispatch\)\s*=>/u,
    );
    expect(productionGateway).toMatch(
      /assertBeforeSend:\s*\(\)\s*=>\s*fence\.assertCurrent\(\)/u,
    );
    expect(productionGateway).toMatch(
      /recordBeforeSend:\s*recordDispatch/u,
    );
    const send = section(transport, "  const send = async (", "\n  };");
    const firstFence = send.indexOf(
      "await assertBeforeSend(command.assertBeforeSend);",
    );
    const record = send.indexOf("await command.recordBeforeSend();");
    const secondFence = send.indexOf(
      "await assertBeforeSend(command.assertBeforeSend);",
      firstFence + 1,
    );
    const fixedPatch = send.indexOf("method: \"PATCH\"");
    expect([firstFence, record, secondFence, fixedPatch].every(
      (index) => index >= 0,
    )).toBe(true);
    expect(firstFence).toBeLessThan(record);
    expect(record).toBeLessThan(secondFence);
    expect(secondFence).toBeLessThan(fixedPatch);

    for (const auditPath of [
      "../src/main/amazon/business-pricing-audit.ts",
      "../src/main/amazon/business-pricing-evidence.ts",
      "../src/main/amazon/catalog-report-reads.ts",
    ]) {
      const imports = importSpecifiers(source(auditPath));
      expect(imports).not.toContain("./business-pricing-gateway");
      expect(imports).not.toContain("../business-pricing-mutations");
    }
  });
});
