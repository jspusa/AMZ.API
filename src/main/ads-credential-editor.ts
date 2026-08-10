import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from "electron";

export const ADS_CREDENTIAL_EDITOR_HTML = String.raw`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'">
  <meta name="referrer" content="no-referrer">
  <meta name="color-scheme" content="light">
  <title>Amazon Ads 本機安全輸入</title>
  <style>
    *{box-sizing:border-box}body{margin:0;background:#f4f5f7;color:#17212b;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{padding:28px}header{margin-bottom:22px}p{color:#5a6570;line-height:1.55}h1{font-size:23px;margin:4px 0}.tag{font-size:11px;font-weight:800;letter-spacing:.12em;color:#b65d16}label{display:block;margin:14px 0 5px;font-weight:700}input,select{width:100%;border:1px solid #c9ced4;border-radius:9px;background:#fff;padding:11px 12px;font:inherit}input:focus,select:focus{outline:2px solid #e5a33f;outline-offset:1px}.note{background:#fff8ea;border-radius:10px;padding:12px;margin:18px 0}.actions{display:flex;gap:10px;justify-content:flex-end;margin-top:22px}button{border:0;border-radius:9px;padding:10px 16px;font:inherit;font-weight:750;cursor:pointer}.cancel{background:#e6e9ed;color:#26313b}.save{background:#d98116;color:white}.save:disabled{opacity:.55;cursor:wait}#feedback{min-height:20px;color:#a43a2b;margin-top:12px}
  </style>
</head>
<body>
  <main>
    <header><div class="tag">LOCAL NOTEBOOK SHEET</div><h1>Amazon Ads 本機安全輸入</h1><p>憑證只送往 Notebook 鑰匙 main process 與系統安全儲存區，不經過 GitHub Pages。Profile ID 由系統自動發現。</p></header>
    <label for="region">Ads OAuth 區域</label><select id="region"><option value="na">NA · US／CA</option><option value="fe">FE · JP／SG／AU</option><option value="eu">EU · UK／DE</option></select>
    <label for="clientId">Ads LWA Client ID</label><input id="clientId" type="password" autocomplete="new-password" spellcheck="false">
    <label for="clientSecret">Ads LWA Client Secret</label><input id="clientSecret" type="password" autocomplete="new-password" spellcheck="false">
    <label for="refreshToken">Ads Refresh Token</label><input id="refreshToken" type="password" autocomplete="new-password" spellcheck="false">
    <div class="note">Amazon OAuth scope 為 <b>advertising::campaign_management</b>；請只授予 Campaign manager <b>Viewer</b>。AMZ.API 沒有廣告寫入能力。</div>
    <div id="feedback" role="alert"></div>
    <div class="actions"><button id="cancel" class="cancel" type="button">取消</button><button id="save" class="save" type="button">本機驗證並加密保存</button></div>
  </main>
  <script>
    (() => {
      const ids = ["clientId", "clientSecret", "refreshToken"];
      const clear = () => ids.forEach((id) => { document.getElementById(id).value = ""; });
      const setBusy = (busy) => { document.getElementById("save").disabled = busy; document.getElementById("cancel").disabled = busy; };
      document.getElementById("cancel").addEventListener("click", () => window.fbaAdvertisingCredentialEditor.close());
      document.getElementById("save").addEventListener("click", async () => {
        const feedback = document.getElementById("feedback");
        feedback.textContent = "";
        setBusy(true);
        try {
          await window.fbaAdvertisingCredentialEditor.save({
            oauthRegion: document.getElementById("region").value,
            lwaClientId: document.getElementById("clientId").value,
            lwaClientSecret: document.getElementById("clientSecret").value,
            refreshToken: document.getElementById("refreshToken").value,
          });
          clear();
          await window.fbaAdvertisingCredentialEditor.close();
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

export function advertisingCredentialEditorDataUrl(): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(ADS_CREDENTIAL_EDITOR_HTML)}`;
}

export function isAdvertisingCredentialEditorFrame(
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
  return event.senderFrame.url === advertisingCredentialEditorDataUrl();
}
