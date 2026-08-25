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

const EXTRACTED_FBA_INBOUND_MODULES = [
  "src/main/amazon/fba-inbound-shipments.ts",
  "src/main/amazon/fba-inbound-modern.ts",
  "src/main/amazon/inbound-noncompliance.ts",
  "src/main/amazon/fba-inbound-reads.ts",
  "src/main/amazon/fba-inbound-reads-production.ts",
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

const EXTRACTED_AGED_INVENTORY_MODULES = [
  "src/main/amazon/aged-inventory-reads.ts",
] as const;

const EXTRACTED_APLUS_CONTENT_MODULES = [
  "src/main/amazon/a-plus-content-reads.ts",
  "src/main/amazon/a-plus-content-reads-production.ts",
] as const;

const EXTRACTED_CUSTOMER_FEEDBACK_MODULES = [
  "src/main/amazon/customer-feedback-reads.ts",
  "src/main/amazon/customer-feedback-reads-production.ts",
] as const;

const EXTRACTED_ORDERS_READ_MODULES = [
  "src/main/amazon/orders-reads.ts",
  "src/main/amazon/orders-reads-production.ts",
] as const;

const ORDERS_SEMANTIC_MODULE = "src/main/amazon/orders-reads.ts";
const ORDERS_PRODUCTION_MODULE =
  "src/main/amazon/orders-reads-production.ts";

const FORBIDDEN_ORDERS_SEMANTIC_DEPENDENCIES = new Set([
  ORDERS_PRODUCTION_MODULE,
  "src/main/amazon/sp-api-runtime.ts",
  "src/main/amazon/listing-write-readback.ts",
  "src/main/amazon/variation-update.ts",
  "src/main/advertising-credential-vault.ts",
  "src/main/credential-vault.ts",
  "src/main/update-policy.ts",
]);

const PURE_CATALOG_REPORT_MODULES = [
  "src/main/amazon/business-pricing-evidence.ts",
  "src/main/amazon/catalog-report-reads.ts",
] as const;

const FBA_CATALOG_REPORTS_COORDINATOR =
  "src/main/amazon/fba-catalog-reports.ts";

const PURE_REVENUE_REPORT_MODULES = [
  "src/main/amazon/revenue-report-windows.ts",
  "src/main/amazon/brand-sales-reads.ts",
  "src/main/amazon/sales-and-traffic-reads.ts",
] as const;

const REVENUE_REPORT_COORDINATORS = [
  ["src/main/amazon/sales-and-traffic-reports.ts", false],
  ["src/main/amazon/fba-revenue-reports.ts", true],
] as const;

const REVENUE_REPORT_DEMO_MODULES: ReadonlySet<string> = new Set([
  "src/main/amazon/brand-sales-demo.ts",
  "src/main/amazon/sales-and-traffic-demo.ts",
]);

const SUPERSEDED_REVENUE_REPORT_FACADES = [
  "getBrandSalesReportWindow",
  "startFbaShipmentSalesReport",
  "getFbaShipmentSalesReportStatus",
  "getBrandSalesData",
  "getBrandSalesDataFromDocuments",
  "startSalesAndTrafficReport",
  "getSalesAndTrafficReportStatus",
  "getSalesAndTrafficReportData",
  "getSalesAndTrafficReportDataFromDocument",
  "parseSalesAndTrafficReportDocument",
] as const;

const SUPERSEDED_REVENUE_ROUTER_WIRING = [
  "BrandSalesReportGateway",
  "SalesAndTrafficReportGateway",
  "brandSalesReports",
  "salesAndTrafficReports",
] as const;

const SUPERSEDED_FBA_INBOUND_FACADES = [
  "getFbaInboundShipmentSnapshot",
  "startInboundNoncomplianceReport",
  "getInboundNoncomplianceReportStatus",
  "getInboundNoncomplianceReportDocument",
] as const;

const SUPERSEDED_FBA_INBOUND_ROUTER_WIRING = [
  "InboundShipmentGateway",
  "InboundNoncomplianceReportGateway",
  "inboundShipments",
  "inboundNoncomplianceReports",
] as const;

const SUPERSEDED_AGED_INVENTORY_FACADES = [
  "startAgedInventoryReport",
  "getAgedInventoryReportStatus",
  "getAgedInventoryData",
  "getAgedInventoryDataFromDocument",
  "parseAgedInventoryReportData",
  "parseAgedInventoryReportDocument",
  "downloadReportDocument",
  "executeReportsRequest",
  "callReportsApi",
] as const;

const SUPERSEDED_AGED_INVENTORY_ROUTER_WIRING = [
  "AgedInventoryReportGateway",
  "agedInventoryReports",
  "startSharedAgedInventoryReport",
  "getSharedAgedInventoryReportStatus",
  "getSharedAgedInventoryData",
] as const;

const SUPERSEDED_APLUS_CONTENT_FACADES = [
  "AplusContentRequestBase",
  "AplusContentRequestInput",
  "observeAplusContentRateLimit",
  "aplusContentRetryDelayMs",
  "reserveAplusContentReadStart",
  "assertAplusContentMode",
  "assertAplusContentInput",
  "aplusContentRequestUrl",
  "callAplusContentApi",
  "executeAplusContentRequest",
  "getAplusContentPublishRecordsPage",
  "getAplusContentDocumentsPage",
  "getAplusContentDocumentAsinRelationsPage",
] as const;

const SUPERSEDED_APLUS_ROUTER_WIRING = [
  "fetchAplusAuditPublishRecords",
  "fetchAplusAuditContentDocuments",
  "fetchAplusAuditContentDocumentAsinRelations",
  "getAplusContentPublishRecordsPage",
  "getAplusContentDocumentsPage",
  "getAplusContentDocumentAsinRelationsPage",
] as const;

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

function isForbiddenOrdersSemanticDependency(dependencyPath: string): boolean {
  return LEGACY_RUNTIME_MODULES.has(dependencyPath) ||
    FORBIDDEN_ORDERS_SEMANTIC_DEPENDENCIES.has(dependencyPath) ||
    /-production\.(?:ts|tsx)$/u.test(dependencyPath) ||
    /(?:^|[-/])(?:transport|update|vault|write)(?:[-/.]|$)/u.test(
      dependencyPath,
    ) ||
    dependencyPath.startsWith("src/preload/") ||
    dependencyPath.startsWith("src/renderer/");
}

function ordersSemanticDependencyViolations(): string[] {
  const pending = [absolutePath(ORDERS_SEMANTIC_MODULE)];
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
      if (isForbiddenOrdersSemanticDependency(dependencyPath)) {
        violations.add(`${repositoryPath(sourcePath)} -> ${dependencyPath}`);
      } else if (!visited.has(dependency)) {
        pending.push(dependency);
      }
    }
  }

  return [...violations].sort();
}

