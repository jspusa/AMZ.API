import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));

const LEGACY_RUNTIME_MODULES = new Set([
  "src/main/amazon/sp-api.ts",
  "src/main/api-router.ts",
  "src/main/index.ts",
]);

const NEW_SP_LEAF_MODULES = [
  "src/main/amazon/sp-execution-context.ts",
  "src/main/amazon/sp-api-error.ts",
] as const;

const EXTRACTED_FBA_SALES_MODULES = [
  "src/main/amazon/fba-sales-calendar.ts",
  "src/main/amazon/fba-sales-metrics.ts",
  "src/main/amazon/fba-sales-metrics-demo.ts",
  "src/main/amazon/fba-sales-metrics-production.ts",
] as const;

const EXTRACTED_LISTINGS_READ_MODULES = [
  "src/main/amazon/listings-reads.ts",
  "src/main/amazon/listings-reads-production.ts",
] as const;

const EXTRACTED_FBA_INVENTORY_REPLENISHMENT_MODULES = [
  "src/main/amazon/fba-inventory-replenishment.ts",
  "src/main/amazon/fba-inventory-replenishment-production.ts",
  "src/main/amazon/replenishment-audit.ts",
] as const;

const EXTRACTED_VARIATION_CATALOG_MODULES = [
  "src/main/amazon/variation-family-reads.ts",
  "src/main/amazon/variation-relationship-evidence.ts",
  "src/main/amazon/variation-catalog-reads.ts",
  "src/main/amazon/exact-seller-sku-batches.ts",
  "src/main/amazon/listings-response-error.ts",
  "src/main/amazon/variation-family.ts",
  "src/main/amazon/unbound-variation-audit.ts",
] as const;

const EXTRACTED_REPORTS_MODULES = [
  "src/main/amazon/report-lifecycle.ts",
  "src/main/amazon/reports-runtime.ts",
  "src/main/amazon/reports-runtime-production.ts",
] as const;

const PURE_CATALOG_REPORT_MODULES = [
  "src/main/amazon/business-pricing-evidence.ts",
  "src/main/amazon/catalog-report-reads.ts",
] as const;

const FBA_CATALOG_REPORTS_COORDINATOR =
  "src/main/amazon/fba-catalog-reports.ts";

const FORBIDDEN_CATALOG_MODULE_DEPENDENCIES = new Set([
  "src/main/amazon/listing-write-readback.ts",
  "src/main/amazon/reports-runtime.ts",
  "src/main/amazon/variation-update.ts",
  "src/main/credential-vault.ts",
  "src/main/local-store.ts",
]);

const FORBIDDEN_CATALOG_PTD_IMPORTS = new Set([
  "ProductTypeDefinitionReadIdentity",
  "ProductTypeDefinitionReadPlan",
  "ProductTypeDefinitionReadResult",
  "readDefinition",
  "readProductTypeDefinition",
]);

const FORBIDDEN_REPORT_TRANSPORT_IMPORTS = new Set([
  "ReportsAdapter",
  "ReportsAdapterDocument",
  "ReportsAdapterIdentity",
  "ReportsAdapterRequest",
  "ReportsAdapterStatus",
  "ReportsCreateRequest",
  "ReportsDocumentRequest",
  "ReportsStatusRequest",
]);

