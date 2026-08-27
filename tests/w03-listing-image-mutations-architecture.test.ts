import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROUTER_SOURCE = readFileSync(
  new URL("../src/main/api-router.ts", import.meta.url),
  "utf8",
);
const SP_API_SOURCE = readFileSync(
  new URL("../src/main/amazon/sp-api.ts", import.meta.url),
  "utf8",
);
const GENERIC_READBACK_SOURCE = readFileSync(
  new URL("../src/main/amazon/listing-write-readback.ts", import.meta.url),
  "utf8",
);
const IMAGE_OWNER_SOURCE = readFileSync(
  new URL("../src/main/listing-image-mutations.ts", import.meta.url),
  "utf8",
);
const IMAGE_GATEWAY_SOURCE = readFileSync(
  new URL("../src/main/amazon/listing-image-gateway.ts", import.meta.url),
  "utf8",
);
const IMAGE_PRODUCTION_SOURCE = readFileSync(
  new URL(
    "../src/main/amazon/listing-image-gateway-production.ts",
    import.meta.url,
  ),
  "utf8",
);

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

describe("W03 Listing Images mutation architecture", () => {
  it("keeps ApiRouter as dispatch/composition instead of a legacy image owner", () => {
    for (const legacyOwner of [
      "imageInput",
      "listingImages",
      "previewImages",
      "commitImages",
      "imageFingerprint",
      "reconcileImageWrites",
    ]) {
      expect(ROUTER_SOURCE).not.toMatch(
        new RegExp(`private (?:async )?${legacyOwner}\\b`, "u"),
      );
    }
    for (const legacyImport of [
      "getListingImages",
      "previewListingImageUpdate",
      "updateListingImages",
      "imageReadbackDecision",
      "reconcileImageWrite",
    ]) {
      expect(ROUTER_SOURCE).not.toMatch(
        new RegExp(`\\b${legacyImport}\\b`, "u"),
      );
    }
  });

  it("keeps image policy/readback in the deep owner and audit snapshots separate", () => {
    for (const legacyExport of [
      "getListingImages",
      "previewListingImageUpdate",
      "updateListingImages",
    ]) {
      expect(SP_API_SOURCE).not.toMatch(
        new RegExp(`export async function ${legacyExport}\\b`, "u"),
      );
    }
    expect(GENERIC_READBACK_SOURCE).not.toMatch(
      /export function (?:imageReadbackDecision|reconcileImageWrite)\b/u,
    );
    expect(IMAGE_OWNER_SOURCE).not.toMatch(
      /from ["'].+(?:image-audit|listings-export|catalog-report|audit-suite|standalone-audit|xlsx)/u,
    );
    expect(IMAGE_OWNER_SOURCE).not.toMatch(/listing-price-(?:types|gateway)/u);
    expect(IMAGE_GATEWAY_SOURCE).not.toMatch(/listing-price-(?:types|gateway)/u);
    expect(SP_API_SOURCE).toMatch(
      /const\s+listingImageGatewayRuntime\s*=\s*createListingImageGatewayProduction\(\{/u,
    );
    expect(SP_API_SOURCE).toMatch(
      /export\s+const\s+listingImageGatewayProduction\s*=\s*listingImageGatewayRuntime\.gateway/u,
    );
    expect(SP_API_SOURCE).not.toMatch(
      /\b(?:listingImageUrl|imageSnapshotFromContext|listingImageEvidence|resolveListingImageEvidence|listingImageGatewayPatchBody|demoImageOverrides)\b/u,
    );
  });

  it("keeps the image gateway closed and requires a final execution fence", () => {
    const port = IMAGE_GATEWAY_SOURCE.slice(
      IMAGE_GATEWAY_SOURCE.indexOf("export interface ListingImageGateway {"),
      IMAGE_GATEWAY_SOURCE.indexOf("\n}", IMAGE_GATEWAY_SOURCE.indexOf(
        "export interface ListingImageGateway {",
      )) + 2,
    );

    expect(port).toMatch(/\bvalidationPreview\s*\(/u);
    expect(port).toMatch(/\bcommitOnce\s*\(/u);
    expect(port).toMatch(
      /commitOnce\s*\(\s*patch:\s*ListingImagePatchDescriptor,\s*fence:\s*ListingWriteExecutionFence/u,
    );
    expect(port).toMatch(
      /replaceDemoImages\s*\(\s*patch:\s*ListingImagePatchDescriptor,\s*fence:\s*ListingWriteExecutionFence/u,
    );
    expect(port).not.toMatch(/fence\?:\s*ListingWriteExecutionFence/u);
    expect(port).not.toMatch(
      /\b(?:url|endpoint|method|headers|sellerId|accessToken|retryCount|body|patches)\s*:/u,
    );
  });

  it("keeps one production factory and fixed Listings write transport", () => {
    const files = sourceFilePaths(MAIN_ROOT);
    const factoryOwners = files
      .filter((path) => /\bcreateListingImageGatewayProduction\(\{/u.test(
        readFileSync(path, "utf8"),
      ))
      .map((path) => portablePath(relative(MAIN_ROOT, path)))
      .sort();

    expect(factoryOwners).toEqual(["amazon/sp-api.ts"]);
    expect(IMAGE_PRODUCTION_SOURCE).toContain(
      "const listingImageEvidence = new WeakMap",
    );
    expect(IMAGE_PRODUCTION_SOURCE).toContain(
      "contentReads: ListingContentReadProduction",
    );
    expect(IMAGE_PRODUCTION_SOURCE).toMatch(
      /dependencies\.write\.validationPreview\(\{/u,
    );
    expect(IMAGE_PRODUCTION_SOURCE).toMatch(
      /dependencies\.write\.commitOnce\(\{[\s\S]*assertBeforeSend:\s*\(\)\s*=>\s*fence\.assertCurrent\(\)/u,
    );
    expect(IMAGE_PRODUCTION_SOURCE).not.toMatch(/\bfetch\s*\(/u);
    expect(IMAGE_PRODUCTION_SOURCE).not.toMatch(
      /\b(?:accessToken|sellerId|retryCount|endpoint)\s*[:=(]/u,
    );
  });
});
