import { readFile } from 'node:fs/promises';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuditReviewSession, compareReviewSnapshots, exactReviewSku, projectContentReview, reviewCell, reviewProducts, sealReviewSnapshot, REVIEW_KINDS, type ReviewCell, type ReviewKind, type ReviewSnapshot, type ReviewSource } from '../src/renderer/src/audit-review-model';
import { AuditReviewProvider } from '../src/renderer/src/audit-review-session';
import { contentIssueOrigin, contentRowOrigins } from '../src/renderer/src/audit-issue-origin';
import { projectReviewSnapshot, ReviewSourceProjector, type ReviewSourceInput } from '../src/renderer/src/audit-review-sources';
import { AuditViewSessionProvider } from '../src/renderer/src/audit-view-session';
import AuditReviewWorkbench from '../src/renderer/src/components/audit-review-workbench';
import ContentOriginFilter from '../src/renderer/src/components/content-origin-filter';
import SkuCommandCenter from '../src/renderer/src/components/sku-command-center';
import type { ContentAuditRow, ContentAuditSnapshot, ContentAuditIssueKind } from '../src/renderer/src/content-quality';
import { parseStandaloneAuditJob } from '../src/renderer/src/standalone-audit';

const M = 'ATVPDKIKX0DER';
const time = (n: number) => `2026-09-10T0${n}:00:00.000Z`;
function cell(sku = 'FBA-ONE', codes = ['TITLE_BELOW_TARGET'], complete = true, facts: unknown = 'original', asin: string | null = 'B000000001', kind: ReviewKind = 'content') {
  return reviewCell(kind, { sellerSku: sku, asin, productType: 'PET_FOOD', title: 'Synthetic product' }, complete, facts,
    codes.map(code => ({ code, origin: 'suggestion' as const, message: `${code} fixture`, field: 'title' })));
}
function snapshot(cells: ReviewCell[], n = 1, options: unknown = null): ReviewSnapshot {
  return sealReviewSnapshot(cells[0]?.kind ?? 'content', M, 'demo', { fetchedAt: time(n), exportId: `export-${n}` }, cells, options);
}
const ready = (value: ReviewSnapshot): ReviewSource => ({ kind: value.kind, state: 'ready', snapshot: value, note: '' });
const row = (overrides: Partial<ContentAuditRow> = {}): ContentAuditRow => ({
  sellerSku: 'FBA-ONE', asin: 'B000000001', productType: 'PET_FOOD', title: 'Synthetic content',
  bulletPoints: ['One'], ingredients: 'Turkey', readStatus: 'complete', readErrors: [],
  issues: [{kind:'TITLE_BELOW_TARGET', field:'title', source:'amazon-content', message:'Local length suggestion'}], ...overrides,
});
const content = (rows: ContentAuditRow[]) => ({marketplaceId:M,fetchedAt:time(1),rows}) as ContentAuditSnapshot;
const trees: ReactTestRenderer[] = [];
afterEach(async () => { await act(async () => { for (const tree of trees.splice(0)) tree.unmount(); }); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function imagePayload() {
  return {marketplaceId:M, fetchedAt:time(1), exportId:'image-export', minimumImages:6,
    rows:[{sellerSku:'FBA-ONE',asin:'B000000001',productType:'PET_FOOD',title:'Synthetic images',imageUrls:['https://example.invalid/one.jpg'],imageCount:1,readStatus:'complete',readErrors:[]}],
    summary:{total:1,completed:1,incomplete:0,underMinimum:1}};
}
function imageJob() {
  return parseStandaloneAuditJob({jobId:'84ec9cda-e878-4e87-984e-65c8c5652cee',contextId:'94ec9cda-e878-4e87-984e-65c8c5652cef',kind:'image',marketplaceId:M,mode:'demo',options:{},ready:true,status:'completed',progress:{stage:'complete',message:'完成',completedUnits:1,totalUnits:1},snapshot:imagePayload()}, {kind:'image',marketplaceId:M,mode:'demo'});
}
function aplusPayload(status = 'REJECTED') {
  const totals={eligibleFbaSkus:1,uniqueAsins:1,published:1,missing:0,incomplete:0,unavailable:0};
  return {mode:'demo',marketplaceId:M,fetchedAt:time(1),rows:[{sellerSku:'FBA-ONE',asin:'B000000001',title:'Synthetic A+',marketplaceId:M,status:'published',sourceCompleteness:'complete',publishedRecordCount:1,contentTypes:['EBC'],locales:['en-US'],documentEvidenceCompleteness:'complete',reasonCode:'PUBLISHED_RECORD_FOUND',reason:'Published record present',documents:[{name:'Draft revision',documentStatus:status,badges:[],relationState:'published',evidence:'publish_record',completeness:'complete'}]}],totals,summary:totals,notice:'Synthetic read only'};
}

describe('audit problem origins are evidence based', () => {
  it.each(['TITLE_BELOW_TARGET','MISSING_BULLETS','MISSING_INGREDIENTS','HIGHLIGHT_BELOW_TARGET','BULLET_ABOVE_TARGET','BULLET_BELOW_TARGET','DESCRIPTION_BELOW_TARGET'] as ContentAuditIssueKind[])
  ('never calls locally measured %s an Amazon ruling', kind => { expect(contentIssueOrigin({kind,source:'amazon-content'})).toBe('suggestion'); });
  it.each(['SUSPECTED_TYPO','SINGLE_INGREDIENT_MISMATCH'] as ContentAuditIssueKind[])('requires manual judgment for %s', kind => {
    expect(contentIssueOrigin({kind,source:'pages-dictionary'})).toBe('review');
  });
  it('separates incomplete ingredient proof and failed reads', () => {
    expect(contentIssueOrigin({kind:'INGREDIENTS_UNVERIFIED'})).toBe('unread');
    expect(contentRowOrigins(row({readStatus:'incomplete'}))).toEqual(['unread','suggestion']);
    const projected=projectContentReview(content([row({readStatus:'incomplete',readErrors:[{code:'PARTIAL',message:'Missing content'}]})]))[0]!;
    expect(projected.complete).toBe(false);expect(projected.findings.map(f=>f.origin)).toEqual(['unread']);
  });
  it('excludes parent containers and treats unverified ingredients as incomplete', () => {
    expect(projectContentReview(content([row({variationRole:'parent'})]))).toEqual([]);
    const projected=projectContentReview(content([row({issues:[{kind:'INGREDIENTS_UNVERIFIED',field:'ingredients',message:'Unknown applicability'}]})]))[0]!;
    expect(projected.complete).toBe(false);
  });
  it('projects the original messages without rewriting the existing verdicts', () => {
    const original=row();const before=JSON.stringify(original);const projected=projectContentReview(content([original]))[0]!;
    expect(projected.findings[0]!.message).toBe(original.issues[0]!.message);expect(JSON.stringify(original)).toBe(before);
  });
  it('keeps optional image-count targets separate from compliance', () => {
    const projected=projectReviewSnapshot('image',imagePayload(),M,'demo');
    expect(projected.cells[0]!.findings[0]!.origin).toBe('suggestion');
    expect(projected.cells[0]!.findings[0]!.message).toContain('並非 Amazon 下架判定');
  });
  it('labels only an explicit complete rejected A+ document as Amazon reported', () => {
    const projected=projectReviewSnapshot('aplus',aplusPayload(),M,'demo');
    expect(projected.cells[0]!.findings.map(f=>f.origin)).toEqual(['amazon']);
    expect(projected.cells[0]!.findings[0]!.message).toContain('不等同目前 Listing 無法銷售');
    expect(projectReviewSnapshot('aplus',aplusPayload('APPROVED'),M,'demo').cells[0]!.findings).toEqual([]);
  });
  it('does not turn missing optional document evidence into a proven missing A+ suggestion', () => {
    const data=aplusPayload('APPROVED');data.rows[0]!.status='missing';data.rows[0]!.publishedRecordCount=0;data.rows[0]!.documents=[];data.rows[0]!.documentEvidenceCompleteness='unavailable';
    data.rows[0]!.contentTypes=[];data.rows[0]!.locales=[];data.rows[0]!.reasonCode='NO_PUBLISHED_RECORD';data.rows[0]!.reason='No record';data.totals.published=0;data.totals.missing=1;
    const projected=projectReviewSnapshot('aplus',data,M,'demo');expect(projected.cells[0]!.complete).toBe(false);expect(projected.cells[0]!.findings.map(f=>f.origin)).toEqual(['unread']);
  });
  it('renders a local classification selector without a fake Amazon category', () => {
    const html=renderToStaticMarkup(<ContentOriginFilter rows={[row()]} value="all" onChange={()=>{}}/>);
    expect(html).toContain('AMZ.API 優化建議');expect(html).not.toContain('Amazon 回報');
  });
});

describe('review identities and coverage', () => {
  it.each([' a,b/ONE ','MiXeD_03','商品品號','A'.repeat(40)])('preserves exact identity %s', sku => {
    expect(exactReviewSku(sku)).toBe(true);expect(cell(sku).sellerSku).toBe(sku);
  });
  it.each(['', ' ', 'A'.repeat(41), 'A\u200bB','A\nB','A\u202eB'])('rejects malformed identity %j instead of repairing it', sku => {
    expect(exactReviewSku(sku)).toBe(false);expect(()=>cell(sku)).toThrow();
  });
  it('rejects duplicate SKUs and conflicting evidence instead of silently merging them', () => {
    expect(()=>snapshot([cell(),cell()])).toThrow();
    expect(()=>reviewCell('content',{sellerSku:'FBA-ONE'},true,'x',[{code:'A',origin:'review',message:'first'},{code:'A',origin:'review',message:'different'}])).toThrow();
  });
  it('counts products separately from findings and exposes conflicting ASINs', () => {
    const products=reviewProducts([ready(snapshot([cell('FBA-ONE',['A','B'])])),ready(snapshot([cell('FBA-ONE',['C'],true,'x','B000000002','image')]))]);
    expect(products).toHaveLength(1);expect(products[0]!.findingCount).toBe(3);expect(products[0]!.identityConflict).toBe(true);
  });
  it('does not merge failed or running source snapshots into the current matrix', () => {
    const old=snapshot([cell()]);expect(reviewProducts([{...ready(old),state:'running'}])).toEqual([]);
    expect(reviewProducts([{...ready(old),state:'failed'}])).toEqual([]);
  });
  it('accepts only completed same-market/mode jobs and does not issue reads', () => {
    const network=vi.fn();vi.stubGlobal('fetch',network);
    const projector=new ReviewSourceProjector();const input:ReviewSourceInput={marketplaceId:M,mode:'demo',jobs:{image:imageJob()},aplusJob:null,blockedKinds:[]};
    const result=projector.read(input);expect(result.find(s=>s.kind==='image')!.state).toBe('ready');
    expect(projector.read(input).find(s=>s.kind==='image')!.snapshot).toBe(result.find(s=>s.kind==='image')!.snapshot);
    expect(projector.read({...input,mode:'live'}).every(s=>s.state==='unrun')).toBe(true);
    expect(projector.read({...input,blockedKinds:['image']}).find(s=>s.kind==='image')!.snapshot).toBeNull();
    expect(network).not.toHaveBeenCalled();
  });
  it('does not claim unreadable source data or a foreign snapshot is healthy', () => {
    expect(()=>projectReviewSnapshot('image',{...imagePayload(),marketplaceId:'FOREIGN'},M,'demo')).toThrow();
    const projector=new ReviewSourceProjector();const job=imageJob();
    const result=projector.read({marketplaceId:M,mode:'demo',jobs:{image:{...job,ready:true,status:'completed',snapshot:{}} as typeof job},aplusJob:null,blockedKinds:[]});
    expect(result.find(s=>s.kind==='image')!.state).toBe('failed');
  });
});

describe('same-session recheck differences', () => {
  it('never calls every first result new',()=>expect(compareReviewSnapshots(null,snapshot([cell()])).map(c=>c.delta)).toEqual(['uncompared']));
  it('separates new, continuing and positively resolved findings',()=>{
    const before=snapshot([cell('FBA-ONE',['A','B']),cell('FBA-TWO',[])]);
    const after=snapshot([cell('FBA-ONE',['B','C']),cell('FBA-TWO',['D'])],2);
    expect(compareReviewSnapshots(before,after).map(c=>[c.finding.code,c.delta])).toEqual([['B','continuing'],['C','new'],['D','new'],['A','resolved']]);
  });
  it.each(['absent','incomplete','asin','type','missing-asin'])('does not mistake %s evidence for resolution', reason=>{
    const before=snapshot([cell('FBA-ONE',['A'],true,'original',reason==='missing-asin'?null:'B000000001')]);
    let next:ReviewCell[]=reason==='absent'?[]:[cell('FBA-ONE',[],reason!=='incomplete','changed',reason==='asin'?'B000000002':reason==='missing-asin'?null:'B000000001')];
    if(reason==='type')next=[reviewCell('content',{sellerSku:'FBA-ONE',asin:'B000000001',productType:'OTHER'},true,'changed',[])];
    expect(compareReviewSnapshots(before,snapshot(next,2)).map(c=>c.delta)).toEqual(['unknown']);
  });
  it.each(['same-time','older','scope'])('does not compare %s snapshots as a valid recheck',reason=>{
    const before=snapshot([cell('FBA-ONE',['A'])],2);
    const after=snapshot([cell('FBA-ONE',['B'])],reason==='older'?1:reason==='scope'?3:2,reason==='scope'?'other-window':null);
    expect(compareReviewSnapshots(before,after).map(c=>c.delta)).toEqual(['uncompared']);
  });
  it('does not label a newly discovered row or a previously unreadable row as a new defect',()=>{
    expect(compareReviewSnapshots(snapshot([cell('OTHER')]),snapshot([cell()],2))[0]!.delta).toBe('uncompared');
    expect(compareReviewSnapshots(snapshot([cell('FBA-ONE',[],false)]),snapshot([cell()],2))[0]!.delta).toBe('uncompared');
  });
  it('keeps running and failed rechecks observation-only and retains a comparison baseline',()=>{
    const first=snapshot([cell()]);const session=new AuditReviewSession([ready(first)]);
    session.ingest([{kind:'content',state:'running',snapshot:null,note:'running'}]);expect(session.changes('content')[0]!.delta).toBe('unknown');
    session.ingest([{kind:'content',state:'failed',snapshot:null,note:'failed'}]);expect(session.changes('content')[0]!.delta).toBe('unknown');
    session.ingest([ready(snapshot([cell('FBA-ONE',[])],2))]);expect(session.changes('content')[0]!.delta).toBe('resolved');
  });
  it('rejects late older results without replacing the newest evidence',()=>{
    const session=new AuditReviewSession([ready(snapshot([cell()],2))]);session.ingest([ready(snapshot([cell('FBA-ONE',[])],1))]);
    expect(session.getSources()[0]!.state).toBe('failed');expect(session.changes('content')[0]!.delta).toBe('unknown');
  });
});

describe('human review is separate from truth and expires with changed evidence',()=>{
  it.each(['seen','later'] as const)('records %s without clearing any finding or calling the API',value=>{
    const network=vi.fn();vi.stubGlobal('fetch',network);const first=snapshot([cell()]);const session=new AuditReviewSession([ready(first)]);const finding=first.cells[0]!.findings[0]!;
    session.mark(finding,value);expect(session.markOf(finding)).toBe(value);expect(session.getSources()[0]!.snapshot!.cells[0]!.findings).toHaveLength(1);expect(network).not.toHaveBeenCalled();
    session.mark(finding,null);expect(session.markOf(finding)).toBeNull();
  });
  it('retains the mark across identical later evidence but resets after any source-content change',()=>{
    const first=snapshot([cell()]);const session=new AuditReviewSession([ready(first)]);const finding=first.cells[0]!.findings[0]!;
    session.mark(finding,'seen');session.ingest([ready(snapshot([cell()],2))]);expect(session.markOf(finding)).toBe('seen');
    session.ingest([ready(snapshot([cell('FBA-ONE',undefined,true,'changed')],3))]);expect(session.markOf(finding)).toBeNull();
  });
  it.each(['scope','removed','identity'])('invalidates acknowledgements when %s changes',reason=>{
    const first=snapshot([cell()]);const finding=first.cells[0]!.findings[0]!;const session=new AuditReviewSession([ready(first)]);session.mark(finding,'later');
    const after=snapshot(reason==='removed'?[]:[cell('FBA-ONE',undefined,true,'original',reason==='identity'?'B000000002':'B000000001')],2,reason==='scope'?'new-options':null);
    session.ingest([ready(after)]);expect(session.markOf(finding)).toBeNull();
  });
  it('cannot mark stale captured evidence or a source still running',()=>{
    const first=snapshot([cell()]);const session=new AuditReviewSession([ready(first)]);const finding=first.cells[0]!.findings[0]!;
    session.ingest([ready(snapshot([cell('FBA-ONE',undefined,true,'changed')],2))]);session.mark(finding,'seen');expect(session.markOf(finding)).toBeNull();
    session.ingest([{kind:'content',state:'running',snapshot:null,note:''}]);session.mark(finding,'later');expect(session.markOf(finding)).toBeNull();
  });
});

function Harness({sessionKey='demo-1',sources,onOpen=()=>{}}:{sessionKey?:string;sources:ReviewSource[];onOpen?:(kind:ReviewKind,sku:string)=>void}) {
  return <AuditViewSessionProvider sessionKey={sessionKey}><AuditReviewProvider sessionKey={sessionKey} sources={sources}>
    <AuditReviewWorkbench marketplaceId={M} marketplaceLabel="US 美國站" mode="demo" onOpen={onOpen}/>
  </AuditReviewProvider></AuditViewSessionProvider>;
}
describe('review matrix interactions',()=>{
  it('renders missing sources honestly and counts two findings as one product',()=>{
    const sources=REVIEW_KINDS.map(kind=>kind==='content'?ready(snapshot([cell('FBA-ONE',['A','B'])])):{kind,state:'unrun' as const,snapshot:null,note:''});
    const html=renderToStaticMarkup(<Harness sources={sources}/>);expect(html).toContain('1 個商品 · 2 項提示');expect(html).toContain('未檢查');expect(html).not.toContain('100%');
  });
  it('marks, filters and navigates without creating a read or write request',async()=>{
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const network=vi.fn();vi.stubGlobal('fetch',network);const onOpen=vi.fn();const sources=[ready(snapshot([cell()]))];let tree!:ReactTestRenderer;
    await act(async()=>{tree=create(<Harness sources={sources} onOpen={onOpen}/>);trees.push(tree);});
    await act(async()=>{tree.root.findAllByType('button').find(n=>n.props['aria-label']==='FBA-ONE 文案 1 項提示')!.props.onClick();});
    await act(async()=>{tree.root.findAllByType('button').find(n=>n.children.join('')==='已看過'&&n.parent?.props.className==='audit-review-marks')!.props.onClick();});
    expect(tree.root.findAll(n=>n.props.className==='audit-review-table-scroll')).toHaveLength(0);
    await act(async()=>{tree.root.findAllByType('button').find(n=>n.children.join('')==='已看過'&&n.parent?.props['aria-label']==='人工處理狀態')!.props.onClick();});
    expect(tree.root.findAll(n=>n.props.className==='audit-review-table-scroll')).toHaveLength(1);
    await act(async()=>{tree.root.findAllByType('button').find(n=>n.children.join('').includes('前往文案健檢'))!.props.onClick();});
    expect(onOpen).toHaveBeenCalledWith('content','FBA-ONE');expect(network).not.toHaveBeenCalled();
    await act(async()=>{tree.update(<Harness sessionKey="demo-2" sources={sources}/>);});
    expect(tree.root.findAllByType('button').find(n=>n.children.join('')==='待查看')!.props['aria-pressed']).toBe(true);
    expect(tree.root.findAll(n=>n.props.className==='audit-review-table-scroll')).toHaveLength(1);
  });
  it('opens the existing SKU overview in audit mode without looking up an old SKU',async()=>{
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('window',{setTimeout,clearTimeout,addEventListener:vi.fn(),removeEventListener:vi.fn()});const network=vi.fn();vi.stubGlobal('fetch',network);let tree!:ReactTestRenderer;
    await act(async()=>{tree=create(<SkuCommandCenter initialMarketplaceId={M} initialSellerSku="OLD-SKU" initialView="audits" auditReview={<div>Audit view only</div>} onClose={()=>{}} onLaunch={()=>{}}/>);trees.push(tree);await new Promise(r=>setTimeout(r,50));});
    expect(JSON.stringify(tree.toJSON())).toContain('Audit view only');expect(network).not.toHaveBeenCalled();
  });
  it('contains no direct persistence, transport or write dispatch in the new review layer',async()=>{
    const paths=['audit-issue-origin.ts','audit-review-model.ts','audit-review-sources.ts','audit-review-session.tsx','components/audit-review-workbench.tsx','components/content-origin-filter.tsx'];
    for(const path of paths){const source=await readFile(new URL(`../src/renderer/src/${path}`,import.meta.url),'utf8');expect(source).not.toMatch(/\b(?:localStorage|sessionStorage|fetch|XMLHttpRequest)\s*[.(]/u);expect(source).not.toContain('/api/');}
  });
});