const SUPERSEDED_CATALOG_HELPERS = [
  "canonicalSingleBasePriceAmount",
  "canonicalBusinessQuantityDiscountPlan",
  "summarizeBusinessPricingAudit",
  "withBusinessPricingRecommendations",
  "incompleteBusinessPricingAuditRow",
  "unavailableListingsBusinessPricingAuditRow",
  "exactBusinessPricingAuditPayload",
  "completeBusinessPricingAuditRow",
  "listingReportBusinessPriceEvidence",
  "listingReportQuantityDiscountColumns",
  "listingReportPositiveNumber",
  "listingReportQuantityDiscountEvidence",
  "parseFbaListingReport",
  "parseBusinessPricingActiveListingsReport",
  "reconcileBusinessPriceReportEvidence",
  "sameBusinessQuantityDiscountPlan",
  "reconcileBusinessQuantityDiscountReportEvidence",
  "reconcileListingsAndReportQuantityDiscountEvidence",
  "exportRowFromListing",
  "fetchExportRows",
  "getBusinessPricingAuditData",
  "getBusinessPricingAuditDataFromDocuments",
  "getBusinessPricingActiveListingsReportDocument",
  "getFbaReviewAuditCandidates",
  "getFbaReviewAuditCandidatesFromDocument",
  "getAllListingsExportData",
  "getAllListingsExportDataFromDocument",
  "getFbaListingIdentitySnapshot",
  "getFbaListingIdentitySnapshotFromDocument",
  "getUnboundVariationAuditData",
  "getUnboundVariationAuditDataFromDocument",
  "verifyFbaReviewAuditSeeds",
  "startAllListingsReport",
  "getAllListingsReportStatus",
  "startBusinessPricingActiveListingsReport",
  "getBusinessPricingActiveListingsReportStatus",
  "getBrandSalesData",
  "getFixedReportsDocumentText",
] as const;

const FORBIDDEN_VARIATION_CATALOG_DEPENDENCIES = new Set([
  "src/main/amazon/listings-reads-production.ts",
  "src/main/amazon/variation-update.ts",
  "src/main/local-store.ts",
  "src/main/credential-vault.ts",
  "src/preload/index.ts",
]);

const ERROR_CONSUMERS = new Map<string, readonly string[]>([
  ["src/main/local-store.ts", ["SpApiError", "SpApiPreCommitError"]],
  ["src/main/amazon/connection-health.ts", ["SpApiError"]],
  ["src/main/amazon/report-lifecycle.ts", ["SpApiError"]],
]);

type SourceImport = Readonly<{
  specifier: string;
  importedNames: readonly string[];
}>;

function repositoryPath(absolutePath: string): string {
  return relative(REPOSITORY_ROOT, absolutePath).split(sep).join("/");
}

function absolutePath(repositoryRelativePath: string): string {
  return resolve(REPOSITORY_ROOT, repositoryRelativePath);
}

