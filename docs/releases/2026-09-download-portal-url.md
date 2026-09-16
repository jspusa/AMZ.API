# AMZ.API 下載入口遷移交付帳本

[Issue #302](https://github.com/jspusa/AMZ.API/issues/302)；[核准範圍](../specs/2026-09-download-portal-url.md)。

- 開工 source 為 freshly fetched `origin/main`：`15f716db7d88d9b467f643fcf6b2c7640346f030`。獨立 worktree 與分支 `codex/download-portal-url-20260916` 保留原 checkout。
- Canonical 入口：`https://amz-api-downloads.brave-prawn-0848.chatgpt.site/downloads`。下載站由 ChatGPT Sites 持有；repo 只修改共用安裝連結、現行文件與既有 public seam 測試。
- 版本保持 0.1.79；繼續使用 runtime `6d85bd0dd00b7531b382a046c964c35342df712d` 的既有可信 DMG／NSIS。產物來源、bytes 與 SHA-256 以[0.1.79 帳本](2026-09-audit-layout-grain-claims.md)為準，本輪不重新打包或安裝。
- Sites owner 正準備下載專用串流代理，沿用原私有 R2 的一份安裝檔，並提供舊 `/downloads` 相容導向。已安裝 Notebook Key 的 main-owned 更新提示仍可能含舊網址；新 Pages 不會替換已安裝 main bundle。
- 圖片、公布欄與 maintenance origins、Amazon 功能、憑證、原生授權與 public update-feed approval 均保持原有邊界。
- 聚焦測試先在 WebGate 渲染與 update-policy 公開輸出重現舊網址：既有 11 tests 中 2 個目標網址斷言失敗、9 個通過。第一次直接呼叫 runner 少了 generated stylesheet，已改用包含既定 pretest 的 npm script，未改測試或 production 來規避。

## 分層證據

| 層級 | 狀態 | 證據與界線 |
|---|---|---|
| Repo 實作 | ★ 已驗 | WebGate 與 main guidance 共用新的 canonical constant；README、handoff 同步；既有測試固定核對新入口。Production renderer bundle 已包含 canonical URL。 |
| 聚焦測試 | ★ 通過 | `npm run test -- tests/web-gate.test.tsx tests/update-policy.test.ts`：2 files／11 tests。 |
| 完整檢查 | ★ 通過 | `VITEST_MAX_WORKERS=4 npm run check`：334 files／4,298 tests、typecheck、build、stylesheet verification；`npm audit --omit=dev` 0 vulnerabilities；`git diff --check` 通過。 |
| 獨立審查 | ★ 兩軸 0 findings | Read-only reviewer 核對 Standards、Spec／安全與證據紀錄；範圍為本輪 repo diff，不含 Sites 實作或線上驗收。 |
| CI | ☆ 尚未 push | 同 source 的正式 Actions 待發布階段核對。 |
| GitHub Pages | ☆ 未發布 | 核對正式入口與 exact source 的發布 bytes。 |
| Sites 服務 | ☆ 發布與 live 待驗 | 新 canonical 頁、下載保護、輪替後驗證及舊入口相容導向由 Sites owner 核對。 |
| 員工實際下載 | ☆ 待登入與 bytes 驗證 | 一般下載按鈕取得 Mac／Windows 檔案後，核對大小、SHA-256 與既有可信產物。 |
| Notebook Key／Amazon | ★ 本輪無新增操作 | 不建立桌面版本／產物、不安裝、不送 Amazon 呼叫；既有原生與 Amazon 待驗事項原樣保留。 |

下載密碼、verifier、session 及管理 secrets 僅由 Sites owner 的受保護流程處理；本帳本不保存其值。發布、登入、串流 bytes 與 repo CI 各自只能證明對應層，不互相替代。
