import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {brotliDecompressSync,constants} from 'node:zlib';
const chunks=readdirSync('.github').filter(n=>/^efficiency-transport-\d+\.b64$/.test(n)).sort();
assert.equal(chunks.length,9,'Expected the nine previously staged payload segments');
const bytes=Buffer.from(chunks.map(n=>readFileSync('.github/'+n,'utf8')).join(''),'base64');
// The previous transport stopped inside CSS04. Recover only complete, inspected hunks.
const source=brotliDecompressSync(bytes,{finishFlush:constants.BROTLI_OPERATION_FLUSH}).toString('utf8');
const cutoff=source.lastIndexOf('diff --git a/tests/css04-stylesheet-extraction.test.ts');
assert.ok(cutoff>0);const patch=source.slice(0,cutoff);
assert.equal(createHash('sha256').update(patch).digest('hex'),'afd4015cbb21c819f7515facbe93d9a3d6a3e9443af20fa2ccbff7920e565c76');
execFileSync('git',['apply','--check','--unidiff-zero','-'],{input:patch});
execFileSync('git',['apply','--unidiff-zero','-'],{input:patch});
function replace(path,old,next){const s=readFileSync(path,'utf8');assert.ok(s.includes(old),'Missing expected source in '+path);writeFileSync(path,s.replace(old,next));}
const css04='tests/css04-stylesheet-extraction.test.ts';
replace(css04,'  "styles/chart-compact.css",','  "styles/chart-compact.css",\n  "styles/workflow-efficiency.css",');
replace(css04,'8f7fd5afa1f51c0f47e34df28f0f5b9bd16f3e39866f78cff24859ddf2d5bace','73c8feb78a4ae333549f9ec31e817392f381eac3989f0920370fa3985b4acc0f');
replace(css04,'toBe(28922)','toBe(29071)');replace(css04,'toBe(832560)','toBe(840363)');
replace('tests/image-audit.test.ts','void loadSku(sellerSku)','void loadSku(sellerSku, true)');
for(const name of readdirSync('src/renderer/src/components').filter(n=>n.endsWith('.tsx'))){
 const path='src/renderer/src/components/'+name,s=readFileSync(path,'utf8');
 if((s.match(/\buseAuditMemoryState\b/g)||[]).length===1)writeFileSync(path,s.replace(/, useAuditMemoryState\b/u,'').replace(/\buseAuditMemoryState, /u,''));
}
const record=`# Frontend workflow efficiency — verification record

Baseline main: \`4a3d08d829ffd2c1988492b6efc6bd60e86169f8\`.
Approved scope: [spec](../specs/2026-09-frontend-workflow-efficiency.md).

## Scope
Renderer components, bounded memory-only display helpers, styles, build-time UI
metadata and tests. Package remains 0.1.63. No main/preload/shared API, credential,
write-ticket, installer, update-channel or live Amazon operation changes.

The previous transport was incomplete. Only hash-verified complete source hunks
were recovered; missing CSS04 evidence and behavior tests were completed and
reviewed. Temporary transport/workflow files must be removed before merge.

The loaded web UI build and installed Notebook Key version are distinct.
Safe reload is allowed only after returning home, asks for confirmation and
rechecks its guard. No automatic update, online lookup or cache-clearing claim.
Nine audit surfaces share exact, bounded SKU filtering and snapshot-scoped view
memory. Content, images and B2B provide a filtered previous/next queue, operation
locks and confirmation before discarding unsent drafts. Display-only filtering
neither changes the original export scope nor starts an Amazon request.

## Verification
- Local Node 24: npm run check passed; 300 files, 3,438 tests, TypeScript and
  production build; source/build stylesheet identity matched.
- Added 29 focused tests for identifier fidelity, input limits, in-memory scope,
  queued navigation and guarded reload; no browser persistence introduced.
- Offline Chromium: 9 audit result pages x 2 widths x 4 themes = 72 non-overflow
  cases, and all nine batch filters made zero additional Bridge requests.
- Content, images and B2B: cancel preserves drafts; confirm selects the next
  exact SKU; content returns to the saved 350px list position. Safe reload is
  blocked while an audit is open. No writes or write previews were invoked.
- Online CI check, dependency audit, browser results and exact source/artifact
  evidence are captured by the temporary verification job, then final PR checks.
- Final merge SHA, Pages deployment and public byte verification are recorded
  separately in the PR. CI/build success alone does not prove deployment.

## Limits
Local browser checks used the emitted UI flattened solely for an offline fixture
because this environment blocks localhost navigation; this is not production
origin/CSP verification. All data were synthetic. No live Amazon account,
Touch ID, Windows Hello, installed upgrade or user credentials were exercised.
Operational view state is in memory for this session only and cleared at context
changes; it is not cross-day history or cross-computer synchronization.
`;
writeFileSync('docs/releases/2026-09-frontend-workflow-efficiency.md',record);
execFileSync('git',['diff','--check'],{stdio:'inherit'});
console.log('Recovered inspected frontend hunks and completed exact source contracts.');
