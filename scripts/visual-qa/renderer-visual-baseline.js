async (page) => {
  const controllerHash = await page.evaluate(() => window.location.hash);
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
  const visualScenarios = [
    {
      key: "css03",
      marker: "css03-extra",
      evidenceDirectory: "css03-extra",
      profileNames: [
        "desktop-standard",
        "compact-390-large",
        "compact-320-large",
        "desktop-reduced",
      ],
      surfaces: [
        "sticky-nav",
        "chart-scrolled",
        "variation-long",
        "variation-focus",
        "bridge-focus",
        "reduced-loading",
      ],
      expectedCaptures: ({ phases, profiles }) => phases.length * profiles.reduce(
        (count, profile) => count + 5 + (profile.reduced ? 1 : 0),
        0,
      ),
    },
    {
      key: "css02",
      marker: "css02-extra",
      evidenceDirectory: "css02-extra",
      profileNames: ["desktop-standard", "compact-390-large", "desktop-reduced"],
      surfaces: ["content", "subscription", "accounting"],
      expectedCaptures: ({ phases, profiles, surfaces }) =>
        phases.length * profiles.length * surfaces.length,
    },
    {
      key: "css01",
      marker: null,
      evidenceDirectory: "css01",
      profileNames: controllerHash.includes("single-profile")
        ? ["desktop-standard"]
        : null,
      surfaces: [
        "webgate",
        "home",
        "sales",
        "brand",
        "system-info",
        "variation",
        "b2b",
        "reports",
        "inbound",
      ],
      expectedCaptures: ({ phases, profiles, surfaces }) =>
        phases.length * profiles.length * surfaces.length,
    },
  ];
  const visualScenario = visualScenarios.find(
    ({ marker }) => marker === null || controllerHash.includes(marker),
  );
  const phases = controllerHash.includes("before-only")
    ? allPhases.slice(0, 1)
    : controllerHash.includes("after-only")
      ? allPhases.slice(1)
      : allPhases;
  const profiles = visualScenario.profileNames
    ? allProfiles.filter(({ name }) => visualScenario.profileNames.includes(name))
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
    closeSelector = ".drawer-header > button",
    allowedScrollers = [],
    requiredScrollers = [],
    strictScrollers = false,
    requireScopeContainment = false,
    expectedPage = null,
    stickySelector = null,
    focusSelector = null,
    verticalScrollerSelector = null,
    verticalLastItemSelector = null,
    motionSelector = null,
    reduced = false,
    font,
  }) => {
    const metrics = await page.evaluate(
      ({
        scopeSelector,
        dialogSelector,
        closeSelector,
        allowedScrollers,
        requiredScrollers,
        stickySelector,
        focusSelector,
        verticalScrollerSelector,
        verticalLastItemSelector,
        motionSelector,
        reduced,
      }) => {
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
            scrollLeft: element.scrollLeft,
          }));
        const requiredScrollerMetrics = requiredScrollers.map((selector) => {
          const element = document.querySelector(selector);
          if (!(element instanceof HTMLElement)) return { selector, missing: true };
          const style = getComputedStyle(element);
          return {
            selector,
            missing: false,
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            scrollLeft: element.scrollLeft,
            overflowX: style.overflowX,
          };
        });
        let dialog = null;
        if (dialogSelector) {
          const element = document.querySelector(dialogSelector);
          if (element instanceof HTMLElement) {
            const rect = element.getBoundingClientRect();
            const close = element.querySelector(closeSelector);
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
        let sticky = null;
        if (stickySelector) {
          const element = document.querySelector(stickySelector);
          if (element instanceof HTMLElement) {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            sticky = {
              position: style.position,
              top: rect.top,
              bottom: rect.bottom,
              visible: visible(element),
              scrollY: window.scrollY,
            };
          }
        }
        let focus = null;
        if (focusSelector) {
          const active = document.activeElement;
          if (active instanceof HTMLElement || active instanceof SVGElement) {
            const style = getComputedStyle(active);
            focus = {
              matches: active.matches(focusSelector),
              outlineStyle: style.outlineStyle,
              outlineWidth: style.outlineWidth,
              boxShadow: style.boxShadow,
            };
          }
        }
        let verticalScroller = null;
        if (verticalScrollerSelector) {
          const element = document.querySelector(verticalScrollerSelector);
          const lastItem = verticalLastItemSelector
            ? document.querySelector(verticalLastItemSelector)
            : null;
          if (element instanceof HTMLElement) {
            const elementRect = element.getBoundingClientRect();
            const lastRect = lastItem instanceof HTMLElement
              ? lastItem.getBoundingClientRect()
              : null;
            verticalScroller = {
              clientHeight: element.clientHeight,
              scrollHeight: element.scrollHeight,
              scrollTop: element.scrollTop,
              horizontalOverflow: element.scrollWidth - element.clientWidth,
              lastItemVisible: lastRect
                ? lastRect.bottom <= elementRect.bottom + 1 &&
                  lastRect.top >= elementRect.top - 1
                : null,
            };
          }
        }
        let motion = null;
        if (motionSelector) {
          const element = document.querySelector(motionSelector);
          if (element instanceof HTMLElement) {
            const style = getComputedStyle(element);
            motion = {
              animationName: style.animationName,
              animationDuration: style.animationDuration,
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
          requiredScrollers: requiredScrollerMetrics,
          scopeHorizontalOverflow: scope.scrollWidth - scope.clientWidth,
          sticky,
          focus,
          verticalScroller,
          motion,
          font: root.dataset.uiFontSize ?? null,
          reduced: {
            requested: reduced,
            matches: matchMedia("(prefers-reduced-motion: reduce)").matches,
            rootScrollBehavior: getComputedStyle(root).scrollBehavior,
            skaterTransitionDuration: skaterStyle?.transitionDuration ?? null,
          },
        };
      },
      {
        scopeSelector,
        dialogSelector,
        closeSelector,
        allowedScrollers,
        requiredScrollers,
        stickySelector,
        focusSelector,
        verticalScrollerSelector,
        verticalLastItemSelector,
        motionSelector,
        reduced,
      },
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
    if (expectedPage) {
      ensure(
        metrics.page.clientWidth === expectedPage.clientWidth &&
          metrics.page.scrollWidth === expectedPage.scrollWidth,
        `${surface}: page geometry is ${metrics.page.clientWidth}/${metrics.page.scrollWidth}, expected ${expectedPage.clientWidth}/${expectedPage.scrollWidth}`,
      );
    }
    if (strictScrollers) {
      const unexpectedScrollers = metrics.scrollOwners.filter(({ allowed }) => !allowed);
      ensure(
        unexpectedScrollers.length === 0,
        `${surface}: unexpected horizontal scrollers ${JSON.stringify(unexpectedScrollers)}`,
      );
      if (requireScopeContainment) {
        ensure(
          metrics.scopeHorizontalOverflow <= 1,
          `${surface}: scope horizontal overflow is ${metrics.scopeHorizontalOverflow}`,
        );
      }
    }
    for (const requiredScroller of metrics.requiredScrollers) {
      ensure(!requiredScroller.missing, `${surface}: missing required scroller ${requiredScroller.selector}`);
      ensure(
        requiredScroller.scrollWidth > requiredScroller.clientWidth + 1,
        `${surface}: ${requiredScroller.selector} does not overflow internally`,
      );
      ensure(
        requiredScroller.overflowX === "auto" || requiredScroller.overflowX === "scroll",
        `${surface}: ${requiredScroller.selector} overflow-x is ${requiredScroller.overflowX}`,
      );
    }
    if (stickySelector) {
      ensure(metrics.sticky, `${surface}: sticky geometry unavailable`);
      ensure(metrics.sticky.position === "sticky", `${surface}: sticky position is ${metrics.sticky.position}`);
      ensure(metrics.sticky.scrollY > 0, `${surface}: page was not scrolled`);
      ensure(
        Math.abs(metrics.sticky.top) <= 0.5 && metrics.sticky.bottom > 0 && metrics.sticky.visible,
        `${surface}: sticky header is not pinned and visible ${JSON.stringify(metrics.sticky)}`,
      );
    }
    if (focusSelector) {
      ensure(metrics.focus?.matches, `${surface}: keyboard focus is not on ${focusSelector}`);
      const outlineVisible =
        metrics.focus.outlineStyle !== "none" && parseFloat(metrics.focus.outlineWidth) > 0;
      const shadowVisible = metrics.focus.boxShadow !== "none";
      ensure(
        outlineVisible || shadowVisible,
        `${surface}: ${focusSelector} has no visible keyboard focus indicator`,
      );
    }
    if (verticalScrollerSelector) {
      ensure(metrics.verticalScroller, `${surface}: vertical scroller is unavailable`);
      ensure(
        metrics.verticalScroller.scrollHeight > metrics.verticalScroller.clientHeight + 1,
        `${surface}: ${verticalScrollerSelector} does not overflow vertically`,
      );
      ensure(
        Math.abs(
          metrics.verticalScroller.scrollTop -
            (metrics.verticalScroller.scrollHeight - metrics.verticalScroller.clientHeight),
        ) <= 1,
        `${surface}: ${verticalScrollerSelector} did not reach the end`,
      );
      ensure(
        metrics.verticalScroller.horizontalOverflow <= 1,
        `${surface}: ${verticalScrollerSelector} horizontal overflow is ${metrics.verticalScroller.horizontalOverflow}`,
      );
      ensure(
        metrics.verticalScroller.lastItemVisible,
        `${surface}: final Variation child is not reachable`,
      );
    }
    if (motionSelector) {
      ensure(metrics.motion, `${surface}: motion target ${motionSelector} is missing`);
      ensure(
        metrics.motion.animationName === "none" ||
          metrics.motion.animationDuration.split(",").every((value) => parseFloat(value) === 0),
        `${surface}: reduced-motion animation remains ${JSON.stringify(metrics.motion)}`,
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
    closeSelector = ".drawer-header > button",
    allowedScrollers = [],
    requiredScrollers = [],
    strictScrollers = false,
    requireScopeContainment = false,
    expectedPage = null,
    stickySelector = null,
    focusSelector = null,
    verticalScrollerSelector = null,
    verticalLastItemSelector = null,
    motionSelector = null,
  }) => {
    currentState = `${phase.name}/${profile.name}/${surface}`;
    await settle();
    const metrics = await inspectLayout({
      surface: currentState,
      scopeSelector,
      dialogSelector,
      closeSelector,
      allowedScrollers,
      requiredScrollers,
      strictScrollers,
      requireScopeContainment,
      expectedPage,
      stickySelector,
      focusSelector,
      verticalScrollerSelector,
      verticalLastItemSelector,
      motionSelector,
      reduced: profile.reduced,
      font: profile.font,
    });
    const comparisonKey = `${profile.name}/${surface}`;
    const comparisonMetrics = {
      page: metrics.page,
      dialog: metrics.dialog,
      scrollOwners: metrics.scrollOwners,
      requiredScrollers: metrics.requiredScrollers,
      scopeHorizontalOverflow: metrics.scopeHorizontalOverflow,
      sticky: metrics.sticky,
      focus: metrics.focus,
      verticalScroller: metrics.verticalScroller,
      motion: metrics.motion,
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
    const path = `output/playwright/${visualScenario.evidenceDirectory}/${phase.name}/${profile.name}/${surface}.png`;
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

  const focusWithKeyboard = async (selector) => {
    const target = page.locator(selector).first();
    await target.waitFor();
    await target.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    ensure(
      await target.evaluate((element) => document.activeElement === element),
      `${currentState}: Tab did not return focus to ${selector}`,
    );
  };

  const exerciseHorizontalScroller = async (selector, shouldOverflow) => {
    const geometry = await page.evaluate(async ({ selector }) => {
      const root = document.documentElement;
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) return { missing: true };
      const pageBefore = { clientWidth: root.clientWidth, scrollWidth: root.scrollWidth };
      element.scrollLeft = 0;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const start = element.scrollLeft;
      const maximum = element.scrollWidth - element.clientWidth;
      element.scrollLeft = maximum;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return {
        missing: false,
        start,
        end: element.scrollLeft,
        maximum,
        pageBefore,
        pageAfter: { clientWidth: root.clientWidth, scrollWidth: root.scrollWidth },
      };
    }, { selector });
    ensure(!geometry.missing, `${currentState}: missing ${selector}`);
    ensure(
      JSON.stringify(geometry.pageBefore) === JSON.stringify(geometry.pageAfter),
      `${currentState}: page width changed while scrolling ${selector}`,
    );
    if (shouldOverflow) {
      ensure(geometry.maximum > 1, `${currentState}: ${selector} has no horizontal range`);
      ensure(geometry.start === 0, `${currentState}: ${selector} did not start at zero`);
      ensure(
        geometry.end > 1 && Math.abs(geometry.end - geometry.maximum) <= 1,
        `${currentState}: ${selector} did not reach its horizontal end ${JSON.stringify(geometry)}`,
      );
    } else {
      ensure(
        geometry.maximum <= 1 && geometry.end <= 1,
        `${currentState}: ${selector} unexpectedly scrolls ${JSON.stringify(geometry)}`,
      );
    }
  };

  const exerciseVerticalScroller = async (selector) => {
    const geometry = await page.evaluate(async ({ selector }) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) return { missing: true };
      element.scrollTop = 0;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const start = element.scrollTop;
      const maximum = element.scrollHeight - element.clientHeight;
      element.scrollTop = maximum;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return { missing: false, start, end: element.scrollTop, maximum };
    }, { selector });
    ensure(!geometry.missing, `${currentState}: missing ${selector}`);
    ensure(geometry.maximum > 1, `${currentState}: ${selector} has no vertical range`);
    ensure(geometry.start === 0, `${currentState}: ${selector} did not start at zero`);
    ensure(
      geometry.end > 1 && Math.abs(geometry.end - geometry.maximum) <= 1,
      `${currentState}: ${selector} did not reach its vertical end ${JSON.stringify(geometry)}`,
    );
  };

  const expectedPageFor = (profile) => profile.name === "compact-320-large"
    ? { clientWidth: 320, scrollWidth: 352 }
    : { clientWidth: profile.width, scrollWidth: profile.width };

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

      switch (visualScenario.key) {
        case "css02": {
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
          break;
        }
        case "css03": {
          const compact = profile.width <= 390;
          const compact320 = profile.name === "compact-320-large";
          const expectedPage = expectedPageFor(profile);
          currentState = `${phase.name}/${profile.name}/css03-load`;
          await page.goto(`${phase.baseUrl}/?font=${profile.font}&css03=1`, {
            waitUntil: "domcontentloaded",
            timeout: 30_000,
          });
          await page.locator(".commerce-os").waitFor();
          await page.locator('section.sales-trend[aria-busy="false"]').waitFor();
          await page.locator(".sales-trend-line.is-current").waitFor();

          await page.evaluate(() => {
            const maximum = document.documentElement.scrollHeight - window.innerHeight;
            window.scrollTo({ top: Math.min(640, maximum), behavior: "instant" });
          });
          await page.waitForFunction(() => window.scrollY > 0);
          currentState = `${phase.name}/${profile.name}/sticky-nav`;
          await focusWithKeyboard(".workspace-primary-menu-trigger");
          await capture({
            phase,
            profile,
            surface: "sticky-nav",
            scopeSelector: ".workspace-header",
            expectedPage,
            stickySelector: ".workspace-header",
            focusSelector: ".workspace-primary-menu-trigger",
          });

          await page.locator("section.sales-trend").scrollIntoViewIfNeeded();
          currentState = `${phase.name}/${profile.name}/chart-scrolled`;
          await focusWithKeyboard(".sales-trend svg");
          await exerciseHorizontalScroller(".sales-trend-plot-scroll", compact);
          await capture({
            phase,
            profile,
            surface: "chart-scrolled",
            scopeSelector: "section.sales-trend",
            allowedScrollers: [".sales-trend-plot-scroll"],
            requiredScrollers: compact ? [".sales-trend-plot-scroll"] : [],
            strictScrollers: true,
            expectedPage,
            focusSelector: ".sales-trend svg",
          });

          await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
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

          currentState = `${phase.name}/${profile.name}/variation-long`;
          await exerciseVerticalScroller(".variation-child-list");
          await capture({
            phase,
            profile,
            surface: "variation-long",
            scopeSelector: ".variation-planner-drawer",
            dialogSelector: ".variation-planner-drawer",
            strictScrollers: true,
            requireScopeContainment: true,
            expectedPage,
            verticalScrollerSelector: ".variation-child-list",
            verticalLastItemSelector: ".variation-child-list .variation-child-card:last-child",
          });

          currentState = `${phase.name}/${profile.name}/variation-focus`;
          await focusWithKeyboard(".variation-planner-drawer .drawer-header > button");
          await page.evaluate(() => {
            window.scrollTo({ top: 0, behavior: "instant" });
            const drawer = document.querySelector(".variation-planner-drawer");
            if (drawer instanceof HTMLElement) drawer.scrollTop = 0;
          });
          await capture({
            phase,
            profile,
            surface: "variation-focus",
            scopeSelector: ".variation-planner-drawer",
            dialogSelector: ".variation-planner-drawer",
            strictScrollers: true,
            requireScopeContainment: true,
            expectedPage,
            focusSelector: ".variation-planner-drawer .drawer-header > button",
          });
          await page.keyboard.press("Escape");
          await variationDialog.waitFor({ state: "detached" });

          await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
          const connectionButton = page.getByRole("button", {
            name: /開啟本機安全連線設定/u,
          });
          await connectionButton.focus();
          await page.keyboard.press("Enter");
          const bridgeDialog = page.getByRole("dialog", { name: "Notebook 安全連線" });
          await bridgeDialog.waitFor();
          currentState = `${phase.name}/${profile.name}/bridge-focus`;
          await focusWithKeyboard(".connection-panel > header > button");
          await page.evaluate(() => {
            window.scrollTo({ top: 0, behavior: "instant" });
            const panel = document.querySelector(".connection-panel");
            if (panel instanceof HTMLElement) {
              panel.scrollTop = 0;
              panel.scrollLeft = 0;
            }
          });
          await capture({
            phase,
            profile,
            surface: "bridge-focus",
            scopeSelector: ".connection-panel",
            dialogSelector: ".connection-panel",
            closeSelector: ".connection-panel > header > button",
            allowedScrollers: compact320 ? [".connection-panel"] : [],
            requiredScrollers: compact320 ? [".connection-panel"] : [],
            strictScrollers: true,
            requireScopeContainment: !compact320,
            expectedPage,
            focusSelector: ".connection-panel > header > button",
          });
          await page.keyboard.press("Escape");
          await bridgeDialog.waitFor({ state: "detached" });
          await auditRequests(phase, profile);

          if (profile.reduced) {
            currentState = `${phase.name}/${profile.name}/reduced-loading-load`;
            await page.goto(
              `${phase.baseUrl}/?font=${profile.font}&css03=1&sales-loading=1`,
              { waitUntil: "domcontentloaded", timeout: 30_000 },
            );
            await page.locator(".commerce-os").waitFor();
            await page
              .getByRole("group", { name: "銷售趨勢日期範圍" })
              .getByRole("button", { name: "30 天", exact: true })
              .click();
            await page.locator(".sales-trend-loading span").waitFor();
            await capture({
              phase,
              profile,
              surface: "reduced-loading",
              scopeSelector: "section.sales-trend",
              strictScrollers: true,
              expectedPage,
              motionSelector: ".sales-trend-loading span",
            });
            await auditRequests(phase, profile);
          }
          break;
        }
        case "css01": {
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
          break;
        }
        default: {
          fail(`unknown visual scenario ${visualScenario.key}`);
        }
      }
    }
  }

  const surfaces = visualScenario.surfaces;
  const expectedCaptures = visualScenario.expectedCaptures({
    phases,
    profiles,
    surfaces,
  });
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
