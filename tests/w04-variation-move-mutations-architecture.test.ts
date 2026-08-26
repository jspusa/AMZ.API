import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
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
  });
});
