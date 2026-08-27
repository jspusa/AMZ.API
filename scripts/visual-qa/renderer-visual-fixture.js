/* Shared fixed-time, local-only renderer data for visual regression runs. */
(() => {
  const params = new URLSearchParams(window.location.search);
  const css03 = params.get("css03") === "1";
  const css04 = params.get("css04") === "1";
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
  const standaloneJob = (kind, jobId, contextId, snapshot) => ({
    jobId,
    contextId,
    kind,
    marketplaceId,
    mode: "demo",
    options: {},
    ready: true,
    status: "completed",
    progress: {
      stage: "complete",
      message: "CSS04 固定唯讀健檢完成",
      completedUnits: snapshot.rows?.length ?? 1,
      totalUnits: snapshot.rows?.length ?? 1,
    },
    snapshot,
  });
  const css04ImageSnapshot = {
    marketplaceId,
    fetchedAt: fixedTime,
    exportId: "31000000-0000-4100-8100-000000000001",
    minimumImages: 6,
    rows: [
      {
        sellerSku: "CSS04-IMAGE-MISSING",
        asin: "B04IMG0001",
        productType: "PET_FOOD",
        title: "CSS04 turkey tendon image audit row with fewer than six images",
        imageUrls: [
          "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='90' height='90'%3E%3Crect width='90' height='90' fill='%23f3e5cf'/%3E%3Ctext x='45' y='51' text-anchor='middle' font-size='18'%3E1%3C/text%3E%3C/svg%3E",
        ],
        imageCount: 1,
        readStatus: "complete",
        readErrors: [],
      },
      {
        sellerSku: "CSS04-IMAGE-COMPLETE",
        asin: "B04IMG0002",
        productType: "PET_FOOD",
        title: "CSS04 image-complete comparison row",
        imageUrls: Array.from({ length: 6 }, (_, index) =>
          `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='90' height='90'%3E%3Crect width='90' height='90' fill='%23edf4ef'/%3E%3Ctext x='45' y='51' text-anchor='middle' font-size='18'%3E${index + 1}%3C/text%3E%3C/svg%3E`,
        ),
        imageCount: 6,
        readStatus: "complete",
        readErrors: [],
      },
      {
        sellerSku: "CSS04-IMAGE-INCOMPLETE",
        asin: "B04IMG0003",
        productType: "PET_FOOD",
        title: "CSS04 fail-visible image read",
        imageUrls: [],
        imageCount: 0,
        readStatus: "incomplete",
        readErrors: [{
          code: "LISTING_CONTENT_NOT_RETURNED",
          message: "Amazon fixture 未回傳可驗證圖片 attributes；不判定為零張。",
        }],
      },
    ],
    summary: { total: 3, completed: 2, incomplete: 1, underMinimum: 1 },
  };
  const css04ImageJob = standaloneJob(
    "image",
    "31000000-0000-4100-8100-000000000002",
    "31000000-0000-4100-8100-000000000003",
    css04ImageSnapshot,
  );
  const css04AgedInventorySnapshot = {
    mode: "demo",
    marketplaceId,
    fetchedAt: fixedTime,
    exportId: "32000000-0000-4200-8200-000000000001",
    rows: [{
      sellerSku: "CSS04-AGED-FBA-01",
      fnSku: "X04AGED001",
      asin: "B04AGED001",
      title: "CSS04 aged FBA inventory with independent excess evidence",
      condition: "New",
      available: 240,
      totalAgedUnits: 50,
      agedOver180: 31,
      ageBuckets: [
        { key: "0-90", label: "0–90 天", units: 10, over180: false },
        { key: "91-180", label: "91–180 天", units: 9, over180: false },
        { key: "181-270", label: "181–270 天", units: 12, over180: true },
        { key: "271-365", label: "271–365 天", units: 10, over180: true },
        { key: "366-455", label: "366–455 天", units: 7, over180: true },
        { key: "456-plus", label: "456 天以上", units: 2, over180: true },
      ],
      estimatedExcessQuantity: 25,
      recommendedRemovalQuantity: 5,
      daysOfSupply: 220.5,
      currencyCode: "USD",
      estimatedStorageCostNextMonth: 15.25,
      estimatedAgedSurcharge: 3.6,
      agedSurchargeBuckets: [
        { key: "181-210", label: "AIS 181–210 天", quantity: 3, estimatedCharge: 1.2 },
        { key: "211-240", label: "AIS 211–240 天", quantity: 4, estimatedCharge: 2.4 },
      ],
      alert: "CSS04 fixed Amazon alert evidence",
      recommendedAction: "Review removal or promotion options",
      snapshotDate: "2026-08-20",
    }],
    summary: {
      skuCount: 1,
      agedOver180SkuCount: 1,
      totalAgedUnits: 50,
      agedOver180: 31,
      excessAvailability: "complete",
      estimatedExcessQuantity: 25,
      excessReportedSkuCount: 1,
      currencyCode: "USD",
      storageCostAvailability: "complete",
      estimatedStorageCostNextMonth: 15.25,
      storageCostReportedSkuCount: 1,
      agedSurchargeAvailability: "complete",
      estimatedAgedSurcharge: 3.6,
      agedSurchargeReportedSkuCount: 1,
    },
    expiration: {
      currentFbaExpirationDatesAvailable: false,
      nearExpiryUnits: null,
      expiredUnits: null,
      inboundPlanExpirationDatesAvailable: true,
      notice: "CSS04 fixture preserves the current-FC expiration boundary.",
    },
    notice: "CSS04 固定唯讀 FBA 庫齡資料；未連線 Amazon。",
  };
  const css04AgedInventoryJob = standaloneJob(
    "agedInventory",
    "32000000-0000-4200-8200-000000000002",
    "32000000-0000-4200-8200-000000000003",
    css04AgedInventorySnapshot,
  );
  const css04AdvertisingSnapshot = {
    schemaVersion: 1,
    mode: "demo",
    marketplaceId,
    marketplaceCode: "US",
    fetchedAt: fixedTime,
    rows: [
      {
        sellerSku: "CSS04-ADS-COVERED",
        asin: "B04ADS0001",
        title: "CSS04 covered FBA advertising row",
        covered: true,
        evidence: {
          kind: "seller-sku",
          campaignId: "coverage-evidence.css04.1",
          campaignName: "[ProductAI] US-B04ADS0001-CSS04-ADS-COVERED-SP-PAT-Aug202026",
          campaignSellerSku: "CSS04-ADS-COVERED",
        },
      },
      {
        sellerSku: "CSS04-ADS-UNCOVERED",
        asin: "B04ADS0002",
        title: "CSS04 uncovered FBA advertising row with long wrapping evidence",
        covered: false,
        evidence: null,
      },
    ],
    uncovered: [{
      sellerSku: "CSS04-ADS-UNCOVERED",
      asin: "B04ADS0002",
      title: "CSS04 uncovered FBA advertising row with long wrapping evidence",
      covered: false,
      evidence: null,
    }],
    summary: {
      currentFbaSkuCount: 2,
      coveredSkuCount: 1,
      directSkuCount: 1,
      sameAsinCount: 0,
      uncoveredSkuCount: 1,
      eligibleCampaignCount: 1,
      ignoredInactiveCampaignCount: 0,
      ignoredMalformedCampaignCount: 0,
    },
    rule: "CSS04 固定資料只計 ENABLED Sponsored Products。",
    notice: "CSS04 固定唯讀 Ads 覆蓋資料；未連線 Amazon。",
  };
  const css04AdvertisingJob = standaloneJob(
    "advertising",
    "33000000-0000-4300-8300-000000000001",
    "33000000-0000-4300-8300-000000000002",
    css04AdvertisingSnapshot,
  );
  const css04ContentSnapshot = {
    marketplaceId,
    fetchedAt: fixedTime,
    exportId: "34000000-0000-4400-8400-000000000001",
    rows: [
      {
        sellerSku: "CSS04-MISSING-BULLETS",
        asin: "B04COPY001",
        productType: "PET_FOOD",
        title: "Trukey tendon missing bullet fixture",
        bulletPoints: ["Only one concise benefit"],
        ingredients: "Turkey",
        readStatus: "complete",
        readErrors: [],
        variationRole: "child",
        variationParentSku: "CSS04-PARENT",
        variationFamilyKey: "CSS04-PARENT",
        variationTheme: "SIZE_NAME",
        relationshipStatus: "complete",
        relationshipMessage: "CSS04 fixture relationship proof complete.",
        issues: [
          {
            kind: "MISSING_BULLETS",
            field: "bulletPoints",
            message: "目前只有 1 個非空白賣點，少於 5 個。",
          },
          {
            kind: "SUSPECTED_TYPO",
            field: "title",
            token: "Trukey",
            suggestion: "Turkey",
            source: "pages-dictionary",
            message: "標題疑似有錯字 Trukey。",
          },
        ],
      },
      {
        sellerSku: "CSS04-TYPO-ONLY",
        asin: "B04COPY002",
        productType: "PET_FOOD",
        title: "Naturall turkey treats typo-only fixture",
        bulletPoints: ["One", "Two", "Three", "Four", "Five"],
        ingredients: "Turkey",
        readStatus: "complete",
        readErrors: [],
        variationRole: "standalone",
        relationshipStatus: "complete",
        issues: [{
          kind: "SUSPECTED_TYPO",
          field: "title",
          token: "Naturall",
          suggestion: "Natural",
          source: "pages-dictionary",
          message: "標題疑似有錯字 Naturall。",
        }],
      },
      {
        sellerSku: "CSS04-READ-INCOMPLETE",
        asin: "B04COPY003",
        productType: "PET_FOOD",
        title: "",
        bulletPoints: [],
        ingredients: "",
        readStatus: "incomplete",
        readErrors: [{
          code: "LISTING_CONTENT_NOT_RETURNED",
          message: "CSS04 fixture preserves an incomplete read without inventing missing content.",
        }],
        variationRole: "unknown",
        relationshipStatus: "incomplete",
        issues: [],
      },
    ],
    summary: { total: 3 },
  };
  const css04ContentJob = standaloneJob(
    "content",
    "34000000-0000-4400-8400-000000000002",
    "34000000-0000-4400-8400-000000000003",
    css04ContentSnapshot,
  );
  const css04AdvertisingStrategySnapshot = {
    schemaVersion: 1,
    marketplaceId,
    marketplaceCode: "US",
    dateRange: { startDate: "2026-08-01", endDate: "2026-08-07" },
    currencyCode: "USD",
    fetchedAt: "2026-08-08T03:00:00.000Z",
    sourceFetchedAt: {
      fba: "2026-08-08T02:00:00.000Z",
      sales: "2026-08-08T02:15:00.000Z",
      ads: "2026-08-08T02:30:00.000Z",
    },
    rows: [{
      sellerSku: "CSS04-STRATEGY-01",
      asin: "B04STR0001",
      title: "CSS04 deterministic FBA advertising strategy row with wrapping copy",
      price: null,
      salesStatus: "reported",
      unitsSold: 10,
      salesAmount: 200,
      salesRank: 1,
      salesTier: "T1",
      suggestedSpDailyBudget: 300,
      suggestedSpTargetAcos: 0.35,
      suggestion: "overrideable-default",
      spStatus: "reported",
      spSpend: 35,
      spSales14d: 100,
      spActualAcos: 0.35,
      spActualAcosStatus: "reported",
      spPurchases14d: 2,
      spSpendRank: 1,
      spAttribution: "seller-sku",
      specification: null,
      sbSales: null,
      sbSalesAcos: null,
      sbAttack: null,
      sbAttackAcos: null,
      sdAttack: null,
      sdAttackAcos: null,
      sdDefense: null,
      sdDefenseAcos: null,
      sdRemarketing: null,
      sdRemarketingAcos: null,
      otherAdvertising: null,
    }],
    unresolved: [],
    coverage: {
      currentFbaSkuCount: 1,
      salesSourceRowCount: 1,
      salesResolvedSourceRowCount: 1,
      salesUnresolvedSourceRowCount: 0,
      salesAnonymousUnprovenSourceRowCount: 0,
      salesReportedSkuCount: 1,
      salesNotReportedSkuCount: 0,
      spSourceRowCount: 1,
      spResolvedSourceRowCount: 1,
      spUnresolvedSourceRowCount: 0,
      spAnonymousUnprovenSourceRowCount: 0,
      spReportedSkuCount: 1,
      spNotReportedSkuCount: 0,
      spDirectSourceRowCount: 1,
      spUniqueAsinSourceRowCount: 0,
    },
    summary: {
      tierCounts: { T1: 1, T2: 0, T3: 0, T4: 0 },
      reportedUnitsSold: 10,
      unresolvedUnitsSold: 0,
      sourceUnitsSold: 10,
      reportedSalesAmount: 200,
      unresolvedSalesAmount: 0,
      sourceSalesAmount: 200,
      reportedSpSpend: 35,
      unresolvedSpSpend: 0,
      sourceSpSpend: 35,
      suggestedSpDailyBudget: 300,
    },
    rule: {
      salesTierMethod: "reported-sales-desc-sku-asc-ceil-20-50-80",
      adsAttributionMethod: "exact-sku-or-unique-current-fba-asin",
      missingReportMethod: "null-not-reported-never-zero",
      unprovenSourceMethod: "anonymous-count-only-no-identifiers-or-metrics",
      suggestionIsOverrideable: true,
      presets: {
        T1: { dailyBudget: 300, targetAcos: 0.35 },
        T2: { dailyBudget: 100, targetAcos: 0.3 },
        T3: { dailyBudget: 50, targetAcos: 0.3 },
        T4: { dailyBudget: 50, targetAcos: 0.5 },
      },
      manualFields: [
        "specification",
        "sbSales",
        "sbSalesAcos",
        "sbAttack",
        "sbAttackAcos",
        "sdAttack",
        "sdAttackAcos",
        "sdDefense",
        "sdDefenseAcos",
        "sdRemarketing",
        "sdRemarketingAcos",
        "otherAdvertising",
      ],
    },
    notice: "CSS04 固定唯讀策略資料；建議可覆寫，但不建立、不修改、不啟用 campaign。",
  };
  const css04AdvertisingStrategyJob = {
    schemaVersion: 1,
    jobId: "css04-strategy-job-0001",
    marketplaceId,
    marketplaceCode: "US",
    dateRange: { startDate: "2026-08-01", endDate: "2026-08-07" },
    state: "completed",
    progress: { phase: "building", completed: 4, total: 4 },
    notice: "CSS04 固定唯讀 FBA 廣告策略已完成。",
    snapshot: css04AdvertisingStrategySnapshot,
    errorCode: null,
  };
  const css04ReviewSnapshot = {
    schemaVersion: 2,
    mode: "demo",
    marketplaceId,
    fetchedAt: fixedTime,
    exportId: "css04-review-export-0001",
    rows: [
      {
        sellerSkus: ["CSS04-REVIEW-CHILD"],
        asin: "B04REV0001",
        title: "CSS04 child product with long positive and negative review topics",
        relationshipRole: "child",
        status: "COMPLETE",
        positiveTopics: [{
          topic: "Dogs enthusiastically return for the texture and natural turkey aroma",
          numberOfMentions: 18,
          occurrencePercentage: 42.5,
          starRatingImpact: 4.75,
          reviewSnippets: ["Fixture positive topic snippet"],
        }],
        negativeTopics: [{
          topic: "Package size expectations require clearer comparison information",
          numberOfMentions: 5,
          occurrencePercentage: 11.75,
          starRatingImpact: -1.85,
          reviewSnippets: ["Fixture negative topic snippet"],
        }],
        incompleteReason: null,
        averageProductRating: null,
        totalReviewCount: null,
        fullReviewTextAvailable: false,
      },
      {
        sellerSkus: ["CSS04-REVIEW-STANDALONE"],
        asin: "B04REV0002",
        title: "CSS04 standalone FBA product with deterministic ranking evidence",
        relationshipRole: "standalone",
        status: "COMPLETE",
        positiveTopics: [{
          topic: "Ingredient simplicity is repeatedly appreciated by pet owners",
          numberOfMentions: 12,
          occurrencePercentage: 31.25,
          starRatingImpact: 3.6,
          reviewSnippets: ["Second fixture positive topic"],
        }],
        negativeTopics: [{
          topic: "Some customers request a more compact resealable package",
          numberOfMentions: 3,
          occurrencePercentage: 7.5,
          starRatingImpact: -0.9,
          reviewSnippets: ["Second fixture negative topic"],
        }],
        incompleteReason: null,
        averageProductRating: null,
        totalReviewCount: null,
        fullReviewTextAvailable: false,
      },
    ],
    relationshipIncompleteRows: [],
    topFivePositive: [
      {
        sellerSkus: ["CSS04-REVIEW-CHILD"],
        asin: "B04REV0001",
        title: "CSS04 child product with long positive and negative review topics",
        topic: "Dogs enthusiastically return for the texture and natural turkey aroma",
        numberOfMentions: 18,
        occurrencePercentage: 42.5,
        starRatingImpact: 4.75,
        metricLabel: "NON_PARENT_ASIN_TOPIC_STAR_RATING_IMPACT",
      },
      {
        sellerSkus: ["CSS04-REVIEW-STANDALONE"],
        asin: "B04REV0002",
        title: "CSS04 standalone FBA product with deterministic ranking evidence",
        topic: "Ingredient simplicity is repeatedly appreciated by pet owners",
        numberOfMentions: 12,
        occurrencePercentage: 31.25,
        starRatingImpact: 3.6,
        metricLabel: "NON_PARENT_ASIN_TOPIC_STAR_RATING_IMPACT",
      },
    ],
    bottomFiveNegative: [
      {
        sellerSkus: ["CSS04-REVIEW-CHILD"],
        asin: "B04REV0001",
        title: "CSS04 child product with long positive and negative review topics",
        topic: "Package size expectations require clearer comparison information",
        numberOfMentions: 5,
        occurrencePercentage: 11.75,
        starRatingImpact: -1.85,
        metricLabel: "NON_PARENT_ASIN_TOPIC_STAR_RATING_IMPACT",
      },
      {
        sellerSkus: ["CSS04-REVIEW-STANDALONE"],
        asin: "B04REV0002",
        title: "CSS04 standalone FBA product with deterministic ranking evidence",
        topic: "Some customers request a more compact resealable package",
        numberOfMentions: 3,
        occurrencePercentage: 7.5,
        starRatingImpact: -0.9,
        metricLabel: "NON_PARENT_ASIN_TOPIC_STAR_RATING_IMPACT",
      },
    ],
    summary: {
      sourceFbaListings: 2,
      verifiedNonParentListings: 2,
      uniqueFbaNonParentAsins: 2,
      verifiedChildListings: 1,
      verifiedStandaloneListings: 1,
      excludedParentContainers: 0,
      relationshipIncomplete: 0,
      completed: 2,
      noTopics: 0,
      feedbackIncomplete: 0,
      totalIncomplete: 0,
      incomplete: 0,
      duplicateSkuAsinsCollapsed: 0,
    },
    notice: "CSS04 固定評論主題影響值；負數不是商品負星等。",
  };
  const css04ReviewJob = {
    jobId: "css04-review-job-0001",
    marketplaceId,
    mode: "demo",
    ready: false,
    status: "READING_NON_PARENT_TOPICS",
    progress: { completed: 0, total: 2, percent: 0 },
    message: "CSS04 正在讀取非 parent ASIN 主題。",
    capabilityNotice: "CSS04 固定唯讀評論主題資料。",
  };
  const reportCategories = css04
    ? [
        "FBA",
        "AMAZON_BUSINESS",
        "ANALYTICS",
        "B2B_OPPORTUNITIES",
        "BROWSE_TREE",
        "EASY_SHIP",
        "INVENTORY",
        "INVOICE_DATA",
        "ORDER",
        "PAYMENT",
        "PERFORMANCE",
        "REGULATORY",
        "RETURNS",
        "SETTLEMENT",
        "TAX",
      ]
    : ["FBA"];
  const reportRows = reportCategories.map((category, index) => ({
    reportType: index === 0 ? "GET_AFN_INVENTORY_DATA" : `GET_CSS04_${category}_DATA`,
    label: index === 0 ? "AFN 庫存" : `CSS04 ${category} 固定報表`,
    description: index === 0
      ? "FBA 固定庫存摘要。"
      : `CSS04 ${category} 唯讀視覺分類資料。`,
    categories: [category],
    party: "SELLER",
    fbaScope: category === "EASY_SHIP" ? "OUT_OF_FBA_SCOPE" : "FBA_ONLY",
    lifecycle: "REQUEST",
    output: "TAB_DELIMITED",
    restrictedData: "NONE",
    roles: ["Amazon Fulfillment"],
    marketplaceAvailability: "US FBA sellers",
    prerequisites: [],
    deprecated: false,
    officialSource: "https://developer-docs.amazon.com/sp-api/docs/report-type-values-fba",
    state: category === "EASY_SHIP" ? "OUT_OF_FBA_SCOPE" : "READY_TO_PLAN",
    amazonPublicArtifactAvailable: true,
    appDownloadImplemented: false,
    stateNotice: category === "EASY_SHIP"
      ? "非 FBA 範圍，固定 fixture 只顯示邊界。"
      : "Amazon 有此文件，App 尚未接線。",
  }));
  const reportLibrary = {
    schemaVersion: 1,
    marketplaceId,
    fetchedAt: "2026-08-21T08:00:00.000Z",
    officialCatalog: {
      uniqueReportTypeCount: reportRows.length,
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
    reports: reportRows,
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
        if (
          css04 &&
          request.path === "/api/amazon-ads/status" &&
          request.method === "GET"
        ) {
          return json({
            marketplaceCode: "US",
            configured: true,
            verified: true,
            lwaConfigured: true,
            profileConfigured: true,
            writeEnabled: false,
            coverageAuditAvailable: true,
            coverageAuditNotice: "CSS04 固定唯讀 Ads 覆蓋 fixture 已就緒。",
            testedAt: fixedTime,
            requiredPermission: "Campaign manager Viewer",
            permissionVerified: false,
            notice: "CSS04 固定本機 Ads Profiles／Campaign query 驗證資料。",
          });
        }
        if (
          css04 &&
          request.path === "/api/amazon-ads/strategy" &&
          request.method === "POST"
        ) {
          return json(css04AdvertisingStrategyJob);
        }
        if (
          css04 &&
          request.path === "/api/sp-api/review-audit" &&
          request.method === "POST"
        ) {
          return json(css04ReviewJob, 202);
        }
        if (
          css04 &&
          request.path === "/api/sp-api/review-audit" &&
          request.method === "GET"
        ) {
          return json(css04ReviewSnapshot);
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
          if (css04 && body?.kind === "image") return json(css04ImageJob);
          if (css04 && body?.kind === "agedInventory") {
            return json(css04AgedInventoryJob);
          }
          if (css04 && body?.kind === "advertising") {
            return json(css04AdvertisingJob);
          }
          if (css04 && body?.kind === "content") return json(css04ContentJob);
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
      version: async () => "0.1.32",
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