function sourceImports(sourcePath: string): SourceImport[] {
  const source = ts.createSourceFile(
    sourcePath,
    readFileSync(sourcePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const imports: SourceImport[] = [];

  function append(specifier: ts.Expression, importedNames: readonly string[] = []): void {
    if (ts.isStringLiteralLike(specifier)) {
      imports.push({ specifier: specifier.text, importedNames });
    }
  }

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) {
      const importedNames = node.importClause?.namedBindings &&
        ts.isNamedImports(node.importClause.namedBindings)
        ? node.importClause.namedBindings.elements.map(
            (element) => element.propertyName?.text ?? element.name.text,
          )
        : [];
      append(node.moduleSpecifier, importedNames);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      append(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression
    ) {
      append(node.moduleReference.expression);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length > 0 &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      append(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return imports;
}

function resolveLocalImport(importer: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const unresolved = resolve(dirname(importer), specifier);
  const candidates = extname(unresolved)
    ? [unresolved]
    : [
        `${unresolved}.ts`,
        `${unresolved}.tsx`,
        `${unresolved}.mts`,
        `${unresolved}.cts`,
        resolve(unresolved, "index.ts"),
        resolve(unresolved, "index.tsx"),
      ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function legacyDependencies(entryPath: string): string[] {
  const pending = [absolutePath(entryPath)];
  const visited = new Set<string>();
  const violations = new Set<string>();

  while (pending.length > 0) {
    const sourcePath = pending.pop();
    if (!sourcePath || visited.has(sourcePath)) continue;
    visited.add(sourcePath);

    for (const sourceImport of sourceImports(sourcePath)) {
      const dependency = resolveLocalImport(sourcePath, sourceImport.specifier);
      if (!dependency) continue;
      const dependencyPath = repositoryPath(dependency);
      if (LEGACY_RUNTIME_MODULES.has(dependencyPath)) {
        violations.add(`${repositoryPath(sourcePath)} -> ${dependencyPath}`);
      } else if (!visited.has(dependency)) {
        pending.push(dependency);
      }
    }
  }

  return [...violations].sort();
}

function isForbiddenCatalogDependency(dependencyPath: string): boolean {
  return LEGACY_RUNTIME_MODULES.has(dependencyPath) ||
    FORBIDDEN_CATALOG_MODULE_DEPENDENCIES.has(dependencyPath) ||
    /-production\.(?:ts|tsx)$/u.test(dependencyPath) ||
    /(?:^|\/)transport(?:[-/.]|$)/u.test(dependencyPath) ||
    dependencyPath.startsWith("src/preload/") ||
    dependencyPath.startsWith("src/renderer/");
}

function catalogDependencyViolations(
  entryPath: string,
  options: Readonly<{
    recursive: boolean;
    allowReportsRuntime?: boolean;
    forbidReportTransportImports?: boolean;
  }>,
): string[] {
  const entrySourcePath = absolutePath(entryPath);
  const pending = [entrySourcePath];
  const visited = new Set<string>();
  const violations = new Set<string>();

  while (pending.length > 0) {
    const sourcePath = pending.pop();
    if (!sourcePath || visited.has(sourcePath)) continue;
    visited.add(sourcePath);

    for (const sourceImport of sourceImports(sourcePath)) {
      const dependency = resolveLocalImport(sourcePath, sourceImport.specifier);
      if (!dependency) continue;
      const dependencyPath = repositoryPath(dependency);
      const sourceRepositoryPath = repositoryPath(sourcePath);
      if (
        isForbiddenCatalogDependency(dependencyPath) &&
        !(
          options.allowReportsRuntime &&
          dependencyPath === "src/main/amazon/reports-runtime.ts"
        )
      ) {
        violations.add(`${sourceRepositoryPath} -> ${dependencyPath}`);
      }

      const forbiddenPtdImports = sourcePath === entrySourcePath
        ? sourceImport.importedNames.filter((name) =>
            FORBIDDEN_CATALOG_PTD_IMPORTS.has(name)
          )
        : [];
      if (forbiddenPtdImports.length > 0) {
        violations.add(
          `${sourceRepositoryPath} -> ${dependencyPath} (${forbiddenPtdImports.sort().join(", ")})`,
        );
      }

      if (
        options.forbidReportTransportImports &&
        dependencyPath === "src/main/amazon/reports-runtime.ts"
      ) {
        const forbiddenTransportImports = sourceImport.importedNames.filter(
          (name) => FORBIDDEN_REPORT_TRANSPORT_IMPORTS.has(name),
        );
        if (forbiddenTransportImports.length > 0) {
          violations.add(
            `${sourceRepositoryPath} -> ${dependencyPath} (${forbiddenTransportImports.sort().join(", ")})`,
          );
        }
      }

      if (options.recursive && !visited.has(dependency)) {
        pending.push(dependency);
      }
    }
  }

  return [...violations].sort();
}

function exportedTypePropertyNames(
  sourcePath: string,
  exportedTypeName: string,
): string[] {
  const program = ts.createProgram([sourcePath], {
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(sourcePath);
  if (!source) throw new Error(`Source file not found: ${sourcePath}`);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) throw new Error(`Module symbol not found: ${sourcePath}`);
  const exportedType = checker
    .getExportsOfModule(moduleSymbol)
    .find((symbol) => symbol.name === exportedTypeName);
  if (!exportedType) {
    throw new Error(`Exported type not found: ${exportedTypeName}`);
  }
  return checker
    .getPropertiesOfType(checker.getDeclaredTypeOfSymbol(exportedType))
    .map((property) => property.name)
    .sort();
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [path] : [];
  });
}

describe("SP execution-context architecture", () => {
  it.each(NEW_SP_LEAF_MODULES)(
    "%s stays independent from legacy runtime modules",
    (entryPath) => {
      expect(legacyDependencies(entryPath)).toEqual([]);
    },
  );

  it.each(EXTRACTED_FBA_SALES_MODULES)(
    "%s does not import the legacy SP facade",
    (entryPath) => {
      const sourcePath = absolutePath(entryPath);
      const violations = sourceImports(sourcePath)
        .map((sourceImport) =>
          resolveLocalImport(sourcePath, sourceImport.specifier),
        )
        .filter((dependency): dependency is string => dependency !== null)
        .map(repositoryPath)
        .filter((dependency) => dependency === "src/main/amazon/sp-api.ts");

      expect(violations).toEqual([]);
    },
  );

  it.each(EXTRACTED_LISTINGS_READ_MODULES)(
    "%s does not import the legacy SP facade",
    (entryPath) => {
      expect(legacyDependencies(entryPath)).toEqual([]);
    },
  );

  it.each(EXTRACTED_FBA_INVENTORY_REPLENISHMENT_MODULES)(
    "%s stays independent from legacy runtime modules",
    (entryPath) => {
      expect(legacyDependencies(entryPath)).toEqual([]);
    },
  );

  it.each(EXTRACTED_VARIATION_CATALOG_MODULES)(
    "%s stays independent from legacy runtime modules",
    (entryPath) => {
      expect(legacyDependencies(entryPath)).toEqual([]);
    },
  );

  it.each(EXTRACTED_REPORTS_MODULES)(
    "%s stays independent from legacy runtime modules",
    (entryPath) => {
      expect(legacyDependencies(entryPath)).toEqual([]);
    },
  );

  it.each(PURE_CATALOG_REPORT_MODULES)(
    "%s stays outside legacy, production, write, PTD, preload, and renderer wiring",
    (entryPath) => {
      expect(catalogDependencyViolations(entryPath, { recursive: true }))
        .toEqual([]);
    },
  );

  it("keeps the FBA catalog coordinator on runtime ports and out of transport, production, and write wiring", () => {
    expect(catalogDependencyViolations(FBA_CATALOG_REPORTS_COORDINATOR, {
      recursive: false,
      allowReportsRuntime: true,
      forbidReportTransportImports: true,
    })).toEqual([]);
  });

  it("keeps the catalog Listings interface free of fetch, URL, method, and PTD capabilities", () => {
    expect(exportedTypePropertyNames(
      absolutePath("src/main/amazon/catalog-report-reads.ts"),
      "CatalogListingsReadAdapter",
    )).toEqual(["readItem", "searchItems"]);
  });

  it("removes superseded catalog and B2B helper declarations from the SP facade", () => {
    const source = readFileSync(
      absolutePath("src/main/amazon/sp-api.ts"),
      "utf8",
    );
    for (const helper of SUPERSEDED_CATALOG_HELPERS) {
      expect(source).not.toMatch(new RegExp(`function\\s+${helper}\\b`, "u"));
    }
    expect(source).not.toContain("parseFbaListingReportSeeds");
  });

  it("keeps report documents behind the FBA catalog coordinator", () => {
    const routerSource = readFileSync(
      absolutePath("src/main/api-router.ts"),
      "utf8",
    );
    for (const helper of [
      "getBusinessPricingAuditDataFromDocuments",
      "getFbaReviewAuditCandidatesFromDocument",
      "getAllListingsExportDataFromDocument",
      "getFbaListingIdentitySnapshotFromDocument",
      "getUnboundVariationAuditDataFromDocument",
    ]) {
      expect(routerSource).not.toMatch(new RegExp(`\\b${helper}\\b`, "u"));
    }
    expect(routerSource).toContain("function routerDemoReportsAdapter");
    expect(routerSource).toContain("assertDemoReportsRequest(request)");
    expect(routerSource).not.toMatch(/\brouterReportsAdapter\b/u);
  });

  it("keeps the Reports runtime main-only and wires its production adapter explicitly", () => {
    const forbiddenConsumers = [
      ...sourceFiles(absolutePath("src/preload")),
      ...sourceFiles(absolutePath("src/renderer")),
      ...sourceFiles(absolutePath("src/shared")),
    ].flatMap((sourcePath) =>
      sourceImports(sourcePath)
        .map((sourceImport) => resolveLocalImport(sourcePath, sourceImport.specifier))
        .filter((dependency): dependency is string => dependency !== null)
        .map(repositoryPath)
        .filter((dependency) =>
          dependency === "src/main/amazon/reports-runtime.ts" ||
          dependency === "src/main/amazon/reports-runtime-production.ts"
        )
        .map((dependency) => `${repositoryPath(sourcePath)} -> ${dependency}`)
    );
    expect(forbiddenConsumers).toEqual([]);

    const indexSource = readFileSync(absolutePath("src/main/index.ts"), "utf8");
    expect(indexSource).toContain("reportsAdapter: reportsRuntimeProductionAdapter");

    const routerSource = readFileSync(
      absolutePath("src/main/api-router.ts"),
      "utf8",
    ).replace(/\r\n?/gu, "\n");
    expect(routerSource).not.toContain("resolveInternalReferences(");
    expect(routerSource).toContain(
      "const liveReportsAdapter = input.reportsAdapter ??\n" +
      "      reportsRuntimeProductionAdapter;",
    );
    expect(routerSource).not.toContain(
      "const reportsAdapter: ReportsAdapter = input.reportsAdapter",
    );
  });

  it.each([
    "src/main/amazon/variation-family-reads.ts",
    "src/main/amazon/variation-relationship-evidence.ts",
    "src/main/amazon/variation-catalog-reads.ts",
  ])("keeps %s outside write and production wiring", (entryPath) => {
    const sourcePath = absolutePath(entryPath);
    const forbiddenImports = sourceImports(sourcePath)
      .map((sourceImport) =>
        resolveLocalImport(sourcePath, sourceImport.specifier),
      )
      .filter((dependency): dependency is string => dependency !== null)
      .map(repositoryPath)
      .filter((dependency) =>
        FORBIDDEN_VARIATION_CATALOG_DEPENDENCIES.has(dependency)
      );

    expect(forbiddenImports).toEqual([]);
  });

  it("removes superseded Variation read helper declarations from the SP facade", () => {
    const source = readFileSync(
      absolutePath("src/main/amazon/sp-api.ts"),
      "utf8",
    );
    for (const helper of [
      "normalizeVariationPayload",
      "fetchVariationItem",
      "fetchVariationChildren",
      "fetchLiveVariationFamily",
      "resolveLiveSellerSkuByAsin",
      "executeUnboundVariationSearchRequest",
      "exactUnboundVariationMarketplaceSummary",
      "incompleteVariationBatch",
      "variationGroupingSignature",
      "fetchFbaReviewRelationshipBatch",
    ]) {
      expect(source).not.toMatch(new RegExp(`function\\s+${helper}\\b`, "u"));
    }
  });

  it("keeps arbitrary relationship transport callbacks out of the Variation read cluster", () => {
    const source = readFileSync(
      absolutePath("src/main/amazon/variation-catalog-reads.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/\bsearchBatch\b/u);
  });

  it.each([...ERROR_CONSUMERS.entries()])(
    "%s imports canonical SP errors from the error seam",
    (entryPath, expectedErrors) => {
      const sourcePath = absolutePath(entryPath);
      const errorImports = sourceImports(sourcePath)
        .map((sourceImport) => ({
          ...sourceImport,
          dependency: resolveLocalImport(sourcePath, sourceImport.specifier),
        }))
        .filter(({ importedNames }) =>
          importedNames.some((name) => expectedErrors.includes(name)),
        )
        .map(({ dependency, importedNames }) => ({
          dependency: dependency ? repositoryPath(dependency) : null,
          importedNames: importedNames
            .filter((name) => expectedErrors.includes(name))
            .sort(),
        }));

      expect(errorImports).toEqual([
        {
          dependency: "src/main/amazon/sp-api-error.ts",
          importedNames: [...expectedErrors].sort(),
        },
      ]);
    },
  );
});
