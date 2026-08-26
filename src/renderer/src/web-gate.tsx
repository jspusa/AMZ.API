import { useState } from "react";
import packageJson from "../../../package.json";
import BrandGlyph from "./components/brand-glyph";

export const PROTECTED_NOTEBOOK_DOWNLOAD_PORTAL =
  "https://supply-boss.brave-prawn-0848.chatgpt.site/downloads";
export const APP_DOWNLOAD_VERSION = packageJson.version;

export function safeNotebookDownloadHref(href: string | null): string | null {
  if (!href) return null;
  try {
    const url = new URL(href);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export default function WebGate({
  downloadHref = PROTECTED_NOTEBOOK_DOWNLOAD_PORTAL,
}: {
  downloadHref?: string | null;
}) {
  const [launching, setLaunching] = useState(false);
  const safeDownloadHref = safeNotebookDownloadHref(downloadHref);

  return (
    <main className="web-gate">
      <nav className="web-gate-nav" aria-label="AMZ.API 安全入口">
        <div className="web-gate-brand">
          <BrandGlyph className="web-gate-brand-mark" />
          <div><strong>AMZ.API</strong><small>GitHub Control Console</small></div>
        </div>
        <div className="web-gate-state" role="status"><i />Notebook 鑰匙未連線</div>
      </nav>

      <section className="web-gate-card">
        <div className="web-gate-hero">
          <div className="web-gate-icon"><span>⌁</span><i /></div>
          <p className="web-gate-eyebrow">LOCAL KEY REQUIRED</p>
          <h1 aria-label="控制台已就緒。請用 Notebook 鑰匙安全開啟。">
            <span className="web-gate-heading-line">控制台已就緒。</span>
            <span className="web-gate-heading-line web-gate-heading-key">
              請用 <b>Notebook&nbsp;鑰匙</b>{" "}安全開啟。
            </span>
          </h1>
          <div className="web-gate-copy" aria-label="GitHub 更新與本機憑證邊界">
            <article>
              <span>GITHUB UI</span>
              <strong>介面自動保持最新</strong>
              <p>GitHub Pages 只提供版面與流程，不會取得 Amazon 憑證。</p>
            </article>
            <article>
              <span>LOCAL CREDENTIALS</span>
              <strong>憑證只留在本機</strong>
              <p>瀏覽器無權讀取本機憑證；Notebook 鑰匙連線後才會開啟控制台。</p>
            </article>
          </div>
          <div className="web-gate-actions">
            <a
              className="web-gate-primary"
              href="amz-api://launch"
              onClick={() => setLaunching(true)}
            >
              {launching ? "正在開啟 AMZ.API…" : "開啟 Notebook 鑰匙"}<span>↗</span>
            </a>
          </div>
          {launching && <p className="web-gate-hint">控制台會在 Notebook 鑰匙視窗中開啟；這個瀏覽器分頁維持鎖定是正常的。</p>}
        </div>

        <section className="web-gate-install" aria-labelledby="notebook-key-download-title">
          <div className="web-gate-install-heading">
            <div>
              <p>NOTEBOOK KEY DOWNLOAD</p>
              <h2 id="notebook-key-download-title">下載 AMZ.API App {APP_DOWNLOAD_VERSION}</h2>
            </div>
            {safeDownloadHref ? (
              <a
                className="web-gate-download"
                href={safeDownloadHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                安全登入下載 Mac／Windows App<i aria-hidden="true">↓</i>
              </a>
            ) : (
              <span className="web-gate-download-pending" aria-disabled="true">下載準備中</span>
            )}
          </div>
        </section>
      </section>

      <section className="web-gate-boundary" aria-label="安全架構">
        <article className="done"><span>01</span><div><strong>GitHub 控制台</strong><small>版面與流程自動更新</small></div><i>✓</i></article>
        <article><span>02</span><div><strong>Notebook 鑰匙</strong><small>本機憑證不進入瀏覽器</small></div><i>鎖定</i></article>
        <article><span>03</span><div><strong>Amazon SP-API</strong><small>Notebook 鑰匙連線後才可使用</small></div><i>等待</i></article>
      </section>

      <footer className="web-gate-footer">AMZ.API · FBA only · GitHub UI / Notebook Key Bridge</footer>
    </main>
  );
}
