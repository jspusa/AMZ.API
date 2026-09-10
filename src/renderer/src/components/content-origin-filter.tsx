import type { ContentAuditRow } from '../content-quality';
import { AUDIT_ISSUE_ORIGINS, AUDIT_ISSUE_ORIGIN_LABELS, contentRowOrigins, type AuditIssueOrigin } from '../audit-issue-origin';
export default function ContentOriginFilter({ rows, value, onChange }: {
  rows: readonly ContentAuditRow[]; value: AuditIssueOrigin | 'all'; onChange: (value: AuditIssueOrigin | 'all') => void;
}) {
  return <div className="audit-origin-filter" role="group" aria-label="依問題來源篩選">
    <span>問題來源</span><button type="button" aria-pressed={value === 'all'} onClick={() => onChange('all')}>全部</button>
    {AUDIT_ISSUE_ORIGINS.filter(origin => origin !== 'amazon').map(origin => <button key={origin} type="button"
      className={`origin-${origin}`} aria-pressed={value === origin} onClick={() => onChange(origin)}>
      {AUDIT_ISSUE_ORIGIN_LABELS[origin]} <small>{rows.filter(row => contentRowOrigins(row).includes(origin)).length}</small>
    </button>)}
  </div>;
}
