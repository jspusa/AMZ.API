import type { AuditSuiteSectionId } from '../../shared/audit-suite';
import type { ContentAuditSnapshot } from './content-quality';
import { contentIssueOrigin, type AuditIssueOrigin } from './audit-issue-origin';

export const REVIEW_KINDS = ['content', 'image', 'aplus', 'variation', 'subscription', 'businessPricing', 'advertising'] as const satisfies readonly AuditSuiteSectionId[];
export type ReviewKind = typeof REVIEW_KINDS[number];
export const REVIEW_KIND_LABELS: Record<ReviewKind, string> = {
  content: '文案', image: '圖片', aplus: 'A+', variation: '變體', subscription: '訂閱', businessPricing: 'B2B', advertising: '廣告',
};
export type ReviewFinding = Readonly<{
  id: string; kind: ReviewKind; sellerSku: string; origin: AuditIssueOrigin;
  code: string; message: string; field: string; evidence: string;
}>;
export type ReviewCell = Readonly<{
  kind: ReviewKind; sellerSku: string; asin: string | null; title: string;
  identity: string; complete: boolean; findings: readonly ReviewFinding[]; evidence: string;
}>;
export type ReviewSnapshot = Readonly<{
  kind: ReviewKind; sourceId: string; fetchedAt: string; scope: string;
  cells: readonly ReviewCell[];
}>;
export type ReviewSource = Readonly<{
  kind: ReviewKind; state: 'unrun' | 'running' | 'failed' | 'ready';
  snapshot: ReviewSnapshot | null; note: string;
}>;
export type ReviewMark = 'seen' | 'later';
export type ReviewDelta = 'new' | 'continuing' | 'resolved' | 'unknown' | 'uncompared';
export const REVIEW_DELTA_LABELS: Record<ReviewDelta, string> = {
  new: '新出現', continuing: '仍存在', resolved: '本次已消除', unknown: '本次無法判定', uncompared: '尚無可比較基準',
};
export type ReviewChange = Readonly<{ finding: ReviewFinding; delta: ReviewDelta }>;

export function exactReviewSku(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 40 && Boolean(value.trim()) &&
    !/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u.test(value);
}
/** Structured strings stay memory-only. Exact equality, not a collision-prone hash. */
export function reviewCell(kind: ReviewKind, row: {
  sellerSku: string; asin?: string | null; productType?: string; title?: string;
}, complete: boolean, facts: unknown, issues: readonly {
  code: string; origin: AuditIssueOrigin; message: string; field?: string; discriminator?: unknown;
}[]): ReviewCell {
  if (!exactReviewSku(row.sellerSku) || issues.length > 500) throw Error('無法精確整合商品身分或問題範圍');
  const identity = JSON.stringify([row.sellerSku, row.asin || null, row.productType || null]);
  const evidence = JSON.stringify([identity, complete, facts]);
  if (evidence.length > 120_000) throw Error('商品證據超出總表範圍');
  const findings = issues.map(issue => {
    const id = JSON.stringify([kind, row.sellerSku, issue.code, issue.field ?? '', issue.discriminator ?? null]);
    return { id, kind, sellerSku: row.sellerSku, origin: issue.origin, code: issue.code,
      field: issue.field ?? '', message: issue.message,
      evidence: JSON.stringify([evidence, issue.origin, issue.message]),
    };
  });
  const unique = new Map<string, ReviewFinding>();
  for (const finding of findings) {
    const previous = unique.get(finding.id);
    if (previous && previous.evidence !== finding.evidence) throw Error('同一問題的證據不一致');
    unique.set(finding.id, finding);
  }
  return { kind, sellerSku: row.sellerSku, asin: row.asin || null, title: row.title ?? '', identity, complete,
    findings: [...unique.values()], evidence };
}

export function projectContentReview(snapshot: ContentAuditSnapshot): ReviewCell[] {
  return snapshot.rows.filter(row => row.variationRole !== 'parent').map(row => {
    const unread = row.readStatus !== 'complete';
    const complete = !unread && !row.issues.some(issue => issue.kind === 'INGREDIENTS_UNVERIFIED');
    return reviewCell('content', row, complete,
      [row.title, row.itemHighlight, row.bulletPoints, row.productDescription, row.ingredients,
        row.variationRole, row.relationshipStatus, row.issues],
      unread
        ? [{ code: 'CONTENT_READ_INCOMPLETE', origin: 'unread', message: row.readErrors.map(e => e.message).join('；') || '文案尚未完整讀取' }]
        : row.issues.map(issue => ({ code: issue.kind, origin: contentIssueOrigin(issue), message: issue.message,
            field: issue.field, discriminator: [issue.bulletIndex ?? null, issue.token ?? null] })),
    );
  });
}

export function sealReviewSnapshot(kind: ReviewKind, marketplace: string, mode: string, data: {
  fetchedAt: string; exportId?: string | null;
}, cells: readonly ReviewCell[], options: unknown = null): ReviewSnapshot {
  if (!Number.isFinite(Date.parse(data.fetchedAt)) || cells.length > 5_000 ||
      new Set(cells.map(cell => cell.sellerSku)).size !== cells.length) throw Error('總表資料時間、範圍或 SKU 重複');
  return { kind, fetchedAt: data.fetchedAt,
    sourceId: JSON.stringify([data.fetchedAt, data.exportId ?? null]),
    scope: JSON.stringify(['review-v1', marketplace, mode, kind, options]), cells };
}