function isOrdersPrivateRawImport(name: string): boolean {
  return /^OrdersPage/u.test(name) || /^AmazonOrder/u.test(name);
}

function ordersPrivateImportViolations(
  sourcePaths: readonly string[],
): string[] {
  const violations = new Set<string>();
  for (const sourcePath of sourcePaths) {
    for (const sourceImport of sourceImports(sourcePath)) {
      const dependency = resolveLocalImport(sourcePath, sourceImport.specifier);
      if (!dependency) continue;
      const dependencyPath = repositoryPath(dependency);
      if (dependencyPath === ORDERS_PRODUCTION_MODULE) {
        violations.add(`${repositoryPath(sourcePath)} -> ${dependencyPath}`);
        continue;
      }
      if (dependencyPath !== ORDERS_SEMANTIC_MODULE) continue;
      const rawImports = sourceImport.importedNames.filter(
        isOrdersPrivateRawImport,
      );
      if (sourceImport.importedNames.length === 0 || rawImports.length > 0) {
        const imported = rawImports.length > 0
          ? rawImports.sort().join(", ")
          : "*";
        violations.add(
          `${repositoryPath(sourcePath)} -> ${dependencyPath} (${imported})`,
        );
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
    allowLocalStore?: boolean;
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
      const allowedDependency =
        (options.allowReportsRuntime &&
          dependencyPath === "src/main/amazon/reports-runtime.ts") ||
        (options.allowLocalStore &&
          dependencyPath === "src/main/local-store.ts");
      if (isForbiddenCatalogDependency(dependencyPath) && !allowedDependency) {
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

  it.each(EXTRACTED_FBA_INBOUND_MODULES)(
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

  it.each(EXTRACTED_AGED_INVENTORY_MODULES)(
    "%s stays independent from legacy runtime modules",
    (entryPath) => {
      expect(legacyDependencies(entryPath)).toEqual([]);
    },
  );

  it.each(EXTRACTED_APLUS_CONTENT_MODULES)(
    "%s stays independent from legacy runtime modules",
    (entryPath) => {
      expect(legacyDependencies(entryPath)).toEqual([]);
    },
  );

  it.each(EXTRACTED_CUSTOMER_FEEDBACK_MODULES)(
    "%s stays independent from legacy runtime modules",
    (entryPath) => {
      expect(legacyDependencies(entryPath)).toEqual([]);
    },
  );

  it.each(EXTRACTED_ORDERS_READ_MODULES)(
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

  it.each(PURE_REVENUE_REPORT_MODULES)(
    "%s stays outside legacy, production, runtime, store, write, PTD, preload, and renderer wiring",
    (entryPath) => {
      expect(catalogDependencyViolations(entryPath, { recursive: true }))
        .toEqual([]);
    },
  );

  it.each(REVENUE_REPORT_COORDINATORS)(
    "%s stays on semantic ports and out of demo, transport, production, and write wiring",
    (entryPath, allowLocalStore) => {
      expect(catalogDependencyViolations(entryPath, {
        recursive: false,
        allowReportsRuntime: true,
        allowLocalStore,
        forbidReportTransportImports: true,
      })).toEqual([]);

      const sourcePath = absolutePath(entryPath);
      const demoDependencies = sourceImports(sourcePath)
        .map((sourceImport) =>
          resolveLocalImport(sourcePath, sourceImport.specifier),
        )
        .filter((dependency): dependency is string => dependency !== null)
        .map(repositoryPath)
        .filter((dependency) => REVENUE_REPORT_DEMO_MODULES.has(dependency));

      expect(demoDependencies).toEqual([]);
    },
  );

  it(
    "keeps the catalog Listings interface free of fetch, URL, method, and PTD capabilities",
    () => {
      expect(exportedTypePropertyNames(
        absolutePath("src/main/amazon/catalog-report-reads.ts"),
        "CatalogListingsReadAdapter",
      )).toEqual(["readItem", "searchItems"]);
    },
    // The first TypeScript AST contract assertion cold-loads the full source
    // program and can exceed Vitest's 5s default under full-suite contention.
    15_000,
  );

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

  it("removes superseded Brand Sales and Sales & Traffic facades from the SP facade", () => {
    const source = readFileSync(
      absolutePath("src/main/amazon/sp-api.ts"),
      "utf8",
    );
    for (const symbol of SUPERSEDED_REVENUE_REPORT_FACADES) {
      expect(source).not.toMatch(new RegExp(`\\b${symbol}\\b`, "u"));
    }
    expect(source).not.toContain('"brand-sales"');
    expect(source).not.toContain('"sales-and-traffic"');
  });

  it("routes Brand Sales and Sales & Traffic only through their semantic coordinators", () => {
    const source = readFileSync(
      absolutePath("src/main/api-router.ts"),
      "utf8",
    );
    for (const symbol of [
      ...SUPERSEDED_REVENUE_REPORT_FACADES,
      ...SUPERSEDED_REVENUE_ROUTER_WIRING,
    ]) {
      expect(source).not.toMatch(new RegExp(`\\b${symbol}\\b`, "u"));
    }
    expect(source).toContain("new SalesAndTrafficReports({");
    expect(source).toContain("new FbaRevenueReports({");
  });

  it("removes superseded FBA Inbound production facades from the SP facade", () => {
    const source = readFileSync(
      absolutePath("src/main/amazon/sp-api.ts"),
      "utf8",
    );
    for (const symbol of SUPERSEDED_FBA_INBOUND_FACADES) {
      expect(source).not.toMatch(new RegExp(`\\b${symbol}\\b`, "u"));
    }
    expect(source).not.toContain("FBA_INBOUND_READ_INTERVAL_MS");
    expect(source).toContain("createFbaInboundReadsProductionAdapter({");
  });

  it("routes FBA Inbound only through its semantic read owner", () => {
    const source = readFileSync(
      absolutePath("src/main/api-router.ts"),
      "utf8",
    );
    for (const symbol of [
      ...SUPERSEDED_FBA_INBOUND_FACADES,
      ...SUPERSEDED_FBA_INBOUND_ROUTER_WIRING,
    ]) {
      expect(source).not.toMatch(new RegExp(`\\b${symbol}\\b`, "u"));
    }
    expect(source).toContain("new FbaInboundReads({");
    expect(source).toContain("expectedContext: job.context");
    expect(source).toContain("this.spExecutionContext.capture(marketplaceId)");
  });

  it("removes superseded Aged Inventory facades and duplicate Reports transport from the SP facade", () => {
    const source = readFileSync(
      absolutePath("src/main/amazon/sp-api.ts"),
      "utf8",
    );
    for (const symbol of SUPERSEDED_AGED_INVENTORY_FACADES) {
      expect(source).not.toMatch(new RegExp(`\\b${symbol}\\b`, "u"));
    }
    expect(source).not.toContain("AGED_INVENTORY_REPORT_TYPE");
    expect(source).not.toContain("ReportsPurpose");
  });

  it("routes Aged Inventory only through its semantic read owner", () => {
    const source = readFileSync(
      absolutePath("src/main/api-router.ts"),
      "utf8",
    );
    for (const symbol of SUPERSEDED_AGED_INVENTORY_ROUTER_WIRING) {
      expect(source).not.toMatch(new RegExp(`\\b${symbol}\\b`, "u"));
    }
    expect(source).toContain("new AgedInventoryReads({");
    expect(source).toContain("expectedContext: agedInventoryContext");
  });

  it("keeps A+ Content behind one semantic read and one closed page adapter", () => {
    const semanticPath = absolutePath(
      "src/main/amazon/a-plus-content-reads.ts",
    );
    expect(exportedTypePropertyNames(
      semanticPath,
      "AplusContentReadsPort",
    )).toEqual(["read"]);
    expect(exportedTypePropertyNames(
      semanticPath,
      "AplusContentPageAdapter",
    )).toEqual(["read"]);
    expect(readFileSync(semanticPath, "utf8"))
      .not.toMatch(/export\s+(?:async\s+)?function\s+runAplusAudit\b/u);
    expect(existsSync(absolutePath("src/main/amazon/a-plus-audit.ts")))
      .toBe(false);
  });

  it("removes superseded A+ transport and pacing facades from the SP facade", () => {
    const source = readFileSync(
      absolutePath("src/main/amazon/sp-api.ts"),
      "utf8",
    );
    for (const symbol of SUPERSEDED_APLUS_CONTENT_FACADES) {
      expect(source).not.toMatch(new RegExp(`\\b${symbol}\\b`, "u"));
    }
    expect(source).not.toContain("aplusContentReadTails");
    expect(source).toContain("createAplusContentReadProductionAdapter({");
  });

  it("routes standalone and suite A+ audits through the same semantic read owner", () => {
    const source = readFileSync(
      absolutePath("src/main/api-router.ts"),
      "utf8",
    );
    for (const symbol of SUPERSEDED_APLUS_ROUTER_WIRING) {
      expect(source).not.toMatch(new RegExp(`\\b${symbol}\\b`, "u"));
    }
    expect(source).toContain("new AplusContentReads({");
    expect(source).toContain("read: input.aplusAudit?.read");
    expect(source.match(/this\.aplusContentReads\.read\(/gu)).toHaveLength(2);
  });

  it("keeps Customer Feedback behind one semantic read and one closed adapter", () => {
    const semanticPath = absolutePath(
      "src/main/amazon/customer-feedback-reads.ts",
    );
    expect(exportedTypePropertyNames(
      semanticPath,
      "CustomerFeedbackReadsPort",
    )).toEqual(["read"]);
    expect(exportedTypePropertyNames(
      semanticPath,
      "CustomerFeedbackPageAdapter",
    )).toEqual(["read"]);
  });

  it("removes superseded Customer Feedback transport from the SP facade", () => {
    const source = readFileSync(
      absolutePath("src/main/amazon/sp-api.ts"),
      "utf8",
    );
    for (const symbol of [
      "CustomerFeedbackRequestInput",
      "callCustomerFeedbackApi",
      "executeCustomerFeedbackRequest",
      "assertCustomerFeedbackMode",
      "demoCustomerFeedbackResult",
      "getCustomerFeedbackReviewTopics",
    ]) {
      expect(source).not.toMatch(new RegExp(`\\b${symbol}\\b`, "u"));
    }
    expect(source).toContain(
      "createCustomerFeedbackReadProductionAdapter({",
    );
  });

  it("routes Review Audit through the Customer Feedback semantic owner", () => {
    const source = readFileSync(
      absolutePath("src/main/api-router.ts"),
      "utf8",
    );
    expect(source).toContain("new CustomerFeedbackReads({");
    expect(source).toContain("expectedContext: job.context");
    expect(source).not.toContain("getCustomerFeedbackReviewTopics");
    expect(source).not.toContain("reviewAuditFeedbackQueue");
    expect(source).not.toContain("reviewAuditFeedbackNextStartAt");
    expect(source).not.toContain("runReviewAuditFeedbackRequest");
  });

  it("keeps Orders behind one semantic read and one closed page adapter", () => {
    const semanticPath = absolutePath(ORDERS_SEMANTIC_MODULE);
    expect(exportedTypePropertyNames(
      semanticPath,
      "OrdersReadsPort",
    )).toEqual(["read"]);
    expect(exportedTypePropertyNames(
      semanticPath,
      "OrdersPageAdapter",
    )).toEqual(["read"]);
    expect(readFileSync(semanticPath, "utf8")).not.toMatch(
      /export\s+(?:interface|type)\s+AmazonOrder\w*\b/u,
    );
  });

  it("keeps the Orders semantic owner outside legacy, production, transport, write, vault, preload, and renderer wiring", () => {
    expect(ordersSemanticDependencyViolations()).toEqual([]);
  });

  it("keeps Orders production and raw page internals private to the composition seam", () => {
    const siblingAmazonDomains = sourceFiles(
      absolutePath("src/main/amazon"),
    ).filter((sourcePath) => ![
      absolutePath(ORDERS_SEMANTIC_MODULE),
      absolutePath(ORDERS_PRODUCTION_MODULE),
      absolutePath("src/main/amazon/sp-api.ts"),
    ].includes(sourcePath));
    const forbiddenConsumers = [
      ...sourceFiles(absolutePath("src/preload")),
      ...sourceFiles(absolutePath("src/renderer")),
      ...sourceFiles(absolutePath("src/shared")),
      ...siblingAmazonDomains,
    ];

    expect(ordersPrivateImportViolations(forbiddenConsumers)).toEqual([]);
  });

  it("lets the router import only the public Orders semantic API", () => {
    const routerPath = absolutePath("src/main/api-router.ts");
    const imports = sourceImports(routerPath).map((sourceImport) => ({
      ...sourceImport,
      dependency: resolveLocalImport(routerPath, sourceImport.specifier),
    }));
    const productionImports = imports
      .filter(({ dependency }) =>
        dependency !== null &&
        repositoryPath(dependency) === ORDERS_PRODUCTION_MODULE
      )
      .map(() => ORDERS_PRODUCTION_MODULE);
    const semanticImports = imports.filter(({ dependency }) =>
      dependency !== null &&
      repositoryPath(dependency) === ORDERS_SEMANTIC_MODULE
    );
    const semanticImportNames = semanticImports.flatMap(
      ({ importedNames }) => importedNames,
    );
    const rawImports = semanticImportNames.filter(isOrdersPrivateRawImport);

    expect(productionImports).toEqual([]);
    expect(ordersPrivateImportViolations([routerPath])).toEqual([]);
    expect(semanticImportNames).toEqual(
      expect.arrayContaining(["OrdersReads", "OrdersReadsPort"]),
    );
    expect(rawImports).toEqual([]);
  });

  it("removes superseded Orders transport and raw models from the SP facade", () => {
    const source = readFileSync(
      absolutePath("src/main/amazon/sp-api.ts"),
      "utf8",
    );
    for (const symbol of [
      "searchOrders",
      "callOrdersApi",
      "fetchLiveOrders",
      "normalizeOrders",
      "buildDemoOrders",
      "VALID_STATUSES",
      "SearchOrdersInput",
    ]) {
      expect(source).not.toMatch(new RegExp(`\\b${symbol}\\b`, "u"));
    }
    expect(source).not.toMatch(/\bAmazonOrder\w*\b/u);
  });

  it("routes dashboard and connection-test Orders reads through the same semantic owner", () => {
    const source = readFileSync(
      absolutePath("src/main/api-router.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/\bsearchOrders\b/u);
    expect(source.match(/this\.ordersReads\.read\(/gu)).toHaveLength(2);
  });

  it("reuses one normalized Aged Inventory header index", () => {
    const source = readFileSync(
      absolutePath("src/main/amazon/aged-inventory-reads.ts"),
      "utf8",
    ).replaceAll("\r\n", "\n");
    const reportColumnStart = source.indexOf("function reportColumn(");
    const reportColumnEnd = source.indexOf("\n}\n", reportColumnStart);
    const reportColumnSource = source.slice(reportColumnStart, reportColumnEnd);

    expect(reportColumnStart).toBeGreaterThanOrEqual(0);
    expect(reportColumnEnd).toBeGreaterThan(reportColumnStart);
    expect(source).toContain("const headerIndexes = new Map<string, number>()");
    expect(reportColumnSource).toContain("headerIndexes.get(");
    expect(reportColumnSource).not.toContain("headers.map(");
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
          dependency === "src/main/amazon/reports-runtime-production.ts" ||
          dependency === "src/main/amazon/report-broker.ts"
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

  it("keeps one fixed Report Broker as the only router lifecycle owner", () => {
    const routerSource = readFileSync(
      absolutePath("src/main/api-router.ts"),
      "utf8",
    );
    const brokerPath = absolutePath("src/main/amazon/report-broker.ts");
    const brokerSource = readFileSync(brokerPath, "utf8");

    expect(routerSource).toContain(
      "private readonly reportBroker: FixedReportBroker;",
    );
    expect(routerSource.match(/new FixedReportBroker\(/gu)).toHaveLength(1);
    expect(routerSource).not.toContain("new DurableReportLifecycle(");
    expect(routerSource).not.toContain("this.reportLifecycle");
    expect(routerSource).not.toContain("adsAccountScope:");
    expect(routerSource).not.toContain("adsProfileFingerprint:");
    expect(routerSource.match(/reports:\s*this\.reportBroker\b/gu)).toHaveLength(5);
    for (const directCall of [
      /\.getCombinedAccountIdentity\s*\(/u,
      /\.createSponsoredProductsAdvertisedProductReport\s*\(/u,
      /\.getSponsoredProductsAdvertisedProductReportStatus\s*\(/u,
      /\.downloadSponsoredProductsAdvertisedProductReport\s*\(/u,
    ]) {
      expect(routerSource).not.toMatch(directCall);
    }

    const competingOwners = sourceFiles(absolutePath("src/main"))
      .filter((sourcePath) => sourcePath !== brokerPath)
      .flatMap((sourcePath) => {
        const source = readFileSync(sourcePath, "utf8");
        return [
          ...(source.includes("new DurableReportLifecycle(")
            ? [`${repositoryPath(sourcePath)} -> DurableReportLifecycle`]
            : []),
          ...(source.includes("new ReportsRuntime(")
            ? [`${repositoryPath(sourcePath)} -> ReportsRuntime`]
            : []),
        ];
      });
    expect(competingOwners).toEqual([]);
    expect(brokerSource.match(/new DurableReportLifecycle\(/gu)).toHaveLength(1);
    expect(brokerSource.match(/new ReportsRuntime\(/gu)).toHaveLength(1);

    expect(brokerSource).toContain(
      'intent: "ads-sp-advertised-product";',
    );
    expect(brokerSource).toContain(
      'reportType: "ADS_SP_ADVERTISED_PRODUCT"',
    );
    const planStart = brokerSource.indexOf(
      "export type AdvertisedProductReportPlan",
    );
    const planEnd = brokerSource.indexOf("}>;", planStart);
    const publicPlan = brokerSource.slice(planStart, planEnd);
    expect(publicPlan).not.toMatch(
      /accountScope|reportType|optionsKey|configuration|columns|format|method|path|host|url/iu,
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

  it("keeps private execution and audit-suite contexts out of shared, preload, and renderer modules", () => {
    const privateContextModules = new Set([
      "src/main/amazon/audit-suite-context.ts",
      "src/main/amazon/sp-execution-context.ts",
      "src/main/router-request-context.ts",
    ]);
    const forbiddenImports = [
      ...sourceFiles(absolutePath("src/shared")),
      ...sourceFiles(absolutePath("src/preload")),
      ...sourceFiles(absolutePath("src/renderer")),
    ].flatMap((sourcePath) =>
      sourceImports(sourcePath)
        .map((sourceImport) => resolveLocalImport(sourcePath, sourceImport.specifier))
        .filter((dependency): dependency is string => dependency !== null)
        .map(repositoryPath)
        .filter((dependency) => privateContextModules.has(dependency))
        .map((dependency) => `${repositoryPath(sourcePath)} -> ${dependency}`)
    );
    const sharedAuditSuite = readFileSync(
      absolutePath("src/shared/audit-suite.ts"),
      "utf8",
    );

    expect(forbiddenImports).toEqual([]);
    expect(sharedAuditSuite).not.toMatch(/\bAuditSuiteContext\b/u);
    expect(sharedAuditSuite).not.toMatch(/\baccountScope\b/u);
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
