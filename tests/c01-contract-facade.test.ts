import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const DELEGATED_RESPONSE: ApiResponse = {
  status: 200,
  headers: {
    "cache-control": "private, no-store, max-age=0",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  },
  body: {
    kind: "json",
    value: { owner: "listings-export-routes" },
  },
};

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_PATH_CACHE = new Map<string, string[]>();
const SOURCE_FILE_CACHE = new Map<string, ts.SourceFile>();

function sourceFiles(root: string): string[] {
  const cached = SOURCE_PATH_CACHE.get(root);
  if (cached) return cached;
  const paths = readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx"].includes(extname(entry.name)) &&
        !entry.name.includes(" 2.")
      ? [path]
      : [];
  });
  SOURCE_PATH_CACHE.set(root, paths);
  return paths;
}

function sourceFile(sourcePath: string): ts.SourceFile {
  const cached = SOURCE_FILE_CACHE.get(sourcePath);
  if (cached) return cached;
  const parsed = ts.createSourceFile(
    sourcePath,
    readFileSync(sourcePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    sourcePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  SOURCE_FILE_CACHE.set(sourcePath, parsed);
  return parsed;
}

function importSpecifiers(sourcePath: string): string[] {
  const specifiers: string[] = [];
  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]!) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      specifiers.push(node.arguments[0]!.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile(sourcePath));
  return specifiers;
}

function localImport(sourcePath: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(sourcePath), specifier);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    resolve(base, "index.ts"),
    resolve(base, "index.tsx"),
  ]) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      // Try the next local TypeScript resolution candidate.
    }
  }
  return null;
}

function constructorOwners(
  root: string,
  constructorName: string,
): string[] {
  return sourceFiles(root).flatMap((sourcePath) => {
    let found = false;
    function visit(node: ts.Node): void {
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === constructorName
      ) {
        found = true;
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile(sourcePath));
    return found ? [relative(REPOSITORY_ROOT, sourcePath)] : [];
  });
}

function factoryCallOwners(root: string, factoryName: string): string[] {
  return sourceFiles(root).flatMap((sourcePath) => {
    let found = false;
    function visit(node: ts.Node): void {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === factoryName
      ) {
        found = true;
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile(sourcePath));
    return found ? [relative(REPOSITORY_ROOT, sourcePath)] : [];
  });
}

type FactoryCallSite = Readonly<{
  sourcePath: string;
  call: ts.CallExpression;
}>;

function factoryCallSites(
  root: string,
  factoryName: string,
): FactoryCallSite[] {
  return sourceFiles(root).flatMap((sourcePath) => {
    const calls: FactoryCallSite[] = [];
    function visit(node: ts.Node): void {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === factoryName
      ) {
        calls.push({ sourcePath, call: node });
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile(sourcePath));
    return calls;
  });
}

function propertyNameText(name: ts.PropertyName | undefined): string {
  if (!name) return "<anonymous>";
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) return name.text;
  return "<computed>";
}

function objectLiteralPropertyNames(
  expression: ts.Expression | undefined,
): string[] | null {
  if (!expression || !ts.isObjectLiteralExpression(expression)) return null;
  return expression.properties.map((property) => {
    if (ts.isSpreadAssignment(property)) return "<spread>";
    return propertyNameText(property.name);
  }).sort();
}

function nestedObjectLiteralPropertyNames(
  call: ts.CallExpression,
  propertyName: string,
): string[] | null {
  const argument = call.arguments[0];
  if (!argument || !ts.isObjectLiteralExpression(argument)) return null;
  const property = argument.properties.find((candidate) =>
    ts.isPropertyAssignment(candidate) &&
    propertyNameText(candidate.name) === propertyName
  );
  return property && ts.isPropertyAssignment(property)
    ? objectLiteralPropertyNames(property.initializer)
    : null;
}

