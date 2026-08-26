import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function importSpecifiers(value: string): string[] {
  return [...value.matchAll(/\bfrom\s+["']([^"']+)["']/gmu)].map(
    (match) => match[1]!,
  );
}

describe("W01 main-owned Write Gate architecture", () => {
  it("keeps preview, approval, reservation and durable-ledger ownership out of Router", () => {
    const routerSource = source("../src/main/api-router.ts");
    const writeGateImport = routerSource.match(
      /import\s*\{(?<bindings>[\s\S]*?)\}\s*from\s*["']\.\/write-gate["'];/mu,
    );

    expect(writeGateImport?.groups?.bindings).toMatch(
      /\btype\s+MainWriteGatePort\b/u,
    );
    expect(routerSource).toMatch(
      /\bprivate\s+readonly\s+writeGate:\s*MainWriteGatePort;/u,
    );

    const legacyRouterOwnership = [
      ["PreviewTicket", /\bPreviewTicket\b/u],
      ["private previews map", /\bprivate\s+readonly\s+previews\s*=\s*new\s+Map\b/u],
      ["listingAttributeWriteReservations", /\blistingAttributeWriteReservations\b/u],
      ["reserveListingAttributeWrites", /\breserveListingAttributeWrites\b/u],
      ["approveReservedPreview", /\bapproveReservedPreview\b/u],
      ["runIdempotentOperation", /\.runIdempotentOperation\s*\(/u],
      [
        "assertIdempotentOperationsAvailable",
        /\.assertIdempotentOperationsAvailable\s*\(/u,
      ],
      ["reconcileIdempotentOperations", /\.reconcileIdempotentOperations\s*\(/u],
    ] as const;

    for (const [owner, pattern] of legacyRouterOwnership) {
      expect(
        routerSource,
        `${owner} must be owned by the main Write Gate`,
      ).not.toMatch(pattern);
    }
  });

  it("keeps the Write Gate independent from routes, renderer and mutation domains", () => {
    const writeGateSource = source("../src/main/write-gate.ts");
    const forbiddenImports = importSpecifiers(writeGateSource).filter(
      (specifier) =>
        /(?:^|\/)api-router(?:\.ts)?$/u.test(specifier) ||
        /(?:^|\/)(?:renderer|preload)(?:\/|$)/u.test(specifier) ||
        /(?:^|\/)shared\/contracts(?:\.ts)?$/u.test(specifier) ||
        /(?:^|\/)sp-api(?:\.ts)?$/u.test(specifier) ||
        /(?:^|\/)listing-write-readback(?:\.ts)?$/u.test(specifier),
    );

    expect(forbiddenImports).toEqual([]);
  });
});
