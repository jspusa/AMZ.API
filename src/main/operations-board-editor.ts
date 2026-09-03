import type { BrowserWindow, IpcMainInvokeEvent } from "electron";

export const OPERATIONS_BOARD_EDITOR_HTML = String.raw`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>AMZ.API 公布欄管理</title>
  <style>
    :root { color-scheme:light; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:#18251f; background:#f4f7f5; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; background:linear-gradient(145deg,#f0f7f1,#f7f9fb 62%,#edf4f8); }
    main { width:min(920px,100%); margin:0 auto; padding:30px 26px 42px; }
    header { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; margin-bottom:22px; }
    .eyebrow { margin:0 0 5px; color:#35704f; font-size:12px; font-weight:800; letter-spacing:.14em; }
    h1 { margin:0; font-size:27px; letter-spacing:-.035em; }
    h2 { margin:0; font-size:18px; }
    .intro { margin:7px 0 0; color:#617069; line-height:1.55; }
    .panel { background:rgba(255,255,255,.94); border:1px solid #dbe5de; border-radius:18px; padding:20px; box-shadow:0 16px 44px rgba(35,67,48,.08); }
    .notice { margin:0 0 16px; padding:12px 14px; border-radius:11px; background:#eef5f0; color:#466054; line-height:1.45; }
    .notice.error { background:#fff0ed; color:#8e3024; }
    form { margin:0; }
    label { display:grid; gap:6px; color:#3e5047; font-size:13px; font-weight:700; }
    input,textarea,select { width:100%; border:1px solid #cbd8d0; border-radius:10px; padding:10px 11px; color:#17231d; background:#fff; font:inherit; }
    input:focus,textarea:focus,select:focus,button:focus-visible { outline:3px solid rgba(37,122,78,.24); outline-offset:2px; border-color:#32805a; }
    textarea { min-height:76px; resize:vertical; }
    .fields { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
    .wide { grid-column:1/-1; }
    .actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:9px; margin-top:18px; }
    button { border:0; border-radius:10px; padding:10px 14px; font:inherit; font-weight:800; cursor:pointer; }
    button.primary { background:#17643e; color:#fff; }
    button.secondary { background:#e7efe9; color:#24523a; }
    button.ghost { background:transparent; color:#52635a; }
    button.danger { background:#fff0ed; color:#a13e30; }
    button:disabled { cursor:not-allowed; opacity:.55; }
    .toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; }
    .items { display:grid; gap:12px; }
    .item { border:1px solid #dbe4de; background:#fbfdfb; border-radius:14px; padding:14px; transition:border-color .18s,box-shadow .18s; }
    .item.focused { border-color:#2f7f58; box-shadow:0 0 0 3px rgba(47,127,88,.14); }
    .item.pending { border-color:#6c8fb6; box-shadow:0 0 0 3px rgba(108,143,182,.13); }
    .item-head { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:12px; }
    .item-kind { font-size:12px; font-weight:900; letter-spacing:.07em; color:#347253; }
    .check { display:flex; grid-column:1/-1; align-items:center; gap:8px; font-weight:700; }
    .check input { width:auto; }
    .empty { padding:34px 16px; text-align:center; color:#6d7973; border:1px dashed #cdd8d1; border-radius:12px; }
    .hidden { display:none !important; }
    .spinner { opacity:.65; pointer-events:none; }
    @media (max-width:680px) { main{padding:20px 14px 30px}.fields{grid-template-columns:1fr}.wide{grid-column:auto}.toolbar,header{display:block}.toolbar>div:last-child,header>button{margin-top:12px} }
  </style>
</head>
<body>
<main>
  <header>
    <div>
      <p class="eyebrow">SECURE BOARD EDITOR</p>
      <h1>重要公布欄管理</h1>
      <p class="intro">即期品與促銷檔期會同步給所有 AMZ.API 使用者；員工不需要 GitHub 帳號。</p>
    </div>
    <button id="close" class="ghost" type="button">關閉</button>
  </header>
  <p id="message" class="notice" role="status" aria-live="polite">正在讀取公布欄…</p>

  <section id="auth" class="panel hidden" aria-labelledby="auth-title">
    <h2 id="auth-title">管理者登入</h2>
    <p class="intro">輸入內部公布欄帳密即可。密碼只會由 AMZ.API App 傳到固定的 Supply Boss 登入服務，不會交給 GitHub，也不會保存在 App；電腦鎖定後會自動登出。</p>
    <form id="auth-form">
      <div class="fields">
        <label>管理帳號<input id="username" name="username" value="API" autocomplete="username" maxlength="64" required></label>
        <label>管理密碼<input id="password" name="password" type="password" autocomplete="current-password" maxlength="256" required></label>
      </div>
      <div class="actions"><button id="auth-submit" class="primary" type="submit">登入並繼續</button></div>
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
  let baseRevision = 0;
  let busy = false;
  let pendingDraftApplied = false;

  function setBusy(value) {
    busy = value;
    document.body.classList.toggle('spinner', value);
    document.querySelectorAll('button').forEach((button) => { button.disabled = value; });
  }
  function showMessage(text, error = false) {
    message.textContent = text;
    message.classList.toggle('error', error);
  }
  function clearSecret() { byId('password').value = ''; }
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
  function createItem(item, className) {
    const card = document.createElement('article');
    card.className = 'item'+(className ? ' '+className : '');
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
    remove.textContent = '刪除';
    remove.addEventListener('click', () => {
      if (!confirm('確定要刪除這筆公布項目嗎？')) return;
      card.remove();
      if (!itemsRoot.querySelector('.item')) renderItems([]);
    });
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
      const empty = document.createElement('div');
      empty.className='empty';
      empty.textContent='尚無公布項目。可新增即期 SKU 或促銷檔期。';
      itemsRoot.append(empty);
    }
  }
  function draftItem(draft) { return Object.assign({ id:crypto.randomUUID() }, draft); }
  function blank(type) {
    return type === 'expiry'
      ? { id:crypto.randomUUID(), type, marketplaceId:'ATVPDKIKX0DER', sellerSku:'', expiryDate:'', note:'' }
      : { id:crypto.randomUUID(), type, date:'', title:'', note:'', countdown:false };
  }
  function add(type) {
    const empty = itemsRoot.querySelector('.empty'); if (empty) empty.remove();
    const card = createItem(blank(type), 'pending');
    itemsRoot.append(card);
    card.querySelector('input,select')?.focus();
    card.scrollIntoView({ behavior:'smooth', block:'center' });
  }
  function collectItems() {
    return Array.from(itemsRoot.querySelectorAll('.item')).map((card) => {
      const value = (name) => card.querySelector('[data-field="'+name+'"]')?.value || '';
      if (card.dataset.type === 'expiry') return { id:card.dataset.id, type:'expiry', marketplaceId:value('marketplaceId'), sellerSku:value('sellerSku'), expiryDate:value('expiryDate'), note:value('note') };
      return { id:card.dataset.id, type:'promotion', date:value('date'), title:value('title'), note:value('note'), countdown:Boolean(card.querySelector('[data-field="countdown"]')?.checked) };
    });
  }
  function render(state) {
    auth.classList.toggle('hidden', state.authenticated);
    editor.classList.toggle('hidden', !state.authenticated);
    if (!state.authenticated) {
      showMessage(state.board.stale ? (state.board.message || '目前無法讀取公布欄，仍可登入後重試。') : '請登入後新增、編輯或刪除公布項目。', state.board.stale);
      if (state.username) byId('username').value = state.username;
      return;
    }
    baseRevision = state.board.snapshot.revision;
    const items = state.board.snapshot.items.slice();
    let pendingId = null;
    if (state.pendingDraft && !pendingDraftApplied) {
      const pending = draftItem(state.pendingDraft);
      pendingId = pending.id;
      items.push(pending);
      pendingDraftApplied = true;
    }
    renderItems(items);
    if (pendingId) {
      const card = Array.from(itemsRoot.querySelectorAll('.item')).find((item) => item.dataset.id === pendingId);
      if (card) { card.classList.add('pending'); card.scrollIntoView({ behavior:'smooth', block:'center' }); card.querySelector('input,select')?.focus(); }
    } else if (state.focusItemId) {
      const card = Array.from(itemsRoot.querySelectorAll('.item')).find((item) => item.dataset.id === state.focusItemId);
      if (card) { card.classList.add('focused'); card.scrollIntoView({ behavior:'smooth', block:'center' }); card.querySelector('input,select,textarea')?.focus(); }
      else showMessage('這筆公告已不存在；已顯示目前最新的公布欄。', true);
    }
    if (!state.focusItemId || items.some((item) => item.id === state.focusItemId)) {
      const expiry = state.expiresAt ? new Date(state.expiresAt).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'}) : '';
      showMessage(state.board.stale ? (state.board.message || '目前顯示上次同步資料；發布時會再次核對版本。') : '已登入'+(expiry ? '，本次登入有效至 '+expiry : '')+'。按「確認並發布」才會更新所有人的公布欄。', state.board.stale);
    }
    byId('revision').textContent = '共享版本 '+baseRevision+' ・ 最後更新 '+(baseRevision ? new Date(state.board.snapshot.updatedAt).toLocaleString('zh-TW') : '尚未發布');
  }
  async function run(action) {
    if (busy) return;
    setBusy(true);
    try { const result = await action(); if (result) render(result); }
    catch (error) { showMessage(error instanceof Error ? error.message : '操作失敗，請重試。', true); }
    finally { clearSecret(); setBusy(false); }
  }
  byId('auth-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void run(() => bridge.login({ username:byId('username').value, password:byId('password').value }));
  });
  byId('add-expiry').addEventListener('click', () => add('expiry'));
  byId('add-promotion').addEventListener('click', () => add('promotion'));
  byId('save').addEventListener('click', () => void run(() => bridge.save({ baseRevision, items:collectItems() })));
  byId('cancel').addEventListener('click', () => { clearSecret(); void bridge.close(); });
  byId('close').addEventListener('click', () => { clearSecret(); void bridge.close(); });
  addEventListener('pagehide', clearSecret);
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
