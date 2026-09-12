# AMZ.API — Codex 交接入口

更新：2026-09-12。Repository：`jspusa/AMZ.API`；控制台：`https://jspusa.github.io/AMZ.API/`。

## 開始工作

1. 讀本文件，再依 [任務必讀表](agents/required-reading.md) 讀相關安全／功能契約及 owner；不用重讀全部發行歷史。
2. 檢查 working tree、分支與 origin 的 exact SHA，保留使用者和其他 agent 的變更。依 `package.json` 安裝鎖定依賴。
3. 依已核准 spec 實作，先在約定 public seam 重現問題，再執行聚焦驗證；最後跑 `npm run check`、`npm audit --omit=dev` 及 `git diff --check`。
4. 建立可審查變更，核對同一 commit 的 Actions 後才合併／發布。發布、artifact、安裝和 live 驗證分開記錄，不能從前一步推定後一步成功。

## 目前狀態

- Issue #250 已由 PR #251／main `3584b3bb775ceb0e645fa2e4a403314016bac037` 合併 0.1.65：圖片改用專用代管並支援 01–10 排序、效期／銷速有全部 FBA 的獨立同步入口、Vine 直接貼整頁且只顯示未結束登記。3,690 tests、兩軸 final review、四條 exact main CI、Pages HTML 與全部 11 個 JS／CSS、Mac／Windows 可信 artifact 均通過；Supply Boss 圖片服務 version 7 已成功發布。Mac 已安裝 0.1.65 universal，ASAR 與可信 artifact 相符，0.1.64 App 與 0700 userData 備份保留，換版期間 vault／ledger bytes 一致。啟動後只確認 App／SecurityAgent 程序存活，尚未看見新版 UI；Keychain／儲存視窗待使用者處理，偏好重啟與 live 驗收仍待完成。Mac→Windows 下載卡上傳完成；使用者重新登入後已核對兩卡版本／hash 並先後啟動下載，但本機驗證仍缺本次 Mac 新檔，實際下載 bytes 尚未驗收。新需求、待恢復的驗收用外觀設定及各層證據見 [補充 spec](specs/2026-09-direct-images-expiry-vine.md) 及 [0.1.65 帳本](releases/2026-09-direct-images-expiry-vine.md)。

