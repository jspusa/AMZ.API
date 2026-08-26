import { readFileSync } from "node:fs";
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
});
