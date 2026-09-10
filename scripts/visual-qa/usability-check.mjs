import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Real production DOM interactions, deliberately stalled synthetic health only. */
export async function verifyUsability({ browser, origin, root, evidence }) {
  const fixture = await readFile(resolve(root, "scripts/visual-qa/renderer-visual-fixture.js"), "utf8");
  const checks = [];
  for (const width of [375, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
    await context.route("**/*", route => route.request().url().startsWith(origin + "/") ? route.continue() : route.abort());
    await context.addInitScript({ content: fixture + `\n(() => {
      const request = window.fbaOS.api.request;
      window.fbaOS.api.request = (input) => input.path === "/api/system/health"
        ? new Promise(() => {}) : request(input);
    })();` });
    const page = await context.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/?css04=1`);
    await page.locator("#home-audits").waitFor();
    await page.waitForTimeout(800);
    const requests = () => page.evaluate(() => window.__rendererVisualRequests.length);
    const initialRequests = await requests();
    const search = page.getByRole("textbox", {name: "全域 Seller SKU", exact: true});
    await page.keyboard.press("Control+k");
    assert.equal(await search.evaluate(el => el === document.activeElement), true);
    await search.fill("VISUAL-TYPING-ONLY");
    await page.keyboard.press("Escape");
    assert.equal(await search.inputValue(), "");
    await search.fill("VISUAL-CLEAR-ONLY");
    await page.getByRole("button", {name: "清除 SKU 搜尋", exact: true}).click();
    assert.equal(await search.inputValue(), "");
    assert.equal(await search.evaluate(el => el === document.activeElement), true);
    await search.fill("VISUAL-IME-ONLY");
    await search.dispatchEvent("keydown", {key: "Enter", isComposing: true});
    assert.equal(await requests(), initialRequests, "Focus, typing, clear and IME must not request data");
    await search.fill("");
    await search.evaluate(el => el.blur());
    await page.keyboard.press("/");
    assert.equal(await search.evaluate(el => el === document.activeElement), true);
    assert.equal(await requests(), initialRequests);

    // Read-only background health is still pending. All close routes remain usable.
    const open = page.getByRole("button", {name:"開啟設定", exact:true});
    await open.click();
    const dialog = page.getByRole("dialog", {name:"設定", exact:true});
    const close = page.getByRole("button", {name:"關閉設定", exact:true});
    assert.equal(await close.isEnabled(), true);
    assert.equal(await page.locator("#root").evaluate(el => el.inert), true);
    assert.equal(await page.locator(".settings-about").getAttribute("open"), null);
    const order = await dialog.evaluate(el => {
      const nodes = [".font-size-preference", ".appearance-preference", ".settings-sync-preference", ".settings-about"].map(selector => el.querySelector(selector));
      return nodes.every((node, i) => !i || Boolean(nodes[i-1].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    assert.equal(order, true, "Appearance and sync must precede technical explanations");
    await close.focus(); await page.keyboard.press("Shift+Tab");
    assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
    await page.keyboard.press("Tab");
    assert.equal(await close.evaluate(el => el === document.activeElement), true, "Focus must wrap inside settings");
    await page.keyboard.press("Escape");
    assert.equal(await dialog.count(), 0);
    assert.equal(await open.evaluate(el => el === document.activeElement), true);
    assert.equal(await page.locator("#root").evaluate(el => el.inert), false);
    await open.click(); await close.click();
    assert.equal(await dialog.count(), 0);
    if (width === 1440) {
      await open.click(); await page.locator(".drawer-backdrop").click({position:{x:10,y:500}});
      assert.equal(await dialog.count(), 0);
    }
    await open.click();
    const fonts = dialog.getByRole("radiogroup", {name:"介面字級", exact:true});
    await fonts.getByRole("radio", {name:"標準", exact:true}).focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await fonts.getByRole("radio", {name:"大", exact:true}).getAttribute("aria-checked"), "true");
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
    await page.keyboard.press("ArrowLeft");
    await page.locator('.appearance-option:has(input[value="pink"])').click();
    await dialog.screenshot({path:resolve(evidence, `usability-settings-light-${width}.png`)});
    await page.getByRole("switch", {name:"深色模式", exact:true}).setChecked(true);
    await dialog.screenshot({path:resolve(evidence, `usability-settings-dark-${width}.png`)});
    await close.click();
    assert.equal(await requests(), initialRequests, "Local display changes must not call the Bridge");
    assert.equal(await page.locator(".sales-period-note").count(), 0);
    assert.equal(await page.locator(".sales-trend-line.is-current.is-partial").getAttribute("stroke-dasharray"), "5 5");
    assert.equal(await page.locator(".sales-chart-options").getAttribute("open"), null);
    assert.equal(await page.getByRole("button", {name:"迷你滑板", exact:false}).isVisible(), false);
    await page.locator(".sales-chart-options > summary").click();
    await page.getByRole("button", {name:"迷你滑板", exact:false}).click();
    assert.equal(await page.getByRole("button", {name:"迷你滑板", exact:false}).getAttribute("aria-pressed"), "true");
    await page.getByRole("button", {name:"迷你滑板", exact:false}).click();
    await page.locator(".sales-chart-options > summary").click();
    assert.equal(await requests(), initialRequests, "Chart options remain local only");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({path:resolve(evidence, `usability-home-dark-${width}.png`), fullPage:true});
    // Exercise genuine UI states using the synthetic fixture's supported/unsupported jobs.
    await page.locator(".audit-suite-start").click();
    await page.locator('.home-audit-summary:not(.is-empty)').waitFor();
    await page.waitForTimeout(700);
    const summary = page.locator(".home-audit-summary:not(.is-empty)");
    const total = await summary.locator("button > strong").evaluateAll(nodes => nodes.reduce((n, el) => n + Number(el.textContent), 0));
    assert.equal(total, 7, "Summary partitions the seven audit types, not unique SKUs");
    const beforeLocate = await requests();
    await summary.locator("button:not([disabled])").first().click();
    assert.equal(await requests(), beforeLocate, "Summary only locates a card; never starts or retries a job");
    assert.equal(await page.evaluate(() => document.activeElement.matches("[data-audit-workspace-launch]")), true);
    await page.locator("#home-audits").screenshot({path:resolve(evidence, `usability-audit-states-${width}.png`)});
    assert.deepEqual(errors, []);
    checks.push({width, search:"passed", stalledReadClosing:"passed", focusTrap:"passed", fontKeyboard:"passed", appearanceOrder:"passed", incompleteDate:"passed", chartOptions:"passed", displayOnlyRequests:0, summaryTypes:7, summaryNavigation:"focus-only"});
    await context.close();
  }
  await writeFile(resolve(evidence, "usability-results.json"), JSON.stringify({fixture:"synthetic-only", checks}, null, 2));
  console.log("Usability browser verification passed: search/IME, closable pending read, keyboard/focus, settings order, partial day and local chart controls.");
}
