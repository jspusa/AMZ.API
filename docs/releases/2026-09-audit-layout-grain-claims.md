# 0.1.79 健檢修正交付帳本

規格：[健檢排版、圖片門檻入口與無穀宣稱](../specs/2026-09-audit-layout-grain-claims.md)。

- Base `03378b8a23320fd8dd259521f184499b74f881f8`；獨立工作副本與分支 `codex/audit-layout-image-controls-20260916`，保留原 checkout 的未追蹤檔。
- 原生 .78 已讀取使用者本次健檢結果，重現兩個標籤與長原因被三欄 grid 擠壓重疊；只切換既有結果篩選，未重新掃描、預檢或寫入 Amazon。
- 原共用宣稱規則沒有無穀／穀物核對；產品描述已排除。本次新增規則並保留原有描述排除。
- Production renderer 合成資料視覺已核對 1440／390 px × 標準／大字 × 深／淺色八組：兩標籤與長原因均無重疊、無列外溢、無文件水平溢出。另四組圖片頁核對 1–10 選项、選取 10 張與首頁無選單；選單實測 84 px，沒有撐滿版面。只使用測試 Bridge，未連線 Amazon。
- 第一次完整檢查 4,281 項通過，7 項因版本與 CSS 組成基準待更新失敗；按實際組成更新 canonical 1,215,441 字元、LF 881,303 bytes／29,771 行與 CRLF 911,074 bytes，規則 fingerprint `73457f11b00957c3d15a4d6848c7bc7d6d680638085e0d8d06482e31d2147cd7`。保留所有檢查，未放寬驗證。
- 本機檢查、視覺與審查證據如下；本輪 CI、Pages、兩平台 artifact、安裝與受保護下載的後續狀態分列於下，不沿用 .78 成功證據。
- 第一輪 Standards 0 findings；Spec 的兩個 P2（括號內否定吞掉後續 Rice、may also／might contain 誤當正向證據）已在公共 seam 重現並修正。新增十個案例後 grain 46 tests、五檔共 200 tests 通過；產品描述持續排除。
- 圖片頁站點選單亦收斂成內容寬度，最後樣式契約為 canonical 1,215,581 字元、LF 881,386 bytes／29,772 行、CRLF 911,158 bytes，fingerprint `2b3a99bd0324c3746a451682aefb68cb6ceb1addfac25ab415cf16fbce452ce9`。
- 最終程式 HEAD `5dfe2f683cad6eb7d80d0259a9089ff595a373dd`：`VITEST_MAX_WORKERS=4 npm run check` 全數通過（334 files／4,298 tests、typecheck、build、stylesheet contract）；`npm audit --omit=dev` 0 vulnerabilities；`git diff --check` 通過。
- 最終獨立 Standards 0 actionable findings（另驗證 7 files／78 tests）；Spec 0 open findings，前述兩個 P2 已解決（另驗證 2 files／50 tests）。
- 最後 production build 在一般視窗與 390 px 大字核對：圖片站點選單 173 px，張數選單 84 px，均無頁面水平溢出；首頁不再顯示張數選單。測試資料未連線 Amazon。

## 正式來源與 CI

