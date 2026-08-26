import type {
  ContentAuditRow,
  ContentAuditSnapshot,
} from "./content-quality";

export function contentAuditAttentionRows(
  snapshot: ContentAuditSnapshot,
): ContentAuditRow[] {
  return snapshot.rows.filter(
    (row) => row.readStatus === "incomplete" || row.issues.length > 0,
  );
}
