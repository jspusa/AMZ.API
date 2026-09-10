import { Fragment, useMemo, useRef } from 'react';
import { useAuditReview } from '../audit-review-session';
import { useAuditMemoryState, useAuditPosition, useAuditViewMemory, auditViewScope } from '../audit-view-session';
import AuditSkuFilter, { useAuditSkuBatch } from './audit-sku-filter';
import { AUDIT_ISSUE_ORIGINS, AUDIT_ISSUE_ORIGIN_LABELS, type AuditIssueOrigin } from '../audit-issue-origin';
import { REVIEW_KINDS, REVIEW_KIND_LABELS, REVIEW_DELTA_LABELS, reviewProducts,
  type ReviewKind, type ReviewFinding, type ReviewDelta } from '../audit-review-model';

type WorkFilter = 'todo' | 'seen' | 'later' | 'all';
const WORK_LABELS: Record<WorkFilter, string> = { todo: '待查看', seen: '已看過', later: '稍後處理', all: '全部' };
function time(value: string) { return new Date(value).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }); }

export default function AuditReviewWorkbench({ marketplaceId, marketplaceLabel, mode, onOpen }: {
  marketplaceId: string; marketplaceLabel: string; mode: 'live' | 'demo'; onOpen: (kind: ReviewKind, sellerSku: string) => void;
}) {
  const session = useAuditReview();
  const memory = useAuditViewMemory();
  const sources = session.getSources();
  const products = useMemo(() => reviewProducts(sources), [sources]);
  const scope = auditViewScope('review-workbench', marketplaceId, mode, 'current-session');
  const [tab, setTab] = useAuditMemoryState<'products' | 'changes'>(scope, 'tab', 'products');
  const [work, setWork] = useAuditMemoryState<WorkFilter>(scope, 'work', 'todo');
  const [origin, setOrigin] = useAuditMemoryState<AuditIssueOrigin | 'all'>(scope, 'origin', 'all');
  const [query, setQuery] = useAuditMemoryState(scope, 'query', '');
  const [selected, setSelected] = useAuditMemoryState<{ sku: string; kind: ReviewKind } | null>(scope, 'selected', null);
  const [pageIndex, setPageIndex] = useAuditMemoryState(scope, 'page', 0);
  const [delta, setDelta] = useAuditMemoryState<ReviewDelta | 'all'>(scope, 'delta', 'all');
  const batch = useAuditSkuBatch(scope);
  const rootRef = useAuditPosition(scope, true);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const matchFinding = (finding: ReviewFinding) => (origin === 'all' || finding.origin === origin) && (
    work === 'all' || (work === 'todo' ? session.markOf(finding) === null : session.markOf(finding) === work));
  const matchesSearch = (sku: string, title = '') => batch.matches(sku) &&
    (!query.trim() || `${sku} ${title}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const filtered = products.filter(product => matchesSearch(product.sellerSku, product.title) && (
    work === 'all' && origin === 'all' || Object.values(product.cells).some(cell => cell?.findings.some(matchFinding))));
  const changes = REVIEW_KINDS.flatMap(kind => session.changes(kind)).filter(change =>
    matchesSearch(change.finding.sellerSku) && (origin === 'all' || origin === change.finding.origin) &&
    (delta === 'all' || change.delta === delta));
  const currentFindings = products.flatMap(product => Object.values(product.cells).flatMap(cell => cell?.findings ?? []));
  const count = tab === 'products' ? filtered.length : changes.length;
  const pages = Math.max(1, Math.ceil(count / 25));
  const page = Math.min(pageIndex, pages - 1);
  const openSource = (kind: ReviewKind, sku: string) => {
    const source = sources.find(item => item.kind === kind);
    if (source?.state !== 'ready' || !source.snapshot?.cells.some(cell => cell.sellerSku === sku)) return;
    const target = auditViewScope(kind, marketplaceId, mode, source.snapshot.fetchedAt);
    memory?.write(`${target}:sku-batch`, [sku]);
    memory?.write(`${target}:sku-batch-draft`, sku);
    memory?.write(`${target}:query`, '');
    memory?.write(`${target}:filter`, 'all');
    memory?.write(`${target}:origin-filter`, 'all');
    memory?.write(`${target}:page`, 1);
    onOpen(kind, sku);
  };
  const markedButtons = (finding: ReviewFinding) => <div className="audit-review-marks" role="group" aria-label={`${finding.sellerSku} ${finding.code} 人工標記`}>
    {(['seen', 'later'] as const).map(value => <button type="button" key={value} aria-pressed={session.markOf(finding) === value}
      onClick={() => session.mark(finding, session.markOf(finding) === value ? null : value)}>{WORK_LABELS[value]}</button>)}
  </div>;
  const setPage = (next: number) => { setPageIndex(next); headingRef.current?.scrollIntoView({ block: 'start' }); headingRef.current?.focus({ preventScroll: true }); };
  return <section className="audit-review-workbench" ref={rootRef} aria-label="商品健檢總表">
    <header className="audit-review-heading"><div><h3 ref={headingRef} tabIndex={-1}>商品健檢總表</h3><p>{marketplaceLabel}{mode === 'demo' ? ' · 展示資料' : ''} · {products.length} 個商品 · {currentFindings.length} 項提示</p></div>
      <div className="audit-review-tabs" role="group" aria-label="總表檢視"><button type="button" aria-pressed={tab === 'products'} onClick={() => { setTab('products'); setPageIndex(0); }}>商品總表</button>
      <button type="button" aria-pressed={tab === 'changes'} onClick={() => { setTab('changes'); setPageIndex(0); }}>本次重檢差異</button></div>
    </header>
    <details className="audit-review-sources"><summary>資料範圍與時間 · {sources.filter(s => s.state === 'ready').length}／7 項已有結果</summary>
      <p>只整理本次已讀取的結果；不同健檢可能涵蓋不同商品。空白不代表正常，人工標記不改變健檢或寫入判定。標記與比較基準僅保留在當次介面，重新載入即清除。</p>
      <div>{sources.map(source => <span key={source.kind}><strong>{REVIEW_KIND_LABELS[source.kind]}</strong> {source.state === 'ready' && source.snapshot ? time(source.snapshot.fetchedAt) : source.state === 'running' ? '執行中' : source.state === 'failed' ? '未完成' : '尚未檢查'}{source.note && <small>{source.note}</small>}</span>)}</div>
      <p>「Amazon 回報」只採用可驗證的原始狀態，例如 A+ 文件 REJECTED；沒有這類回報不代表帳號無違規。AMZ.API 自訂門檻不是 Amazon 官方違規判定。</p>
    </details>
    <div className="audit-origin-filter" role="group" aria-label="總表問題來源">
      <button type="button" aria-pressed={origin === 'all'} onClick={() => { setOrigin('all'); setPageIndex(0); }}>全部來源</button>
      {AUDIT_ISSUE_ORIGINS.map(value => <button type="button" key={value} className={`origin-${value}`} aria-pressed={origin === value} onClick={() => { setOrigin(value); setPageIndex(0); }}>
        {AUDIT_ISSUE_ORIGIN_LABELS[value]} <small>{currentFindings.filter(finding => finding.origin === value).length} 項</small></button>)}
    </div>
    <div className="audit-review-toolbar"><label><span className="sr-only">搜尋健檢總表</span><input aria-label="搜尋健檢總表" placeholder="搜尋 SKU 或商品名稱" value={query} onChange={e => { setQuery(e.target.value); setPageIndex(0); }} /></label>
      {tab === 'products' ? <div role="group" aria-label="人工處理狀態">{(['todo', 'seen', 'later', 'all'] as const).map(value => <button type="button" key={value} aria-pressed={work === value} onClick={() => { setWork(value); setPageIndex(0); }}>{WORK_LABELS[value]}</button>)}</div> :
        <label><span className="sr-only">差異分類</span><select aria-label="差異分類" value={delta} onChange={e => { setDelta(e.target.value as ReviewDelta | 'all'); setPageIndex(0); }}><option value="all">全部差異</option>{Object.entries(REVIEW_DELTA_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>}
    </div>
    <AuditSkuFilter scope={scope} skus={batch.skus} availableSkus={products.map(product => product.sellerSku)} onChange={skus => { batch.setSkus(skus); setPageIndex(0); }} />
    {tab === 'products' && (filtered.length ? <div className="audit-review-table-scroll" tabIndex={0} role="region" aria-label="各商品七項健檢結果">
      <table><caption className="sr-only">點選健檢欄位查看提示與人工標記；未列入該結果的商品顯示無本列資料。</caption><thead><tr><th scope="col">商品／Seller SKU</th>{REVIEW_KINDS.map(kind => <th scope="col" key={kind}>{REVIEW_KIND_LABELS[kind]}</th>)}</tr></thead><tbody>
        {filtered.slice(page * 25, page * 25 + 25).map(product => <Fragment key={product.sellerSku}>
          <tr><th scope="row"><code>{product.sellerSku}</code><small>{product.title}</small>{product.identityConflict && <small className="audit-review-identity-warning">各來源 ASIN 不一致，請逐項核對</small>}</th>{REVIEW_KINDS.map(kind => {
            const source = sources.find(item => item.kind === kind);
            const cell = product.cells[kind];
            const opened = selected?.sku === product.sellerSku && selected.kind === kind;
            return <td key={kind}>{cell ? <button type="button" className={`audit-review-cell ${!cell.complete ? 'is-incomplete' : cell.findings.length ? 'has-findings' : 'is-clear'}`}
              aria-label={`${product.sellerSku} ${REVIEW_KIND_LABELS[kind]} ${cell.findings.length} 項提示`} aria-expanded={opened}
              onClick={() => setSelected(opened ? null : { sku: product.sellerSku, kind })}>
              {cell.findings.length ? `${cell.findings.length} 項提示` : cell.complete ? '已核對' : '未完整'}
              {cell.findings.some(f => session.markOf(f) === 'later') && <small>有稍後項目</small>}
            </button> : <span className="audit-review-unknown" aria-label={source?.state === 'ready' ? '無本列資料，不能判定正常' : undefined}>{source?.state === 'ready' ? '—' : source?.state === 'running' ? '執行中' : source?.state === 'failed' ? '未完成' : '未檢查'}</span>}</td>;
          })}</tr>
          {selected?.sku === product.sellerSku && product.cells[selected.kind] && <tr className="audit-review-detail-row"><td colSpan={8}>
            <section className="audit-review-detail" aria-label={`${product.sellerSku} 提示明細`}>
              <header><div><strong>{product.sellerSku} · {REVIEW_KIND_LABELS[selected.kind]}</strong><small>ASIN：{product.cells[selected.kind]!.asin ?? "未提供"} · {time(sources.find(source => source.kind === selected.kind)!.snapshot!.fetchedAt)}</small></div><button type="button" onClick={() => openSource(selected.kind, product.sellerSku)}>前往{REVIEW_KIND_LABELS[selected.kind]}健檢 →</button></header>
              {product.cells[selected.kind]!.findings.length === 0 ? <p>這份結果在已核對範圍內沒有提示；不是所有 Amazon 政策或銷售狀態的保證。</p> :
                product.cells[selected.kind]!.findings.map(finding => <article key={finding.id} className="audit-review-finding">
                  <div><span className={`audit-origin-badge origin-${finding.origin}`}>{AUDIT_ISSUE_ORIGIN_LABELS[finding.origin]}</span>{finding.field && <small>{finding.field}</small>}<p>{finding.message}</p></div>{markedButtons(finding)}
                </article>)}
            </section>
          </td></tr>}
        </Fragment>)}
      </tbody></table>
    </div> : <div className="audit-review-empty"><strong>{products.length ? '目前篩選下沒有項目' : '尚無可整合的健檢結果'}</strong><p>{products.length ? '可切換「全部」或清除篩選；已看過不等於問題已解決。' : '返回首頁執行需要的健檢，完成後即可在這裡整理，不會自動重新掃描。'}</p></div>)}
    {tab === 'changes' && <div className="audit-review-changes"><p className="audit-review-note">只比較同次介面、同站點與同範圍的前後結果。商品消失、讀取未完成或身分改變，均不算已解決。</p>
      {changes.length ? changes.slice(page * 25, page * 25 + 25).map((change, index) => <article className="audit-review-change" key={`${change.finding.id}-${change.delta}-${index}`}>
        <span className={`audit-review-delta delta-${change.delta}`}>{REVIEW_DELTA_LABELS[change.delta]}</span><div><strong>{change.finding.sellerSku} · {REVIEW_KIND_LABELS[change.finding.kind]}</strong><p>{change.finding.message}</p></div>
      </article>) : <div className="audit-review-empty"><strong>目前沒有可顯示的差異</strong><p>需保留同次使用的前一份結果，再回原健檢按「重新健檢」。首次結果不會全算成新問題。</p></div>}
    </div>}
    {count > 0 && <nav className="audit-review-pagination" aria-label="總表分頁"><span role="status">{tab === 'products' ? `${count} 個商品` : `${count} 項提示`} · 第 {page + 1}／{pages} 頁</span>
      <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>上一頁</button><button type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>下一頁</button></nav>}
  </section>;
}
