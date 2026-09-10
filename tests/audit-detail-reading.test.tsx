import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import AuditWorkspaceShell from "../src/renderer/src/components/audit-workspace-shell";

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
describe("shared audit detail reading surface", () => {
  it.each(["workspace", "dialog"] as const)("shares type/layout without changing %s safety or semantics", (presentation) => {
    const html = renderToStaticMarkup(<AuditWorkspaceShell presentation={presentation} eyebrow="FBA" title="Test audit" closeLabel="Close audit" surfaceClassName="test-audit" busy onBack={() => undefined}><p role="alert">Incomplete evidence remains visible</p></AuditWorkspaceShell>);
    expect(html).toContain('data-audit-reading="true"');
    expect(html).toContain('disabled');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="alert"');
    expect(html.includes('role="dialog"')).toBe(presentation === "dialog");
  });
  it("covers both low-frequency audit surfaces without touching Settings", async () => {
    const dashboard = await source("src/renderer/src/components/dashboard.tsx");
    for (const name of ["aged-inventory-audit-drawer", "review-audit-drawer"]) {
      expect(dashboard).toContain(`className="order-drawer ${name}"\n            data-audit-reading="true"`);
    }
    expect(await source("src/renderer/src/components/system-health-control.tsx")).not.toContain('data-audit-reading');
  });
  it("keeps large data in scroll owners and never hides warnings or filters artwork", async () => {
    const root=postcss.parse(await source("src/renderer/src/styles/audit-detail-reading.css"));
    root.walkDecls((d) => {
      expect(d.important).toBeFalsy();
      expect(d.prop).not.toBe("filter");
      expect(d.prop).not.toBe("zoom");
      if (d.prop === "display" && d.value === "none") expect((d.parent as {selector?: string}).selector).toBe('[data-audit-reading="true"] .content-audit-summary-spacer:empty');
    });
    const css=root.toString();
    expect(css).toContain('minmax(min(100%, 145px), 1fr)');
    expect(css).toContain('overflow-x: auto');
    expect(css).toContain('font-variant-numeric: tabular-nums');
  });
  it("composes the detail module before appearance and the generated dark palette", async () => {
    const entry=await source("src/renderer/src/styles/index.css");
    expect(entry.indexOf('audit-detail-reading.css')).toBeLessThan(entry.indexOf('appearance.css'));
    expect(entry.indexOf('appearance.css')).toBeLessThan(entry.indexOf('dark-palette.generated.css'));
  });
});