function sourcePosition(
  source: ts.SourceFile,
  node: ts.Node,
): string {
  const { line, character } = source.getLineAndCharacterOfPosition(
    node.getStart(source),
  );
  return `${relative(REPOSITORY_ROOT, source.fileName)}:${line + 1}:${character + 1}`;
}

function rootIdentifier(expression: ts.Expression): string | null {
  let current = expression;
  while (
    ts.isPropertyAccessExpression(current) ||
    ts.isElementAccessExpression(current)
  ) current = current.expression;
  return ts.isIdentifier(current) ? current.text : null;
}

function facadeImplementationViolations(sourcePath: string): string[] {
  const source = sourceFile(sourcePath);
  const violations: string[] = [];
  const allowedFunctionDeclarations = new Set([
    "invalidateSpApiCredentialCaches",
  ]);
  const rawAmazonObjectKeys = new Set([
    "attributes",
    "fulfillmentAvailability",
    "patches",
    "payload",
    "relationships",
    "schema",
    "schemaEnvelope",
    "summaries",
    "workbook",
    "worksheets",
  ]);
  const forbiddenLocalDomainType =
    /(?:Amazon|Payload|Schema|Workbook|Worksheet)/u;

  function add(kind: string, node: ts.Node): void {
    violations.push(`${kind} at ${sourcePosition(source, node)}`);
  }

  function visit(node: ts.Node): void {
    if (
      ts.isIdentifier(node) &&
      ["Headers", "Request", "Response", "URLSearchParams"].includes(node.text)
    ) add(`forbidden transport identifier ${node.text}`, node);

    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      /^(?:(?:node:)?(?:http|https|net|tls)|axios|undici)$/u.test(
        node.moduleSpecifier.text,
      )
    ) add(`raw transport import ${node.moduleSpecifier.text}`, node);

    if (
      ts.isStringLiteralLike(node) &&
      /(?:https?:\/\/|sellingpartnerapi|api\.amazon\.com)/iu.test(node.text)
    ) add("raw transport URL", node);

    if (ts.isNewExpression(node)) {
      const name = rootIdentifier(node.expression);
      if ([
        "Function",
        "Headers",
        "Map",
        "Proxy",
        "Request",
        "WeakMap",
        "Response",
        "URLSearchParams",
      ].includes(name ?? "")) add(`forbidden constructor ${name}`, node);
    }

    if (ts.isCallExpression(node)) {
      const root = rootIdentifier(node.expression);
      const direct = ts.isIdentifier(node.expression)
        ? node.expression.text
        : null;
      const member = ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name.text
        : direct;
      if (["fetch", "setInterval", "setTimeout"].includes(member ?? "")) {
        add(`forbidden call ${member}`, node);
      }
      if (root === "Response" || root === "Reflect") {
        add(`forbidden dynamic/transport call ${root}`, node);
      }
      if (ts.isElementAccessExpression(node.expression)) {
        add("generic computed dispatch", node);
      }
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        direct === "require" ||
        direct === "eval" ||
        direct === "Function"
      ) add("dynamic module or code dispatch", node);
    }

    if (
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isEnumDeclaration(node)
    ) {
      const name = node.name?.text ?? "<anonymous>";
      if (ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) {
        add(`local ${ts.isClassDeclaration(node) ? "class" : "enum"} ${name}`, node);
      } else if (forbiddenLocalDomainType.test(name)) {
        add(`raw Amazon/domain type ${name}`, node);
      }
    }

    if (
      ts.isTypeReferenceNode(node) &&
      ts.isIdentifier(node.typeName) &&
      ["Map", "WeakMap"].includes(node.typeName.text)
    ) add(`forbidden state type ${node.typeName.text}`, node);

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /(?:payload|schema|workbook|worksheet)/iu.test(node.name.text)
    ) add(`raw Amazon/domain local ${node.name.text}`, node);

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /demo/iu.test(node.name.text) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) add(`demo domain helper body ${node.name.text}`, node);

    if (ts.isFunctionDeclaration(node)) {
      const name = node.name?.text ?? "<anonymous>";
      if (!allowedFunctionDeclarations.has(name)) {
        add(`domain function declaration ${name}`, node);
      }
    }

    if (ts.isPropertyAssignment(node)) {
      const name = propertyNameText(node.name);
      if (rawAmazonObjectKeys.has(name)) {
        add(`raw Amazon/domain object key ${name}`, node);
      }
    }

    if (
      (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
      ts.isBlock(node.body)
    ) {
      let controlHeavy = node.body.statements.length > 2;
      function inspect(statement: ts.Node): void {
        if (
          ts.isTryStatement(statement) ||
          ts.isThrowStatement(statement) ||
          ts.isForStatement(statement) ||
          ts.isForInStatement(statement) ||
          ts.isForOfStatement(statement) ||
          ts.isWhileStatement(statement) ||
          ts.isDoStatement(statement) ||
          ts.isSwitchStatement(statement)
        ) controlHeavy = true;
        ts.forEachChild(statement, inspect);
      }
      inspect(node.body);
      if (controlHeavy) add("inline domain callback body", node);
    }

    ts.forEachChild(node, visit);
  }
  visit(source);

  const invalidationDeclarations = source.statements.filter(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === "invalidateSpApiCredentialCaches",
  );
  if (invalidationDeclarations.length !== 1) {
    violations.push(
      `expected one invalidation coordinator, found ${invalidationDeclarations.length}`,
    );
  }
  return violations;
}

