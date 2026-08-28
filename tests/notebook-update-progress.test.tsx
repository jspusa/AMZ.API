import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import NotebookUpdateProgress from "../src/renderer/src/components/notebook-update-progress";

describe("Notebook Key background update progress", () => {
  it("moves the existing sales skater to the bounded download percentage", () => {
    const markup = renderToStaticMarkup(
      <NotebookUpdateProgress
        status={{ state: "downloading", version: "0.1.38", percent: 48.6 }}
      />,
    );

    expect(markup).toContain("正在背景下載安全更新 v0.1.38");
    expect(markup).toContain("49%");
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-valuenow="49"');
    expect(markup).toContain("sales-skater-person");
    expect(markup).toContain("sales-skater-board");
    expect(markup).toContain("left:49%");
    expect(markup).toContain("下載時可以繼續使用；完成後再由你決定何時重啟。");
  });
});
