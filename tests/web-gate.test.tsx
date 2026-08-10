import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ConnectionPanel from "../src/renderer/src/connection-panel";
import WebGate, {
  DEFAULT_NOTEBOOK_KEY_DOWNLOADS,
  safeNotebookDownloadHref,
} from "../src/renderer/src/web-gate";

describe("Notebook Key WebGate", () => {
  it("uses platform-neutral launch language and the approved Windows release entry", () => {
    const markup = renderToStaticMarkup(<WebGate />);

    expect(markup).toContain("LOCAL KEY REQUIRED");
    expect(markup).toContain("控制台已就緒");
    expect(markup).toContain('aria-label="控制台已就緒。請用 Notebook 鑰匙安全開啟。"');
    expect(markup).toContain("開啟 Notebook 鑰匙");
    expect(markup).toContain('href="amz-api://launch"');
    expect(markup).toContain("GitHub Pages 只提供版面與流程");
    expect(markup).toContain("憑證只留在本機");
    expect(markup).not.toContain("開啟 Mac 鑰匙");

    const windows = DEFAULT_NOTEBOOK_KEY_DOWNLOADS[0];
    expect(windows).toMatchObject({
      platform: "windows",
      detail: "Windows 11 x64",
      version: "0.1.16",
    });
    expect(markup).toContain(
      "https://github.com/jspusa/AMZ.API/releases/download/notebook-key-windows/AMZ.API-Notebook-Key-Windows-x64-Setup.exe",
    );
    expect(markup).toContain("Windows 11 x64 · v0.1.16");
    expect(markup).toContain("Microsoft SmartScreen");
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
  });

  it("accepts public download props but disables non-HTTPS values", () => {
    expect(safeNotebookDownloadHref("javascript:alert(1)")).toBeNull();
    expect(safeNotebookDownloadHref("http://example.com/key.exe")).toBeNull();
    expect(safeNotebookDownloadHref("https://example.com/key.exe")).toBe(
      "https://example.com/key.exe",
    );

    const markup = renderToStaticMarkup(
      <WebGate
        downloads={[{
          platform: "windows",
          label: "測試 Notebook 鑰匙",
          detail: "公開設定尚未完成",
          version: null,
          href: "javascript:alert(1)",
        }]}
      />,
    );
    expect(markup).toContain("下載準備中");
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).not.toContain("javascript:alert");
  });

  it("keeps ordinary browsers on WebGate without exposing Bridge or API calls", async () => {
    const [mainSource, gateSource] = await Promise.all([
      readFile(new URL("../src/renderer/src/main.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/renderer/src/web-gate.tsx", import.meta.url), "utf8"),
    ]);

    expect(mainSource).toContain("hasMacBridge ? <App /> : <WebGate />");
    expect(mainSource).toContain("if (hasMacBridge) installApiBridge()");
    expect(gateSource).not.toContain("/api/");
    expect(gateSource).not.toContain("window.fbaOS");
    expect(gateSource).not.toContain("installApiBridge");
  });

  it("uses a non-overlapping Notebook footer in the local connection panel", async () => {
    const markup = renderToStaticMarkup(
      <ConnectionPanel
        open
        showTrigger={false}
        onConnectionChanged={() => undefined}
      />,
    );
    const [css, connectionSource] = await Promise.all([
      readFile(new URL("../src/renderer/src/app.css", import.meta.url), "utf8"),
      readFile(new URL("../src/renderer/src/connection-panel.tsx", import.meta.url), "utf8"),
    ]);

    expect(markup).toContain("LOCAL NOTEBOOK KEY");
    expect(markup).toContain("Notebook 安全連線");
    expect(markup).toContain("Notebook 鑰匙版本");
    expect(markup).toContain("GitHub 介面自動保持最新");
    expect(markup).toContain("本機憑證不會隨介面更新上傳");
    expect(markup).toContain('class="connection-panel-footer"');
    expect(markup).toContain('class="connection-panel-footer-actions"');
    expect(markup).not.toContain("Mac 鑰匙版本");
    expect(connectionSource).toContain("本機系統安全儲存區既有值");
    expect(connectionSource).toContain("Touch ID／Windows Hello 清除 Ads 憑證");
    expect(connectionSource).not.toContain("Keychain 既有值");
    expect(connectionSource).not.toContain('"Touch ID 清除 Ads 憑證"');
    expect(css).toMatch(
      /\.connection-panel > footer\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/s,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*480px\)[\s\S]*?\.connection-panel-footer-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/,
    );
  });

  it("stacks WebGate explanations and download cards on narrow screens", async () => {
    const css = await readFile(
      new URL("../src/renderer/src/app.css", import.meta.url),
      "utf8",
    );

    expect(css).toMatch(
      /@media \(max-width:\s*720px\)[\s\S]*?\.web-gate-copy,[\s\S]*?\.web-gate-platform-grid\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/,
    );
    expect(css).toContain("overflow-wrap: anywhere");
  });
});
