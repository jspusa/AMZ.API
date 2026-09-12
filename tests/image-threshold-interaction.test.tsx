import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import ImageAuditPanel from "../src/renderer/src/components/image-audit-panel";
const marketplaceId = "ATVPDKIKX0DER";
let renderer: ReactTestRenderer | null = null;
const text = () => JSON.stringify(renderer?.toJSON());
const button = (label: string) => renderer!.root.findAllByType("button").find(node => node.children.join("") === label)!;
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = null; vi.unstubAllGlobals(); });

describe("operator-selected image audit threshold", () => {
  it("starts a new main-owned audit with the selected threshold and clears a differently configured result", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout });
    const requested: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      requested.push(body.options.minimumImages);
      return Response.json({
        jobId: "11111111-1111-4111-8111-111111111111", contextId: "22222222-2222-4222-8222-222222222222",
        kind: "image", marketplaceId, mode: "live", options: body.options,
        ready: true, status: "completed", progress: { stage: "complete", message: "完成", completedUnits: 1, totalUnits: 1 },
        snapshot: { marketplaceId, minimumImages: body.options.minimumImages, fetchedAt: "2026-09-12T08:00:00Z", exportId: "image-export-12345", rows: [{ sellerSku: "SEVEN-IMAGES", title: "Seven images", imageCount: 7, imageUrls: Array.from({ length: 7 }, (_, index) => `https://images.example/${index}.png`), readStatus: "complete", readErrors: [] }] },
      });
    }));
    await act(async () => { renderer = create(<ImageAuditPanel marketplaceId={marketplaceId} marketplaceShort="US" onOpenSku={() => undefined} />); });
    const selection = () => renderer!.root.findByProps({ "aria-label": "圖片健檢最低張數" });
    expect(selection().props.value).toBe(8);
    await act(async () => { selection().props.onChange({ target: { value: "6" } }); });
    await act(async () => { await button("掃描 US 全部 FBA 圖片").props.onClick(); });
    expect(requested).toEqual([6]);
    expect(text()).toContain("目前沒有少於 6 張圖片");
    await act(async () => { selection().props.onChange({ target: { value: "9" } }); });
    expect(text()).not.toContain("圖片健檢摘要");
    await act(async () => { await button("掃描 US 全部 FBA 圖片").props.onClick(); });
    expect(requested).toEqual([6, 9]);
    expect(text()).toContain("SEVEN-IMAGES");
    expect(text()).toContain('"目前 ","7"," 張 · 還差 ","2"," 張達到 ","9"');
  });
});
