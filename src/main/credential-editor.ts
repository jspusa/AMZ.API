import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from "electron";

export const CREDENTIAL_EDITOR_HTML = String.raw`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'">
  <meta name="referrer" content="no-referrer">
  <meta name="color-scheme" content="light">
  <title>SP-API 本機安全輸入</title>
  <style>
    *{box-sizing:border-box}body{margin:0;background:#f4f5f7;color:#17212b;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{padding:28px}header{margin-bottom:20px}h1{font-size:23px;margin:4px 0}.tag{font-size:11px;font-weight:800;letter-spacing:.12em;color:#2563a7}p,small{color:#5a6570;line-height:1.5}.section{margin:16px 0;padding:16px;border:1px solid #dfe3e8;border-radius:12px;background:#fff}.section h2{margin:0 0 4px;font-size:16px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:11px 12px}.full{grid-column:1/-1}label{display:block;font-weight:700;font-size:12px}input{width:100%;margin-top:5px;border:1px solid #c9ced4;border-radius:8px;background:#fff;padding:10px 11px;font:inherit}input:focus{outline:2px solid #75a7dc;outline-offset:1px}.note{background:#eef6ff;border-radius:10px;padding:12px;margin:16px 0}.actions{position:sticky;bottom:0;display:flex;gap:10px;justify-content:flex-end;margin:20px -8px -8px;padding:14px 8px 8px;background:#f4f5f7}button{border:0;border-radius:9px;padding:10px 16px;font:inherit;font-weight:750;cursor:pointer}.cancel{background:#e6e9ed;color:#26313b}.save{background:#2368aa;color:white}.save:disabled{opacity:.55;cursor:wait}#feedback{min-height:20px;color:#a43a2b;margin-top:12px}@media(max-width:680px){main{padding:18px}.grid{grid-template-columns:1fr}.full{grid-column:auto}}
  </style>
</head>
<body>
  <main>
    <header><div class="tag">LOCAL NOTEBOOK SHEET</div><h1>SP-API／R2／Skill 本機安全輸入</h1><p>欄位只存在此本機記憶體視窗，並直接送往 Notebook 鑰匙 main process 與系統安全儲存區；不經 GitHub Pages。已保存內容不會回填，留白代表沿用既有值。</p></header>
    <section class="section"><h2>SP-API App 身分</h2><small>LWA Client ID 與 Secret 必須成對；若已保存可全部留白。</small><div class="grid">
      <label>LWA Client ID<input id="lwaClientId" type="password" autocomplete="new-password" spellcheck="false"></label>
      <label>LWA Client Secret<input id="lwaClientSecret" type="password" autocomplete="new-password" spellcheck="false"></label>
    </div></section>
    <section class="section"><h2>北美 NA · US／CA</h2><small>更新 Refresh Token 時必須同時輸入同一帳號的 Seller ID／Merchant Token。</small><div class="grid">
      <label>NA Refresh Token<input id="naRefreshToken" type="password" autocomplete="new-password" spellcheck="false"></label>
      <label>NA Seller ID／Merchant Token<input id="naSellerId" type="password" autocomplete="new-password" spellcheck="false"></label>
    </div></section>
    <section class="section"><h2>遠東 FE · JP／SG／AU</h2><div class="grid">
      <label>FE Refresh Token<input id="feRefreshToken" type="password" autocomplete="new-password" spellcheck="false"></label>
      <label>FE Seller ID／Merchant Token<input id="feSellerId" type="password" autocomplete="new-password" spellcheck="false"></label>
    </div></section>
    <section class="section"><h2>歐洲 EU · UK／DE</h2><div class="grid">
      <label>EU Refresh Token<input id="euRefreshToken" type="password" autocomplete="new-password" spellcheck="false"></label>
      <label>EU Seller ID／Merchant Token<input id="euSellerId" type="password" autocomplete="new-password" spellcheck="false"></label>
    </div></section>
    <section class="section"><h2>Cloudflare R2 圖片空間（選配）</h2><small>五個欄位必須完整；已保存時可全部留白。</small><div class="grid">
      <label>R2 Account ID<input id="r2AccountId" type="password" autocomplete="new-password" spellcheck="false"></label>
      <label>Bucket<input id="r2Bucket" autocomplete="off" spellcheck="false"></label>
      <label>Access Key ID<input id="r2AccessKeyId" type="password" autocomplete="new-password" spellcheck="false"></label>
      <label>Secret Access Key<input id="r2SecretAccessKey" type="password" autocomplete="new-password" spellcheck="false"></label>
      <label class="full">公開圖片 HTTPS 網址<input id="r2PublicBaseUrl" type="url" autocomplete="off" spellcheck="false"></label>
    </div></section>
    <section class="section"><h2>共享公布欄唯讀網址（選配）</h2><small>一般同事的電腦只要填這個公開 HTTPS 基底網址，不需持有 R2 Access Key；負責更新的電腦才需要填上方完整 R2 寫入設定。</small><div class="grid">
      <label class="full">公布欄公開 HTTPS 基底網址<input id="operationsBoardPublicBaseUrl" type="url" autocomplete="off" spellcheck="false"></label>
    </div></section>
    <section class="section"><h2>補貨 Skill 接點（選配）</h2><div class="grid"><label class="full">HTTPS Skill URL<input id="replenishmentSkillUrl" type="url" autocomplete="off" spellcheck="false"></label></div></section>
    <div class="note">保存會觸發 Touch ID 或 Windows Hello（指紋／臉部／PIN 由系統決定）。取消、成功或視窗關閉時會立即清空所有欄位；任何 Secret 都不會回傳或顯示。</div>
    <div id="feedback" role="alert"></div>
    <div class="actions"><button id="cancel" class="cancel" type="button">取消</button><button id="save" class="save" type="button">本機驗證並加密保存</button></div>
  </main>
  <script>
    (() => {
      const ids = ["lwaClientId","lwaClientSecret","naRefreshToken","naSellerId","feRefreshToken","feSellerId","euRefreshToken","euSellerId","r2AccountId","r2AccessKeyId","r2SecretAccessKey","r2Bucket","r2PublicBaseUrl","operationsBoardPublicBaseUrl","replenishmentSkillUrl"];
      const value = (id) => document.getElementById(id).value;
      const clear = () => ids.forEach((id) => { document.getElementById(id).value = ""; });
      const setBusy = (busy) => { document.getElementById("save").disabled = busy; document.getElementById("cancel").disabled = busy; };
      document.getElementById("cancel").addEventListener("click", async () => { clear(); await window.fbaCredentialEditor.close(); });
      document.getElementById("save").addEventListener("click", async () => {
        const feedback = document.getElementById("feedback");
        feedback.textContent = "";
        setBusy(true);
        try {
          await window.fbaCredentialEditor.save({
            lwaClientId: value("lwaClientId"), lwaClientSecret: value("lwaClientSecret"),
            regions: {
              na: { refreshToken: value("naRefreshToken"), sellerId: value("naSellerId") },
              fe: { refreshToken: value("feRefreshToken"), sellerId: value("feSellerId") },
              eu: { refreshToken: value("euRefreshToken"), sellerId: value("euSellerId") },
            },
            imageStorage: {
              accountId: value("r2AccountId"), accessKeyId: value("r2AccessKeyId"),
              secretAccessKey: value("r2SecretAccessKey"), bucket: value("r2Bucket"),
              publicBaseUrl: value("r2PublicBaseUrl"),
            },
            operationsBoardPublicBaseUrl: value("operationsBoardPublicBaseUrl"),
            replenishmentSkillUrl: value("replenishmentSkillUrl"),
          });
          clear();
          await window.fbaCredentialEditor.close();
        } catch (error) {
          clear();
          feedback.textContent = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+':\s*/i, "").replace(/^Error:\s*/i, "") : "憑證未保存。";
          setBusy(false);
        }
      });
      window.addEventListener("pagehide", clear);
    })();
  </script>
</body>
</html>`;

export function credentialEditorDataUrl(): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(CREDENTIAL_EDITOR_HTML)}`;
}

export function isCredentialEditorFrame(
  event: IpcMainInvokeEvent | IpcMainEvent,
  editorWindow: BrowserWindow | null,
): boolean {
  if (
    !editorWindow ||
    editorWindow.isDestroyed() ||
    event.sender !== editorWindow.webContents ||
    !event.senderFrame ||
    event.senderFrame !== event.sender.mainFrame
  ) {
    return false;
  }
  return event.senderFrame.url === credentialEditorDataUrl();
}
