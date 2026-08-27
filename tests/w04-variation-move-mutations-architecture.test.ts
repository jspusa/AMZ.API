import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const MAIN_ROOT = fileURLToPath(new URL("../src/main/", import.meta.url));

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

describe("W04 Variation Move mutation architecture", () => {
  it("keeps ApiRouter as dispatch and composition instead of a legacy Variation Move owner", () => {
    const router = source("../src/main/api-router.ts");
    const legacyOwners = [
      "variationMovePreparation",
      "variationMoveInput",
      "variationMoveFingerprint",
      "previewVariationMove",
      "commitVariationMove",
    ].filter((symbol) =>
      new RegExp(`private (?:async )?${symbol}\\b`, "u").test(router)
    );
    const directOperations = [
      "getVariationMovePreparation",
      "previewVariationMove",
      "updateVariationMove",
      "VariationMoveInput",
    ].filter((symbol) => new RegExp(`\\b${symbol}\\b`, "u").test(router));

    expect(legacyOwners).toEqual([]);
    expect(directOperations).toEqual([]);
  });

  it("keeps Variation Move policy in the deep Module instead of the legacy SP facade", () => {
    const owner = source("../src/main/variation-move-mutations.ts");
    const spApi = source("../src/main/amazon/sp-api.ts");
    const productionGateway = source(
      "../src/main/amazon/variation-move-gateway-production.ts",
    );

    expect(owner).not.toMatch(/from ["']\.\/amazon\/sp-api["']/u);
    expect(owner).not.toMatch(
      /export (?:interface|type) VariationMoveMutationOperations\b/u,
    );
    expect(owner).not.toMatch(
      /export function createVariationMoveMutationOperations\b/u,
    );
    for (const legacyExport of [
      "getVariationMovePreparation",
      "previewVariationMove",
      "updateVariationMove",
    ]) {
      expect(spApi).not.toMatch(
        new RegExp(`export async function ${legacyExport}\\b`, "u"),
      );
    }
    for (const legacyPolicy of [
      "prepareLiveVariationContext",
      "prepareLiveVariationAction",
      "verifyVariationMoveReadback",
      "assertNoDuplicateTargetDimensions",
    ]) {
      expect(spApi).not.toMatch(new RegExp(`\\b${legacyPolicy}\\b`, "u"));
    }
    expect(productionGateway).toContain(
      "export function createVariationMoveGatewayProduction",
    );
    expect(productionGateway).toContain("new WeakMap");
    expect(spApi).toMatch(
      /createVariationMoveGatewayProduction\(\{[\s\S]*write:\s*listingsWriteProduction,[\s\S]*\}\)/u,
    );
    expect(spApi).not.toMatch(
      /\b(?:ListingsWriteReceipt|SpApiPreCommitError|UPDATE_STATUS_UNKNOWN|PRECOMMIT_FAILED)\b/u,
    );
  });

  it("keeps one production factory and maps the closed patch through fixed Listings writes", () => {
    const files = sourceFilePaths(MAIN_ROOT);
    const production = source(
      "../src/main/amazon/variation-move-gateway-production.ts",
    );
    const factoryOwners = files
      .filter((path) => /\bcreateVariationMoveGatewayProduction\(\{/u.test(
        readFileSync(path, "utf8"),
      ))
      .map((path) => portablePath(relative(MAIN_ROOT, path)))
      .sort();

    expect(factoryOwners).toEqual(["amazon/sp-api.ts"]);
    expect(production).toMatch(
      /\bwrite:\s*ListingsWriteProduction\s*;/u,
    );
    expect(production).toMatch(
      /dependencies\.write\.validationPreview\(\{[\s\S]*patchBody:\s*patchBody\(descriptor\)/u,
    );
    expect(production).toMatch(
      /dependencies\.write\.commitOnce\(\{[\s\S]*patchBody:\s*body,[\s\S]*assertBeforeSend:\s*\(\)\s*=>\s*fence\.assertCurrent\(\),[\s\S]*recordBeforeSend:/u,
    );
    expect(production).toContain("error.code === \"UPDATE_STATUS_UNKNOWN\"");
    expect(production).toContain("new SpApiPreCommitError(cause)");
    expect(production).not.toMatch(/\bfetch\s*\(/u);
  });
});