function isInsideFunction(node: ts.Node): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionLike(current)) return true;
  }
  return false;
}

describe("C01 contract facade", () => {
  it("delegates the exact Listings export status route without owning its workflow", async () => {
    const request: ApiRequest = {
      requestId: "c01-export-route-001",
      method: "GET",
      path: "/api/sp-api/listing-content/export",
      query: { deliberatelyInvalidLegacyQuery: "1" },
      headers: {},
    };
    const listingsExportRoutes = {
      start: vi.fn(async () => DELEGATED_RESPONSE),
      observe: vi.fn(async () => DELEGATED_RESPONSE),
    };
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      listingsExportRoutes,
    } as unknown as ConstructorParameters<typeof ApiRouter>[0]);

    const response = await router.handle(request);

    expect(response).toBe(DELEGATED_RESPONSE);
    expect(listingsExportRoutes.observe).toHaveBeenCalledOnce();
    expect(listingsExportRoutes.observe).toHaveBeenCalledWith(request);
    expect(listingsExportRoutes.start).not.toHaveBeenCalled();
  });

  it("keeps domain workflows and superseded compatibility helpers out of Router", () => {
    const router = readFileSync(
      resolve(REPOSITORY_ROOT, "src/main/api-router.ts"),
      "utf8",
    );

    for (const superseded of [
      "routerDemoReportsAdapter",
      "startDemoFixedReport",
      "getSharedUnboundVariationAuditData",
      "getSharedBusinessPricingAuditData",
      "startExport",
      "exportStatusOrDownload",
      "writeApiError",
      "writeBinding",
      "allListingsDemoReports",
      "businessPricingActiveListingsReports",
      "inboundNoncomplianceDemoReports",
    ] as const) {
      expect(router).not.toMatch(new RegExp(`\\b${superseded}\\b`, "u"));
    }
    expect(router).not.toMatch(
      /export\s*\{[\s\S]*?parse(?:Asin|Marketplace|SellerSku)[\s\S]*?\}\s*from\s*["']\.\/route-input["']/mu,
    );
    expect(router).not.toMatch(/\bnew\s+Map\b|\bset(?:Interval|Timeout)\s*\(/u);
    expect(router).not.toMatch(
      /\bfetch\s*\(|sp-api-runtime|requestAccessToken|https?:\/\//u,
    );
  });

  it("keeps sp-api as a composition and public-contract facade", () => {
    const spApiPath = resolve(
      REPOSITORY_ROOT,
      "src/main/amazon/sp-api.ts",
    );

    expect(facadeImplementationViolations(spApiPath)).toEqual([]);
  });

  it("constructs each extracted runtime once with only its fixed semantic ports", () => {
    const mainRoot = resolve(REPOSITORY_ROOT, "src/main");
    const expectedOwner = "src/main/amazon/sp-api.ts";
    const expectedComposition = {
      createSpCredentialRuntime: null,
      createFbaSalesTrend: [
        "getAccessToken",
        "invalidateAccessToken",
        "isConfiguredForMarketplace",
        "marketplaceLabel",
        "usesDemoMode",
      ],
      createListingsReadProductionAdapter: [
        "getAccessToken",
        "getSellerId",
        "invalidateAccessToken",
      ],
      createListingItemReads: ["listings", "usesDemoMode"],
      createListingContentCapabilities: [
        "getCredentialGeneration",
        "getSellerId",
        "listingsReadAdapter",
      ],
      createListingContentReadProduction: [
        "contentCapabilities",
        "listingItems",
      ],
      createBusinessPricingCapabilities: [
        "credentialGeneration",
        "listingsReads",
        "marketplace",
        "sellerId",
      ],
      createListingsWriteProduction: [
        "getAccessToken",
        "getSellerId",
        "invalidateAccessToken",
      ],
      createListingPriceGatewayProduction: [
        "readLive",
        "resolveMode",
        "write",
      ],
      createBusinessPricingGatewayProduction: [
        "capabilities",
        "credentialGeneration",
        "listingItems",
        "readDemoPrice",
        "resolveMode",
        "write",
      ],
      createListingContentGatewayProduction: [
        "contentReads",
        "credentialGeneration",
        "readDemoListing",
        "resolveMode",
        "write",
      ],
      createListingImageGatewayProduction: [
        "contentReads",
        "credentialGeneration",
        "readDemoContent",
        "resolveMode",
        "write",
      ],
      createVariationDemoRuntime: ["readDemoListingPrice"],
      createVariationQueryRuntime: [
        "demo",
        "live",
        "readDemoListingPrice",
        "resolveMode",
      ],
      createVariationGroupingRuntime: ["demo", "readLive", "resolveMode"],
      createCatalogReportsDemoSource: [
        "marketplaceDisplayName",
        "readDemoBusinessPricing",
        "readDemoContent",
        "variationDemo",
      ],
      createFbaInventoryReplenishmentProductionAdapter: [
        "getAccessToken",
        "invalidateAccessToken",
      ],
      createSubscriptionReads: [
        "inventoryAdapter",
        "readDemoListingPrice",
        "resolveMode",
      ],
      createRestockPlanPort: [
        "getAccessToken",
        "invalidateAccessToken",
        "inventoryAdapter",
        "isSkillConnected",
        "readDemoListingPrice",
        "readLiveListingPrice",
        "resolveMode",
      ],
      createFbaInboundReadsProductionAdapter: [
        "getAccessToken",
        "invalidateAccessToken",
      ],
      createReportsRuntimeProductionAdapter: [
        "getAccessToken",
        "invalidateAccessToken",
      ],
      createAplusContentReadProductionAdapter: [
        "getAccessToken",
        "invalidateAccessToken",
        "resolveMode",
      ],
      createCustomerFeedbackReadProductionAdapter: [
        "getAccessToken",
        "invalidateAccessToken",
        "resolveMode",
      ],
      createOrdersReadProductionAdapter: [
        "getAccessToken",
        "invalidateAccessToken",
        "resolveMode",
      ],
      createVariationMoveGatewayProduction: [
        "credentialGeneration",
        "listings",
        "readDemoFamily",
        "resolveMode",
        "write",
      ],
    } as const satisfies Record<string, readonly string[] | null>;

    for (const [factoryName, expectedProperties] of Object.entries(
      expectedComposition,
    )) {
      const sites = factoryCallSites(mainRoot, factoryName);
      expect(sites.map(({ sourcePath }) =>
        relative(REPOSITORY_ROOT, sourcePath))).toEqual([expectedOwner]);
      expect(sites.every(({ call }) => !isInsideFunction(call))).toBe(true);
      if (expectedProperties === null) {
        expect(sites[0]?.call.arguments).toHaveLength(0);
      } else {
        expect(sites[0]?.call.arguments).toHaveLength(1);
        expect(objectLiteralPropertyNames(sites[0]?.call.arguments[0]))
          .toEqual(expectedProperties);
      }
    }

    const querySite = factoryCallSites(
      mainRoot,
      "createVariationQueryRuntime",
    )[0];
    expect(querySite).toBeDefined();
    expect(nestedObjectLiteralPropertyNames(querySite!.call, "live"))
      .toEqual([
        "fetchListingBatch",
        "readFamily",
        "resolveSellerSkuByAsin",
      ]);
  }, 15_000);

  it("keeps main-private boundaries one-way and one report lifecycle", () => {
    const mainRoot = resolve(REPOSITORY_ROOT, "src/main");
    const routerPath = resolve(mainRoot, "api-router.ts");
    const indexPath = resolve(mainRoot, "index.ts");
    const spApiPath = resolve(mainRoot, "amazon/sp-api.ts");
    const boundaryViolations = [
      ...sourceFiles(resolve(REPOSITORY_ROOT, "src/renderer")),
      ...sourceFiles(resolve(REPOSITORY_ROOT, "src/preload")),
      ...sourceFiles(resolve(REPOSITORY_ROOT, "src/shared")),
    ].flatMap((sourcePath) =>
      importSpecifiers(sourcePath).flatMap((specifier) => {
        const dependency = localImport(sourcePath, specifier);
        return dependency?.startsWith(`${mainRoot}/`)
          ? [`${relative(REPOSITORY_ROOT, sourcePath)} -> ${relative(REPOSITORY_ROOT, dependency)}`]
          : [];
      })
    );
    const facadeBackImports = sourceFiles(mainRoot)
      .filter((sourcePath) =>
        sourcePath !== routerPath &&
        sourcePath !== indexPath &&
        sourcePath !== spApiPath
      )
      .flatMap((sourcePath) =>
        importSpecifiers(sourcePath).flatMap((specifier) => {
          const dependency = localImport(sourcePath, specifier);
          return dependency === routerPath || dependency === spApiPath
            ? [
                `${relative(REPOSITORY_ROOT, sourcePath)} -> ${relative(REPOSITORY_ROOT, dependency)}`,
              ]
            : [];
        })
      );
    const lifecycleOwners = [
      ...constructorOwners(mainRoot, "DurableReportLifecycle"),
      ...constructorOwners(mainRoot, "ReportsRuntime"),
    ];
    const brokerOwners = constructorOwners(mainRoot, "FixedReportBroker");
    const credentialRuntimeOwners = factoryCallOwners(
      mainRoot,
      "createSpCredentialRuntime",
    );
    const salesTrendOwners = factoryCallOwners(
      mainRoot,
      "createFbaSalesTrend",
    );

    expect(boundaryViolations).toEqual([]);
    expect(facadeBackImports).toEqual([]);
    expect(lifecycleOwners).toEqual([
      "src/main/amazon/report-broker.ts",
      "src/main/amazon/report-broker.ts",
    ]);
    expect(brokerOwners).toEqual(["src/main/api-router.ts"]);
    expect(credentialRuntimeOwners).toEqual(["src/main/amazon/sp-api.ts"]);
    expect(salesTrendOwners).toEqual(["src/main/amazon/sp-api.ts"]);
  }, 15_000);
});
