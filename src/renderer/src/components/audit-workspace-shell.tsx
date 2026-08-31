"use client";

import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";

export type AuditSurfacePresentation = "dialog" | "workspace";

export default function AuditWorkspaceShell({
  presentation = "dialog",
  eyebrow,
  title,
  closeLabel,
  surfaceClassName,
  busy = false,
  busyStatus = null,
  autoFocusClose = false,
  onBack,
  children,
}: {
  presentation?: AuditSurfacePresentation;
  eyebrow: ReactNode;
  title: ReactNode;
  closeLabel: string;
  surfaceClassName: string;
  busy?: boolean;
  busyStatus?: ReactNode;
  autoFocusClose?: boolean;
  onBack: () => void;
  children: ReactNode;
}) {
  const generatedId = useId().replaceAll(":", "");
  const titleId = `audit-surface-title-${generatedId}`;
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (presentation !== "workspace") return;
    headingRef.current?.focus();
  }, [presentation]);

  if (presentation === "workspace") {
    return (
      <section
        className="audit-workspace"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        data-audit-workspace="true"
      >
        <header className="audit-workspace-header">
          <button
            className="audit-workspace-back"
            type="button"
            onClick={onBack}
            disabled={busy}
          >
            <span aria-hidden="true">←</span>
            回到一鍵健檢
          </button>
          <div className="audit-workspace-heading">
            <p className="eyebrow">{eyebrow}</p>
            <h1 id={titleId} ref={headingRef} tabIndex={-1}>{title}</h1>
            {busyStatus}
          </div>
        </header>
        <div className={`audit-workspace-body ${surfaceClassName}`}>
          {children}
        </div>
      </section>
    );
  }

  return (
    <div
      className="drawer-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onBack();
      }}
    >
      <aside
        className={`order-drawer ${surfaceClassName}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
      >
        <div className="drawer-header">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2 id={titleId}>{title}</h2>
            {busyStatus}
          </div>
          <button
            type="button"
            onClick={onBack}
            aria-label={closeLabel}
            disabled={busy}
            autoFocus={autoFocusClose}
          >×</button>
        </div>
        {children}
      </aside>
    </div>
  );
}
