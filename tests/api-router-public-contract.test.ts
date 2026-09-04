import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { OperationsBoardPort } from "../src/main/operations-board";
import type {
  ApiMethod,
  ApiRequest,
  ApiResponse,
} from "../src/shared/contracts";

const JSON_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};

type RoutePair = Readonly<{
  method: ApiMethod;
  path: `/api/${string}`;
}>;

const REVIEWED_ROUTES = [
  { method: "GET", path: "/api/sp-api/orders" },
  { method: "GET", path: "/api/sp-api/sales-trend" },
  { method: "POST", path: "/api/sp-api/brand-sales" },
  { method: "GET", path: "/api/sp-api/brand-sales" },
  { method: "POST", path: "/api/sp-api/inbound-shipments" },
  { method: "GET", path: "/api/sp-api/inbound-shipments" },
  { method: "GET", path: "/api/sp-api/listings" },
  { method: "POST", path: "/api/sp-api/listings" },
  { method: "PATCH", path: "/api/sp-api/listings" },
  { method: "POST", path: "/api/sp-api/business-pricing-audit" },
  { method: "GET", path: "/api/sp-api/business-pricing-audit" },
  { method: "GET", path: "/api/sp-api/business-pricing-audit/export" },
  { method: "GET", path: "/api/sp-api/business-pricing" },
  { method: "POST", path: "/api/sp-api/business-pricing" },
  { method: "PATCH", path: "/api/sp-api/business-pricing" },
  { method: "GET", path: "/api/sp-api/business-pricing/batch" },
  { method: "POST", path: "/api/sp-api/business-pricing/batch" },
  { method: "PATCH", path: "/api/sp-api/business-pricing/batch" },
  { method: "POST", path: "/api/sp-api/listings/batch" },
  { method: "GET", path: "/api/sp-api/listing-content" },
  { method: "POST", path: "/api/sp-api/listing-content" },
  { method: "PATCH", path: "/api/sp-api/listing-content" },
  { method: "POST", path: "/api/sp-api/listing-content/import" },
  { method: "GET", path: "/api/sp-api/listing-content/import" },
  { method: "PATCH", path: "/api/sp-api/listing-content/import" },
  { method: "GET", path: "/api/sp-api/listing-images" },
  { method: "POST", path: "/api/sp-api/listing-images" },
  { method: "PATCH", path: "/api/sp-api/listing-images" },
  { method: "POST", path: "/api/sp-api/sale-price" },
  { method: "PATCH", path: "/api/sp-api/sale-price" },
  { method: "GET", path: "/api/sp-api/subscribe-save" },
  { method: "GET", path: "/api/sp-api/subscription-audit" },
  { method: "GET", path: "/api/sp-api/subscription-audit/export" },
  { method: "GET", path: "/api/sp-api/accounting/capabilities" },
  { method: "POST", path: "/api/sp-api/accounting/access-plan" },
  { method: "GET", path: "/api/sp-api/report-library" },
  { method: "POST", path: "/api/sp-api/report-library/access-plan" },
  { method: "POST", path: "/api/sp-api/review-audit" },
  { method: "GET", path: "/api/sp-api/review-audit" },
  { method: "GET", path: "/api/sp-api/review-audit/export" },
  { method: "GET", path: "/api/sp-api/replenishment-plan" },
  { method: "POST", path: "/api/sp-api/aged-inventory" },
  { method: "GET", path: "/api/sp-api/aged-inventory" },
  { method: "GET", path: "/api/sp-api/variation-family" },
  { method: "POST", path: "/api/sp-api/variation-audit" },
  { method: "GET", path: "/api/sp-api/variation-audit" },
  { method: "GET", path: "/api/sp-api/variation-move" },
  { method: "POST", path: "/api/sp-api/variation-move" },
  { method: "PATCH", path: "/api/sp-api/variation-move" },
  { method: "GET", path: "/api/sp-api/sku-command" },
  { method: "GET", path: "/api/operations-board" },
  { method: "POST", path: "/api/sp-api/operations-board-facts" },
  { method: "GET", path: "/api/product-master" },
  { method: "PUT", path: "/api/product-master" },
  { method: "POST", path: "/api/uploads/listing-images" },
  { method: "POST", path: "/api/sp-api/listing-content/export" },
  { method: "GET", path: "/api/sp-api/listing-content/export" },
  { method: "GET", path: "/api/system/health" },
  { method: "GET", path: "/api/amazon-ads/status" },
  { method: "GET", path: "/api/amazon-ads/coverage" },
  { method: "POST", path: "/api/amazon-ads/strategy" },
  { method: "GET", path: "/api/amazon-ads/strategy" },
  { method: "POST", path: "/api/sp-api/a-plus-audit" },
  { method: "GET", path: "/api/sp-api/a-plus-audit" },
  { method: "POST", path: "/api/sp-api/audit-suite" },
  { method: "GET", path: "/api/sp-api/audit-suite" },
  { method: "GET", path: "/api/sp-api/audit-suite/export" },
  { method: "POST", path: "/api/sp-api/standalone-audit" },
  { method: "GET", path: "/api/sp-api/standalone-audit" },
] as const satisfies readonly RoutePair[];

