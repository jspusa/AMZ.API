# 0.1.66 圖片生物辨識與確認流程

Issue [#254](https://github.com/jspusa/AMZ.API/issues/254)。規格見 [圖片登入與送出操作簡化](../specs/2026-09-image-biometric-confirmation.md)。

Source base：`147a14a2afbe19a06adc1ee8192038f2fc58b78e`。開發分支：`codex/image-touch-id-confirmation-20260912`。版本 0.1.66 已由 [PR #255](https://github.com/jspusa/AMZ.API/pull/255) 合併至 main `afbffdd85a2685992dc2c3341f79dbdd3a86c2fc`；同來源網站與兩平台產物已發布驗證，Mac／Windows 下載卡上傳完成。這台 Mac 已安裝可信 0.1.66，保留舊 App 與 userData 備份；新版程序已啟動，系統授權與原生功能驗收尚待完成。

## 行為

首次完成圖片登入及原生授權後，Notebook Key 保存獨立的系統加密登入資料；後續重開或安全環境失效後，以 Touch ID／Windows Hello 重新解鎖登入。圖片 Amazon 預檢通過後直接顯示商品與變更位置，不再重打 SKU，按送出才進入一次原生確認。

首次保存、後續解密、取消／鎖定與明確認證失敗的行為，須以實作及聚焦安全測試核對。服務仍維持八小時記憶體 session；不擴大 server audience、不保存 image token、不改下載或公告登入。

## 分層驗收

| 範圍 | 證據／狀態 |
| --- | --- |
| ★ Source | 已完成圖片登入 OS 加密保存、Touch ID／Windows Hello 解鎖，以及免重打 SKU 確認；保留原 main Write Gate、idempotency 與 native confirmation |
| ★ Check／audit | 最終 `VITEST_MAX_WORKERS=4 npm run check`：323 files／3,754 tests、型別與 build 通過；`npm audit --omit=dev`：0 vulnerabilities；`git diff --check` 通過。降低本機同時測試數以避免既有 durable I/O 測試受磁碟競爭而逾時，原 5 秒門檻未改。Windows CI 首輪指出 POSIX mode 不適用，僅對 Windows 略過該斷言，仍執行加密與重新開啟檢查 |
| ★ 兩軸 review | Standards／Spec 均核對 `147a14a…33af1149acf050a7770cdacf1a5254d5a7027c1b`，各 0 open。Spec 所見 ASIN／Product Type 漂移與 Standards 所見 context cache 清除缺口已修復；main 查詢憑據綁定、失效清除與遲到結果拒絕均有 public seam 測試 |
| ★ 同 source CI／Pages／兩平台 artifact | main/push Validate `34703293096`、Pages `34703293147`、Mac `34703293079`、Windows `34703293060` 均 success，attempt 1。Pages artifact `10300676804` 的 HTML 與全部 11 個 JS／CSS 與線上 bytes 一致；Mac artifact `10300986368`、Windows artifact `10301635948` 的 archive／manifest／payload hashes 均相符 |
| ★ 0.1.66 Mac 安裝 | 舊版正常 Command-Q 並確認退出後，完成 0700 userData 備份，再由可信 DMG 換版。已安裝 App 的 ASAR 與可信 artifact 一致，universal 與 deep/strict adhoc codesign 通過；0.1.65 App 保留，換版期間 vault／ledger bytes 一致 |
| ☆ 0.1.66 原生畫面與圖片登入 | 新版程序已啟動，但 CUA 取得 App／讀取畫面逾時，同時觀察到 SecurityAgent 執行中；工具基於安全禁止操作系統授權程序。已請使用者完成 macOS 授權，尚未看見新版 UI。初次加密保存、重開後 Touch ID 及新版確認頁原生驗收待完成 |
| ★ 下載卡上傳 | Mac→Windows 兩次 uploader exit 0、complete 回覆成功，保留既有卡片 ID、平台與名稱，改為 0.1.66 及可信檔案 bytes／hash |
| ☆ 員工下載實體檔 | 現有下載頁顯示登入畫面；尚未建立本版員工下載，登入後需核對兩卡及新完成檔案大小／hash。上傳完成不等於員工成功下載 |

## 2026-09-13 交付證據

PR head `6b43d91c292ad956eda93b73e783104f679aa119` 的 Validate `34702887230` 與 Windows `34702887228` 成功後合併；reviewed tree 與 main tree 都是 `e5d756fe3ddbbea1e606d382eb68bd56224aab47`。

| 可信產物 | 大小（bytes） | SHA-256 |
| --- | ---: | --- |
| ★ Mac 0.1.66 universal DMG | 247359322 | `aaa954316ce6c3cd0b82a5e27e79aee872b1e153e1d7edad3ff0ef0940534861` |
| ★ Mac universal ZIP | 222186853 | `f67c79cac54d13c0b53a20e6416a7e4663542fd67f04791cdd2ef9b2e7037c8a` |
| ★ Windows x64 Setup.exe | 102059351 | `5434c14a5115b92f7327889ce1518071cb08d49d09f3a32a52cfea362e685ada` |
| ★ Windows x64 ZIP | 143372011 | `e8d0ad5031af5c7ac797b0f21bc288fb7d4a34e90d72ff93aa47d473979b79f3` |

Mac ASAR `a06cd5ecf4e803fadbbbca0a964e5a701ef4347e89bd17b93b41179b0c2e4ccd`；Windows ASAR `2d1453e877df7d8cf6fc108295ceed4bdf6411adf6c084dd7b24ae1efceb0a64`，後者的 AMD64 N-API addon、唯一 unpacked 路徑、packed manifest hash 與 8 項 fuses 均核對。兩平台 package 為 0.1.66／update channel disabled；CI 不代表真人生物辨識或 live Amazon。

新證據及可接續 helper 在 `/tmp/amz-api-v0166-verified/`；可信 DMG 已唯讀掛載並核對 App。`installation-verification.json` 綁定 source `afbffdd85a2685992dc2c3341f79dbdd3a86c2fc`、Mac run `34703293079`、artifact `10300986368`，證明 `/Applications/AMZ.API.app` 已是 0.1.66 universal、update channel disabled，ASAR 為上述可信 Mac hash，deep/strict adhoc codesign 通過。舊版保留於 `/Applications/AMZ.API-v0.1.65-backup-before-0166-20260912.app`，其 ASAR 為 `1820bfa0d35298ed37ee3159531023d3da94dc216b058c49f71be3ece56b1638`。

`user-data-backup-verification.json` 記錄換版前正常停止 0.1.65、建立權限 0700 的 `20260912-before-0166` userData 備份，vault／ledger bytes 均保留；安裝證據另核對 swap 全程 App 已停止、換版期間 vault／ledger bytes 一致。這些是備份與安裝證據，不代表新版已成功解密憑證或完成原生驗收。

`native-acceptance-20260913.json` 記錄安裝前 Mac 已可操作，舊版首頁沒有寫入確認或 active image workspace，正常 Command-Q 後確認程序退出。安裝後觀察到新版 PID `77466` 與系統授權 PID `77471`；CUA 取得 App／讀取畫面逾時，且明確禁止操作 `com.apple.SecurityAgent`。已請使用者完成當前 macOS 系統授權；若系統提供 Touch ID 可由使用者使用。尚未看見 0.1.66 UI，不能把程序存在當成授權成功、圖片加密登入、Amazon 連線或功能通過；本輪 agent 未送 Amazon Preview、原生寫入批准或 mutation。

先前安裝暫停期間，原生工具曾回報 Mac locked／自動解鎖失敗；使用者已提供「鎖定使用」開啟的畫面，當時未查到確切原因，不能歸咎為使用者沒有啟用設定。這是已由上述安裝進度接續的歷史卡點；目前待完成的是新版啟動授權與 UI 觀察。App 圖片服務的一次初始設定、macOS 系統授權與 Codex 的 Mac 自動解鎖是不同項目。

## 保留的 0.1.65 原生證據及未完成範圍

0.1.65 曾在實際 Mac 重開後保留 large／pink／dark，已恢復 standard／default／light。使用者提供的完整 Vine 原頁已保存 25 筆來源資料，主清單只有 11 筆進行中；14 筆結束項目不顯示，六月仍進行中的登記保留，22／30 的評論回收進度條及重新讀取均已核對。

原生 AFA12AM 圖片查詢及 01–09 整批對照通過，圖片服務登入後顯示「草稿就緒 9 張、暫存待準備 0 張」，每張套用至正確位置，安全預檢按鈕可用。`HostedListingImages` 只有在固定 URL 的匿名讀回 bytes／hash 與原檔相符後才回 ready；這是已安裝 0.1.65 的直接準備證據。Agent 未送 Amazon Preview、原生寫入批准或 PATCH；後續使用者自行操作不從此證據推定成功。之後原生畫面顯示安全環境變更，草稿停止並保留圖片，未自行重送。

全部 FBA 效期同步曾由原生入口啟動；鎖屏後重開與讀取本機資料均顯示 idle、無 job／snapshot。Owner 確認 lock/context 清除會中止 main job，關閉 panel 本身不會；尚未取得完整實機結果。原始需求的全 FBA 效期／銷速、免原表價目表實際 Excel、健檢→變體導覽、圖片門檻結果及實際員工下載驗收仍保留，不因本輪 UI 修正縮小結案範圍。