/** Absence is resolved only with a positively identified, completely read current row. */
export function compareReviewSnapshots(previous: ReviewSnapshot | null, current: ReviewSnapshot): ReviewChange[] {
  const comparable = previous?.scope === current.scope &&
    Date.parse(previous.fetchedAt) < Date.parse(current.fetchedAt) ? previous : null;
  const before = new Map(comparable?.cells.map(cell => [cell.sellerSku, cell]));
  const after = new Map(current.cells.map(cell => [cell.sellerSku, cell]));
  const changes: ReviewChange[] = [];
  for (const cell of current.cells) {
    const prior = before.get(cell.sellerSku);
    const sameIdentity = prior?.identity === cell.identity;
    for (const finding of cell.findings) {
      const existed = sameIdentity && prior?.findings.some(old => old.id === finding.id);
      changes.push({ finding, delta: existed ? 'continuing' : sameIdentity && prior?.complete ? 'new' : 'uncompared' });
    }
  }
  for (const prior of before.values()) {
    const cell = after.get(prior.sellerSku);
    for (const finding of prior.findings) {
      if (cell?.identity === prior.identity && cell.findings.some(item => item.id === finding.id)) continue;
      changes.push({ finding, delta: cell?.complete && cell.identity === prior.identity && Boolean(cell.asin)
        ? 'resolved' : 'unknown' });
    }
  }
  return changes;
}

export type ReviewProduct = Readonly<{
  sellerSku: string; title: string; cells: Partial<Record<ReviewKind, ReviewCell>>; findingCount: number; identityConflict: boolean;
}>;
export function reviewProducts(sources: readonly ReviewSource[]): ReviewProduct[] {
  const products = new Map<string, { sellerSku: string; title: string; cells: Partial<Record<ReviewKind, ReviewCell>>; findingCount: number; identityConflict: boolean }>();
  for (const source of sources) {
    if (source.state !== 'ready' || !source.snapshot) continue;
    for (const cell of source.snapshot.cells) {
      const product = products.get(cell.sellerSku) ?? { sellerSku: cell.sellerSku, title: '', cells: {}, findingCount: 0, identityConflict: false };
      if (!product.title && cell.title) product.title = cell.title;
      product.cells[cell.kind] = cell;
      product.findingCount += cell.findings.length;
      product.identityConflict = new Set(Object.values(product.cells).map(item => item?.asin).filter(Boolean)).size > 1;
      products.set(cell.sellerSku, product);
    }
  }
  return [...products.values()].sort((a, b) => b.findingCount - a.findingCount || a.sellerSku.localeCompare(b.sellerSku));
}

/** Bounded per-Dashboard review state. Never an Amazon decision, job owner or persistent cache. */
export class AuditReviewSession {
  private sources: readonly ReviewSource[];
  private previous = new Map<ReviewKind, ReviewSnapshot>();
  private latest = new Map<ReviewKind, ReviewSnapshot>();
  private marks = new Map<string, { evidence: string; value: ReviewMark }>();
  private listeners = new Set<() => void>();
  private revision = 0;
  constructor(sources: readonly ReviewSource[]) { this.sources = []; this.ingest(sources); }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getRevision = () => this.revision;
  getSources = () => this.sources;
  private changed() { this.revision++; this.listeners.forEach(listener => listener()); }
  ingest(sources: readonly ReviewSource[]) {
    if (sources === this.sources) return;
    this.sources = sources.map(source => {
      const next = source.snapshot;
      if (source.state !== 'ready' || !next) return source;
      const last = this.latest.get(source.kind);
      if (last && Date.parse(next.fetchedAt) < Date.parse(last.fetchedAt)) {
        return { ...source, state: 'failed', snapshot: null, note: '收到較舊結果，未用來判定問題已解決' };
      }
      if (last && last.sourceId !== next.sourceId) {
        if (last.scope === next.scope) this.previous.set(source.kind, last);
        else this.previous.delete(source.kind);
      }
      this.latest.set(source.kind, next);
      // Source changes invalidate acknowledgements even if the same issue later returns.
      const current = new Map(next.cells.flatMap(cell => cell.findings.map(finding => [finding.id, finding.evidence] as const)));
      const lastIds = new Set(last?.cells.flatMap(cell => cell.findings.map(f => f.id)));
      for (const [id, mark] of this.marks) {
        if (lastIds.has(id) && (last?.scope !== next.scope || current.get(id) !== mark.evidence)) this.marks.delete(id);
      }
      return source;
    });
    this.changed();
  }
  changes(kind: ReviewKind): ReviewChange[] {
    const source = this.sources.find(item => item.kind === kind);
    if (source?.state === 'ready' && source.snapshot) return compareReviewSnapshots(this.previous.get(kind) ?? null, source.snapshot);
    return (this.latest.get(kind)?.cells.flatMap(cell => cell.findings) ?? []).map(finding => ({ finding, delta: 'unknown' }));
  }
  baseline(kind: ReviewKind): ReviewSnapshot | null { return this.previous.get(kind) ?? null; }
  markOf(finding: ReviewFinding): ReviewMark | null {
    const mark = this.marks.get(finding.id);
    return mark?.evidence === finding.evidence ? mark.value : null;
  }
  mark(finding: ReviewFinding, value: ReviewMark | null) {
    const source = this.sources.find(item => item.kind === finding.kind);
    const live = source?.state === 'ready' && source.snapshot?.cells.find(cell => cell.sellerSku === finding.sellerSku)?.findings.find(item => item.id === finding.id);
    if (!live || live.evidence !== finding.evidence) return;
    if (value === null) this.marks.delete(finding.id);
    else {
      this.marks.delete(finding.id); this.marks.set(finding.id, { evidence: finding.evidence, value });
      if (this.marks.size > 5_000) this.marks.delete(this.marks.keys().next().value!);
    }
    this.changed();
  }
}
