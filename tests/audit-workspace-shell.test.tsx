import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AuditWorkspaceShell from "../src/renderer/src/components/audit-workspace-shell";

describe("audit workspace shell", () => {
  it("renders a page-level workspace without modal semantics or backdrop", () => {
    const markup = renderToStaticMarkup(
      <AuditWorkspaceShell
        presentation="workspace"
        eyebrow="FBA · READ ONLY"
        title="全站文案健檢"
        closeLabel="關閉文案健檢"
        surfaceClassName="sku-ops-drawer"
        onBack={() => undefined}
      >
        <p>健檢內容</p>
      </AuditWorkspaceShell>,
    );

    expect(markup).toContain('data-audit-workspace="true"');
    expect(markup).toContain("回到一鍵健檢");
    expect(markup).toContain("全站文案健檢");
    expect(markup).not.toContain('role="dialog"');
    expect(markup).not.toContain('aria-modal="true"');
    expect(markup).not.toContain("drawer-backdrop");
  });

  it("keeps the legacy dialog presentation for non-home navigation", () => {
    const markup = renderToStaticMarkup(
      <AuditWorkspaceShell
        presentation="dialog"
        eyebrow="FBA · READ ONLY"
        title="全站文案健檢"
        closeLabel="關閉文案健檢"
        surfaceClassName="sku-ops-drawer"
        busy
        onBack={() => undefined}
      >
        <p>健檢內容</p>
      </AuditWorkspaceShell>,
    );

    expect(markup).toContain("drawer-backdrop");
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("disabled");
  });
});
