async (page) => {
  const controllerHash = await page.evaluate(() => window.location.hash);
  const css02Extra = controllerHash.includes("css02-extra");
  const allPhases = [
    { name: "before", baseUrl: "http://127.0.0.1:4173" },
    { name: "after", baseUrl: "http://127.0.0.1:4174" },
  ];
  const allProfiles = [
    { name: "desktop-standard", width: 1440, height: 1000, font: "standard", reduced: false },
    { name: "desktop-large", width: 1440, height: 1000, font: "large", reduced: false },
    { name: "compact-390-large", width: 390, height: 844, font: "large", reduced: false },
    { name: "compact-320-large", width: 320, height: 568, font: "large", reduced: false },
    { name: "desktop-reduced", width: 1440, height: 1000, font: "standard", reduced: true },
  ];
  const phases = controllerHash.includes("before-only")
    ? allPhases.slice(0, 1)
    : controllerHash.includes("after-only")
      ? allPhases.slice(1)
      : allPhases;
  const profiles = css02Extra
    ? allProfiles.filter(({ name }) =>
      ["desktop-standard", "compact-390-large", "desktop-reduced"].includes(name),
    )
    : controllerHash.includes("single-profile")
      ? allProfiles.slice(0, 1)
      : allProfiles;
  const results = [];
  const externalRequests = [];
  const consoleErrors = [];
  const pageErrors = [];
  const beforeMetrics = {};
  let currentState = "setup";

  const fail = (message) => {
    throw new Error(`Renderer visual baseline rejected: ${message}`);
  };
  const ensure = (condition, message) => {
    if (!condition) fail(message);
  };
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push({ state: currentState, text: message.text() });
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push({ state: currentState, text: error.message });
  });
  await page.context().route("**/*", async (route) => {
    const request = route.request();
    const requestUrl = request.url();
    const isLocalHttp =
      requestUrl.startsWith("http://127.0.0.1:4173/") ||
      requestUrl.startsWith("http://127.0.0.1:4174/");
    if (
      isLocalHttp &&
      /\/favicon\.ico(?:[?#]|$)/u.test(requestUrl)
    ) {
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    const local =
      requestUrl.startsWith("about:") ||
      requestUrl.startsWith("data:") ||
      requestUrl.startsWith("blob:") ||
      isLocalHttp;
    if (local) {
      await route.continue();
      return;
    }
    externalRequests.push({
      state: currentState,
      method: request.method(),
      url: request.url(),
    });
    await route.abort("blockedbyclient");
  });
  await page.clock.setFixedTime(new Date("2026-08-21T12:00:00.000Z"));
  await page.addInitScript({
    path: "scripts/visual-qa/renderer-visual-fixture.js",
  });

  const settle = async () => {
    await page.waitForTimeout(280);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
  };

  const inspectLayout = async ({
    surface,
    scopeSelector,
    dialogSelector = null,
    allowedScrollers = [],
    reduced = false,
    font,
  }) => {
    const metrics = await page.evaluate(
      ({ scopeSelector, dialogSelector, allowedScrollers, reduced, font }) => {
        const root = document.documentElement;
        const scope = document.querySelector(scopeSelector);
        if (!(scope instanceof HTMLElement)) {
          return { missingScope: scopeSelector };
        }
        const visible = (element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            rect.width > 0 &&
            rect.height > 0
          );
        };
        const scrollOwners = [scope, ...scope.querySelectorAll("*")]
          .filter((element) => element instanceof HTMLElement && visible(element))
          .filter((element) => {
            const style = getComputedStyle(element);
            return (
              element.scrollWidth > element.clientWidth + 1 &&
              (style.overflowX === "auto" || style.overflowX === "scroll")
            );
          })
          .map((element) => ({
            tag: element.tagName.toLowerCase(),
            id: element.id,
            classes: Array.from(element.classList),
            allowed: allowedScrollers.some((selector) => element.matches(selector)),
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
          }));
        let dialog = null;
        if (dialogSelector) {
          const element = document.querySelector(dialogSelector);
          if (element instanceof HTMLElement) {
            const rect = element.getBoundingClientRect();
            const close = element.querySelector(".drawer-header > button");
            const closeRect =
              close instanceof HTMLElement ? close.getBoundingClientRect() : null;
            dialog = {
              ariaModal: element.getAttribute("aria-modal"),
              left: rect.left,
              top: rect.top,
              rightGap: window.innerWidth - rect.right,
              bottomGap: window.innerHeight - rect.bottom,
              close: closeRect
                ? { width: closeRect.width, height: closeRect.height }
                : null,
            };
          }
        }
        const skater = document.querySelector(".sales-skater");
        const skaterStyle = skater ? getComputedStyle(skater) : null;
        return {
          missingScope: null,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          page: {
            clientWidth: root.clientWidth,
            scrollWidth: root.scrollWidth,
          },
          dialog,
          scrollOwners,
          font: root.dataset.uiFontSize ?? null,
          reduced: {
            requested: reduced,
            matches: matchMedia("(prefers-reduced-motion: reduce)").matches,
            rootScrollBehavior: getComputedStyle(root).scrollBehavior,
            skaterTransitionDuration: skaterStyle?.transitionDuration ?? null,
          },
        };
      },
      { scopeSelector, dialogSelector, allowedScrollers, reduced, font },
    );
    ensure(!metrics.missingScope, `${surface}: missing ${metrics.missingScope}`);
    ensure(metrics.font === font, `${surface}: expected ${font} font, received ${metrics.font}`);
    if (dialogSelector) {
      ensure(metrics.dialog, `${surface}: dialog geometry unavailable`);
      ensure(metrics.dialog.ariaModal === "true", `${surface}: dialog is not aria-modal`);
      for (const [edge, value] of Object.entries({
        left: metrics.dialog.left,
        top: metrics.dialog.top,
        right: metrics.dialog.rightGap,
        bottom: metrics.dialog.bottomGap,
      })) {
        ensure(value >= 7.5, `${surface}: dialog ${edge} gutter is ${value}`);
      }
      ensure(metrics.dialog.close, `${surface}: close target is missing`);
      ensure(
        Math.abs(metrics.dialog.close.width - 36) <= 0.25 &&
          Math.abs(metrics.dialog.close.height - 36) <= 0.25,
        `${surface}: close target is ${metrics.dialog.close.width}×${metrics.dialog.close.height}`,
      );
    }
    ensure(
      metrics.reduced.matches === reduced,
      `${surface}: reduced-motion media mismatch`,
    );
    if (reduced) {
      ensure(
        metrics.reduced.rootScrollBehavior === "auto",
        `${surface}: reduced-motion root scroll is ${metrics.reduced.rootScrollBehavior}`,
      );
      if (metrics.reduced.skaterTransitionDuration !== null) {
        ensure(
          metrics.reduced.skaterTransitionDuration === "0s",
          `${surface}: sales skater transition is ${metrics.reduced.skaterTransitionDuration}`,
        );
      }
    }
    return metrics;
  };

  const capture = async ({
    phase,
    profile,
    surface,
    scopeSelector,
    dialogSelector = null,
    allowedScrollers = [],
  }) => {
    currentState = `${phase.name}/${profile.name}/${surface}`;
    await settle();
    const metrics = await inspectLayout({
      surface: currentState,
      scopeSelector,
      dialogSelector,
      allowedScrollers,
      reduced: profile.reduced,
      font: profile.font,
    });
    const comparisonKey = `${profile.name}/${surface}`;
    const comparisonMetrics = {
      page: metrics.page,
      dialog: metrics.dialog,
      scrollOwners: metrics.scrollOwners,
    };
    if (phase.name === "before") {
      beforeMetrics[comparisonKey] = comparisonMetrics;
    } else {
      ensure(
        JSON.stringify(comparisonMetrics) ===
          JSON.stringify(beforeMetrics[comparisonKey]),
        `${comparisonKey}: layout metrics changed from ${JSON.stringify(beforeMetrics[comparisonKey])} to ${JSON.stringify(comparisonMetrics)}`,
      );
    }
    const evidenceDirectory = css02Extra ? "css02-extra" : "css01";
    const path = `output/playwright/${evidenceDirectory}/${phase.name}/${profile.name}/${surface}.png`;
    await page.screenshot({
      path,
      fullPage: false,
      animations: "disabled",
      caret: "hide",
      scale: "css",
    });
    results.push({ phase: phase.name, profile: profile.name, surface, path, metrics });
  };

  const openMenuItem = async (menuName, itemName) => {
    await page.getByRole("button", { name: menuName, exact: true }).click();
    const menu = page.getByRole("menu", { name: menuName });
    await menu.getByRole("menuitem", { name: itemName }).click();
  };

  const auditRequests = async (phase, profile) => {
    const requestAudit = await page.evaluate(() => ({
      unexpected: window.__rendererVisualUnexpected ?? [],
      dangerous: (window.__rendererVisualRequests ?? []).filter((request) =>
        ["PUT", "PATCH", "DELETE"].includes(request.method),
      ),
    }));
    ensure(
      requestAudit.unexpected.length === 0,
      `${phase.name}/${profile.name}: unhandled fixture routes ${JSON.stringify(requestAudit.unexpected)}`,
    );
    ensure(
      requestAudit.dangerous.length === 0,
      `${phase.name}/${profile.name}: write requests ${JSON.stringify(requestAudit.dangerous)}`,
    );
  };

  for (const phase of phases) {
    for (const profile of profiles) {
      await page.setViewportSize({ width: profile.width, height: profile.height });
      await page.emulateMedia({
        reducedMotion: profile.reduced ? "reduce" : "no-preference",
      });

      if (css02Extra) {
        currentState = `${phase.name}/${profile.name}/css02-load`;
        await page.goto(`${phase.baseUrl}/?font=${profile.font}`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await page.locator(".commerce-os").waitFor();

        await openMenuItem("產品區", /文案/u);
        const contentDialog = page.getByRole("dialog", { name: "商品內容" });
        await contentDialog.waitFor();
        await contentDialog.getByRole("tab", { name: "全站文案健檢" }).click();
        await contentDialog
          .getByRole("region", { name: "全站 FBA 文案健檢" })
          .waitFor();
        await capture({
          phase,
          profile,
          surface: "content",
          scopeSelector: ".sku-ops-drawer",
          dialogSelector: ".sku-ops-drawer",
        });
        await contentDialog
          .getByRole("button", { name: "關閉商品內容工具" })
          .click();

        await openMenuItem("價格區", /訂閱價格健檢/u);
        const subscriptionDialog = page.getByRole("dialog", {
          name: "全站訂閱價格健檢",
        });
        await subscriptionDialog.waitFor();
        await capture({
          phase,
          profile,
          surface: "subscription",
          scopeSelector: ".subscription-audit-drawer",
          dialogSelector: ".subscription-audit-drawer",
        });
        await subscriptionDialog
          .getByRole("button", { name: "關閉全站訂閱省健檢" })
          .click();

        await openMenuItem("營運區", /^帳務/u);
        const accountingDialog = page.getByRole("dialog", { name: "帳務" });
        await accountingDialog.waitFor();
        await capture({
          phase,
          profile,
          surface: "accounting",
          scopeSelector: ".accounting-drawer",
          dialogSelector: ".accounting-drawer",
        });
        await accountingDialog
          .getByRole("button", { name: "關閉帳務" })
          .click();

        await auditRequests(phase, profile);
        continue;
      }

      currentState = `${phase.name}/${profile.name}/webgate-load`;
      await page.goto(
        `${phase.baseUrl}/?gate=1&font=${profile.font}`,
        { waitUntil: "domcontentloaded", timeout: 30_000 },
      );
      await page.locator("main.web-gate").waitFor();
      await page
        .locator('.web-gate-primary[href="amz-api://launch"]')
        .waitFor();
      await capture({
        phase,
        profile,
        surface: "webgate",
        scopeSelector: "main.web-gate",
      });

      currentState = `${phase.name}/${profile.name}/home-load`;
      await page.goto(
        `${phase.baseUrl}/?font=${profile.font}`,
        { waitUntil: "domcontentloaded", timeout: 30_000 },
      );
      await page.locator(".commerce-os").waitFor();
      await page.locator('section.sales-trend[aria-busy="false"]').waitFor();
      await page.locator(".sales-trend-line.is-current").waitFor();
      await page.locator(".sales-trend-line.is-comparison").waitFor();
      await page.locator('section.brand-sales-card[aria-busy="false"]').waitFor();
      await page.waitForFunction(
        () => document.querySelectorAll(".brand-sales-pie-slice").length === 6,
      );
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await capture({
        phase,
        profile,
        surface: "home",
        scopeSelector: "main#workspace-top",
        allowedScrollers: [".sales-trend-plot-scroll"],
      });

      await page.locator("section.operations-pulse").scrollIntoViewIfNeeded();
      await capture({
        phase,
        profile,
        surface: "sales",
        scopeSelector: "section.operations-pulse",
        allowedScrollers: [".sales-trend-plot-scroll"],
      });

      await page.locator("section.brand-sales-card").scrollIntoViewIfNeeded();
      await capture({
        phase,
        profile,
        surface: "brand",
        scopeSelector: "section.brand-sales-card",
      });

      await page.getByRole("button", { name: "開啟系統資訊" }).click();
      const systemDialog = page.getByRole("dialog", { name: "進階與系統資訊" });
      await systemDialog.waitFor();
      await systemDialog.getByText("目前本機 App 0.1.31").waitFor();
      await capture({
        phase,
        profile,
        surface: "system-info",
        scopeSelector: ".system-health-drawer",
        dialogSelector: ".system-health-drawer",
      });
      await systemDialog
        .getByRole("button", { name: "關閉進階與系統資訊" })
        .click();

      await openMenuItem("產品區", /變體/u);
      const variationDialog = page.getByRole("dialog", { name: "變體規劃與改掛" });
      await variationDialog.waitFor();
      await variationDialog.getByLabel("來源 Seller SKU").fill("SOURCE-4OZ");
      await variationDialog.locator('[data-variation-lookup="source"]').click();
      await variationDialog
        .locator(".variation-family-summary", { hasText: "SOURCE-PARENT" })
        .waitFor();
      await variationDialog.getByLabel("目標 Parent SKU").fill("TARGET-PARENT");
      await variationDialog.locator('[data-variation-lookup="target"]').click();
      await variationDialog
        .locator(".variation-target-details", { hasText: "TARGET-PARENT" })
        .waitFor();
      await variationDialog
        .locator(".variation-child-card", { hasText: "SOURCE-4OZ" })
        .getByRole("button", { name: "放入解除變體存放區" })
        .click();
      await variationDialog
        .locator(".variation-staged-card", { hasText: "SOURCE-4OZ" })
        .waitFor();
      ensure(
        await variationDialog
          .getByRole("button", { name: "確認解除變體" })
          .isDisabled(),
        `${phase.name}/${profile.name}/variation: demo write action became enabled`,
      );
      await capture({
        phase,
        profile,
        surface: "variation",
        scopeSelector: ".variation-planner-drawer",
        dialogSelector: ".variation-planner-drawer",
      });
      await variationDialog.getByRole("button", { name: "關閉變體規劃" }).click();

      await openMenuItem("價格區", /B2B 價格健檢/u);
      const b2bDialog = page.getByRole("dialog", { name: "全站 B2B 價格健檢" });
      await b2bDialog.waitFor();
      await b2bDialog
        .getByRole("button", { name: "開始全站 B2B 價格健檢" })
        .click();
      await b2bDialog
        .getByRole("group", { name: "B2B 價格健檢摘要與篩選" })
        .waitFor();
      await b2bDialog
        .getByRole("listitem")
        .filter({ hasText: "B2B-DEMO-01" })
        .waitFor();
      await capture({
        phase,
        profile,
        surface: "b2b",
        scopeSelector: ".business-pricing-audit-drawer",
        dialogSelector: ".business-pricing-audit-drawer",
      });
      await b2bDialog
        .getByRole("button", { name: "關閉全站 B2B 價格健檢" })
        .click();

      await openMenuItem("報表區", /^Amazon API 文件庫/u);
      const reportsDialog = page.getByRole("dialog", { name: "報表區" });
      await reportsDialog.waitFor();
      await reportsDialog
        .getByRole("heading", { name: "Amazon 有的報表類型" })
        .waitFor();
      await reportsDialog.locator(".report-library-report").waitFor();
      await capture({
        phase,
        profile,
        surface: "reports",
        scopeSelector: ".report-library-drawer",
        dialogSelector: ".report-library-drawer",
        allowedScrollers: [".report-library-toolbar nav"],
      });
      await reportsDialog
        .getByRole("button", { name: "關閉 Amazon API 文件庫" })
        .click();

      await openMenuItem("報表區", /^入庫貨件/u);
      const inboundDialog = page.getByRole("dialog", {
        name: "FBA 入庫貨件追蹤",
      });
      await inboundDialog.waitFor();
      await inboundDialog.getByLabel("開始日期").fill("2026-05-24");
      await inboundDialog.getByLabel("結束日期").fill("2026-08-21");
      await inboundDialog
        .getByRole("button", { name: "同步 US 貨件與全部商品" })
        .click();
      await inboundDialog.locator(".inbound-summary").waitFor();
      const shipment = inboundDialog
        .locator("details.inbound-shipment")
        .filter({ hasText: "FBA15VISUAL001" });
      await shipment.waitFor();
      await shipment.locator("summary").click();
      await shipment.locator(".inbound-item-table-scroll").waitFor();
      await capture({
        phase,
        profile,
        surface: "inbound",
        scopeSelector: ".inbound-shipments-drawer",
        dialogSelector: ".inbound-shipments-drawer",
        allowedScrollers: [".inbound-item-table-scroll"],
      });

      await auditRequests(phase, profile);
    }
  }

  const surfaces = css02Extra
    ? ["content", "subscription", "accounting"]
    : [
      "webgate",
      "home",
      "sales",
      "brand",
      "system-info",
      "variation",
      "b2b",
      "reports",
      "inbound",
    ];
  const expectedCaptures = phases.length * profiles.length * surfaces.length;
  ensure(
    results.length === expectedCaptures,
    `expected ${expectedCaptures} screenshots, captured ${results.length}`,
  );
  ensure(
    externalRequests.length === 0,
    `external requests ${JSON.stringify(externalRequests)}`,
  );
  ensure(consoleErrors.length === 0, `console errors ${JSON.stringify(consoleErrors)}`);
  ensure(pageErrors.length === 0, `page errors ${JSON.stringify(pageErrors)}`);
  return {
    captures: results.length,
    phases: phases.map((phase) => phase.name),
    profiles: profiles.map((profile) => profile.name),
    surfaces,
    externalRequestCount: externalRequests.length,
    consoleErrorCount: consoleErrors.length,
    pageErrorCount: pageErrors.length,
  };
}
