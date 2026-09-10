import type { ContentAuditIssue, ContentAuditRow } from './content-quality';

export type AuditIssueOrigin = 'amazon' | 'unread' | 'review' | 'suggestion';
export const AUDIT_ISSUE_ORIGINS: readonly AuditIssueOrigin[] = ['amazon', 'unread', 'review', 'suggestion'];
export const AUDIT_ISSUE_ORIGIN_LABELS: Record<AuditIssueOrigin, string> = {
  amazon: 'Amazon 回報', unread: '資料未完整', review: '待人工判斷', suggestion: 'AMZ.API 優化建議',
};
/** amazon-content describes where the text came from, NOT an Amazon ruling. */
export function contentIssueOrigin(issue: Pick<ContentAuditIssue, 'kind' | 'source'>): AuditIssueOrigin {
  switch (issue.kind) {
    case 'INGREDIENTS_UNVERIFIED': return 'unread';
    case 'SUSPECTED_TYPO':
    case 'SINGLE_INGREDIENT_MISMATCH': return 'review';
    case 'MISSING_BULLETS':
    case 'MISSING_INGREDIENTS':
    case 'TITLE_BELOW_TARGET':
    case 'HIGHLIGHT_BELOW_TARGET':
    case 'BULLET_BELOW_TARGET':
    case 'BULLET_ABOVE_TARGET':
    case 'DESCRIPTION_BELOW_TARGET': return 'suggestion';
    default: return 'review';
  }
}
export function contentRowOrigins(row: ContentAuditRow): AuditIssueOrigin[] {
  return [...new Set<AuditIssueOrigin>([
    ...(row.readStatus !== 'complete' ? ['unread' as const] : []),
    ...row.issues.map(contentIssueOrigin),
  ])];
}