[PR #300](https://github.com/jspusa/AMZ.API/pull/300) 已於 2026-09-16 02:42:51 UTC 合併。0.1.79 runtime 固定為 `6d85bd0dd00b7531b382a046c964c35342df712d`；tree 與合併候選 `2029c62f4e4a8df880a6faba430798d6b6674aac` 相同，候選相對已審查程式 `5dfe2f683cad6eb7d80d0259a9089ff595a373dd` 只補交付帳本。

以下四條均為該 exact source 的 `main`／`push`，attempt 1 全數成功。Pages 採用 push run，不採用 issue-close 事件的另一條 run。

| 工作流 | Run | Attempt | 結果 | Artifact ID |
|---|---|---:|---|---|
| Validate | [35049042164](https://github.com/jspusa/AMZ.API/actions/runs/35049042164) | 1 | ★ success | — |
| macOS universal | [35049042163](https://github.com/jspusa/AMZ.API/actions/runs/35049042163) | 1 | ★ success | `10427974258` |
| Windows x64 | [35049042168](https://github.com/jspusa/AMZ.API/actions/runs/35049042168) | 1 | ★ success | `10428152929` |
| GitHub Pages | [35049042160](https://github.com/jspusa/AMZ.API/actions/runs/35049042160) | 1 | ★ success | `10427714824` |

PR Validate `35048275029` attempt 1 成功。PR Windows `35048275023` attempt 1 的既有 report-persistence 測試碰到 5 秒期限，沒有 assertion failure；核對後相同 SHA 唯一重跑 attempt 2 成功，未調整 timeout 或削弱測試。這不證明 runner timing 的根因；正式 main 四條皆於 attempt 1 成功。

本輪本機證據目錄為 `/tmp/amz-api-v0179-verified`。`release-config.json` 固定來源、run attempts 與 artifact IDs；`source-main-verification.json` 確認 runtime 位於 main 且版本為 0.1.79，該 proof SHA-256 為 `d0d82910e28124b95d5ede0b4c1f9f23b76fed2287a6f3913542712edefeecf8`。後續文件更新不改變 runtime artifact 來源。

## Pages、產物與原生畫面

| 層級 | 狀態 | 本輪證據與界線 |
|---|---|---|
| 線上 Pages | ★ 已核對 | exact-run artifact 對照正式網址：`index.html` 與全部 11 個 JS／CSS bytes、SHA-256 相同；包含兩個必要 lazy modules，`pages/pages-byte-verification.json` 為 `allEqual: true`。 |
| Windows 產物 | ★ 靜態驗證完成 | archive／manifest／ZIP／Setup bytes 與 hash 相符；主程式及 Hello addon 為 PE32+ AMD64，N-API export、ASAR 0.1.79、addon manifest 邊界及八項 fuses 全數通過。未執行 Windows 程式，不代表 Authenticode、SmartScreen 或真人 Windows Hello 已驗。 |
| macOS 產物 | ★ 已核對 | archive／manifest／DMG／ZIP bytes 與 hash 相符；ZIP bundle 為 arm64／x86_64 universal，ASAR 0.1.79、deep strict ad-hoc codesign、兩個架構的八項 fuses 及讀取後完整性全數通過。可信 DMG 已唯讀掛載，安裝後 App 另已核對。 |
| 正式 UI 原生目視 | ★ 已核對本次 Pages | 仍使用 .78 Notebook Key，普通重新載入後首頁不再有圖片張數選單；圖片健檢頁保留原 8 張偏好，站點與張數選單均已收窄，最後返回首頁。此次未啟動圖片掃描、預檢或 Amazon 寫入。 |
| .79 安裝與資料保留 | ★ 已核對 | App 停止期間完成 0700 userData 備份並安裝可信 DMG；.78 App 備份保留、vault／ledger bytes 未變。已安裝 universal App 的 ASAR 與本輪產物一致，deep strict codesign 通過。 |
| 安裝後原生驗收 | ★ 連線狀態顯示與導覽已驗／☆ 新掃描待驗 | .79 已重新開啟，原生首頁顯示 Amazon 已連線，且可開啟文案健檢頁。首頁狀態不單獨證明新的 Listings／Seller ID 能力。兩次掃描操作均在 CUA 的 `user-changed` 邊界被阻止，未送出新掃描；不能把既有結果當成新版完整健檢已完成。 |
| 受保護下載卡上傳 | ★ 兩卡完成回應已核對 | 依 Mac → Windows 順序取得 server complete receipts；兩卡皆為 0.1.79，名稱、bytes 與 SHA-256 均符合下表可信 DMG／Setup。 |
| 員工實際下載 | ☆ 待登入與驗證 | 兩個既有員工頁 tab 皆仍為登入表單，原登入請求尚未答覆；需員工登入、一般下載按鈕事件與新本機檔案 bytes／hash。管理上傳授權不代替員工下載證據。 |

| 可信交付檔案 | Bytes | SHA-256 |
|---|---:|---|
| `AMZ.API-0.1.79-universal.dmg` | 246749597 | `9fa18d2c0ddcf9ce6054a451e5c299f504214fe6cab146b14a6bae4a2c90e736` |
| `AMZ.API-0.1.79-universal.zip` | 222213150 | `f2c1daba559da6b455d5586d63221e672f1280ca42d5666758b8c4197c7d5775` |
| `AMZ.API-Notebook-Key-Windows-x64.zip` | 143397269 | `4c8a078f15334817c7715c67087a0537e59b27624a06d98297dd44d2a4fc545c` |
| `AMZ.API-Notebook-Key-Windows-x64-Setup.exe` | 102082681 | `1212e7ef64692a77f2fe386285e9869ebef085f68345f70d08e40361fbc016e7` |

Mac ASAR SHA-256 為 `362a4a124c9302051d2572a7d8e61c2f38a29cfd284fb0bef1d8905511bdf208`；Windows ASAR 為 `70022240eb36e0127605f5453600f95a0fffd042456c392f702c023189affa3e`。兩平台 update channel 皆為 `disabled`。

Mac 架構檢查初次遇到 Xcode license 提示，保留第一次解壓結果於 `macos/zip-bundle-lipo-license-attempt1`，改用既有 CommandLineTools 的 `DEVELOPER_DIR` 執行並完成全部原檢查；未接受 license、修改 OS 工具選擇或調整 helpers。重開 App 的首次 CUA 選取 timeout 後，fresh `getApp` 成功取得已連線畫面，該 timeout 不作為認證故障證據。

已安裝位置為 `/Applications/AMZ.API.app`；舊 App 保留於 `/Applications/AMZ.API-v0.1.78-backup-before-0179-20260916.app`，舊 ASAR 為 `0f397fc9b2a9a29a529c9ba3318a7e8ae939416d770e3e873a99e101d20a4d97`。備份與換版過程只記錄完整性結果，未保存私人業務內容或憑證至此帳本。

產物細節保存在 `macos/verification.json`、`macos/zip-bundle-verification.json`、`macos/zip-bundle-fuses-verification.json`、`windows/verification-result.json`、`windows/fuses-verification.json` 及各平台 `ci-verification.json`；安裝與資料保留為 `installation-verification.json`、`user-data-backup-verification.json`；上傳為 `portal-upload-macos-dmg-receipt.json`、`portal-upload-windows-installer-receipt.json`；原生目視記錄為 `runtime-delivery-observations.md`。上述皆屬本輪證據，未以本機 CI 或未簽章測試包推定 live Amazon 寫入、正式簽章或生物辨識驗收成功。
