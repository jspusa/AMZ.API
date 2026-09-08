import type { AuditSuiteSectionId } from "../../../shared/audit-suite";

type State = "idle" | "running" | "success" | "partial" | "failed";
export type HomeAuditEntry = { id: AuditSuiteSectionId; state: State; attention: number | null };

/** Count audit categories, never sum heterogeneous issues as unique SKUs. */
export function groupHomeAudits(entries: readonly HomeAuditEntry[]) {
  const groups: Record<"attention" | "running" | "completed" | "idle", HomeAuditEntry[]> = {
    attention: [], running: [], completed: [], idle: [],
  };
  for (const entry of entries) {
    const group = entry.state === "running" ? "running"
      : entry.state === "idle" ? "idle"
      : entry.state === "failed" || entry.state === "partial" ||
        (entry.attention !== null && Number.isFinite(entry.attention) && entry.attention > 0)
        ? "attention" : "completed";
    groups[group].push(entry);
  }
  return groups;
}

export function AuditIdleStatus() {
  return <span className="content-audit-home-status audit-idle-status"><small>本次未檢查</small></span>;
}

export function AuditResultStatus({ count, label = "項待確認", complete }: {
  count: number; label?: string; complete: boolean;
}) {
  const known = Number.isSafeInteger(count) && count >= 0;
  return <span className="content-audit-home-status" data-needs-review={!complete || (known && count > 0) || undefined}>
    <strong>{!known ? "結果待確認" : count > 0 ? `${count.toLocaleString()} ${label}`
      : complete ? "未發現需處理項目" : "尚有未完成範圍"}</strong>
    <small>{complete ? "檢查完成" : "部分完成"}</small>
  </span>;
}

export default function HomeAuditSummary({ entries }: { entries: readonly HomeAuditEntry[] }) {
  const groups = groupHomeAudits(entries);
  const locate = (id: AuditSuiteSectionId) => {
    const button = document.querySelector<HTMLButtonElement>(`#home-audits [data-audit-workspace-launch="${id}"]`);
    button?.scrollIntoView({ block: "center", behavior: "auto" });
    button?.focus({ preventScroll: true });
  };
  if (groups.idle.length === entries.length) return <p className="home-audit-summary is-empty">本次尚未檢查<span>點選卡片開始，或一次執行全部</span></p>;
  return <div className="home-audit-summary" aria-label="本次健檢摘要；數字為健檢類別數，不是商品數">
    <span>本次健檢</span>
    {([["attention", "需查看"], ["running", "進行中"], ["completed", "已完成"], ["idle", "未執行"]] as const).map(([key, label]) => (
      <button key={key} type="button" data-summary-state={key} disabled={!groups[key].length}
        title={`定位第一個${label}的項目；不會重新執行健檢`}
        onClick={() => { const first = groups[key][0]; if (first) locate(first.id); }}>
        {label}<strong>{groups[key].length}</strong><small>項</small>
      </button>
    ))}
  </div>;
}
