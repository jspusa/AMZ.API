import { useState } from "react";
import BrandGlyph from "./components/brand-glyph";

export type NotebookKeyDownload = Readonly<{
  platform: "macos" | "windows";
  label: string;
  detail: string;
  version: string | null;
  href: string | null;
  warning?: string;
}>;

export const PROTECTED_NOTEBOOK_DOWNLOAD_PORTAL =
  "https://supply-boss.brave-prawn-0848.chatgpt.site/downloads";

export const DEFAULT_NOTEBOOK_KEY_DOWNLOADS: readonly NotebookKeyDownload[] = [
  {
    platform: "macos",
    label: "Mac Notebook 鑰匙",
    detail: "macOS · Universal",
    version: "0.1.16",
    href: PROTECTED_NOTEBOOK_DOWNLOAD_PORTAL,
    warning: "需先通過內部下載密碼驗證；安全下載頁會提供 DMG 大小與 SHA-256。",
  },
  {
    platform: "windows",
    label: "Windows Notebook 鑰匙",
    detail: "Windows 11 x64",
    version: "0.1.16",
    href: PROTECTED_NOTEBOOK_DOWNLOAD_PORTAL,
    warning: "內部未簽章版可能顯示 Microsoft SmartScreen；請從安全下載頁取得並核對 SHA-256。",
  },
] as const;

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
  downloads = DEFAULT_NOTEBOOK_KEY_DOWNLOADS,
}: {
  downloads?: readonly NotebookKeyDownload[];
}) {
  const [launching, setLaunching] = useState(false);

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
          <h1 aria-label="控制台已就緒。請用 Notebook 鑰匙安全開啟。"><span>控制台已就緒。</span><span className="web-gate-key-line"><i>請用 <b>Notebook&nbsp;鑰匙</b></i>{" "}<i>安全開啟。</i></span></h1>
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
              <h2 id="notebook-key-download-title">在這台電腦安全開啟</h2>
            </div>
            <small>一般瀏覽器永遠不會取得 Bridge 或 Amazon API 權限。</small>
          </div>
          <div className="web-gate-platform-grid">
            {downloads.map((download) => {
              const href = safeNotebookDownloadHref(download.href);
              const actionLabel = `安全登入下載 ${download.label}`;
              return (
                <article className={`web-gate-platform is-${download.platform}`} key={`${download.platform}-${download.label}`}>
                  <span aria-hidden="true">{download.platform === "macos" ? "⌘" : "▣"}</span>
                  <div>
                    <strong>{download.label}</strong>
                    <small>{download.detail}{download.version ? ` · v${download.version}` : " · 最新發布版"}</small>
                    {download.warning && <p>{download.warning}</p>}
                  </div>
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer">{actionLabel}<i aria-hidden="true">↓</i></a>
                  ) : (
                    <span className="web-gate-download-pending" aria-disabled="true">下載準備中</span>
                  )}
                </article>
              );
            })}
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
