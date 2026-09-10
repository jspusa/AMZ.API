/** Production renderer + deterministic Bridge fixtures. No live account traffic. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const renderer=resolve(root,'out/renderer'),evidence=resolve(root,'workflow-evidence');await mkdir(evidence,{recursive:true});
const {chromium}=await import(pathToFileURL(process.env.APPEARANCE_PLAYWRIGHT).href);
const server=createServer(async(req,res)=>{
 const path=resolve(renderer,'.'+new URL(req.url,'http://127.0.0.1').pathname);
 if(path!==renderer&&!path.startsWith(renderer+sep)){res.writeHead(403).end();return;}
 const file=path===renderer?resolve(renderer,'index.html'):path;
 try{res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]??'application/octet-stream'});res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.APPEARANCE_CHROME||'/usr/bin/chromium',args:['--no-sandbox']});
const starts={content:'掃描 US 全部 FBA 文案',image:'掃描 US 全部 FBA 圖片',aplus:'開始全站 A+ 健檢',variation:'掃描 US 全部 FBA 變體關係',subscription:'同步 US 全部 FBA S&S',businessPricing:'開始全站 B2B 價格健檢',advertising:'掃描全部 FBA SKU',agedInventory:'開始 FBA 180 天以上庫齡健檢',review:'掃描全站 FBA 評論主題'};
const summaries={content:'.content-audit-summary',image:'.image-audit-summary',aplus:'.business-pricing-summary',variation:'.image-audit-summary',subscription:'.subscription-audit-summary',businessPricing:'.business-pricing-summary',advertising:'.ads-coverage-summary',agedInventory:'.aged-inventory-summary',review:'.review-audit-summary'};
const fixture=(await Promise.all(['renderer-visual-fixture.js','audit-detail-fixture.js','workflow-efficiency-fixture.js'].map(n=>readFile(resolve(root,'scripts/visual-qa',n),'utf8')))).join('\n');
const cases=[],checks=[];
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
await context.addInitScript({content:fixture});const page=await context.newPage();page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
const requests=()=>page.evaluate(()=>window.__rendererVisualRequests.length);
const pause=()=>page.waitForTimeout(200);
async function open(kind){
 if(['agedInventory','review'].includes(kind)){
  const details=page.locator('.low-frequency-audits');if(await details.getAttribute('open')===null)await details.locator(':scope > summary').click();
  const label=kind==='agedInventory'?'FBA 180 天以上庫齡健檢捷徑':'FBA 評論主題健檢捷徑';await page.getByRole('region',{name:label,exact:true}).locator('button').click();
 }else await page.locator(`[data-audit-workspace-launch="${kind}"]`).click();
 const surface=page.locator('[data-audit-reading="true"]').last();await surface.waitFor();const start=surface.getByRole('button',{name:starts[kind],exact:kind!=='agedInventory'});
 await surface.locator(summaries[kind]).or(start).first().waitFor();if(await start.count())await start.click();await surface.locator(summaries[kind]).waitFor();await pause();return surface;
}
async function close(kind,surface){if(['agedInventory','review'].includes(kind))await surface.locator('.drawer-header > button').click();else await page.locator('.audit-workspace-back').click();await page.locator('#home-audits').waitFor();}
try{
 if(process.env.WORKFLOW_OFFLINE==='1'){
  const html=await readFile(resolve(renderer,'index.html'),'utf8');
  const script=html.match(/<script[^>]+src="\.\/([^"]+)"/)[1];
  const cssPath=html.match(/<link[^>]+href="\.\/([^"]+\.css)"/)[1];
  const {build}=await import('esbuild');
  const bundle=await build({entryPoints:[resolve(renderer,script)],bundle:true,format:'iife',write:false});
  await page.setContent('<!doctype html><html lang="zh-Hant"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>');
  await page.addStyleTag({content:await readFile(resolve(renderer,cssPath),'utf8')});
  await page.evaluate(origin => { let counter=0; if(!crypto.randomUUID)crypto.randomUUID=()=>`00000000-0000-4000-8000-${String(++counter).padStart(12,'0')}`; const NativeURL=window.URL; window.URL=class extends NativeURL { constructor(input,base){super(input,base==='about:blank'?origin+'/':base);} }; },origin);
  await page.evaluate(fixture.replace('new URLSearchParams(window.location.search)',`new URLSearchParams('?css04=1')`));
  await page.addScriptTag({content:bundle.outputFiles[0].text});
 }else await page.goto(origin+'/?css04=1');
 await page.locator('#home-audits').waitFor();await pause();
 await page.getByRole('button',{name:'開啟設定',exact:true}).click();await page.locator('.settings-about > summary').click();
 assert.equal(await page.getByRole('button',{name:'重新載入介面',exact:true}).isEnabled(),true);
 await page.locator('.ui-build-information').screenshot({path:resolve(evidence,'version-settings.png')});
 await page.getByRole('button',{name:'關閉設定',exact:true}).click();
 for(const kind of Object.keys(starts)){
  const surface=await open(kind);const filter=surface.getByRole('region',{name:'多 SKU 篩選',exact:true});await filter.waitFor();const before=await requests();
  await filter.getByRole('button',{name:/批次 SKU/}).click();await filter.locator('textarea').fill('SYNTHETIC-NOT-IN-RESULT');await filter.getByRole('button',{name:'套用篩選',exact:true}).click();
  assert.match(await filter.textContent(),/1 個 SKU 不在本次結果中/);assert.equal(await requests(),before,kind+': filtering adds no request');
  for(const width of [1440,375]){await page.setViewportSize({width,height:1000});for(const [accent,mode] of [['default','light'],['pink','light'],['default','dark'],['pink','dark']]){
   await page.evaluate(([a,m])=>{document.documentElement.dataset.uiAccent=a;document.documentElement.dataset.uiMode=m;},[accent,mode]);await page.waitForTimeout(40);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),kind+' '+width+' '+mode+': no page overflow');
   cases.push({kind,width,accent,mode,batchControls:true,noOverflow:true});
  }}
  await page.setViewportSize({width:1440,height:1000});await filter.getByRole('button',{name:'清除批次篩選'}).click();assert.equal(await requests(),before);
  await close(kind,surface);checks.push({kind,batchNoRequests:true});
 }
 // Content filtered queue: unsaved draft confirmation and list-position restoration.
 let surface=await open('content');let filter=surface.getByRole('region',{name:'多 SKU 篩選',exact:true});
 await filter.getByRole('button',{name:/批次 SKU/}).click();await filter.locator('textarea').fill('CSS04-MISSING-BULLETS\nCSS04-TYPO-ONLY');await filter.getByRole('button',{name:'套用篩選',exact:true}).click();
 await surface.getByRole('button',{name:'完整編輯',exact:true}).first().click();await page.locator('.audit-item-navigation').waitFor();
 const draft=page.locator('textarea:visible').first();await draft.waitFor();const original=await draft.inputValue();await draft.fill(original+' amended');
 page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'下一筆 →',exact:true}).click();assert.equal(await draft.inputValue(),original+' amended');
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'下一筆 →',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.audit-item-navigation')?.textContent.includes('第 2／2 筆'));
 await page.getByRole('button',{name:'← 返回全站文案健檢結果',exact:true}).click();await page.locator('.content-audit-summary').waitFor();
 assert.match(await page.locator('.audit-sku-filter').textContent(),/批次 SKU · 2/);
 await page.setViewportSize({width:1440,height:600});await pause();await page.evaluate(()=>{document.documentElement.style.scrollBehavior='auto';window.scrollTo(0,350)});await pause();const saved=await page.evaluate(()=>window.scrollY);assert.ok(saved>50,'scroll test must actually scroll');
 await close('content',surface);surface=await open('content');await page.waitForTimeout(400);assert.ok(Math.abs(await page.evaluate(()=>window.scrollY)-saved)<3,'content scroll restored');
 await page.screenshot({path:resolve(evidence,'content-batch-pink-dark.png'),fullPage:true});checks.push({contentDraftCancel:true,contentDraftConfirm:true,contentQueue:true,contentScroll:saved});
 await page.getByRole('button',{name:'開啟設定',exact:true}).click();await page.locator('.settings-about > summary').click();assert.equal(await page.getByRole('button',{name:'重新載入介面',exact:true}).isDisabled(),true);await page.getByRole('button',{name:'關閉設定',exact:true}).click();
 await close('content',surface);
 // Images: an unapplied URL is an unsent draft; no upload or image preflight.
 surface=await open('image');filter=surface.getByRole('region',{name:'多 SKU 篩選',exact:true});
 await filter.getByRole('button',{name:/批次 SKU/}).click();await filter.locator('textarea').fill('CSS04-IMAGE-MISSING\nCSS04-IMAGE-COMPLETE');await filter.getByRole('button',{name:'套用篩選',exact:true}).click();
 await surface.getByRole('button',{name:'開啟圖片工作台',exact:true}).first().click();await page.locator('.image-url-panel input').waitFor();
 const url=page.locator('.image-url-panel input');await url.fill('https://example.invalid/unsent.jpg');
 page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'下一筆 →',exact:true}).click();assert.equal(await url.inputValue(),'https://example.invalid/unsent.jpg');
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'下一筆 →',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.audit-item-navigation')?.textContent.includes('第 2／2 筆'));await page.locator('.image-url-panel input').waitFor();assert.equal(await page.locator('.image-url-panel input').inputValue(),'');
 await page.getByRole('button',{name:'← 上一筆',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.audit-item-navigation')?.textContent.includes('第 1／2 筆'));
 await page.getByRole('button',{name:'← 返回全站圖片健檢結果',exact:true}).click();await page.locator('.image-audit-summary').waitFor();await close('image',surface);checks.push({imageDraftCancel:true,imageDraftConfirm:true,imagePreviousNext:true});
 // B2B: only existing read paths are called while moving through the queue.
 await page.setViewportSize({width:1440,height:1000});surface=await open('businessPricing');await surface.locator('.business-pricing-summary').getByRole('button',{name:/^全部/}).click();await surface.getByRole('button',{name:'查看 Seller SKU FBA-MISSING 的最新 B2B 價格',exact:true}).click();await page.locator('#business-price-input').waitFor();
 const price=page.locator('#business-price-input');await price.fill('17.25');
 page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'下一筆 →',exact:true}).click();assert.equal(await price.inputValue(),'17.25');
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'下一筆 →',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.audit-item-navigation')?.textContent.includes('第 2／2 筆'));await page.locator('#business-price-input').waitFor();assert.notEqual(await page.locator('#business-price-input').inputValue(),'17.25');
 await page.getByRole('button',{name:'← 上一筆',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.audit-item-navigation')?.textContent.includes('第 1／2 筆'));
 await page.getByRole('button',{name:'返回全站 B2B 價格健檢',exact:true}).click();await page.locator('.business-pricing-summary').waitFor();checks.push({b2bDraftCancel:true,b2bDraftConfirm:true,b2bPreviousNext:true});
 assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>window.__rendererVisualRequests.some(r=>['PUT','PATCH','DELETE'].includes(r.method)||/preview|execute/.test(r.path))),false,'no mutations or write previews');
 await writeFile(resolve(evidence,'results.json'),JSON.stringify({syntheticOnly:true,cases,checks,errors},null,2));console.log(`Workflow verification passed: ${cases.length} visual cases; nine request-free batch filters; content/image/B2B draft navigation, scroll and safe reload.`);
}catch(e){await page.screenshot({path:resolve(evidence,'failure.png'),fullPage:true});await writeFile(resolve(evidence,'failure.txt'),String(e)+'\n'+await page.locator('body').innerText());throw e;}
finally{await context.close();await browser.close();await new Promise(done=>server.close(done));}