const API_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function routeKey(route: RoutePair): `${ApiMethod} /api/${string}` {
  return `${route.method} ${route.path}`;
}

function requestProperty(expression: ts.Expression, name: string): boolean {
  return ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "request" &&
    expression.name.text === name;
}

function exactRouteKeyDeclaration(statement: ts.Statement | undefined): boolean {
  if (!statement || !ts.isVariableStatement(statement)) return false;
  if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) return false;
  const declarations = statement.declarationList.declarations;
  if (declarations.length !== 1) return false;
  const declaration = declarations[0];
  if (
    !declaration ||
    !ts.isIdentifier(declaration.name) ||
    declaration.name.text !== "key" ||
    !declaration.initializer ||
    !ts.isTemplateExpression(declaration.initializer)
  ) {
    return false;
  }
  const template = declaration.initializer;
  return template.head.text === "" &&
    template.templateSpans.length === 2 &&
    requestProperty(template.templateSpans[0]!.expression, "method") &&
    template.templateSpans[0]!.literal.text === " " &&
    requestProperty(template.templateSpans[1]!.expression, "path") &&
    template.templateSpans[1]!.literal.text === "";
}

function exactNotFoundDefault(clause: ts.DefaultClause | undefined): boolean {
  if (!clause || clause.statements.length !== 1) return false;
  const statement = clause.statements[0];
  if (!statement || !ts.isReturnStatement(statement)) return false;
  const expression = statement.expression;
  if (
    !expression ||
    !ts.isCallExpression(expression) ||
    !ts.isIdentifier(expression.expression) ||
    expression.expression.text !== "invalid" ||
    expression.arguments.length !== 3
  ) {
    return false;
  }
  const [message, status, code] = expression.arguments;
  return Boolean(
    message && ts.isStringLiteral(message) &&
      message.text === "此 App 版本不支援這個操作。" &&
      status && ts.isNumericLiteral(status) && status.text === "404" &&
      code && ts.isStringLiteral(code) && code.text === "NOT_FOUND",
  );
}

