import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ConnectionPanel from "../src/renderer/src/connection-panel";
import WebGate, {
  APP_DOWNLOAD_VERSION,
  PROTECTED_NOTEBOOK_DOWNLOAD_PORTAL,
  safeNotebookDownloadHref,
} from "../src/renderer/src/web-gate";
import packageJson from "../package.json";
import { readRendererStylesheet } from "./renderer-stylesheet";

describe("Notebook Key WebGate", () => {
  it("shows one concise protected App 0.1.34 download action", () => {
    const markup = renderToStaticMarkup(<WebGate />);

    expect(markup).toContain("LOCAL KEY REQUIRED");
    expect(markup).toContain("控制台已就緒");
    expect(markup).toContain('aria-label="控制台已就緒。請用 Notebook 鑰匙安全開啟。"');
    expect(markup).toContain("開啟 Notebook 鑰匙");
    expect(markup).toContain('href="amz-api://launch"');
    expect(markup).toContain("GitHub Pages 只提供版面與流程");
    expect(markup).toContain("憑證只留在本機");
    expect(markup).not.toContain("開啟 Mac 鑰匙");

    expect(APP_DOWNLOAD_VERSION).toBe(packageJson.version);
    expect(markup).toContain(`下載 AMZ.API App ${packageJson.version}`);
    expect(markup.match(new RegExp(PROTECTED_NOTEBOOK_DOWNLOAD_PORTAL, "g"))).toHaveLength(1);
    expect(markup).not.toContain("github.com/jspusa/AMZ.API/releases/download");
    expect(markup).not.toContain("AMZ.API-Notebook-Key-Windows-x64-Setup.exe");
    expect(markup).not.toContain("v0.1.16");
    expect(markup).not.toContain("Mac Notebook 鑰匙");
    expect(markup).not.toContain("Windows Notebook 鑰匙");
    expect(markup).not.toContain("Microsoft SmartScreen");
    expect(markup).toContain("安全登入下載 Mac／Windows App");
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
  });

  it("uses two stable desktop heading rows without nested inline layout", async () => {
    const markup = renderToStaticMarkup(<WebGate />);
    const css = await readRendererStylesheet();

    expect(markup).toContain(
      '<span class="web-gate-heading-line">控制台已就緒。</span>',
    );
    expect(markup).toContain(
      '<span class="web-gate-heading-line web-gate-heading-key">請用 <b>Notebook\u00a0鑰匙</b> 安全開啟。</span>',
    );
    const heading = markup.match(/<h1[^>]*>[\s\S]*?<\/h1>/u)?.[0] ?? "";
    expect(heading).not.toContain("<i");
    expect(css).toMatch(
      /\.web-gate-card h1\s*\{[^}]*display:\s*grid;[^}]*row-gap:/s,
    );
    expect(css).toMatch(
      /\.web-gate-heading-line\s*\{[^}]*line-height:\s*1\.2;/s,
    );
  });

  it("accepts protected download props but disables non-HTTPS values", () => {
    expect(safeNotebookDownloadHref("javascript:alert(1)")).toBeNull();
    expect(safeNotebookDownloadHref("http://example.com/key.exe")).toBeNull();
    expect(safeNotebookDownloadHref("https://example.com/key.exe")).toBe(
      "https://example.com/key.exe",
    );

    const markup = renderToStaticMarkup(
      <WebGate
        downloadHref="javascript:alert(1)"
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

  it("keeps user-facing install documentation on the protected portal", async () => {
    const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

    expect(readme).toContain(PROTECTED_NOTEBOOK_DOWNLOAD_PORTAL);
    expect(readme).toContain("安裝檔保存在私有 R2");
    expect(readme).not.toContain("/releases/download/notebook-key-windows/");
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
      readRendererStylesheet(),
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

  it("stacks WebGate explanations and download action on narrow screens", async () => {
    const css = await readRendererStylesheet();

    expect(css).toMatch(
      /@media \(max-width:\s*720px\)[\s\S]*?\.web-gate-copy,[\s\S]*?\.web-gate-install-heading\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/,
    );
    expect(css).toContain("overflow-wrap: anywhere");
  });
});
