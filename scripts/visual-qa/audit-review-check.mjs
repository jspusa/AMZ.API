/** Production renderer + deterministic Bridge fixtures. No live account traffic. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const renderer=resolve(root,'out/renderer'),evidence=resolve(root,'audit-review-evidence');await mkdir(evidence,{recursive:true});
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
const fixture=(await Promise.all(['renderer-visual-fixture.js','audit-detail-fixture.js','workflow-efficiency-fixture.js','audit-review-fixture.js'].map(n=>readFile(resolve(root,'scripts/visual-qa',n),'utf8')))).join('\n');
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

 await page.waitForFunction(()=>window.__rendererVisualRequests.some(r=>r.path==='/api/sp-api/brand-sales'&&r.method==='GET'&&r.query?.data==='1'));await pause();
 // Opening the summary, switching filters and marking are display-only.
 const overview=()=>page.locator('.audit-review-workbench');
 const closeOverview=async()=>{await page.getByRole('button',{name:'關閉 SKU 指揮中心',exact:true}).click();await page.locator('#home-audits').waitFor();};
 const openOverview=async()=>{await page.getByRole('button',{name:'健檢總表',exact:true}).click();await overview().waitFor();await pause();};
 let before=await requests();await openOverview();assert.match(await overview().innerText(),/尚無可整合/);assert.equal(await requests(),before);await closeOverview();
 for(const kind of ['content','image','aplus','variation','subscription','businessPricing','advertising']){const surface=await open(kind);await close(kind,surface);}
 before=await requests();await openOverview();
 assert.match(await overview().locator('.audit-review-sources').innerText(),/7／7 項已有結果/);
 const todo=overview().getByRole('group',{name:'人工處理狀態'});await todo.getByRole('button',{name:'全部',exact:true}).click();
 const observed=[];
 for(const width of [1440,1024,768,375]) { await page.setViewportSize({width,height:1000});for(const [accent,mode] of [['default','light'],['pink','light'],['default','dark'],['pink','dark']]){
   await page.evaluate(([a,m])=>{document.documentElement.dataset.uiAccent=a;document.documentElement.dataset.uiMode=m;},[accent,mode]);await page.waitForTimeout(60);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'overview page overflow');
   const r=await overview().boundingBox();assert.ok(r.x>=-1 && r.x+r.width<=width+1,'overview must fit viewport');
   cases.push({surface:'matrix',width,accent,mode,noDocumentOverflow:true});
   if(width===1440&&accent==='pink')await page.locator('.command-drawer').screenshot({path:resolve(evidence,`matrix-pink-${mode}.png`)});
 }}
 await page.setViewportSize({width:1440,height:1000});
 const row=overview().locator('tbody > tr').filter({has:page.locator('th code',{hasText:'CSS04-MISSING-BULLETS'})}).first();
 await row.locator('button.audit-review-cell').first().click();
 const details=overview().getByRole('region',{name:'CSS04-MISSING-BULLETS 提示明細',exact:true});await details.waitFor();
 assert.match(await details.innerText(),/AMZ.API 優化建議/);assert.match(await details.innerText(),/待人工判斷/);
 const markGroup=details.getByRole('group',{name:'CSS04-MISSING-BULLETS SUSPECTED_TYPO 人工標記',exact:true});
 await markGroup.getByRole('button',{name:'稍後處理',exact:true}).click();assert.equal(await markGroup.getByRole('button',{name:'稍後處理',exact:true}).getAttribute('aria-pressed'),'true');
 await todo.getByRole('button',{name:'稍後處理',exact:true}).click();assert.equal(await overview().locator('tbody > tr:not(.audit-review-detail-row)').count(),1);
 assert.equal(await requests(),before,'summary interactions must not trigger any Bridge request');
 await closeOverview();await openOverview();assert.equal(await overview().getByRole('group',{name:'人工處理狀態'}).getByRole('button',{name:'稍後處理',exact:true}).getAttribute('aria-pressed'),'true');
 await overview().getByRole('button',{name:'前往文案健檢 →',exact:true}).click();await page.locator('.content-audit-summary').waitFor();
 assert.match(await page.locator('.audit-sku-filter').innerText(),/批次 SKU · 1/);assert.equal(await requests(),before,'source handoff uses completed job, not new scan');
 await page.locator('.audit-workspace-back').click();await overview().waitFor();
 assert.equal(await page.evaluate(n=>window.__rendererVisualRequests.slice(n).some(r=>r.path==='/api/sp-api/standalone-audit'||/preview|execute/.test(r.path)),before),false,'return does not relaunch an audit or a write');
 checks.push({displayOnly:true,markSurvivesReopen:true,exactSourceHandoff:true,returnsToMatrix:true});
 // New source evidence reopens review marks; incomplete rows never become resolved.
 await closeOverview();let surface=await open('content');
 await page.evaluate(()=>{window.__auditReviewRound=1;});await surface.getByRole('button',{name:'重新健檢',exact:true}).click();await pause();await close('content',surface);
 await openOverview();await overview().getByRole('button',{name:'本次重檢差異',exact:true}).click();
 assert.ok(await overview().locator('.delta-resolved').count()>0,'complete matching recheck should resolve the old typo');
 assert.ok(await overview().locator('.delta-unknown').count()>0,'incomplete read must not resolve the other typo');
 assert.ok(await overview().locator('.delta-new').count()>0,'new local title finding needs a complete previous baseline');
 assert.ok(await overview().locator('.delta-continuing').count()>0,'existing bullet finding persists');
 await overview().getByRole('button',{name:'商品總表',exact:true}).click();assert.match(await overview().innerText(),/目前篩選下沒有項目/);
 await overview().getByRole('group',{name:'人工處理狀態'}).getByRole('button',{name:'全部',exact:true}).click();
 const finalCell=overview().locator('tbody > tr').filter({has:page.locator('th code',{hasText:'CSS04-MISSING-BULLETS'})}).first().locator('.audit-review-cell').first();if(await finalCell.getAttribute('aria-expanded')!=='true')await finalCell.click();await overview().locator('.audit-review-detail').waitFor();
 for(const width of [1440,375]){await page.setViewportSize({width,height:1000});for(const [accent,mode] of [['default','light'],['pink','light'],['default','dark'],['pink','dark']]){
  await page.evaluate(([a,m])=>{document.documentElement.dataset.uiAccent=a;document.documentElement.dataset.uiMode=m;},[accent,mode]);await pause();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'detail page overflow');cases.push({surface:'detail',width,accent,mode,noDocumentOverflow:true});
  if(width===375&&accent==='pink'&&mode==='dark')await page.locator('.command-drawer').screenshot({path:resolve(evidence,'detail-mobile-pink-dark.png')});
 }}
 await page.setViewportSize({width:1440,height:1000});await overview().getByRole('button',{name:'本次重檢差異',exact:true}).click();await page.locator('.command-drawer').screenshot({path:resolve(evidence,'recheck-differences.png')});
 checks.push({new:true,continuing:true,positiveResolved:true,incompleteUnknown:true,changedEvidenceResetsMarks:true});
 await closeOverview();surface=await open('content');const sourceFilter=surface.getByRole('group',{name:'依問題來源篩選',exact:true});await sourceFilter.waitFor();
 before=await requests();await sourceFilter.getByRole('button',{name:/待人工判斷/}).click();assert.equal(await requests(),before,'source classification makes no API requests');
 await page.screenshot({path:resolve(evidence,'content-classification.png'),fullPage:true});
 assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>window.__rendererVisualRequests.some(r=>['PUT','PATCH','DELETE'].includes(r.method)||/preview|execute/.test(r.path))),false,'no write previews or mutations');
 await writeFile(resolve(evidence,'results.json'),JSON.stringify({syntheticOnly:true,cases,checks,errors},null,2));console.log(`Audit review verified: ${cases.length} visual cases; 7 completed sources; request-free matrix and source handoff; marks and recheck transitions.`);
}catch(e){await page.screenshot({path:resolve(evidence,'failure.png'),fullPage:true});await writeFile(resolve(evidence,'failure.txt'),String(e)+'\n'+await page.locator('body').innerText());await writeFile(resolve(evidence,'failure-requests.json'),JSON.stringify(await page.evaluate(()=>window.__rendererVisualRequests),null,2));throw e;}
finally{await context.close();await browser.close();await new Promise(done=>server.close(done));}