function productionRouteInventory(): Readonly<{
  cases: readonly string[];
  defaultCount: number;
  defaultIsExactNotFound: boolean;
  keyDeclarationIsExact: boolean;
  statementCount: number;
  switchExpressionIsKey: boolean;
  switchCount: number;
}> {
  const sourcePath = fileURLToPath(
    new URL("../src/main/api-router.ts", import.meta.url),
  );
  const source = ts.createSourceFile(
    sourcePath,
    readFileSync(sourcePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const routerClass = source.statements.find(
    (statement): statement is ts.ClassDeclaration =>
      ts.isClassDeclaration(statement) && statement.name?.text === "ApiRouter",
  );
  if (!routerClass) throw new Error("ApiRouter class was not found");
  const routeMethod = routerClass.members.find(
    (member): member is ts.MethodDeclaration =>
      ts.isMethodDeclaration(member) &&
      ts.isIdentifier(member.name) &&
      member.name.text === "route",
  );
  if (!routeMethod?.body) throw new Error("ApiRouter.route was not found");
  const statements = routeMethod.body.statements;
  const switches = statements.filter(ts.isSwitchStatement);
  const routeSwitch = switches[0];
  if (!routeSwitch) {
    return {
      cases: [],
      defaultCount: 0,
      defaultIsExactNotFound: false,
      keyDeclarationIsExact: exactRouteKeyDeclaration(statements[0]),
      statementCount: statements.length,
      switchExpressionIsKey: false,
      switchCount: switches.length,
    };
  }
  const cases: string[] = [];
  let defaultCount = 0;
  let defaultClause: ts.DefaultClause | undefined;
  for (const clause of routeSwitch.caseBlock.clauses) {
    if (ts.isDefaultClause(clause)) {
      defaultCount += 1;
      defaultClause = clause;
      continue;
    }
    if (!ts.isStringLiteral(clause.expression)) {
      throw new Error("ApiRouter route cases must remain exact string literals");
    }
    cases.push(clause.expression.text);
  }
  return {
    cases,
    defaultCount,
    defaultIsExactNotFound: exactNotFoundDefault(defaultClause),
    keyDeclarationIsExact: exactRouteKeyDeclaration(statements[0]),
    statementCount: statements.length,
    switchExpressionIsKey:
      ts.isIdentifier(routeSwitch.expression) && routeSwitch.expression.text === "key",
    switchCount: switches.length,
  };
}

function invalidResponse(
  code: string,
  message: string,
  status = 400,
): ApiResponse {
  return {
    status,
    headers: JSON_HEADERS,
    body: { kind: "json", value: { code, message } },
  };
}

function validBaseRequest(): ApiRequest {
  return {
    requestId: "router-envelope-contract-001",
    method: "GET",
    path: "/api/sp-api/accounting/capabilities",
    query: { marketplaceId: "ATVPDKIKX0DER" },
    headers: {},
  };
}

const MALFORMED_REQUESTS: readonly (readonly [string, unknown])[] = [
  ["null request", null],
  ["non-object request", "request"],
  ["missing request identifier", { ...validBaseRequest(), requestId: undefined }],
  ["short request identifier", { ...validBaseRequest(), requestId: "short" }],
  ["request identifier controls", { ...validBaseRequest(), requestId: "request\n001" }],
  ["oversized request identifier", { ...validBaseRequest(), requestId: "r".repeat(101) }],
  ["lowercase method", { ...validBaseRequest(), method: "get" }],
  ["unknown method", { ...validBaseRequest(), method: "OPTIONS" }],
  ["non-string method", { ...validBaseRequest(), method: 1 }],
  ["non-string path", { ...validBaseRequest(), path: 1 }],
  ["path outside API", { ...validBaseRequest(), path: "/sp-api/orders" }],
  ["uppercase API prefix", { ...validBaseRequest(), path: "/API/sp-api/orders" }],
  ["oversized path", { ...validBaseRequest(), path: `/api/${"x".repeat(196)}` }],
  ["null query", { ...validBaseRequest(), query: null }],
  ["array query", { ...validBaseRequest(), query: [] }],
  ["non-string query value", { ...validBaseRequest(), query: { marketplaceId: 1 } }],
  ["null headers", { ...validBaseRequest(), headers: null }],
  ["array headers", { ...validBaseRequest(), headers: [] }],
  ["non-string header value", { ...validBaseRequest(), headers: { "x-test": 1 } }],
  ["null body", { ...validBaseRequest(), body: null }],
  ["array body", { ...validBaseRequest(), body: [] }],
  ["unknown body kind", { ...validBaseRequest(), body: { kind: "text", value: {} } }],
  ["JSON body without value", { ...validBaseRequest(), body: { kind: "json" } }],
  ["JSON body with an array", {
    ...validBaseRequest(),
    body: { kind: "json", value: [] },
  }],
  ["multipart body with non-string fields", {
    ...validBaseRequest(),
    body: {
      kind: "multipart",
      fields: { marketplaceId: 1 },
      file: { name: "image.png", type: "image/png", bytes: new Uint8Array() },
    },
  }],
  ["multipart body without a file", {
    ...validBaseRequest(),
    body: { kind: "multipart", fields: {} },
  }],
  ["multipart body with non-binary bytes", {
    ...validBaseRequest(),
    body: {
      kind: "multipart",
      fields: {},
      file: { name: "image.png", type: "image/png", bytes: [] },
    },
  }],
];

type DirectHandleCase = Readonly<{
  label: string;
  method: ApiMethod;
  path: `/api/${string}`;
  query?: Record<string, string>;
  body?: ApiRequest["body"];
  expected: ApiResponse;
}>;

const DIRECT_HANDLE_CASES: readonly DirectHandleCase[] = [
  {
    label: "Sales Trend",
    method: "GET",
    path: "/api/sp-api/sales-trend",
    query: { marketplaceId: "invalid" },
    expected: invalidResponse("INVALID_INPUT", "不支援這個 Amazon 站點。"),
  },
  {
    label: "Listings read",
    method: "GET",
    path: "/api/sp-api/listings",
    expected: invalidResponse("INVALID_INPUT", "請選擇站點並輸入完整 SKU。"),
  },
  ...(["POST", "PATCH"] as const).map((method): DirectHandleCase => ({
    label: `Listings ${method}`,
    method,
    path: "/api/sp-api/listings",
    body: { kind: "json", value: { marketplaceId: "invalid" } },
    expected: invalidResponse("INVALID_INPUT", "請提供有效的 Amazon 站點與完整 SKU。"),
  })),
  {
    label: "Listings batch",
    method: "POST",
    path: "/api/sp-api/listings/batch",
    body: { kind: "json", value: { marketplaceId: "invalid", skus: [] } },
    expected: invalidResponse("INVALID_INPUT", "請選擇站點並提供 SKU 清單。"),
  },
  {
    label: "Listing Images read",
    method: "GET",
    path: "/api/sp-api/listing-images",
    expected: invalidResponse("INVALID_INPUT", "請選擇站點並輸入完整 SKU。"),
  },
  ...(["POST", "PATCH"] as const).map((method): DirectHandleCase => ({
    label: `Listing Images ${method}`,
    method,
    path: "/api/sp-api/listing-images",
    body: { kind: "json", value: { marketplaceId: "invalid" } },
    expected: invalidResponse("INVALID_INPUT", "請提供有效的站點、SKU 與最多九個圖片 URL。"),
  })),
  ...(["POST", "PATCH"] as const).map((method): DirectHandleCase => ({
    label: `Sale Price ${method}`,
    method,
    path: "/api/sp-api/sale-price",
    body: { kind: "json", value: { marketplaceId: "invalid" } },
    expected: invalidResponse("INVALID_INPUT", "請提供有效的站點、SKU 與折扣操作。"),
  })),
  {
    label: "Subscribe & Save",
    method: "GET",
    path: "/api/sp-api/subscribe-save",
    expected: invalidResponse("INVALID_INPUT", "請選擇站點並輸入完整 SKU。"),
  },
  {
    label: "Subscription Audit",
    method: "GET",
    path: "/api/sp-api/subscription-audit",
    expected: invalidResponse(
      "INVALID_INPUT",
      "請選擇支援的站點；月度歷史只能選最近 6、12 或 23 個完整月份。",
    ),
  },
  {
    label: "Subscription Audit export",
    method: "GET",
    path: "/api/sp-api/subscription-audit/export",
    expected: invalidResponse("INVALID_INPUT", "Subscribe & Save 匯出資訊無效，請重新執行健檢。"),
  },
  {
    label: "Replenishment",
    method: "GET",
    path: "/api/sp-api/replenishment-plan",
    expected: invalidResponse(
      "INVALID_INPUT",
      "請提供有效的站點、SKU、目標天數、交期、安全天數與箱入數。",
    ),
  },
  {
    label: "SKU Command",
    method: "GET",
    path: "/api/sp-api/sku-command",
    expected: invalidResponse("INVALID_INPUT", "請選擇站點並輸入完整 SKU。"),
  },
  {
    label: "Operations Board SKU facts",
    method: "POST",
    path: "/api/sp-api/operations-board-facts",
    body: { kind: "json", value: { items: [] } },
    expected: invalidResponse("INVALID_INPUT", "請提供 1–100 個有效的公布欄 SKU。"),
  },
  {
    label: "Product Master read",
    method: "GET",
    path: "/api/product-master",
    expected: invalidResponse("INVALID_INPUT", "請選擇有效的 Amazon 站點。"),
  },
  {
    label: "Product Master write",
    method: "PUT",
    path: "/api/product-master",
    body: { kind: "json", value: { marketplaceId: "invalid" } },
    expected: invalidResponse("INVALID_INPUT", "商品主檔內有格式或範圍不正確的欄位。"),
  },
  {
    label: "Listing image upload",
    method: "POST",
    path: "/api/uploads/listing-images",
    body: {
      kind: "multipart",
      fields: {},
      file: { name: "image.png", type: "image/png", bytes: new Uint8Array() },
    },
    expected: invalidResponse("INVALID_INPUT", "請提供有效的站點、SKU 與圖片檔案。"),
  },
];

function contractRouter(
  approveWrite = vi.fn(async () => undefined),
  operationsBoard?: OperationsBoardPort,
): ApiRouter {
  return new ApiRouter({
    store: {} as LocalStore,
    vault: {} as CredentialVault,
    approveWrite,
    operationsBoard,
  } as ConstructorParameters<typeof ApiRouter>[0]);
}

describe("ApiRouter public contract", () => {
  it("matches one reviewed 69-pair matrix to the raw central switch inventory", () => {
    const reviewed = REVIEWED_ROUTES.map(routeKey);
    const production = productionRouteInventory();

    expect(REVIEWED_ROUTES).toHaveLength(69);
    expect(new Set(reviewed).size).toBe(reviewed.length);
    expect(production.statementCount).toBe(2);
    expect(production.keyDeclarationIsExact).toBe(true);
    expect(production.switchCount).toBe(1);
    expect(production.switchExpressionIsKey).toBe(true);
    expect(production.defaultCount).toBe(1);
    expect(production.defaultIsExactNotFound).toBe(true);
    expect(production.cases).toHaveLength(69);
    expect(new Set(production.cases).size).toBe(production.cases.length);
    expect([...production.cases].sort()).toEqual([...reviewed].sort());
  });

  it("serves the read-only shared operations board through its injected main owner", async () => {
    const board = {
      read: vi.fn(async () => ({
        snapshot: {
          schemaVersion: 2 as const,
          revision: 0,
          updatedAt: "1970-01-01T00:00:00.000Z",
          items: [],
        },
        source: "empty" as const,
        stale: false,
        status: "ready" as const,
      })),
      replace: vi.fn(),
    } satisfies OperationsBoardPort;

    const response = await contractRouter(vi.fn(async () => undefined), board).handle({
      requestId: "operations-board-read-001",
      method: "GET",
      path: "/api/operations-board",
      query: {},
      headers: {},
    });

    expect(response).toEqual({
      status: 200,
      headers: JSON_HEADERS,
      body: { kind: "json", value: await board.read.mock.results[0]?.value },
    });
    expect(board.read).toHaveBeenCalledOnce();
    expect(board.replace).not.toHaveBeenCalled();
  });

  it("rejects a malformed JSON body at the public handle envelope", async () => {
    const approveWrite = vi.fn(async () => undefined);
    const router = contractRouter(approveWrite);

    const response = await router.handle({
      requestId: "router-body-contract-001",
      method: "POST",
      path: "/api/sp-api/listings",
      query: {},
      headers: {},
      body: { kind: "json", value: [] } as never,
    } satisfies ApiRequest);

    expect(response).toEqual({
      status: 400,
      headers: JSON_HEADERS,
      body: {
        kind: "json",
        value: {
          code: "INVALID_REQUEST",
          message: "App 內部請求格式無效。",
        },
      },
    });
    expect(approveWrite).not.toHaveBeenCalled();
  });

  it.each(MALFORMED_REQUESTS)(
    "rejects malformed %s with the canonical invalid-request envelope",
    async (_label, request) => {
      const response = await contractRouter().handle(request as ApiRequest);

      expect(response).toEqual(
        invalidResponse("INVALID_REQUEST", "App 內部請求格式無效。"),
      );
    },
  );

  for (const route of REVIEWED_ROUTES) {
    it(`keeps ${routeKey(route)} exact against case, prefix, suffix and method near misses`, async () => {
      const pathTail = route.path.slice("/api/".length);
      const firstLowercase = pathTail.search(/[a-z]/u);
      if (firstLowercase < 0) throw new Error(`No case mutation available for ${route.path}`);
      const casePath = `/api/${pathTail.slice(0, firstLowercase)}${pathTail[firstLowercase]!.toUpperCase()}${pathTail.slice(firstLowercase + 1)}`;
      const wrongMethod = API_METHODS.find(
        (method) => !REVIEWED_ROUTES.some(
          (candidate) => candidate.path === route.path && candidate.method === method,
        ),
      );
      if (!wrongMethod) throw new Error(`No wrong method available for ${route.path}`);
      const nearMisses: readonly RoutePair[] = [
        { method: route.method, path: casePath as `/api/${string}` },
        { method: route.method, path: `/api/unreviewed${route.path.slice(4)}` },
        { method: route.method, path: `${route.path}-unreviewed` },
        { method: wrongMethod, path: route.path },
      ];
      const router = contractRouter();
      for (const nearMiss of nearMisses) {
        expect(REVIEWED_ROUTES.some(
          (candidate) => routeKey(candidate) === routeKey(nearMiss),
        )).toBe(false);
        const response = await router.handle({
          requestId: "router-near-miss-001",
          method: nearMiss.method,
          path: nearMiss.path,
          query: {},
          headers: {},
        });
        expect(response).toEqual(
          invalidResponse("NOT_FOUND", "此 App 版本不支援這個操作。", 404),
        );
      }
    });
  }

  for (const [index, direct] of DIRECT_HANDLE_CASES.entries()) {
    it(`dispatches the previously implicit ${direct.label} route through handle`, async () => {
      const response = await contractRouter().handle({
        requestId: `router-direct-${String(index + 1).padStart(3, "0")}`,
        method: direct.method,
        path: direct.path,
        query: direct.query ?? {},
        headers: {},
        ...(direct.body === undefined ? {} : { body: direct.body }),
      });

      expect(response).toEqual(direct.expected);
    });
  }
});
