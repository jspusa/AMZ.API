import { parseContentAuditSnapshot } from './components/content-audit-panel';
import { parseImageAuditSnapshot } from './image-audit';
import { parseAplusAuditSnapshot, type AplusAuditJobTerminal, type AplusAuditJobReceipt } from './a-plus-audit';
import { parseUnboundVariationAuditSnapshot } from './unbound-variation-audit';
import { parseSubscriptionAuditSnapshot } from './subscription-audit';
import { subscriptionAuditDisplayRows } from './components/subscription-audit-panel';
import { businessPricingRowMatchesFilter, parseBusinessPricingAuditSnapshot } from './business-pricing-audit';
import { parseAdvertisingCoverageSnapshot } from './advertising-coverage';
import type { StandaloneAuditJob } from './standalone-audit';
import { projectContentReview, reviewCell, sealReviewSnapshot, REVIEW_KINDS, type ReviewKind, type ReviewSnapshot, type ReviewSource } from './audit-review-model';

type ReviewJob = StandaloneAuditJob | AplusAuditJobReceipt | AplusAuditJobTerminal;
export type ReviewSourceInput = Readonly<{
  marketplaceId: string; mode: 'live' | 'demo'; jobs: Readonly<Record<string, StandaloneAuditJob>>;
  aplusJob: AplusAuditJobReceipt | AplusAuditJobTerminal | null;
  blockedKinds: readonly ReviewKind[];
}>;
function root(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('總表來源不是快照');
  return value as Record<string, unknown>;
}
/** Only project an already completed, context-fenced main job; never fetch or launch here. */
export function projectReviewSnapshot(kind: ReviewKind, raw: unknown, marketplaceId: string, mode: 'live' | 'demo', options: unknown = null): ReviewSnapshot {
  const source = root(raw);
  if (source.marketplaceId !== marketplaceId || (source.mode !== undefined && source.mode !== mode)) throw Error('總表來源脈絡不符');
  switch (kind) {
    case 'content': {
      const snapshot = parseContentAuditSnapshot(raw, marketplaceId);
      return sealReviewSnapshot(kind, marketplaceId, mode, snapshot, projectContentReview(snapshot));
    }
    case 'image': {
      const snapshot = parseImageAuditSnapshot(raw, marketplaceId);
      return sealReviewSnapshot(kind, marketplaceId, mode, snapshot, snapshot.rows.map(row => reviewCell(kind, row,
        row.readStatus === 'complete', [row.imageUrls, row.imageCount, snapshot.minimumImages, row.readErrors],
        row.readStatus !== 'complete'
          ? [{ code: 'IMAGE_READ_INCOMPLETE', origin: 'unread', message: row.readErrors.map(e => e.message).join('；') || '圖片尚未完整讀取' }]
          : row.imageCount < snapshot.minimumImages
            ? [{ code: 'IMAGE_BELOW_TARGET', origin: 'suggestion', message: `目前 ${row.imageCount} 張；AMZ.API 建議至少 ${snapshot.minimumImages} 張，並非 Amazon 下架判定` }]
            : [],
      )));
    }
    case 'aplus': {
      const snapshot = parseAplusAuditSnapshot(raw, marketplaceId, mode);
      return sealReviewSnapshot(kind, marketplaceId, mode, snapshot, snapshot.rows.map(row => {
        const complete = row.sourceCompleteness === 'complete' && ['published', 'missing'].includes(row.status) && row.documentEvidenceCompleteness === 'complete';
        const issues: Parameters<typeof reviewCell>[4][number][] = [];
        if (!complete) issues.push({ code: 'APLUS_READ_INCOMPLETE', origin: 'unread', message: `A+ 文件或關聯證據尚未完整${row.reason ? `；${row.reason}` : ''}` });
        if (row.status === 'missing' && complete) issues.push({ code: 'APLUS_MISSING', origin: 'suggestion', message: '未找到已發布 A+；可評估是否補齊，不代表商品無法銷售' });
        row.documents.forEach(document => {
          if (document.documentStatus === 'REJECTED' && document.completeness === 'complete') issues.push({
            code: 'APLUS_DOCUMENT_REJECTED', origin: 'amazon', field: 'A+ 文件', discriminator: document.name,
            message: `${document.name ?? 'A+ 文件'}：Amazon 文件狀態為 REJECTED；不等同目前 Listing 無法銷售`,
          });
        });
        return reviewCell(kind, row, complete, [row.status, row.sourceCompleteness, row.documentEvidenceCompleteness, row.documents, row.reasonCode], issues);
      }));
    }
    case 'variation': {
      const snapshot = parseUnboundVariationAuditSnapshot(raw, marketplaceId);
      const cells = snapshot.rows.map(row => reviewCell(kind, row, true, [row.relationshipEvidence, row.productType], [{
        code: 'STANDALONE_PRODUCT', origin: 'suggestion', message: '已確認為獨立商品；只有合適的同系列商品才需評估綁定變體',
      }]));
      cells.push(...snapshot.incompleteRows.map(row => reviewCell(kind, row, false, [row.code, row.message], [{
        code: 'VARIATION_READ_INCOMPLETE', origin: 'unread', message: row.message,
      }])));
      cells.push(...snapshot.allVariationRows.filter(row => row.role === 'child' && row.evidence === 'verified-child').map(row =>
        reviewCell(kind, row, true, [row.familySku, row.variationTheme, row.evidence], [])));
      return sealReviewSnapshot(kind, marketplaceId, mode, snapshot, cells);
    }
    case 'subscription': {
      const snapshot = parseSubscriptionAuditSnapshot(raw);
      const expectedMonths = root(options ?? {}).months;
      if (expectedMonths !== undefined && expectedMonths !== snapshot.requestedMonths) throw Error('訂閱期間不符');
      const cells = subscriptionAuditDisplayRows(snapshot).map(row => {
        const offer = row.offer;
        const readGap = !offer || offer.sellerFundedBaseDiscount === null || snapshot.excluded.some(e => e.sellerSku === row.sellerSku) ||
          snapshot.upstreamCoverage.problemSkuRows.some(e => e.sellerSku === row.sellerSku);
        const metricGap = !offer || offer.monthlySeries.length !== snapshot.intervals.length ||
          offer.monthlySeries.some(point => point.subscriptionRevenue === null || point.shippedSubscriptionUnits === null || point.activeSubscriptionsAtPeriodEnd === null);
        const issues: Parameters<typeof reviewCell>[4][number][] = [];
        if (row.problem) issues.push({ code: readGap ? 'SUBSCRIPTION_READ_INCOMPLETE' : 'SUBSCRIPTION_DISCOUNT_REVIEW', origin: readGap ? 'unread' : 'review', message: row.problem });
        if (metricGap) issues.push({ code: 'SUBSCRIPTION_HISTORY_INCOMPLETE', origin: 'unread', message: '所選期間仍有未回傳的訂閱指標；不補零' });
        return reviewCell(kind, { sellerSku: row.sellerSku, asin: offer?.asin }, !readGap && !metricGap,
          [offer?.sellerFundedBaseDiscount, offer?.sellerFundedTieredDiscount, offer?.monthlySeries, row.problem], issues);
      });
      return sealReviewSnapshot(kind, marketplaceId, mode, snapshot, cells, [snapshot.requestedMonths, snapshot.intervals]);
    }
    case 'businessPricing': {
      const snapshot = parseBusinessPricingAuditSnapshot(raw);
      return sealReviewSnapshot(kind, marketplaceId, mode, snapshot, snapshot.rows.map(row => {
        const incomplete = businessPricingRowMatchesFilter(row, 'incomplete');
        const missing = businessPricingRowMatchesFilter(row, 'missing');
        const problem = businessPricingRowMatchesFilter(row, 'problem');
        const issues: Parameters<typeof reviewCell>[4] = incomplete
          ? [{ code: 'B2B_READ_INCOMPLETE', origin: 'unread', message: row.reason || '必要價格證據未完整' }]
          : missing ? [{ code: 'B2B_NOT_SET', origin: 'suggestion', message: '尚未設定 Business Price；可依營運需求評估，不代表違規' }]
            : problem ? [{ code: 'B2B_RECOMMENDATION', origin: 'suggestion', message: row.reason || '與 AMZ.API 的 B2B 價格或數量折扣建議不同' }] : [];
        return reviewCell(kind, row, !incomplete,
          [row.standardPrice, row.businessPrice, row.quantityDiscountPlan, row.status, row.recommendedPriceMismatch, row.recommendedQuantityDiscountMismatch], issues);
      }));
    }
    case 'advertising': {
      const snapshot = parseAdvertisingCoverageSnapshot(raw, marketplaceId);
      return sealReviewSnapshot(kind, marketplaceId, mode, snapshot, snapshot.rows.map(row => reviewCell(kind, row, true,
        [row.covered, row.evidence?.kind ?? null, snapshot.rule], row.covered ? [] : [{
          code: 'ADVERTISING_NOT_COVERED', origin: 'suggestion', message: '本次未找到符合現有規則的廣告覆蓋；是否投放由你決定',
        }])));
    }
  }
}

