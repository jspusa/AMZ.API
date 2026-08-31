"use client";

import type { ReactNode } from "react";

export default function AuditDetailsDisclosure({
  children,
  summary = "判定規則、資料來源與安全範圍",
}: {
  children: ReactNode;
  summary?: string;
}) {
  return (
    <details className="health-advanced-details audit-details-disclosure">
      <summary aria-label={`詳細說明：${summary}`}>
        <strong>詳細說明</strong>
        <i aria-hidden="true">›</i>
      </summary>
      <div className="health-advanced-body audit-details-body">{children}</div>
    </details>
  );
}
