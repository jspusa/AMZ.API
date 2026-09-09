import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HomeAuditSummary, { AuditIdleStatus, AuditResultStatus, groupHomeAudits } from "../src/renderer/src/components/home-audit-summary";
import { isSkuSearchShortcut } from "../src/renderer/src/components/global-sku-search";
import { salesLineSegments } from "../src/renderer/src/sales-line-segments";

const key = (value: string, changes = {}) => ({ key: value, metaKey: false, ctrlKey: false, altKey: false, isComposing: false, ...changes });

describe("frontend usability without new Bridge capabilities", () => {
  it("distinguishes unrun, complete, attention and incomplete evidence", () => {
    expect(renderToStaticMarkup(<AuditIdleStatus />)).toContain("本次未檢查");
    expect(renderToStaticMarkup(<AuditResultStatus count={12} complete />)).toContain("12 項待確認");
    expect(renderToStaticMarkup(<AuditResultStatus count={12} complete />)).toContain("檢查完成");
    expect(renderToStaticMarkup(<AuditResultStatus count={0} complete />)).toContain("未發現需處理項目");
    expect(renderToStaticMarkup(<AuditResultStatus count={0} complete={false} />)).toContain("尚有未完成範圍");
    expect(renderToStaticMarkup(<AuditResultStatus count={Number.NaN} complete />)).toContain("結果待確認");
    expect(renderToStaticMarkup(<AuditResultStatus count={0} complete={false} />)).not.toContain("未發現需處理項目");
  });
  it("counts audit categories rather than pretending issue totals are distinct SKUs", () => {
    const groups = groupHomeAudits([
      { id: "content", state: "success", attention: 500 },
      { id: "image", state: "success", attention: 500 },
      { id: "aplus", state: "partial", attention: 0 },
      { id: "variation", state: "failed", attention: null },
      { id: "businessPricing", state: "running", attention: 500 },
      { id: "subscription", state: "success", attention: null },
      { id: "advertising", state: "idle", attention: null },
    ]);
    expect(Object.values(groups).map((group) => group.length)).toEqual([4, 1, 1, 1]);
    expect(renderToStaticMarkup(<HomeAuditSummary entries={[{ id: "content", state: "idle", attention: null }]} />)).toContain("本次尚未檢查");
  });
  it("honors IME and modifier boundaries and never steals ordinary typing", () => {
    expect(isSkuSearchShortcut(key("k", { metaKey: true }), false)).toBe(true);
    expect(isSkuSearchShortcut(key("K", { ctrlKey: true }), true)).toBe(true);
    expect(isSkuSearchShortcut(key("/"), false)).toBe(true);
    expect(isSkuSearchShortcut(key("/"), true)).toBe(false);
    expect(isSkuSearchShortcut(key("k"), false)).toBe(false);
    expect(isSkuSearchShortcut(key("k", { ctrlKey: true, isComposing: true }), false)).toBe(false);
    expect(isSkuSearchShortcut(key("k", { ctrlKey: true, altKey: true }), false)).toBe(false);
  });
  it("draws incomplete-day edges dashed without changing amounts or joining across gaps", () => {
    const points = [{ x: 0, y: 20, partial: false }, { x: 10, y: 10, partial: false }, { x: 20, y: 40, partial: true }];
    const copy = structuredClone(points);
    expect(salesLineSegments(points)).toEqual({ complete: "M0.00,20.00 L10.00,10.00", partial: "M10.00,10.00 L20.00,40.00" });
    expect(points).toEqual(copy);
    expect(salesLineSegments([])).toEqual({ complete: "", partial: "" });
    expect(salesLineSegments([{ x: 0, y: 3, partial: true }])).toEqual({ complete: "", partial: "" });
    expect(salesLineSegments([points[0], { ...points[1], partial: true }, { ...points[2], partial: false }]).complete).toBe("M0.00,20.00 M20.00,40.00");
  });
  it("puts appearance first, exposes sync, and keeps read-only settings closable", async () => {
    const source = await readFile(new URL("../src/renderer/src/components/system-health-control.tsx", import.meta.url), "utf8");
    expect(source.indexOf('<section className="font-size-preference"')).toBeLessThan(source.indexOf("<AppearancePreference />"));
    expect(source.indexOf("<AppearancePreference />")).toBeLessThan(source.indexOf('className="settings-sync-preference"'));
    expect(source.indexOf('className="settings-sync-preference"')).toBeLessThan(source.indexOf('className="system-recommendation-grid"'));
    expect(source).not.toContain('onClick={() => setOpen(false)} disabled={loading}');
    expect(source).not.toContain('event.key === "Escape" && !loading');
    const dashboard = await readFile(new URL("../src/renderer/src/components/dashboard.tsx", import.meta.url), "utf8");
    expect(dashboard).toContain('disabled={homeReturnLocked}');
    expect(dashboard).toContain('if (homeReturnLocked) return;');
  });
});
