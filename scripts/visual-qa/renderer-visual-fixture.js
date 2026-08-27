/* Shared fixed-time, local-only renderer data for visual regression runs. */
(() => {
  const params = new URLSearchParams(window.location.search);
  const css03 = params.get("css03") === "1";
  const salesLoading = params.get("sales-loading") === "1";
  try {
    window.localStorage.setItem("fba-os-auto-sync", "off");
    window.localStorage.setItem(
      "amz-api:ui-font-size",
      params.get("font") === "large" ? "large" : "standard",
    );
  } catch {
    // The visual harness still verifies the default if storage is unavailable.
  }
  if (params.get("gate") === "1") return;

  const marketplaceId = "ATVPDKIKX0DER";
  const fixedTime = "2026-08-21T12:00:00.000Z";
  const json = (value, status = 200) => ({
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
    body: { kind: "json", value },
  });
  const points = (year) =>
    Array.from({ length: 7 }, (_, index) => {
      const day = String(index + 1).padStart(2, "0");
      const nextDay = String(index + 2).padStart(2, "0");
      return {
        date: `${year}-08-${day}`,
        interval:
          `${year}-08-${day}T00:00:00-07:00--` +
          `${year}-08-${nextDay}T00:00:00-07:00`,
        totalSales: { amount: 100 + index, currencyCode: "USD" },
        unitCount: 2,
        orderItemCount: 2,
        orderCount: 1,
        partial: index === 6,
      };
    });
  const currentPoints = points(2026);
  const previousPoints = points(2025);
  const salesTotals = {
    totalSales: { amount: 721, currencyCode: "USD" },
    unitCount: 14,
    orderItemCount: 14,
    orderCount: 7,
  };
  const sales = {
    schemaVersion: 2,
    mode: "demo",
    marketplaceId,
    days: 7,
    timeZone: "America/Los_Angeles",
    range: {
      startDate: "2026-08-01",
      endDate: "2026-08-07",
      dayCount: 7,
      presetDays: 7,
    },
    points: currentPoints,
    totals: salesTotals,
    comparison: {
      kind: "previous-year",
      range: {
        startDate: "2025-08-01",
        endDate: "2025-08-07",
        dayCount: 7,
        presetDays: null,
      },
      points: previousPoints,
      totals: salesTotals,
      requestId: null,
      rateLimit: "fixture",
    },
    fetchedAt: "2026-08-07T12:00:00.000Z",
    requestId: null,
    rateLimit: "fixture",
    notice: "CSS01 固定展示資料；未連線 Amazon。",
  };
  const health = {
    marketplaceId,
    marketplaceLabel: "Amazon.com",
    mode: "demo",
    overall: "ready",
    checkedAt: fixedTime,
    score: 100,
    summary: { ready: 4, attention: 0, manual: 0 },
    checks: [
      {
        id: "sp-api",
        label: "SP-API 本機橋接",
        state: "ready",
        automation: "automatic",
        detail: "固定本機視覺資料已就緒。",
        action: null,
      },
      {
        id: "fba-only",
        label: "FBA-only 邊界",
        state: "ready",
        automation: "automatic",
        detail: "測試資料只包含 FBA。",
        action: null,
      },
      {
        id: "write-gate",
        label: "寫入防呆",
        state: "ready",
        automation: "one_click",
        detail: "本次視覺檢查不執行寫入。",
        action: null,
      },
      {
        id: "real-device",
        label: "Notebook 鑰匙",
        state: "ready",
        automation: "manual",
        detail: "真實裝置驗證不在 CSS01 範圍。",
        action: null,
      },
    ],
    safeguards: [
      "憑證不進入瀏覽器",
      "FBA-only",
      "預檢後才可寫入",
      "不盲目重試寫入",
    ],
    notice: "CSS01 固定本機 fixture；沒有 Amazon 或真實裝置操作。",
  };
  const brandSnapshot = {
    schemaVersion: 2,
    mode: "demo",
    marketplaceId,
    startDate: "2026-08-01",
    endDate: "2026-08-07",
    fetchedAt: "2026-08-08T08:00:00.000Z",
    dataThrough: "2026-08-08T00:00:00-07:00",
    rangeFreshness: "complete-days",
    currencyCode: "USD",
    segments: [
      { key: "afreschi", label: "Afreschi", color: "#2F855A", amount: 50, percentage: 50, skuCount: 2, unitCount: 5 },
      { key: "gootoe", label: "GooToE", color: "#ED8936", amount: 25, percentage: 25, skuCount: 1, unitCount: 2 },
      { key: "herz", label: "Herz", color: "#3182CE", amount: 10, percentage: 10, skuCount: 1, unitCount: 1 },
      { key: "vitaday", label: "Vitaday", color: "#ECC94B", amount: 5, percentage: 5, skuCount: 1, unitCount: 1 },
      { key: "healthy-moment", label: "Healthy Moment", color: "#E53E3E", amount: 5, percentage: 5, skuCount: 1, unitCount: 1 },
      { key: "unclassified", label: "未分類", color: "#A0A7B1", amount: 5, percentage: 5, skuCount: 1, unitCount: 1 },
    ],
    categorySegments: [
      { key: "turkey-tendon", label: "Turkey Tendons/Tendon", color: "#b45309", amount: 40, percentage: 40, skuCount: 2, unitCount: 4 },
      { key: "turkey", label: "Turkey", color: "#f59e0b", amount: 20, percentage: 20, skuCount: 1, unitCount: 2 },
      { key: "chicken", label: "Chicken", color: "#ef4444", amount: 15, percentage: 15, skuCount: 1, unitCount: 1 },
      { key: "salmon", label: "Salmon", color: "#f97316", amount: 10, percentage: 10, skuCount: 1, unitCount: 1 },
      { key: "buffalo", label: "Buffalo", color: "#7c3aed", amount: 5, percentage: 5, skuCount: 1, unitCount: 1 },
      { key: "fish", label: "Fish", color: "#0284c7", amount: 5, percentage: 5, skuCount: 1, unitCount: 1 },
      { key: "air-dried", label: "Air Dried", color: "#10b981", amount: 5, percentage: 5, skuCount: 0, unitCount: 1 },
      { key: "other", label: "其他", color: "#94a3b8", amount: 0, percentage: 0, skuCount: 0, unitCount: 0 },
    ],
    summary: {
      amount: 100,
      unitCount: 11,
      classifiedAmount: 95,
      unclassifiedAmount: 5,
      currentFbaSkuCount: 8,
      soldFbaSkuCount: 7,
      soldCurrentFbaSkuCount: 7,
      unmatchedCurrentFbaRowCount: 0,
    },
    source: "FBA_CUSTOMER_SHIPMENT_SALES_REPORT",
    notice: "固定 FBA 已出貨商品資料。",
  };
  const member = (sellerSku, asin, parentSku, value) => ({
    sellerSku,
    asin,
    title: `Fixture ${sellerSku}`,
    productType: "PET_FOOD",
    status: ["BUYABLE"],
    role: "child",
    parentSku,
    childSkus: [],
    variationTheme: "SIZE_NAME",
    dimensions: [{ name: "size_name", label: "Size Name", values: [value] }],
    fba: true,
    issues: [],
    relationshipSources: ["relationships", "attributes"],
  });
  const parent = (sellerSku, childSkus) => ({
    sellerSku,
    asin: null,
    title: `Fixture ${sellerSku}`,
    productType: "PET_FOOD",
    status: ["BUYABLE"],
    role: "parent",
    parentSku: null,
    childSkus,
    variationTheme: "SIZE_NAME",
    dimensions: [{ name: "size_name", label: "Size Name", values: [] }],
    fba: false,
    issues: [],
    relationshipSources: ["relationships"],
  });
  const sourceChild = member("SOURCE-4OZ", "B000000001", "SOURCE-PARENT", "4 oz");
  const sourceChildren = css03
    ? [
        sourceChild,
        ...Array.from({ length: 11 }, (_, index) => {
          const sequence = String(index + 1).padStart(2, "0");
          return {
            ...member(
              `CSS03-LONG-FBA-VARIATION-CHILD-${sequence}`,
              `B03VIS${String(index + 1).padStart(4, "0")}`,
              "SOURCE-PARENT",
              `Extra-long CSS03 package configuration ${sequence} with descriptive dimension text`,
            ),
            title:
              `CSS03 fixed visual fixture child ${sequence} with an intentionally long ` +
              "FBA product title that must wrap safely inside the Variation drawer",
            dimensions: [
              {
                name: "size_name",
                label: "Size Name / Package Configuration / FBA Variation Dimension",
                values: [
                  `Extra-long CSS03 package configuration ${sequence} with descriptive dimension text`,
                ],
              },
            ],
          };
        }),
      ]
    : [sourceChild];
  const sourceParent = parent(
    "SOURCE-PARENT",
    sourceChildren.map(({ sellerSku }) => sellerSku),
  );
  const sourceFamily = {
    mode: "demo",
    marketplaceId,
    queriedSku: "SOURCE-4OZ",
    queriedRole: "child",
    queried: sourceChild,
    parent: sourceParent,
    children: sourceChildren,
    excludedChildren: [],
    variationTheme: "SIZE_NAME",
    dimensionNames: ["size_name"],
    familyComplete: true,
    fetchedAt: fixedTime,
    requestIds: ["css01-source"],
    writable: false,
    boundaries: ["FBA only", "read only"],
    notice: "CSS01 固定唯讀 fixture。",
  };
  const targetChild = member("TARGET-8OZ", "B000000002", "TARGET-PARENT", "8 oz");
  const targetParent = parent("TARGET-PARENT", ["TARGET-8OZ"]);
  const targetFamily = {
    mode: "demo",
    marketplaceId,
    queriedSku: "TARGET-PARENT",
    queriedRole: "parent",
    queried: targetParent,
    parent: targetParent,
    children: [targetChild],
    excludedChildren: [],
    variationTheme: "SIZE_NAME",
    dimensionNames: ["size_name"],
    familyComplete: true,
    fetchedAt: fixedTime,
    requestIds: ["css01-target"],
    writable: false,
    boundaries: ["FBA only", "read only"],
    notice: "CSS01 固定唯讀 fixture。",
  };
  const b2bSnapshot = {
    mode: "demo",
    marketplaceId,
    fetchedAt: fixedTime,
    rows: [
      {
        sellerSku: "B2B-DEMO-01",
        asin: "B000000003",
        title: "Fixture Business Price",
        productType: "PET_FOOD",
        standardPrice: { amount: 19.99, currencyCode: "USD" },
        businessPrice: null,
        businessOfferPresence: "absent",
        quantityDiscountPlan: null,
        quantityDiscountPlanPresence: "absent",
        recommendedPriceMismatch: false,
        recommendedQuantityDiscountMismatch: true,
        status: "missing",
        editable: false,
        reason: "尚未設定 Amazon Business 價格。",
      },
    ],
    summary: {
      totalFbaSkuCount: 1,
      configured: 0,
      aboveStandard: 0,
      missing: 1,
      unsupported: 0,
      incomplete: 0,
      recommendedPriceMismatch: 0,
      recommendedQuantityDiscountMismatch: 1,
    },
    notice: "CSS01 固定唯讀 fixture。",
  };
  const b2bJob = {
    jobId: "11111111-1111-4111-8111-111111111111",
    contextId: "22222222-2222-4222-8222-222222222222",
    kind: "businessPricing",
    marketplaceId,
    mode: "demo",
    options: {},
    ready: true,
    status: "completed",
    progress: {
      stage: "complete",
      message: "B2B 價格健檢完成",
      completedUnits: 1,
      totalUnits: 1,
    },
    snapshot: b2bSnapshot,
  };
  const reportLibrary = {
    schemaVersion: 1,
    marketplaceId,
    fetchedAt: "2026-08-21T08:00:00.000Z",
    officialCatalog: {
      uniqueReportTypeCount: 1,
      verifiedAt: "2026-08-21",
      officialPageUpdatedLabel: "CSS01 deterministic fixture",
      source: "https://developer-docs.amazon.com/sp-api/docs/report-type-values",
      changeNotice: "Amazon 官方清單可能更新；本畫面使用固定測試資料。",
    },
    currentAppExports: [
      {
        id: "CONTENT_AUDIT_XLSX",
        label: "FBA 文案健檢 Excel",
        source: "All Listings 與 Listings Items",
        scope: "固定唯讀視覺測試資料。",
        availability: "AVAILABLE_AFTER_AUDIT",
      },
    ],
    reports: [
      {
        reportType: "GET_AFN_INVENTORY_DATA",
        label: "AFN 庫存",
        description: "FBA 庫存摘要。",
        categories: ["FBA"],
        party: "SELLER",
        fbaScope: "FBA_ONLY",
        lifecycle: "REQUEST",
        output: "TAB_DELIMITED",
        restrictedData: "NONE",
        roles: ["Amazon Fulfillment"],
        marketplaceAvailability: "US FBA sellers",
        prerequisites: [],
        deprecated: false,
        officialSource: "https://developer-docs.amazon.com/sp-api/docs/report-type-values-fba",
        state: "READY_TO_PLAN",
        amazonPublicArtifactAvailable: true,
        appDownloadImplemented: false,
        stateNotice: "Amazon 有此文件，App 尚未接線。",
      },
    ],
    unavailableDocuments: [],
    reviewAuditCapability: {
      supportedForMarketplace: true,
      roles: ["Selling Partner Insights", "Brand Analytics"],
      updateCadence: "WEEKLY",
      topicLanguage: "ENGLISH_ONLY",
      nonParentFbaAsinsOnly: true,
      relationshipsEvidenceRequired: true,
      parentContainersExcluded: true,
      fullReviewTextAvailable: false,
      averageProductRatingAvailable: false,
      totalReviewCountAvailable: false,
    },
    notice: "FBA-only · CSS01 固定視覺 fixture",
  };
  const accountingSnapshot = {
    marketplaceId,
    fetchedAt: fixedTime,
    capabilities: [
      {
        id: "FBA_STORAGE_FEES",
        label: "FBA 每月倉儲費估算",
        artifact: "TAB_DELIMITED_REPORT",
        access: "CREATE_PUBLIC_REPORT",
        roles: ["Pricing", "Amazon Fulfillment"],
        availability: "CONFIGURED_FBA_MARKETPLACES",
        fbaSafety: "OFFICIAL_FBA_ONLY",
        reportType: "GET_FBA_STORAGE_FEE_CHARGES_DATA",
        officialSource: "https://developer-docs.amazon.com/sp-api/docs/report-type-values-fba",
        notice: "可請求或排程；內容是估算，不是發票。",
        state: "READY_CREATE_REPORT",
      },
      {
        id: "FINANCIAL_HOLDS",
        label: "日期區間財務保留款",
        artifact: "TAB_DELIMITED_REPORT",
        access: "SELLER_CENTRAL_PREREQUISITE",
        roles: ["Finance and Accounting"],
        availability: "CONFIGURED_FBA_MARKETPLACES",
        fbaSafety: "ACCOUNT_WIDE_NOT_FBA_SAFE",
        reportType: "GET_DATE_RANGE_FINANCIAL_HOLDS_DATA",
        officialSource: "https://developer-docs.amazon.com/sp-api/docs/report-type-values",
        notice: "需先確認帳號與 FBA 安全範圍。",
        state: "MANUAL_PREREQUISITE",
      },
      {
        id: "GENERIC_MARKETPLACE_INVOICES",
        label: "一般站點 Amazon 發票",
        artifact: "NONE",
        access: "UNAVAILABLE_PUBLIC_API",
        roles: [],
        availability: "NONE",
        fbaSafety: "NO_PUBLIC_DATA",
        reportType: null,
        officialSource: "https://developer-docs.amazon.com/sp-api/docs/invoices-api",
        notice: "公開 API 不提供這項下載。",
        state: "UNAVAILABLE",
      },
    ],
    notice: "CSS02 固定唯讀 fixture；未連線 Amazon。",
  };
  const inboundSnapshot = {
    schemaVersion: 1,
    mode: "demo",
    marketplaceId,
    fetchedAt: "2026-08-21T08:00:00.000Z",
    shipmentListScope: "selected-date-range",
    dateRange: {
      startDate: "2026-05-24",
      endDate: "2026-08-21",
      lastUpdatedAfter: "2026-05-24T07:00:00.000Z",
      lastUpdatedBefore: "2026-08-22T07:00:00.000Z",
    },
    coverage: {
      state: "complete",
      shipmentsWithCompleteItems: 1,
      shipmentsWithPartialItems: 0,
      incompleteShipmentCount: 0,
      issues: [],
    },
    summary: {
      shipmentCount: 1,
      itemCount: 1,
      incompleteShipmentCount: 0,
      totals: { expectedUnits: 12, receivedUnits: 10, pendingUnits: 2, overReceivedUnits: 0 },
      verifiedTotals: { expectedUnits: 12, receivedUnits: 10, pendingUnits: 2, overReceivedUnits: 0 },
    },
    shipments: [
      {
        shipmentId: "FBA15VISUAL001",
        shipmentName: "CSS01 visual shipment",
        status: "RECEIVING",
        destinationFulfillmentCenterId: "ONT8",
        labelPrepType: "SELLER_LABEL",
        boxContentsSource: "FEED",
        itemCoverage: "complete",
        itemCount: 1,
        totals: { expectedUnits: 12, receivedUnits: 10, pendingUnits: 2, overReceivedUnits: 0 },
        verifiedTotals: { expectedUnits: 12, receivedUnits: 10, pendingUnits: 2, overReceivedUnits: 0 },
      },
    ],
    items: [
      {
        shipmentId: "FBA15VISUAL001",
        sellerSku: "TEST-SKU-001",
        fulfillmentNetworkSku: "X000TEST01",
        asin: "B000TEST01",
        title: "Deterministic Test Product",
        quantityInCase: 12,
        expectedUnits: 12,
        receivedUnits: 10,
        pendingUnits: 2,
        overReceivedUnits: 0,
      },
    ],
    issueReport: {
      state: "completed",
      fetchedAt: "2026-08-21T07:55:00.000Z",
      dataThrough: null,
      excludedShipmentCount: 0,
      notice: "固定測試報表已讀取。",
      shipment: [],
      carton: [],
      product: [
        {
          level: "product",
          shipmentId: "FBA15VISUAL001",
          sellerSku: "TEST-SKU-001",
          fnsku: "X000TEST01",
          asin: "B000TEST01",
          productName: "Deterministic Test Product",
          cartonId: null,
          problemType: "Barcode cannot be scanned",
          problemQuantity: 1,
          expectedUnits: 12,
          receivedUnits: 10,
          reportedAt: "2026-08-20T00:00:00.000Z",
          alertStatus: "OPEN",
          notice: "固定唯讀測試列。",
        },
      ],
    },
    notice: "全部貨件商品列與每日問題報表已完成。",
  };
  const inboundJob = {
    jobId: "inbound-visual-0001",
    marketplaceId,
    dateRange: { startDate: "2026-05-24", endDate: "2026-08-21" },
    state: "completed",
    progress: { phase: "issues", completed: 1, total: 1 },
    snapshot: inboundSnapshot,
    notice: "同步已收斂。",
    failure: null,
  };
  const credentialSummary = {
    encryptionAvailable: true,
    hasVault: false,
    lwaConfigured: false,
    regions: {
      na: { configured: false, refreshTokenHint: null, sellerIdHint: null },
      fe: { configured: false, refreshTokenHint: null, sellerIdHint: null },
      eu: { configured: false, refreshTokenHint: null, sellerIdHint: null },
    },
    imageStorageConfigured: false,
    imagePublicBaseUrl: null,
    replenishmentSkillConfigured: false,
    updatedAt: null,
  };
  const advertisingSummary = {
    encryptionAvailable: true,
    hasVault: false,
    configured: false,
    lwaConfigured: false,
    refreshTokenConfigured: false,
    oauthRegion: "na",
    updatedAt: null,
  };
  let salesRequestCount = 0;

  window.__rendererVisualRequests = [];
  window.__rendererVisualUnexpected = [];
  window.fbaOS = {
    api: {
      request: async (request) => {
        const body =
          request.body?.kind === "json" ? request.body.value : null;
        window.__rendererVisualRequests.push({
          body,
          method: request.method,
          path: request.path,
          query: { ...request.query },
        });
        if (request.path === "/api/sp-api/sales-trend" && request.method === "GET") {
          salesRequestCount += 1;
          if (css03 && salesLoading && salesRequestCount > 1) {
            return new Promise(() => {});
          }
          return json(sales);
        }
        if (request.path === "/api/system/health" && request.method === "GET") {
          return json(health);
        }
        if (request.path === "/api/sp-api/brand-sales" && request.method === "POST") {
          return json({
            jobId: "css01-brand-job-001",
            mode: "demo",
            marketplaceId,
            startDate: "2026-08-01",
            endDate: "2026-08-07",
            expiresAt: "2099-01-01T00:00:00.000Z",
            ready: true,
            status: "DONE",
            message: "Fixture ready.",
          });
        }
        if (
          request.path === "/api/sp-api/brand-sales" &&
          request.method === "GET" &&
          request.query.data === "1"
        ) {
          return json(brandSnapshot);
        }
        if (request.path === "/api/sp-api/variation-family" && request.method === "GET") {
          if (request.query.sku === "SOURCE-4OZ") return json(sourceFamily);
          if (request.query.sku === "TARGET-PARENT") return json(targetFamily);
        }
        if (request.path === "/api/sp-api/standalone-audit" && request.method === "POST") {
          if (body?.kind === "businessPricing") return json(b2bJob);
        }
        if (request.path === "/api/sp-api/report-library" && request.method === "GET") {
          return json(reportLibrary);
        }
        if (request.path === "/api/sp-api/accounting/capabilities" && request.method === "GET") {
          return json(accountingSnapshot);
        }
        if (request.path === "/api/sp-api/inbound-shipments" && request.method === "POST") {
          return json(inboundJob);
        }
        window.__rendererVisualUnexpected.push({
          body,
          method: request.method,
          path: request.path,
          query: { ...request.query },
        });
        return json(
          {
            code: "RENDERER_VISUAL_UNHANDLED_FIXTURE_ROUTE",
            message: `No renderer visual fixture for ${request.method} ${request.path}`,
            requestId: null,
          },
          404,
        );
      },
      cancel: (requestId) => {
        window.__rendererVisualRequests.push({
          body: null,
          method: "CANCEL",
          path: requestId,
          query: {},
        });
      },
    },
    credentials: {
      status: async () => credentialSummary,
      openEditor: async () => {},
      clear: async () => credentialSummary,
      test: async () => ({ ok: false, testedAt: fixedTime, regions: {} }),
    },
    advertisingCredentials: {
      status: async () => advertisingSummary,
      openEditor: async () => {},
      clear: async () => advertisingSummary,
      test: async () => ({
        ok: false,
        testedAt: fixedTime,
        marketplaceId,
        marketplaceCode: "US",
        accountType: null,
        message: "CSS01 fixture only",
        requestId: null,
      }),
    },
    app: {
      version: async () => "0.1.31",
      platform: async () => "darwin",
      openExternal: async () => {},
      openSellerCentralInventory: async () => {},
    },
    updates: {
      check: async () => ({ state: "not-available", message: "CSS01 fixture only" }),
      install: async () => {},
      onStatus: () => () => {},
    },
  };
})();
