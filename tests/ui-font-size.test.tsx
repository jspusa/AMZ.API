import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import SystemHealthControl from "../src/renderer/src/components/system-health-control";
import {
  applyUiFontSize,
  readUiFontSize,
  saveUiFontSize,
  UI_FONT_SIZE_STORAGE_KEY,
} from "../src/renderer/src/ui-font-size";

describe("local UI font-size preference", () => {
  it("is SSR safe and exposes the preference inside system information", async () => {
    expect(readUiFontSize(null)).toBe("standard");
    expect(() => applyUiFontSize("standard", null)).not.toThrow();
    expect(() => saveUiFontSize("large", null)).not.toThrow();

    const markup = renderToStaticMarkup(
      <SystemHealthControl marketplaceId="ATVPDKIKX0DER" />,
    );
    expect(markup).toContain("系統資訊");

    const source = await readFile(
      new URL(
        "../src/renderer/src/components/system-health-control.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain("介面字級");
    expect(source).toContain("不保存商品、銷售或其他營運資料");
    expect(source).toContain('role="radiogroup"');
    expect(source).toContain('aria-checked={fontSize === option.value}');

    const css = await readFile(
      new URL("../src/renderer/src/app.css", import.meta.url),
      "utf8",
    );
    expect(css).not.toContain("zoom: var(--ui-font-zoom)");
    expect(css).toContain('--ui-font-size-adjust: 0.62');
    expect(css).toContain('--ui-font-size-adjust: 0.69');
    expect(css).toContain('--ui-font-size-adjust: 0.77');
    expect(css).toContain("font-size-adjust: var(--ui-font-size-adjust)");
  });

  it("stores only the allowlisted display value and applies it to the root", () => {
    const storage = {
      getItem: vi.fn(() => "large"),
      setItem: vi.fn(),
    };
    const root = { setAttribute: vi.fn() };

    expect(readUiFontSize(storage)).toBe("large");
    expect(readUiFontSize({ ...storage, getItem: vi.fn(() => "operational-data") })).toBe("standard");
    applyUiFontSize("small", root);
    saveUiFontSize("large", storage);

    expect(storage.getItem).toHaveBeenCalledWith(UI_FONT_SIZE_STORAGE_KEY);
    expect(storage.setItem).toHaveBeenCalledWith(UI_FONT_SIZE_STORAGE_KEY, "large");
    expect(root.setAttribute).toHaveBeenCalledWith("data-ui-font-size", "small");
  });
});
