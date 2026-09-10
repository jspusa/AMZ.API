/** Run against a production renderer with the existing synthetic local Bridge.
 * Usage: APPEARANCE_PLAYWRIGHT=<absolute playwright package>/index.mjs node ...
 * All non-loopback requests are blocked; no live Amazon/hardware verification.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, extname, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { verifyCompactCharts } from "./compact-charts-check.mjs";

import { verifySweetUi } from "./sweet-ui-check.mjs";

import { verifyAuditDetails } from "./audit-detail-check.mjs";

import { verifyUsability } from "./usability-check.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const renderer = resolve(root, "out/renderer");
const evidence = resolve(root, "appearance-evidence");
await mkdir(evidence, { recursive: true });
const { chromium } = await import(pathToFileURL(process.env.APPEARANCE_PLAYWRIGHT).href);
const server = createServer(async (req, res) => {
  const path = resolve(renderer, `.${new URL(req.url, "http://127.0.0.1").pathname}`);
  if (path !== renderer && !path.startsWith(renderer + sep)) { res.writeHead(403).end(); return; }
  const file = path === renderer ? resolve(renderer, "index.html") : path;
  try {
    const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" }[extname(file)] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime }); res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.APPEARANCE_CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const results = [];
try {
  await verifyCompactCharts({ browser, origin, root, evidence });
  await verifySweetUi({ browser, origin, root, evidence });
  await verifyAuditDetails({ browser, origin, root, evidence });
  await verifyUsability({ browser, origin, root, evidence });
  for (const width of [320, 375, 768, 1024, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
    await context.route("**/*", (route) => route.request().url().startsWith(origin + "/") ? route.continue() : route.abort());
    await context.addInitScript({ path: resolve(root, "scripts/visual-qa/renderer-visual-fixture.js") });
    const page = await context.newPage();
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/?css04=1`);
    await page.locator("#home-audits").waitFor();
    await page.waitForTimeout(800);
    await page.evaluate(() => { window.__appearanceHome = document.querySelector("#home-audits"); });
    const geometry = () => page.locator("#home-audits > .health-audit-home-grid > section").evaluateAll((cards) => cards.map((c) => {
      const b = c.getBoundingClientRect(), i = c.querySelector(".content-audit-home-icon").getBoundingClientRect(), t = c.querySelector("h2").getBoundingClientRect();
      return { x: b.x, y: b.y + window.scrollY, w: b.width, h: b.height, iconCenter: i.x + i.width / 2, titleCenter: t.x + t.width / 2 };
    }));
    const baseline = await geometry();
    assert.equal(baseline.length, 7);
    for (const [accent, mode] of [["default", "light"], ["pink", "light"], ["default", "dark"], ["pink", "dark"]]) {
      await page.getByRole("button", { name: "開啟設定", exact: true }).click();
      await page.locator(`.appearance-option:has(input[value="${accent}"])`).click();
      await page.getByRole("switch", { name: "深色模式", exact: true }).setChecked(mode === "dark");
      const attrs = await page.locator("html").evaluate((html) => [html.dataset.uiAccent, html.dataset.uiMode]);
      assert.deepEqual(attrs, [accent, mode]);
      assert.equal(await page.evaluate(() => window.__appearanceHome === document.querySelector("#home-audits")), true, "Theme selection must not remount dashboard");
      if ([375, 1440].includes(width)) {
        await page.locator(".appearance-preference").scrollIntoViewIfNeeded();
        await page.locator(".appearance-preference").screenshot({ path: resolve(evidence, `${accent}-${mode}-settings-${width}.png`) });
      }
      const fieldOverflow = await page.locator(".appearance-preference").evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      assert.equal(fieldOverflow, false, "Appearance selector must fit its drawer");
      await page.getByRole("button", { name: "關閉設定", exact: true }).click();
      const current = await geometry();
      assert.deepEqual(current, baseline, "Theme must not alter card geometry");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "No page horizontal overflow");
      for (const tile of current) assert.ok(Math.abs(tile.iconCenter - tile.titleCenter) < 1, "Icon and title centers must match");
      if ([375, 1440].includes(width)) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: resolve(evidence, `${accent}-${mode}-home-${width}.png`), fullPage: true });
      }
      await page.reload();
      await page.locator("#home-audits").waitFor();
      assert.deepEqual(await page.locator("html").evaluate((html) => [html.dataset.uiAccent, html.dataset.uiMode]), [accent, mode], "Preferences survive renderer reload");
      await page.evaluate(() => { window.__appearanceHome = document.querySelector("#home-audits"); });
      results.push({ width, accent, mode, geometryUnchanged: true, reload: true, overflow: false });
    }
    // A native radio group supports arrows and the switch supports Space.
    await page.getByRole("button", { name: "開啟設定", exact: true }).click();
    const original = page.getByRole("radio", { name: /^原色/ });
    await original.focus(); await page.keyboard.press("ArrowRight");
    assert.equal(await page.getByRole("radio", { name: /^粉紅色/ }).isChecked(), true);
    await page.getByRole("switch", { name: "深色模式", exact: true }).focus();
    await page.keyboard.press("Space");
    assert.equal(await page.getByRole("switch", { name: "深色模式", exact: true }).isChecked(), false);
    assert.deepEqual(errors, [], "No uncaught renderer errors");
    await context.close();
  }
  await writeFile(resolve(evidence, "results.json"), JSON.stringify({ fixture: "synthetic-only", checks: results, keyboard: "passed" }, null, 2));
  console.log(`Appearance browser verification passed: ${results.length} viewport/theme combinations, reload, keyboard, unchanged geometry.`);
} finally {
  await browser.close(); await new Promise((done) => server.close(done));
}
