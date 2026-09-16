# AMZ.API 下載入口遷移交付帳本

[Issue #302](https://github.com/jspusa/AMZ.API/issues/302)；[核准範圍](../specs/2026-09-download-portal-url.md)。

- 開工 source 為 freshly fetched `origin/main`：`15f716db7d88d9b467f643fcf6b2c7640346f030`。獨立 worktree 與分支 `codex/download-portal-url-20260916` 保留原 checkout。
- Canonical 入口：`https://amz-api-downloads.brave-prawn-0848.chatgpt.site/downloads`。下載站由 ChatGPT Sites 持有；repo 只修改共用安裝連結、現行文件與既有 public seam 測試。
- 版本保持 0.1.79；繼續使用 runtime `6d85bd0dd00b7531b382a046c964c35342df712d` 的既有可信 DMG／NSIS。產物來源、bytes 與 SHA-256 以[0.1.79 帳本](2026-09-audit-layout-grain-claims.md)為準，本輪不重新打包或安裝。
- Sites 下載專用串流代理沿用原私有 R2 的一份安裝檔；新站不複製安裝檔儲存。舊 `/downloads` 與 `/downloads/` 已提供相容導向。已安裝 Notebook Key 的 main-owned 更新提示仍可能含舊網址；新 Pages 不會替換已安裝 main bundle。
- 圖片、公布欄與 maintenance origins、Amazon 功能、憑證、原生授權與 public update-feed approval 均保持原有邊界。
- 聚焦測試先在 WebGate 渲染與 update-policy 公開輸出重現舊網址：既有 11 tests 中 2 個目標網址斷言失敗、9 個通過。第一次直接呼叫 runner 少了 generated stylesheet，已改用包含既定 pretest 的 npm script，未改測試或 production 來規避。

## 分層證據

| 層級 | 狀態 | 證據與界線 |
|---|---|---|
| Repo 實作 | ★ 已驗 | WebGate 與 main guidance 共用新的 canonical constant；README、handoff 同步；既有測試固定核對新入口。Production renderer bundle 已包含 canonical URL。 |
| 聚焦測試 | ★ 通過 | `npm run test -- tests/web-gate.test.tsx tests/update-policy.test.ts`：2 files／11 tests。 |
| 完整檢查 | ★ 通過 | `VITEST_MAX_WORKERS=4 npm run check`：334 files／4,298 tests、typecheck、build、stylesheet verification；`npm audit --omit=dev` 0 vulnerabilities；`git diff --check` 通過。 |
| 獨立審查 | ★ 兩軸 0 findings | Read-only reviewer 核對 Standards、Spec／安全與證據紀錄；範圍為本輪 repo diff，不含 Sites 實作或線上驗收。 |
| CI | ★ PR 與正式 main 已通過 | PR Validate／Windows 及 main Validate／Pages 均為 attempt 1，來源與 run 見下表。 |
| GitHub Pages | ★ 完整 bytes 已驗 | exact-main Pages artifact 的全部 16 個檔案與線上 bytes／SHA-256 相同；根入口 `/AMZ.API/` 也符合 `index.html`，live entry JS 含新 canonical URL。 |
| Sites 服務 | ★ 新入口與相容導向已驗 | 新站 public access 只顯示下載密碼表單；匿名 `GET /downloads` 為 200，無 ChatGPT 登入跳轉；無下載 session 的 manifest／file 皆 401。舊兩個入口皆 302 至 canonical URL。 |
| 密碼輪替 | ★ 已驗 | 新密碼登入 200、舊密碼 401；舊 backend session 與舊短效下載 link 均 401。僅保存結果，不保存秘密或驗證值。 |
| 完整下載 bytes | ★ authenticated HTTP 已驗 | 新 gateway v2 當時仍私人，以平台擁有人 QA 授權再通過應用層下載密碼，兩份完整串流皆 200，大小／SHA-256 與既有 .79 可信產物相符。此證據不冒充一般 UI 落地檔案。 |
| 一般瀏覽器 UI | ★ 免 ChatGPT 登入已驗／☆ 落地 bytes 未驗 | public access 生效後，以新下載密碼登入成功；兩卡 .79 名稱／大小／hash 正確。兩個按鈕均顯示「下載已開始」，但 in-app browser 未產生可辨識的新本機檔，不能視為一般 UI 落地 bytes 已驗。 |
| Notebook Key／Amazon | ★ 本輪無新增操作 | 不建立桌面版本／產物、不安裝、不送 Amazon 呼叫；既有原生與 Amazon 待驗事項原樣保留。 |

下載密碼、verifier、session 及管理 secrets 僅由 Sites owner 的受保護流程處理；本帳本不保存其值。發布、登入、串流 bytes 與 repo CI 各自只能證明對應層，不互相替代。

## 正式 source 與 Actions

[PR #303](https://github.com/jspusa/AMZ.API/pull/303) 於 2026-09-16 03:53:24 UTC 正常合併，match head `6bd0effe7524e4663631775417fd035cf369dfdf`，未使用管理員 override。Control Console source 為 `6a184fc10d2b30d42a6f956fd056a9a1e16a5e69`，與已審查 head 的 tree 完全相同；不將此 SHA 的自動桌面測試 build 當成新的 .79 runtime 交付來源。

| 範圍 | Run | Event／來源 | 結果 |
|---|---|---|---|
| PR Validate | [35052908012](https://github.com/jspusa/AMZ.API/actions/runs/35052908012) | `pull_request`／`6bd0eff` | ★ attempt 1 success |
| PR Windows | [35052907987](https://github.com/jspusa/AMZ.API/actions/runs/35052907987) | `pull_request`／`6bd0eff` | ★ attempt 1 success |
| Main Validate | [35053503566](https://github.com/jspusa/AMZ.API/actions/runs/35053503566) | `push`／`6a184fc` | ★ attempt 1 success |
| Main Pages | [35053503622](https://github.com/jspusa/AMZ.API/actions/runs/35053503622) | `push`／`6a184fc` | ★ attempt 1 success；`github-pages` artifact `10429866946` |

2026-09-16 03:57:54 UTC 完成全部 16 檔比對：`index.html`、全部 11 個 JS／CSS、3 份字典授權文件及公布欄 JSON；根入口另以 exact index bytes 核對。驗證拒絕 redirect、每次 HTTP timeout 30 秒、限制回應大小，沒有從 repo 本機 build 推定正式部署。證據目錄為 `/tmp/amz-download-link-20260916-pages-6a184fc`，`pages-byte-verification.json` 的 `allEqual`、`entryUrlBytesMatch` 與 `canonicalPortalPresent` 皆為 true；artifact tar SHA-256 為 `9c17eb48d3d708be117e0cf1d05322f360f7b982286e18e29c0d94dcee204252`。workflow source、branch、event、attempt、成功狀態與唯一未過期 artifact provenance 均另有 JSON 固定。

## Sites 與下載證據

新 gateway 為 version 2、source `c6b1ae3a56fbff9c56702129acae94805aa15973`、deployment `appgdep_6aaa112099a88191b42381718e690ea7`。使用者其後明確選擇只需下載密碼，Sites access 改為 public；route 仍以應用層密碼保護檔案。

既有 backend 為 version 13、source `bbb4bd3c4774aec8ad1510e703973be34c424f7c`；密碼輪替 deployment `appgdep_6aaa1047bb9481919db13d8e3b07a7e2`。相容導向使用 environment revision 13、deployment `appgdep_6aaa128d14308191a67a16d21e42a192`，不重新打包站點程式。圖片、公布欄、maintenance 原有來源與授權邊界保留。

| 新 gateway 完整 HTTP 串流 | Bytes | SHA-256 |
|---|---:|---|
| ★ `AMZ.API-0.1.79-universal.dmg` | 246749597 | `9fa18d2c0ddcf9ce6054a451e5c299f504214fe6cab146b14a6bae4a2c90e736` |
| ★ `AMZ.API-Notebook-Key-Windows-x64-Setup.exe` | 102082681 | `1212e7ef64692a77f2fe386285e9869ebef085f68345f70d08e40361fbc016e7` |

Sites owner 的去敏證據在 `/tmp/amz-download-migration-20260916-evidence.json`。本輪沒有下載本次 main 的桌面測試產物、沒有安裝或 Amazon 呼叫；原 .79 runtime 與舊原生驗收界線保留。
