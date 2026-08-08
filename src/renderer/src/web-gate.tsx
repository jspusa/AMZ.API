import { useState } from "react";

export default function WebGate() {
  const [launching, setLaunching] = useState(false);

  return (
    <main className="web-gate">
      <nav className="web-gate-nav">
        <div className="web-gate-brand"><span>J</span><div><strong>AMZ.API</strong><small>GitHub Control Console</small></div></div>
        <div className="web-gate-state"><i />Mac 鑰匙未連線</div>
      </nav>

      <section className="web-gate-card">
        <div className="web-gate-icon"><span>⌁</span><i /></div>
        <p className="web-gate-eyebrow">LOCAL KEY REQUIRED</p>
        <h1>控制台已就緒。<br />請用 Mac 鑰匙安全開啟。</h1>
        <p className="web-gate-copy">
          這套介面由 GitHub 自動保持最新；Amazon API 憑證只存在你的 Mac。
          瀏覽器本身不會取得金鑰，也不能執行任何 Amazon 操作。
        </p>
        <div className="web-gate-actions">
          <a
            className="web-gate-primary"
            href="amz-api://launch"
            onClick={() => setLaunching(true)}
          >
            {launching ? "正在開啟 AMZ.API…" : "開啟 Mac 鑰匙"}<span>↗</span>
          </a>
        </div>
        {launching && <p className="web-gate-hint">控制台會在 AMZ.API App 視窗中開啟；這個瀏覽器分頁維持鎖定是正常的。</p>}
      </section>

      <section className="web-gate-boundary" aria-label="安全架構">
        <article className="done"><span>01</span><div><strong>GitHub 控制台</strong><small>版面與流程自動更新</small></div><i>✓</i></article>
        <article><span>02</span><div><strong>Mac Keychain</strong><small>API Secret 不離開電腦</small></div><i>鎖定</i></article>
        <article><span>03</span><div><strong>Amazon SP-API</strong><small>開啟 Mac App 後才連線</small></div><i>等待</i></article>
      </section>

      <footer className="web-gate-footer">AMZ.API · FBA only · GitHub UI / Local API Bridge</footer>
    </main>
  );
}
