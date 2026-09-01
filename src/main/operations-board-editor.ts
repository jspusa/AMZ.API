import type { BrowserWindow, IpcMainInvokeEvent } from "electron";

export const OPERATIONS_BOARD_EDITOR_HTML = String.raw`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>AMZ.API 公布欄管理</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color:#18251f; background:#f4f7f5; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; background:linear-gradient(145deg,#f0f7f1,#f7f9fb 62%,#edf4f8); }
    main { width:min(920px,100%); margin:0 auto; padding:30px 26px 42px; }
    header { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; margin-bottom:22px; }
    .eyebrow { margin:0 0 5px; color:#35704f; font-size:12px; font-weight:800; letter-spacing:.14em; }
    h1 { margin:0; font-size:27px; letter-spacing:-.035em; }
    .intro { margin:7px 0 0; color:#617069; line-height:1.55; }
    .panel { background:rgba(255,255,255,.94); border:1px solid #dbe5de; border-radius:18px; padding:20px; box-shadow:0 16px 44px rgba(35,67,48,.08); }
    .notice { margin:0 0 16px; padding:12px 14px; border-radius:11px; background:#eef5f0; color:#466054; line-height:1.45; }
    .notice.error { background:#fff0ed; color:#8e3024; }
    form { margin:0; }
    label { display:grid; gap:6px; color:#3e5047; font-size:13px; font-weight:700; }
    input, textarea, select { width:100%; border:1px solid #cbd8d0; border-radius:10px; padding:10px 11px; color:#17231d; background:#fff; font:inherit; }
    input:focus, textarea:focus, select:focus, button:focus-visible { outline:3px solid rgba(37,122,78,.24); outline-offset:2px; border-color:#32805a; }
    textarea { min-height:76px; resize:vertical; }
    .fields { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
    .wide { grid-column:1/-1; }
    .actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:9px; margin-top:18px; }
    button { border:0; border-radius:10px; padding:10px 14px; font:inherit; font-weight:800; cursor:pointer; }
    button.primary { background:#17643e; color:white; }
    button.secondary { background:#e7efe9; color:#24523a; }
    button.ghost { background:transparent; color:#52635a; }
    button.danger { background:#fff0ed; color:#a13e30; }
    button:disabled { cursor:not-allowed; opacity:.55; }
    .toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; }
    .toolbar h2 { margin:0; font-size:18px; }
    .items { display:grid; gap:12px; }
    .item { border:1px solid #dbe4de; background:#fbfdfb; border-radius:14px; padding:14px; }
    .item-head { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:12px; }
    .item-kind { font-size:12px; font-weight:900; letter-spacing:.07em; color:#347253; }
    .check { display:flex; grid-column:1/-1; align-items:center; gap:8px; font-weight:700; }
    .check input { width:auto; }
    .empty { padding:34px 16px; text-align:center; color:#6d7973; border:1px dashed #cdd8d1; border-radius:12px; }
    .admin-settings { margin-top:20px; border-top:1px solid #dbe4de; padding-top:16px; }
    .admin-settings summary { cursor:pointer; color:#40534a; font-weight:800; }
    .admin-settings form { margin-top:14px; padding:14px; border-radius:12px; background:#f7f9f8; }
    .hidden { display:none !important; }
    .spinner { opacity:.65; pointer-events:none; }
    @media (max-width:680px) { main{padding:20px 14px 30px}.fields{grid-template-columns:1fr}.wide{grid-column:auto}header{display:block}header>button{margin-top:12px} }
  </style>
</head>
<body>
<main>
  <header>
    <div>
      <p class="eyebrow">LOCAL SECURE EDITOR</p>
      <h1>重要公布欄管理</h1>
      <p class="intro">即期品與 Amazon 促銷檔期會共用給使用相同公布欄空間的 AMZ.API 使用者。</p>
    </div>
    <button id="close" class="ghost" type="button">關閉</button>
  </header>
  <p id="message" class="notice" role="status" aria-live="polite">正在讀取本機安全狀態…</p>

  <section id="auth" class="panel hidden" aria-labelledby="auth-title">
    <h2 id="auth-title">管理者驗證</h2>
    <p id="auth-help" class="intro"></p>
    <form id="auth-form">
      <div class="fields">
        <label>管理帳號<input id="username" name="username" value="API" autocomplete="username" maxlength="64" required></label>
        <label>管理密碼<input id="password" name="password" type="password" autocomplete="current-password" minlength="8" maxlength="128" required></label>
        <label id="confirm-wrap" class="hidden">再次輸入密碼<input id="password-confirm" name="passwordConfirm" type="password" autocomplete="new-password" minlength="8" maxlength="128"></label>
      </div>
      <div class="actions">
        <button id="native-unlock" class="secondary hidden" type="button">使用 Touch ID／Windows Hello</button>
        <button id="auth-submit" class="primary" type="submit">進入編輯</button>
      </div>
    </form>
  </section>

  <section id="editor" class="panel hidden" aria-labelledby="editor-title">
    <div class="toolbar">
      <div><h2 id="editor-title">公布項目</h2><p id="revision" class="intro"></p></div>
      <div><button id="add-expiry" class="secondary" type="button">＋ 即期 SKU</button> <button id="add-promotion" class="secondary" type="button">＋ 促銷檔期</button></div>
    </div>
    <div id="items" class="items"></div>
    <div class="actions">
      <button id="cancel" class="ghost" type="button">取消</button>
      <button id="save" class="primary" type="button">確認並發布</button>
    </div>
    <details id="admin-settings" class="admin-settings">
      <summary>更換這台電腦的管理帳號或密碼</summary>
      <form id="admin-form">
        <p class="intro">需再次輸入目前帳密；新密碼仍只保存加鹽驗證值，不會上傳。</p>
        <div class="fields">
          <label>目前管理帳號<input id="current-admin-username" autocomplete="username" maxlength="64" required></label>
          <label>目前管理密碼<input id="current-admin-password" type="password" autocomplete="current-password" minlength="8" maxlength="128" required></label>
          <label>新管理帳號<input id="new-admin-username" autocomplete="username" maxlength="64" required></label>
          <label>新管理密碼<input id="new-admin-password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label>
          <label>再次輸入新密碼<input id="new-admin-password-confirm" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label>
        </div>
        <div class="actions"><button class="secondary" type="submit">確認更換管理帳密</button></div>
      </form>
    </details>
  </section>
</main>
<script>
(() => {
  const bridge = window.fbaOperationsBoardEditor;
  const byId = (id) => document.getElementById(id);
  const message = byId('message');
  const auth = byId('auth');
  const editor = byId('editor');
  const itemsRoot = byId('items');
  let currentState = null;
  let baseRevision = 0;
  let busy = false;

  function setBusy(value) {
    busy = value;
    document.body.classList.toggle('spinner', value);
    document.querySelectorAll('button').forEach((button) => { button.disabled = value; });
  }
  function showMessage(text, error = false) {
    message.textContent = text;
    message.classList.toggle('error', error);
  }
  function clearSecrets() {
    ['password','password-confirm','current-admin-password','new-admin-password','new-admin-password-confirm'].forEach((id) => { byId(id).value = ''; });
  }
  function field(labelText, control) {
    const label = document.createElement('label');
    label.append(labelText, control);
    return label;
  }
  function input(type, value, name, maxLength) {
    const control = document.createElement('input');
    control.type = type;
    control.value = value || '';
    control.dataset.field = name;
    if (maxLength) control.maxLength = maxLength;
    return control;
  }
  function textarea(value, name) {
    const control = document.createElement('textarea');
    control.value = value || '';
    control.dataset.field = name;
    control.maxLength = 500;
    return control;
  }
  function createItem(item) {
    const card = document.createElement('article');
    card.className = 'item';
    card.dataset.id = item.id;
    card.dataset.type = item.type;
    const head = document.createElement('div');
    head.className = 'item-head';
    const kind = document.createElement('span');
    kind.className = 'item-kind';
    kind.textContent = item.type === 'expiry' ? '即期品倒數' : '促銷檔期';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger';
    remove.textContent = '移除';
    remove.addEventListener('click', () => card.remove());
    head.append(kind, remove);
    const fields = document.createElement('div');
    fields.className = 'fields';
    if (item.type === 'expiry') {
      const marketplace = document.createElement('select');
      marketplace.dataset.field = 'marketplaceId';
      [['ATVPDKIKX0DER','Amazon 美國'],['A2EUQ1WTGCTBG2','Amazon 加拿大'],['A1F83G8C2ARO7P','Amazon 英國'],['A1PA6795UKMFR9','Amazon 德國'],['A1VC38T7YXB528','Amazon 日本'],['A19VAU5U5O7RUS','Amazon 新加坡'],['A39IBJ37TRP1C6','Amazon 澳洲']].forEach(([value,label]) => {
        const option = document.createElement('option'); option.value=value; option.textContent=label; option.selected=value===item.marketplaceId; marketplace.append(option);
      });
      fields.append(
        field('Amazon 站點', marketplace),
        field('Seller SKU', input('text', item.sellerSku, 'sellerSku', 40)),
        field('人工效期', input('date', item.expiryDate, 'expiryDate')),
        field('備註', textarea(item.note, 'note')),
      );
    } else {
      fields.append(
        field('檔期日期', input('date', item.date, 'date')),
        field('促銷名稱', input('text', item.title, 'title', 120)),
        field('備註', textarea(item.note, 'note')),
      );
      const check = document.createElement('label');
      check.className = 'check';
      const checkbox = input('checkbox', '', 'countdown');
      checkbox.checked = Boolean(item.countdown);
      check.append(checkbox, '在首頁顯示倒數');
      fields.append(check);
    }
    card.append(head, fields);
    return card;
  }
  function renderItems(items) {
    itemsRoot.replaceChildren();
    items.forEach((item) => itemsRoot.append(createItem(item)));
    if (!items.length) {
      const empty = document.createElement('div'); empty.className='empty'; empty.textContent='尚無公布項目。可新增即期 SKU 或促銷檔期。'; itemsRoot.append(empty);
    }
  }
  function blank(type) {
    return type === 'expiry'
      ? { id: crypto.randomUUID(), type, marketplaceId:'ATVPDKIKX0DER', sellerSku:'', expiryDate:'', note:'' }
      : { id: crypto.randomUUID(), type, date:'', title:'', note:'', countdown:false };
  }
  function add(type) {
    const empty = itemsRoot.querySelector('.empty'); if (empty) empty.remove();
    const card = createItem(blank(type)); itemsRoot.append(card); card.querySelector('input,select')?.focus();
  }
  function collectItems() {
    return Array.from(itemsRoot.querySelectorAll('.item')).map((card) => {
      const value = (name) => card.querySelector('[data-field="'+name+'"]')?.value || '';
      if (card.dataset.type === 'expiry') return { id:card.dataset.id, type:'expiry', marketplaceId:value('marketplaceId'), sellerSku:value('sellerSku'), expiryDate:value('expiryDate'), note:value('note') };
      return { id:card.dataset.id, type:'promotion', date:value('date'), title:value('title'), note:value('note'), countdown:Boolean(card.querySelector('[data-field="countdown"]')?.checked) };
    });
  }
  function render(state) {
    currentState = state;
    auth.classList.toggle('hidden', state.unlocked);
    editor.classList.toggle('hidden', !state.unlocked);
    if (!state.storageConfigured) showMessage('請先從首頁的連線設定完成共用 R2 五個欄位；公布欄不會把資料或密碼寫進 GitHub。', true);
    else if (state.board.stale) showMessage(state.board.message || '目前顯示暫存資料，請稍後重試。', true);
    else showMessage(state.unlocked ? '已通過本機管理者驗證。按「確認並發布」才會更新共用公布欄。' : '帳密只驗證這台 Notebook Key，不會傳到網路。');
    if (!state.unlocked) {
      const enrollment = !state.admin.configured;
      byId('auth-help').textContent = enrollment ? '第一次設定：帳號已先填 API。請在這台電腦輸入一次管理密碼；系統只保存加鹽驗證值。' : state.nativeUnlockAvailable ? '請輸入本機管理帳密，或使用系統生物辨識。' : '請輸入本機管理帳密；這台電腦目前沒有可用的原生身分驗證。';
      byId('confirm-wrap').classList.toggle('hidden', !enrollment);
      byId('password-confirm').required = enrollment;
      byId('native-unlock').classList.toggle('hidden', enrollment || !state.nativeUnlockAvailable);
      byId('auth-submit').textContent = enrollment ? '建立並進入' : '帳密登入';
      if (state.admin.username) byId('username').value = state.admin.username;
      return;
    }
    baseRevision = state.board.snapshot.revision;
    byId('current-admin-username').value = state.admin.username || '';
    byId('new-admin-username').value = state.admin.username || '';
    byId('revision').textContent = '共享版本 '+baseRevision+' ・ 最後更新 '+(baseRevision ? new Date(state.board.snapshot.updatedAt).toLocaleString('zh-TW') : '尚未發布');
    renderItems(state.board.snapshot.items);
  }
  async function run(action) {
    if (busy) return;
    setBusy(true);
    try { const result = await action(); if (result) render(result); }
    catch (error) { showMessage(error instanceof Error ? error.message : '操作失敗，請重試。', true); }
    finally { clearSecrets(); setBusy(false); }
  }
  byId('auth-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void run(async () => {
      const username=byId('username').value, password=byId('password').value;
      if (!currentState.admin.configured) {
        if (password !== byId('password-confirm').value) throw new Error('兩次密碼不一致。');
        return bridge.enroll({username,password});
      }
      return bridge.unlockPassword({username,password});
    });
  });
  byId('native-unlock').addEventListener('click', () => void run(() => bridge.unlockNative()));
  byId('admin-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void run(async () => {
      const newPassword=byId('new-admin-password').value;
      if (newPassword !== byId('new-admin-password-confirm').value) throw new Error('兩次新密碼不一致。');
      const state = await bridge.changeAdmin({
        currentUsername:byId('current-admin-username').value,
        currentPassword:byId('current-admin-password').value,
        newUsername:byId('new-admin-username').value,
        newPassword,
      });
      currentState = state;
      byId('current-admin-username').value = state.admin.username || '';
      byId('new-admin-username').value = state.admin.username || '';
      showMessage('管理帳密已更新；尚未發布的公告編輯仍保留在畫面上。');
      return null;
    });
  });
  byId('add-expiry').addEventListener('click', () => add('expiry'));
  byId('add-promotion').addEventListener('click', () => add('promotion'));
  byId('save').addEventListener('click', () => void run(async () => { await bridge.save({baseRevision,items:collectItems()}); clearSecrets(); await bridge.close(); }));
  byId('cancel').addEventListener('click', () => { clearSecrets(); void bridge.close(); });
  byId('close').addEventListener('click', () => { clearSecrets(); void bridge.close(); });
  addEventListener('pagehide', clearSecrets);
  void run(() => bridge.state());
})();
</script>
</body>
</html>`;

export function operationsBoardEditorDataUrl(): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(OPERATIONS_BOARD_EDITOR_HTML)}`;
}

export function isOperationsBoardEditorFrame(
  event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">,
  editor: BrowserWindow | null,
): boolean {
  if (!editor || editor.isDestroyed()) return false;
  const frame = event.senderFrame;
  return Boolean(
    frame &&
    event.sender === editor.webContents &&
    frame === editor.webContents.mainFrame &&
    frame.url === operationsBoardEditorDataUrl(),
  );
}