/** Cache at most seven projected sources inside one mounted UI session. */
export class ReviewSourceProjector {
  private cache = new Map<ReviewKind, { raw: unknown; context: string; snapshot: ReviewSnapshot }>();
  read(input: ReviewSourceInput): ReviewSource[] {
    return REVIEW_KINDS.map(kind => {
      const job: ReviewJob | undefined | null = kind === 'aplus' ? input.aplusJob :
        Object.values(input.jobs).find(item => item.kind === kind && item.marketplaceId === input.marketplaceId && item.mode === input.mode);
      const empty = (state: ReviewSource['state'], note = ''): ReviewSource => ({ kind, state, snapshot: null, note });
      if (input.blockedKinds.includes(kind)) return empty('failed', '本次啟動未完成，未採用舊結果');
      if (!job || job.marketplaceId !== input.marketplaceId || job.mode !== input.mode) return empty('unrun');
      if (!job.ready) return empty('running', '健檢仍在執行，不以舊資料代替');
      if (job.status !== 'completed') return empty('failed', '本次健檢未完成，請到原健檢查看原因');
      try {
        const options = 'options' in job ? job.options : null;
        const context = JSON.stringify([input.marketplaceId, input.mode, options]);
        const cached = this.cache.get(kind);
        const snapshot = cached && cached.raw === job.snapshot && cached.context === context ? cached.snapshot :
          projectReviewSnapshot(kind, job.snapshot, input.marketplaceId, input.mode, options);
        this.cache.set(kind, { raw: job.snapshot, context, snapshot });
        return { kind, state: 'ready', snapshot, note: '' };
      } catch {
        return empty('failed', '這份結果無法完整整合，請到原健檢查看；未當成正常');
      }
    });
  }
}
