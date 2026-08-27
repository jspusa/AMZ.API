async (page) => {
  const phases = [
    { name: "before", baseUrl: "http://127.0.0.1:4173" },
    { name: "after", baseUrl: "http://127.0.0.1:4174" },
  ];
  const profiles = [
    { name: "desktop-standard", width: 1440, height: 1000, font: "standard", reduced: false },
    { name: "compact-390-large", width: 390, height: 844, font: "large", reduced: false },
    { name: "desktop-reduced", width: 1440, height: 1000, font: "standard", reduced: true },
  ];
  const beforeMetrics = {};
  const captures = [];
  const externalRequests = [];
  const consoleErrors = [];
  const pageErrors = [];
  let state = "setup";

  const fail = (message) => {
    throw new Error(`CSS02 visual comparison rejected: ${message}`);
  };
  const ensure = (condition, message) => {
    if (!condition) fail(message);
  };
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push({ state, text: message.text() });
  });
  page.on("pageerror", (error) => pageErrors.push({ state, text: error.message }));
  await page.context().route("**/*", async (route) => {
    const requestUrl = route.request().url();
    const local =
      requestUrl.startsWith("about:") ||
      requestUrl.startsWith("data:") ||
      requestUrl.startsWith("blob:") ||
      requestUrl.startsWith("http://127.0.0.1:4173/") ||
      requestUrl.startsWith("http://127.0.0.1:4174/");
    if (local && /\/favicon\.ico(?:[?#]|$)/u.test(requestUrl)) {
      await route.fulfill({ status: 204, body: "" });
    } else if (local) {
      await route.continue();
    } else {
      externalRequests.push({
        state,
        method: route.request().method(),
        url: requestUrl,
      });
      await route.abort("blockedbyclient");
    }
  });
  await page.clock.setFixedTime(new Date("2026-08-21T12:00:00.000Z"));
  await page.addInitScript({ path: "scripts/visual-qa/css01-bridge-fixture.js" });

  const settle = async () => {
    await page.waitForTimeout(280);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
  };
  const inspect = async (selector, reduced, font) => page.evaluate(
    ({ selector, reduced, font }) => {
      const root = document.documentElement;
      const dialog = document.querySelector(selector);
      if (!(dialog instanceof HTMLElement)) return { missing: selector };
      const rect = dialog.getBoundingClientRect();
      const close = dialog.querySelector(".drawer-header > button");
      const closeRect = close instanceof HTMLElement ? close.getBoundingClientRect() : null;
      return {
        missing: null,
        font: root.dataset.uiFontSize ?? null,
        page: { clientWidth: root.clientWidth, scrollWidth: root.scrollWidth },
        dialog: {
          ariaModal: dialog.getAttribute("aria-modal"),
          left: rect.left,
          top: rect.top,
          right: window.innerWidth - rect.right,
          bottom: window.innerHeight - rect.bottom,
          close: closeRect ? { width: closeRect.width, height: closeRect.height } : null,
        },
        reduced: {
          requested: reduced,
          matches: matchMedia("(prefers-reduced-motion: reduce)").matches,
          rootScrollBehavior: getComputedStyle(root).scrollBehavior,
        },
      };
    },
    { selector, reduced, font },
  );
  const capture = async (phase, profile, surface, selector) => {
    state = `${phase.name}/${profile.name}/${surface}`;
    await settle();
    const value = await inspect(selector, profile.reduced, profile.font);
    ensure(!value.missing, `${state}: missing ${value.missing}`);
    ensure(value.font === profile.font, `${state}: font ${value.font}`);
    ensure(value.dialog.ariaModal === "true", `${state}: dialog is not modal`);
    ensure(value.dialog.close, `${state}: close target is missing`);
    ensure(
      Math.abs(value.dialog.close.width - 36) <= 0.25 &&
        Math.abs(value.dialog.close.height - 36) <= 0.25,
      `${state}: close target changed`,
    );
    for (const [edge, gap] of Object.entries({
      left: value.dialog.left,
      top: value.dialog.top,
      right: value.dialog.right,
      bottom: value.dialog.bottom,
    })) {
      ensure(gap >= 7.5, `${state}: ${edge} gutter ${gap}`);
    }
    ensure(value.reduced.matches === profile.reduced, `${state}: reduced-motion mismatch`);
    if (profile.reduced) {
      ensure(value.reduced.rootScrollBehavior === "auto", `${state}: reduced scroll behavior`);
    }
    const key = `${profile.name}/${surface}`;
    const comparable = { page: value.page, dialog: value.dialog };
    if (phase.name === "before") {
      beforeMetrics[key] = comparable;
    } else {
      ensure(
        JSON.stringify(comparable) === JSON.stringify(beforeMetrics[key]),
        `${key}: layout changed`,
      );
    }
    const path = `output/playwright/css02-extra/${phase.name}/${profile.name}/${surface}.png`;
    await page.screenshot({ path, animations: "disabled", caret: "hide", scale: "css" });
    captures.push(path);
  };
  const openMenuItem = async (menuName, itemName) => {
    await page.getByRole("button", { name: menuName, exact: true }).click();
    await page.getByRole("menu", { name: menuName })
      .getByRole("menuitem", { name: itemName })
      .click();
  };

  for (const phase of phases) {
    for (const profile of profiles) {
      await page.setViewportSize({ width: profile.width, height: profile.height });
      await page.emulateMedia({
        reducedMotion: profile.reduced ? "reduce" : "no-preference",
      });
      state = `${phase.name}/${profile.name}/load`;
      await page.goto(`${phase.baseUrl}/?font=${profile.font}`, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await page.locator(".commerce-os").waitFor();

      await openMenuItem("產品區", /文案/u);
      const content = page.getByRole("dialog", { name: "商品內容" });
      await content.waitFor();
      await content.getByRole("tab", { name: "全站文案健檢" }).click();
      await content.getByRole("region", { name: "全站 FBA 文案健檢" }).waitFor();
      await capture(phase, profile, "content", ".sku-ops-drawer");
      await content.getByRole("button", { name: "關閉商品內容工具" }).click();

      await openMenuItem("價格區", /訂閱價格健檢/u);
      const subscription = page.getByRole("dialog", { name: "全站訂閱價格健檢" });
      await subscription.waitFor();
      await capture(phase, profile, "subscription", ".subscription-audit-drawer");
      await subscription.getByRole("button", { name: "關閉全站訂閱省健檢" }).click();

      await openMenuItem("營運區", /^帳務/u);
      const accounting = page.getByRole("dialog", { name: "帳務" });
      await accounting.waitFor();
      await capture(phase, profile, "accounting", ".accounting-drawer");
      await accounting.getByRole("button", { name: "關閉帳務" }).click();

      const audit = await page.evaluate(() => ({
        unexpected: window.__css01Unexpected ?? [],
        dangerous: (window.__css01Requests ?? []).filter((request) =>
          ["PUT", "PATCH", "DELETE"].includes(request.method),
        ),
      }));
      ensure(
        audit.unexpected.length === 0,
        `${state}: unexpected fixture routes ${JSON.stringify(audit.unexpected)}`,
      );
      ensure(
        audit.dangerous.length === 0,
        `${state}: write requests ${JSON.stringify(audit.dangerous)}`,
      );
    }
  }

  ensure(captures.length === 18, `expected 18 captures, received ${captures.length}`);
  ensure(externalRequests.length === 0, `external requests ${JSON.stringify(externalRequests)}`);
  ensure(consoleErrors.length === 0, `console errors ${JSON.stringify(consoleErrors)}`);
  ensure(pageErrors.length === 0, `page errors ${JSON.stringify(pageErrors)}`);
  return {
    captures: captures.length,
    profiles: profiles.map((profile) => profile.name),
    surfaces: ["content", "subscription", "accounting"],
    externalRequestCount: externalRequests.length,
    consoleErrorCount: consoleErrors.length,
    pageErrorCount: pageErrors.length,
  };
}
