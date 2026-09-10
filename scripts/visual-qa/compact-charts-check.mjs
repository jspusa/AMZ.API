/** Production renderer, existing synthetic fixture scaled to stress long money.
 * No real accounts or Amazon traffic. Theme/resize/focus must never call APIs. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function verifyCompactCharts({ browser, origin, root, evidence }) {
  const context = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
  await context.route("**/*", route => route.request().url().startsWith(origin + "/") ? route.continue() : route.abort());
  const fixture = await readFile(resolve(root,"scripts/visual-qa/renderer-visual-fixture.js"),"utf8");
  await context.addInitScript({content:fixture + `\n(() => {
    const request=window.fbaOS.api.request;
    window.fbaOS.api.request=async input=>{
      const response=await request(input);
      if(!/sales/.test(input.path)||response.body?.kind!=="json")return response;
      const copy=structuredClone(response),seen=new WeakSet();
      const scale=value=>{if(!value||typeof value!=="object"||seen.has(value))return;seen.add(value);for(const key of Object.keys(value)){
        if((key==="amount"||key.endsWith("Amount"))&&typeof value[key]==="number")value[key]*=7000;
        else scale(value[key]);
      }};
      scale(copy.body.value);return copy;
    };
  })();`});
  const page=await context.newPage(),errors=[],cases=[];
  page.on("pageerror",error=>errors.push(error.message));
  try {
    await page.goto(origin+"/?css04=1");
    await page.locator(".brand-sales-legend strong").first().waitFor();
    await page.waitForTimeout(500);
    const requests=()=>page.evaluate(()=>window.__rendererVisualRequests.length);
    const before=await requests();
    const brandTotal=await page.locator(".brand-sales-pie desc").textContent();
    assert.match(brandTotal,/700,000/);
    for(const width of [320,375,768,1024,1440,1920])for(const font of ["standard","large"])for(const accent of ["default","pink"])for(const mode of ["light","dark"]){
      await page.setViewportSize({width,height:1000});
      await page.evaluate(([a,m,f])=>{Object.assign(document.documentElement.dataset,{uiAccent:a,uiMode:m,uiFontSize:f});window.scrollTo(0,0);},[accent,mode,font]);
      await page.waitForTimeout(60);
      for(const view of ["category","brand"]){
        await page.locator('.brand-sales-heading').getByRole("button",{name:view==="brand"?"品牌":"品類",exact:true}).click();
        assert.equal(await page.locator('.brand-sales-legend [role="listitem"]').count(),view==="brand"?6:8);
        assert.equal(await page.locator(".brand-sales-pie desc").textContent(),brandTotal);
        assert.equal(await page.locator(".brand-sales-selection").count(),0);
        assert.doesNotMatch(await page.locator(".brand-sales-legend").innerText(),/US\$|SKU|件/);
        const bounds=await page.locator('.brand-sales-visual').evaluate(visual=>{
          const box=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
          return {visual:box(visual),stage:box(visual.querySelector('.brand-sales-pie-stage')),pie:box(visual.querySelector('.brand-sales-pie')),legend:box(visual.querySelector('.brand-sales-legend'))};
        });
        assert.ok(bounds.pie.left>=bounds.stage.left-1&&bounds.pie.right<=bounds.stage.right+1,`Pie must be fully contained in its single-column stage: ${JSON.stringify({width,font,view,bounds})}`);
        assert.ok(bounds.pie.left>=bounds.visual.left-1&&bounds.pie.right<=bounds.visual.right+1,"Pie must never be clipped by the card");
        assert.ok(bounds.pie.right<=bounds.legend.left+1||bounds.pie.bottom<=bounds.legend.top+1,"Pie and legend must not overlap");
        const row=page.locator('.brand-sales-legend button').first();
        await row.hover();
        await page.locator('.brand-sales-tooltip').waitFor();
        assert.match(await page.locator('.brand-sales-tooltip-volume').textContent(),/SKU.*件/);
        for(const selector of [".brand-sales-tooltip-amount",".sales-trend-total > strong"]){
          const money=await page.locator(selector).evaluateAll(nodes=>nodes.map(e=>{
            const range=document.createRange();range.selectNodeContents(e);
            return {whiteSpace:getComputedStyle(e).whiteSpace,textWidth:range.getBoundingClientRect().width,available:e.getBoundingClientRect().width,lines:range.getClientRects().length};
          }));
          for(const entry of money){assert.equal(entry.whiteSpace,"nowrap");assert.equal(entry.lines,1);assert.ok(entry.textWidth<=entry.available+1,JSON.stringify({width,font,selector,entry}));}
        }
        const card=page.locator('.brand-sales-card'), hoverHeight=(await card.boundingBox()).height;
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.brand-sales-tooltip').count(),0);
        assert.equal((await card.boundingBox()).height,hoverHeight,"Details must not shift layout");
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`${width} ${font} ${view}: document overflow`);
      }
      const geometry=await page.locator('.sales-trend-plot svg').evaluate(svg=>{
        const rect=svg.getBoundingClientRect();
        return {height:rect.height,width:rect.width,viewport:svg.viewBox.baseVal.width,axis:parseFloat(getComputedStyle(svg.querySelector('.sales-trend-gridline text')).fontSize)*svg.getScreenCTM().a};
      });
      assert.ok(geometry.height<=172,JSON.stringify(geometry));
      assert.ok(Math.abs(geometry.width-geometry.viewport)<2,"Actual-width viewBox must keep axis text readable");
      assert.ok(geometry.axis>=11,"Do not shrink the entire SVG to shrink the card");
      assert.equal(await page.locator(".sales-trend-plot svg").evaluate(svg=>{const box=svg.getBoundingClientRect();return [...svg.querySelectorAll("text")].every(t=>{const r=t.getBoundingClientRect();return r.left>=box.left-1&&r.right<=box.right+1;});}),true,"All axis labels must fit without clipping");
      const captionGap=await page.locator(".sales-trend-plot svg").evaluate(svg=>{
        const currency=svg.querySelector(".sales-trend-axis-currency").getBoundingClientRect();
        const ticks=[...svg.querySelectorAll(".sales-trend-gridline text")].map(t=>t.getBoundingClientRect());
        return Math.min(...ticks.map(t=>t.top))-currency.bottom;
      });
      assert.ok(captionGap>=2,`Currency caption must not touch the top axis tick: ${width} ${font} ${captionGap}`);
      const pie=await page.locator('.brand-sales-pie-wrap').boundingBox();assert.ok(pie.width>=136&&pie.width<=192,`Pie must be recognisable, not a mini-icon: ${pie.width}`);
      if(width===1440&&font==="standard"){
        const pulse=await page.locator('.operations-pulse').boundingBox();assert.ok(pulse.height<475,`Sales card height ${pulse.height}`);
      }
      assert.equal(await page.locator('.sales-period-note').count(),0);
      if(accent==="pink") {
        const controls=await page.locator('#home-performance .sales-trend-range').evaluateAll(nodes=>nodes.map(e=>({bg:getComputedStyle(e).backgroundColor,image:getComputedStyle(e).backgroundImage})));
        for(const paint of controls){assert.equal(paint.bg,mode==="dark"?"rgb(45, 36, 42)":"rgb(255, 240, 245)");assert.equal(paint.image,"none");}
        assert.equal(await page.locator('.pulse-refresh').evaluate(e=>getComputedStyle(e).backgroundColor),mode==="dark"?"rgb(45, 36, 42)":"rgb(255, 240, 245)");
      }
      let minimumContrast=null;
      if(mode==="dark"){
        for(const selector of ['.workspace-header','.operations-pulse','.brand-sales-card'])assert.equal(await page.locator(selector).evaluate(e=>getComputedStyle(e).backgroundImage),"none");
        minimumContrast=await page.evaluate(()=>{
          const rgb=s=>(s.match(/[\d.]+/g)||[]).map(Number);
          const lum=([r,g,b])=>[r,g,b].map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((n,x,i)=>n+x*[.2126,.7152,.0722][i],0);
          const selectors=['.sales-trend-total > strong','.sales-trend-total > span','.brand-sales-legend strong','.sales-trend-range button[aria-pressed="true"]','.global-marketplace select','.system-health-trigger'];
          return Math.min(...selectors.flatMap(s=>[...document.querySelectorAll(s)].map(e=>{
            let parent=e,bg;while(parent){bg=rgb(getComputedStyle(parent).backgroundColor);if(bg.length===3||bg[3]===1)break;parent=parent.parentElement;}
            const fg=lum(rgb(getComputedStyle(e).color)),paper=lum(bg);return (Math.max(fg,paper)+.05)/(Math.min(fg,paper)+.05);
          })));
        });
        assert.ok(minimumContrast>=4.5,`Dark labels and controls need 4.5:1: ${minimumContrast}`);
      }
      cases.push({width,font,accent,mode,oneLineMoney:true,pie:pie.width,plot:geometry.height,minimumContrast});
      if([375,1440].includes(width)&&font==="standard"&&accent==="pink"){
        await page.evaluate(()=>window.scrollTo(0,0));
        await page.screenshot({path:resolve(evidence,`compact-charts-${width}-${accent}-${mode}.png`),fullPage:true});
      }
    }
    const row=page.locator('.brand-sales-legend button').first();
    await row.focus();await page.locator('.brand-sales-tooltip').waitFor();
    await page.keyboard.press('Escape');assert.equal(await page.locator('.brand-sales-tooltip').count(),0);
    await row.click();await page.locator('.brand-sales-tooltip').waitFor();
    await page.locator('.pulse-heading h2').click();assert.equal(await page.locator('.brand-sales-tooltip').count(),0);
    assert.equal(await requests(),before,"Resize, themes, display size and brand/category tabs must reuse existing data");
    await page.setViewportSize({width:375,height:1000});
    const chart=page.locator('.sales-trend-plot svg');await chart.focus();await page.keyboard.press("End");
    await page.locator('.sales-trend-tooltip').waitFor();assert.match(await page.locator('.sales-trend-tooltip strong').textContent(),/2026-08-07/);
    await page.keyboard.press("Home");assert.match(await page.locator('.sales-trend-tooltip strong').textContent(),/2026-08-01/);
    await page.keyboard.press("Escape");
    await page.locator('.sales-chart-options > summary').click();await page.getByRole("button",{name:"迷你滑板",exact:false}).click();
    assert.equal(await chart.getAttribute('viewBox').then(x=>Number(x.split(' ')[3])),250);
    await page.getByRole("button",{name:"迷你滑板",exact:false}).click();await page.locator('.sales-chart-options > summary').click();
    assert.equal(await requests(),before,"Chart tooltips and skater are display-only");
    assert.deepEqual(errors,[]);
    const touchContext=await browser.newContext({viewport:{width:375,height:1000},hasTouch:true,isMobile:true,reducedMotion:"reduce"});
    try {
      await touchContext.route("**/*",route=>route.request().url().startsWith(origin+"/")?route.continue():route.abort());
      await touchContext.addInitScript({content:fixture});
      const touchPage=await touchContext.newPage();
      await touchPage.goto(origin+"/?css04=1");
      await touchPage.locator('.brand-sales-legend button').first().waitFor();
      for(const view of ["brand","category"]){
        await touchPage.locator('.brand-sales-heading').getByRole("button",{name:view==="brand"?"品牌":"品類",exact:true}).tap();
        const item=touchPage.locator('.brand-sales-legend button').first();
        await item.tap();await touchPage.getByRole("tooltip").waitFor();
        assert.equal(await item.getAttribute('aria-pressed'),'true');
        await item.tap();assert.equal(await touchPage.getByRole("tooltip").count(),0);
        await item.tap();await touchPage.getByRole("tooltip").waitFor();
        await touchPage.locator('.pulse-heading h2').tap();assert.equal(await touchPage.getByRole("tooltip").count(),0);
      }
    } finally {await touchContext.close();}
    await writeFile(resolve(evidence,"compact-charts-results.json"),JSON.stringify({syntheticOnly:true,cases,keyboard:true,touch:true,localOnly:true},null,2));
    console.log(`Compact chart verification passed: ${cases.length} width/font/theme cases, full money, two share views, measured contrast and keyboard navigation.`);
  } finally {await context.close();}
}
