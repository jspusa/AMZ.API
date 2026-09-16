"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";

export type AuditSurfacePresentation = "dialog" | "workspace";

export const AuditWorkspaceNavigationContext = createContext<{
  backLabel: string;
  onBackChange?: (onBack: (() => void) | null) => void;
} | null>(null);

/** Shares the full-page header without remounting an existing home section. */
export function WorkspacePageHeader({ title, eyebrow, onBack, busy = false, titleId, backLabel = "返回首頁", busyStatus }: {
  title: ReactNode; eyebrow: ReactNode; onBack: () => void; busy?: boolean;
  titleId: string; backLabel?: string; busyStatus?: ReactNode;
}) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);
  return <header className="audit-workspace-header">
    <button className="audit-workspace-back" type="button" onClick={onBack} disabled={busy}>
      <span aria-hidden="true">←</span>{backLabel}
    </button>
    <div className="audit-workspace-heading">
      <p className="eyebrow">{eyebrow}</p>
      <h1 id={titleId} ref={headingRef} tabIndex={-1}>{title}</h1>
      {busyStatus}
    </div>
  </header>;
}

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
  const navigation = useContext(AuditWorkspaceNavigationContext);
  useEffect(() => {
    if (presentation !== "workspace") return;
    navigation?.onBackChange?.(onBack);
    return () => navigation?.onBackChange?.(null);
  }, [navigation, onBack, presentation]);

  if (presentation === "workspace") {
    return (
      <section
        className="audit-workspace"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        data-audit-workspace="true"
      >
        <WorkspacePageHeader title={title} eyebrow={eyebrow} onBack={onBack}
          busy={busy} titleId={titleId} backLabel={navigation?.backLabel ?? "返回商品健檢"} busyStatus={busyStatus} />
        <div className={`audit-workspace-body ${surfaceClassName}`} data-audit-reading="true">
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
        className={`order-drawer ${surfaceClassName}`} data-audit-reading="true"
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
