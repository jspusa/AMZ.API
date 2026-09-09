/** Real production bundle, synthetic Bridge only; no external/Amazon traffic. */
import assert from "node:assert/strict";
import {readFile, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
export async function verifyAuditDetails({browser,origin,root,evidence}) {
  const cases = [];
  const starts = {
    content: "掃描 US 全部 FBA 文案", image: "掃描 US 全部 FBA 圖片",
    aplus: "開始全站 A+ 健檢", variation: "掃描 US 全部 FBA 變體關係",
    subscription: "同步 US 全部 FBA S&S", businessPricing: "開始全站 B2B 價格健檢",
    advertising: "掃描全部 FBA SKU", agedInventory: "開始 FBA 180 天以上庫齡健檢",
    review: "掃描全站 FBA 評論主題",
  };
  const summaries = {content:".content-audit-summary",image:".image-audit-summary",aplus:".business-pricing-summary",variation:".image-audit-summary",subscription:".subscription-audit-summary",businessPricing:".business-pricing-summary",advertising:".ads-coverage-summary",agedInventory:".aged-inventory-summary",review:".review-audit-summary"};
  const context = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
  await context.route("**/*", r => r.request().url().startsWith(origin+"/") ? r.continue() : r.abort());
  const fixture = await readFile(resolve(root,"scripts/visual-qa/renderer-visual-fixture.js"),"utf8");
  const extra = await readFile(resolve(root,"scripts/visual-qa/audit-detail-fixture.js"),"utf8");
  await context.addInitScript({content:fixture+"\n"+extra});
  const page=await context.newPage(); const errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  try {
    await page.goto(origin+"/?css04=1"); await page.locator("#home-audits").waitFor();
    for (const [kind,start] of Object.entries(starts)) {
      const low=["agedInventory","review"].includes(kind);
      if(low) {
        const details=page.locator(".low-frequency-audits");
        if(await details.getAttribute("open")===null)await details.locator(":scope > summary").click();
        const label=kind==="agedInventory"?"FBA 180 天以上庫齡健檢捷徑":"FBA 評論主題健檢捷徑";
        await page.getByRole("region",{name:label,exact:true}).locator("button").click();
      } else await page.locator(`[data-audit-workspace-launch="${kind}"]`).click();
      const surface=page.locator('[data-audit-reading="true"]').last();
      await surface.waitFor();
      const startButton=surface.getByRole("button",{name:start,exact:kind!=="agedInventory"});
      if(await startButton.count())await startButton.click();
      await surface.locator(summaries[kind]).waitFor({timeout:15000});
      for(const width of [1440,375]) {
        await page.setViewportSize({width,height:1000});
        for(const [accent,mode] of [["default","light"],["pink","light"],["default","dark"],["pink","dark"]]) {
          await page.evaluate(([a,m])=>{document.documentElement.dataset.uiAccent=a;document.documentElement.dataset.uiMode=m},[accent,mode]);
          await page.waitForTimeout(60);
          assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1), `${kind} ${width} ${mode}: page overflow`);
          const tiny=await surface.locator("p,td").evaluateAll(els=>els.filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=="hidden"&&parseFloat(getComputedStyle(e).fontSize)<12).map(e=>e.className));
          assert.deepEqual(tiny,[],`${kind}: readable text size`);
          if(width===1440&&accent==="default"&&mode==="light"||width===375&&accent==="pink"&&mode==="dark")await page.screenshot({path:resolve(evidence,`audit-detail-${kind}-${width}-${mode}.png`),fullPage:true});
          cases.push({kind,width,accent,mode,resultsVisible:true,noPageOverflow:true});
        }
      }
      await page.setViewportSize({width:1440,height:1000});
      if(low)await surface.locator(".drawer-header > button").click();
      else await page.locator(".audit-workspace-back").click();
      await page.locator("#home-audits").waitFor();
    }
    assert.deepEqual(errors,[],"No uncaught renderer errors");
    assert.equal(await page.evaluate(()=>window.__rendererVisualRequests.some(r=>["PUT","PATCH","DELETE"].includes(r.method))),false,"No mutation calls in layout verification");
    await writeFile(resolve(evidence,"audit-detail-results.json"),JSON.stringify({syntheticOnly:true,cases},null,2));
    console.log(`Audit detail browser checks passed: ${cases.length} result-page viewport/theme cases.`);
  } finally { await context.close(); }
}