- 0.1.64 已由 PR #246／main `074c78a41276ee013c832fc9ad88de3a59c8d9c8` 合併；3,583 tests、四條 exact main CI、Pages 全部 bytes 與兩平台 artifact 已驗，安全下載頁兩卡上傳完成。Mac 已安裝 0.1.64 universal，ASAR 與可信 artifact 相符；保留 0.1.63 App、0700 userData 備份及換版期間的 vault／ledger bytes。Keychain 等待已解除，原生 UI 已顯示 Vine 手動來源／日期／未知標籤、使用者選定單 SKU 的 LIVE 圖片查詢結果與整組拖入區；偏好重啟保存及健檢→變體工作區導覽仍待驗，單 SKU 畫面不代表全部 Amazon 能力或寫入已驗。使用者回報拖入圖片因未設定 R2／CDN 而暫存待公開網址，按鈕顯示「檢查並套用 0 張」，完整圖片更新仍受阻。員工登入後已看見兩卡版本／hash 正確與下載開始訊息，但最後檔案核對仍缺少本次下載檔。Issue #245 整合庫存健康、免原表價目表、外觀記憶、變體工作區載入恢復、圖片批次分槽、Vine 手動資料進度與圖片張數門檻（1–9、預設 8）。自動行事曆只收已確認批次的正清售缺口，保存資料在 App／帳號環境重開後須重新健檢才能恢復預估；保留原人工公告。實作、review、CI、Pages、兩平台 artifact、安裝與員工下載的實際完成狀態以 [0.1.64 分層帳本](releases/2026-09-inventory-workflow.md) 為準；不得由 source 版本推定交付成功。需求見 [spec](specs/2026-09-inventory-workflow.md)。
- 0.1.63 已由 PR #237／main `6086d8dbbf85226540c333adc7d3e717cb59a8ac` 完成兩軸 review、本機 check（297 files／3,396 tests、audit 0）、四條 exact main CI、全部 Pages bytes 及 Mac／Windows 可信 artifact 核對。Mac 正式版已安裝，保留 0.1.62 App 備份及安裝當時的 vault／ledger bytes；原有 `TPZ01AM-4` 待確認 attach 已由新 GET 路徑顯示「★ 先前操作已由 Amazon 唯讀回查確認」，目標為 `AF Turkey Tedon_Small`，family 19 FBA。本輪 agent 未送 Preview、原生批准或 PATCH；結案的是 0.1.62 外部使用者互動後的既有操作。兩平台 0.1.63 下載卡上傳已完成，員工登入後實際下載／hash 核對仍待完成。接續交付請讀 [0.1.63 分層帳本](releases/2026-09-variation-readback-recovery.md)；先前液體資料 Preview 與受理歷史保留在 [0.1.62 帳本](releases/2026-09-variation-preserved-required-facts.md)。
- 0.1.59 實機已解決 `1MGRD015A0` 的未綁清單入口，但原始 TPZ 與目標完整讀取後仍在準備階段遇到 theme 站點條件不明，未送 Preview／mutation。Issue #225 的 `0.1.60` 依官方範例與 production 單站 provenance，僅保留完全缺席 selector 的唯一 matching theme，不補欄位或 PATCH theme；malformed／跨站／漂移仍阻擋。本機 check 290 files／3,088 tests、audit 0 已通過；發布、安裝與實機 Preview 依 [本輪帳本](releases/2026-09-single-market-theme-preservation.md) 更新，不能由 .59 成功推定。
- 0.1.59 的獨立 FBA preparation 與來源文字價格差額修正已由 PR #222、#224 合併，最終 release-code SHA `73ca77ec7b7ce6aab80fd5950949122a9b908d8a`，保留 PR #217。完整空 relationships 保留 provenance；精確符合目標的唯一既有 theme 原樣保留；文字價格參與 UI／export 差額但不改原表型別。最終本機 check 290 files／3,067 tests、audit 0、Standards／Spec 均通過；PR checks 與最終 main 的 Validate／Pages／Mac／Windows 均成功，Mac 首次 timeout 的診斷及唯一重跑另有保留。線上入口與全部 9 個 JS／CSS、兩平台可信 artifact bytes／hash 已驗；`/Applications/AMZ.API.app` 已換為 0.1.59 universal 並開啟、Amazon 已連線，0.1.58 備份與 vault bytes 保留。新版健檢 285 FBA／76 獨立／1 未完成；`1MGRD015A0` 清單入口已通過並顯示可綁定目標，TPZ preparation 仍遭 theme 站點條件阻擋，交由 Issue #225；fresh Excel 417 列讀取及實際匯出已通過，原表保留與 176 文字價格差額全數核對。Windows→Mac 兩份 portal 上傳均核對成功，但登入後實際下載尚待完成。CI smoke 不代表真人 Windows Hello，source overlay 與新版實際 export 證據分開；詳見 [分層紀錄](releases/2026-09-standalone-live-preparation.md)。
- 使用者回報的 immutable `item_shape` 改掛阻擋、價目表操作與未綁 FBA 建議已由 PR #219 發布 `0.1.58`，release-code SHA `9ce9bebba2dabcce82604a1d7a423c68608ad962`。Pages bytes、Mac／Windows 可信 artifact 已核對，`/Applications/AMZ.API.app` 已換為 0.1.58，舊版與 vault 保留。員工登入後兩份實際下載已核對，Mac 解鎖後已連線；live immutable preparation 通過，但 picker／既有 theme 卡點及後續整表匯出發現的文字價格差額問題已交由 0.1.59 修正。前版分層狀態以 [本輪證據](releases/2026-09-variation-guidance-price-fix.md) 為準；需求見 [spec](specs/2026-09-08-variation-guidance-price-fix.md)。
- 使用者核准的「變體工作台與 US 價目表」已由 PR #214 合併並發布 `0.1.57`，release-code SHA `495ee23f11924777cac93ce43c9d487bfdd7ad2d`。四條 main Actions 成功、Pages bytes 相符、Mac／Windows artifact hash 已驗；員工下載頁兩張卡已更新，登入後兩份實際下載也符合可信 artifact。`/Applications/AMZ.API.app` 已換為 `0.1.57` 並成功開啟，encrypted vault 未變，`0.1.56` 備份保留。功能範圍與分層證據見 [spec](specs/2026-09-08-variation-price-workbench.md) 及 [本輪帳本](releases/2026-09-variation-price-workbench.md)；live Amazon mutation、真人 Touch ID／Windows Hello 與正式簽章仍不得由本次安裝推定。
- 本輪進行「營運情報與事件」五項能力：促銷、AWD、價格健康、廣告成效與本機通知。修改／驗收這些能力或判斷本輪發布狀態時，先讀 [核准 spec](specs/2026-09-08-operations-intelligence.md) 與 [本輪證據與限制](releases/2026-09-operations-intelligence.md)；source baseline 為 `69a395096b1fdbf23be94c804a0aea1a4d523a24`，分支 `feature/operations-intelligence`。檢查、review、final commit 與發布狀態以該日期化記錄為準，不能由既有版本的成功推定新能力已安裝或 live 通過。
- 使用者已核准把商用首頁收斂成極簡 FBA 面板：移除導言與重複說明；日期篩選移到營收數字下方且不可換行；訂單／件數／去年同期、公布欄、低頻健檢與營運情報預設收折；七張健檢卡只留名稱與真實狀態，整張卡直接開啟工作區並以顏色區分 idle／執行中／完成／部分完成／失敗。桌面八個品類以兩欄四列呈現，避免撐高銷售卡；銷售次要控制合併成一列。營運情報來源加入四個頂部功能群捷徑；連線與系統入口分別固定為短狀態和「設定」，不再顯示右上角 J avatar。變體工作台的返回入口固定在標題左上方；由未綁變體健檢開啟時，入口須明示返回該健檢。頂部 AMZ.API 品牌區必須能退出 inline／audit workspace 並回首頁；變體、文案、圖片或 B2B 價格工作區忙碌時，不得藉此繞過返回鎖定。詳見 [介面改版紀錄](releases/2026-09-commercial-frontend.md)。所有同頁捷徑必須以程式捲動並聚焦，不能改寫 hash 或觸發 API；四個主題樣式後接 `variation-workspace.css` 與 `price-list.css`，仍須保持 fingerprint 與 build rule stream 一致。本輪只有 GitHub Pages renderer，沒有 Notebook Key 版本或下載 artifact 變更。
- 上輪核准範圍：[September review improvements](specs/2026-09-review-improvements.md)。開工 source 為 `efdf76fd701b76997e64b74a4f30d3d3d96da360`，版本 0.1.54；0.1.55 已經 [PR #206](https://github.com/jspusa/AMZ.API/pull/206) 合併至 `bf2ec996e5ee0445c8aa1de8139dc26360dd3ca2`；該 SHA 的 Validate、Pages、Mac universal 測試包與 Windows x64 未簽章測試包流程均成功。artifact 下載與實機未驗項目分列於版本帳本。
- 0.1.54 已於 PR #204 合併到 `36f4afcdbeaf6167a822d99bf41624005ae706b6`，該 SHA 的 Validate／Pages／Mac unsigned／Windows unsigned 四條 Actions 成功。舊交接「尚未 PR／發布」是歷史快照，已被這份 GET 證據取代。
- 2026-09-04 的 `0.1.53` 安裝／下載卡記錄是歷史快照；2026-09-08 的 `0.1.57` 發布、實機版本實查及尚未完成的交付項目以 [本輪帳本](releases/2026-09-variation-price-workbench.md) 為準。
- 正式 Developer ID／公證、Authenticode、簽章 bootstrap 和真實裝置 N→N+1 更新仍無完成證據。package 預設 `amzApiUpdateChannel: disabled`，只有正式工作流可注入 `publisher-signed-v1`。
- 各層 exact SHA、Actions、artifact 與驗證界線見 [版本證據](releases/2026-09-review-evidence.md)。實機／Amazon 下一步見 [live 驗收矩陣](releases/2026-09-live-acceptance.md)，簽章準備見 [發布 preflight](releases/signed-update-preflight.md)。

## 每項工作都要保留的規則

- 產品名是 `AMZ.API`；私人 Jasper Seller 營運控制台，FBA-only。main 擁有憑證、Amazon transport、執行 context 與寫入能力；GitHub Pages 只提供受信任 UI，preload 僅公開窄化 Bridge。
- Secret 只由 main-owned、packaged、無網路本機 sheet 輸入並以 Keychain／當前 Windows 使用者 DPAPI 保護。不得進 GitHub、renderer、URL、browser storage、日誌、測試、Excel 或聊天；安全儲存不可用時 fail closed。
- IPC 只接受精確受信任文件的 main frame；保持 sandbox、contextIsolation、無 Node／raw IPC／任意 URL transport。Custom URL 只能聚焦 App。
- 每次寫入重新證明 exact account／mode／marketplace／generation、Seller SKU／ASIN／Product Type、FBA 與 seller-specific PTD。Orders 成功不代表 Seller ID／Listings 成功。輸入識別值不可 trim／alias 來掩蓋不一致。
- Amazon mutation 保留 main-owned Write Gate、canonical diff、fresh Validation Preview、短效票證、native approval、durable claim、單次 PATCH 和唯讀回查。`ACCEPTED` 與 canonical verified 分開；pending／unknown 或結果不明禁止盲目重送，GET recovery 不能變成寫入。
- B2B 最低價與 B2B 本身是分開的 intent、Preview 與原生授權。最低價 verified 之後仍需 fresh preview 和新確認，不能用舊批准背景續送。文案／B2B PATCH 維持 serial，並行 worker 只可做 bounded 預檢或 GET 回查。
- 維持完整與未完成／未知資料的區別；沒有證據不能補零、標成功或宣稱 API 已支援。文案 Excel 保留 exact snapshot、帳號／站點／digest／時限；產品要點完整替換必須揭露同語系 overflow 刪除且明確確認。
- UI 保留綠色自動、淡藍色一鍵、黃色人工語意；首頁健檢為單層寬版 workspace、主程序工作可接回、焦點可恢復，忙碌寫入不能離開。完整既有功能門檻見 [功能驗收契約](FEATURE_CONTRACTS.md)。
- 公布欄現行來源為固定 Supply Boss API（ADR 0003）；schema v2、v1 唯讀 projection、revision conflict 與 main-memory board session 邊界保持不變。舊 GitHub Issues 公告 trigger 如仍存在，維持 author／label authorization。
- 安裝入口為 [受保護安全下載頁](https://supply-boss.brave-prawn-0848.chatgpt.site/downloads)。保留現有 vault／備份；Source 版本不等於下載卡或實機版本。公開更新 feed 需要 ADR 0001 指定的獨立批准，不能改值或略過 gate 來繞過。
- Linux／CI／fixture 不代表 live Amazon、真實 Touch ID／Windows Hello、DPAPI 跨使用者或簽章更新成功。真實 mutation 需指定 SKU／欄位的另行操作授權，不能為程式驗收自行送出。

## 歷史與後續記錄

原 1,423 行／449,222 bytes 交接已完整保留為 [原始歷史](releases/archive/CODEX_HANDOFF-through-2026-09-04.md)，SHA-256 `b09da95092ea42a4cc48e153337475f3008ad828b90a76ede4c75bd965d2c5fb`。歷史檔保持原 bytes；需要查舊 PR、artifact hash、既有 device 或 Amazon 操作證據時才按日期／版本讀取。歷史中的「目前／未發布」只描述該段當時狀態，不作今日結論。

新一輪變更在 `docs/releases/` 建立日期化證據，這個入口只更新當前工作與指標。不要再次把完整 log、幾十個歷史 artifact 或所有 owner 檔案塞回入口。
