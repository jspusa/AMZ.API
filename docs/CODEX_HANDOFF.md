# AMZ.API — Codex 專案交接入口

最後更新：2026-08-25
Repository：`https://github.com/jspusa/AMZ.API`  
GitHub Pages：`https://jspusa.github.io/AMZ.API/`  
目前正式基線：`v0.1.31` 已發布、部署並由 exact release-code main macOS artifact 安裝為 `/Applications/AMZ.API.app`；原 v0.1.30 保留為 `/Applications/AMZ.API-v0.1.30-backup.app`，更舊備份、原 userData 與既有 encrypted vault file 均未清除。live Pages 的 HTML、主 JS、CSS 與文案規則 chunk 均與 exact main production output byte-for-byte 相同；已安裝 App 的版本／build、bundle、雙架構、deep strict codesign、ASAR header integrity 與 `app.asar` 均匹配 artifact。v0.1.31 主程序已啟動且沒有啟動即崩潰；正式 A+ 唯讀 canary 尚待 Mac 解鎖後完成，沒有執行 Touch ID／Windows Hello、Validation Preview、PATCH、readback 或任何 Amazon mutation。受保護員工 Mac 下載卡仍是舊版，Windows 固定 prerelease 仍為 v0.1.16，且沒有真實 Windows Hello／DPAPI 硬體驗證。

目前工作樹：v0.1.31 release code 已由 PR #67 squash merge，唯一 release code main SHA 為 `fd02266279414e4e716316dbedfe7a507079bb10`；同一 SHA 的 Validate、Pages、macOS universal 與 Windows x64 workflows 均成功，source、CI、Pages、Mac／Windows artifacts 與 exact Mac 安裝已完成。v0.1.30 的正式 US 唯讀 canary 已證明 B2B canonical quantity tiers 與 `父變體橫排`，並暴露 A+ 全數 incomplete；同形 fixture 鎖定跨文件 conflict poisoning 核心缺口。v0.1.31 讓任一 exact `CONTENT_PUBLISHED` 保持正向權威，另一文件的 negative／malformed relation 只能把完整度降為 partial，且未使用的 optional `contentReferenceKeySet` 畸形不再丟棄合法 badge。沒有任何 positive 時仍 fail closed。v0.1.31 A+ 正式唯讀 canary 尚待 Mac 解鎖；任何 PATCH／readback、文案或圖片 mutation，以及真實 Windows Hello／DPAPI 裝置矩陣仍未執行。

架構深化工作依 #69 的 tracer bullets 進行中：S01–S07 已分別發布為尚未合併的 stacked PR #109–#115；S08 已發布為 stacked Draft PR #116（base 為 `codex/s07-variation-catalog-reads`），本分支建立 main-only 固定 Reports runtime 與 production adapter。runtime 只接受 all listings、Active Business Listings、aged inventory、inbound noncompliance、exact-date DAY＋SKU sales/traffic，以及綁 exact dates／immutable data timestamps／`windowCreatedAt` 的 FBA shipment sales 六種封閉意圖；production adapter 固定官方 report type／options／endpoint，POST 不 replay，GET 只有一次 401 refresh 與最多兩次 bounded transient retry，並限制 timeout、redirect、HTTPS signed URL、壓縮與解壓大小。官方 `GetReport` 未回傳 create-time options 時由 durable identity 維持固定選項，若有該欄則 exact match；live ApiRouter 不再退回 legacy transport，compatibility adapter 只處理 demo。所有六種意圖共用 account／mode／marketplace／type／canonical options 綁定的 `DurableReportLifecycle`、single-flight、30 分鐘 retry guard 與 terminal／unknown tombstone；data/document read 不隱含 create，final store read 後也會再驗 context generation。store v2 雙寫 collision-safe tuple key 與上一版 colon alias，alias 碰撞 fail closed，`CREATION_UNKNOWN` 已通過新版→舊版 mutation→新版往返測試。公開 route／legacy coordinator 只保存 `report-lease.*`／`report-document.*` 不透明 handle；runtime `readDocument` 是 metadata、signed URL 與下載的唯一 owner，原始 report／document ID 不再解析回 router caller，domain parser 只接收文字且不得重新輪詢或下載。`ACCOUNT_SCOPE_CHANGED`、`REPORT_MODE_CHANGED` 與 `SP_CONTEXT_INVALIDATED` 不得被 optional Active Business fallback 或 AbortError 降級；create rejection／abort-ignoring success、status／document simultaneous invalidate+abort、create／status caller-signal-first cleanup 與 B2B router cleanup 競態均鎖定原始 409，create 已開始時仍保存 `CREATION_UNKNOWN`。品牌營收 job 只剩雙 leg 協調與公開投影，不再擁有第二套 POST／poll lifecycle；既有 Ads report transport 保持獨立但沿用同一耐久 lifecycle。Review Audit 的帳號／模式 transition 保留原始 409 context error且不重設全 App Customer Feedback pace boundary。本地 `npm run check` 已通過 141 個測試檔／1,384 項測試、typecheck 與 production build，`npm audit --omit=dev` 為 0 漏洞，`git diff --check` 通過；stacked Draft PR #116 的 Validate 與 Windows x64 unsigned build／ASAR addon boundary／packaged Bridge smoke CI 已通過；PR run 依 workflow 規則未上傳 artifact。本文件記錄的是 fixture／demo／local 證據，不能冒充部署、安裝、Notebook Key、live Amazon、Validation Preview、PATCH 或真實裝置驗證。兩個既有 user-owned untracked duplicate files 仍排除。

S09 已發布為 stacked Draft PR #117（base 為 `codex/s08-reports-runtime-lifecycle`），進一步抽離 catalog reports／B2B 唯讀語意：`ReportsRuntime` 保持 lifecycle 與文件下載的唯一 owner；`FbaCatalogReports` 只協調固定 All／Active Listings 意圖、opaque handles、context fences 與 demo／live dispatch；`catalog-report-reads.ts` 只負責 FBA 報表 parse、exact identity、Listings read enrichment、export 與 B2B audit；`business-pricing-evidence.ts` 是無 I/O／無狀態的 pure leaf。Active unavailable 不等於 absence，unknown／ambiguous evidence 不得建立 mismatch，audit rows 固定 `editable: false`，整個 S09 cluster 不接 PTD、Preview、PATCH 或其他 write seam。舊的 live catalog／B2B download-and-parse facade 已移除，只保留明確命名的 demo source；本地完整 gate 與 PR #117 的 Validate／Windows x64 unsigned package／ASAR boundary／packaged Bridge smoke CI 均已通過，PR workflow 未上傳 artifact。S08 的證據不能冒充 S09，分層證據見下方專節。

S10 已發布為 stacked Draft PR #118，分支為 `codex/s10-brand-sales-traffic-reads`，base 為 S09 的 `codex/s09-catalog-reports-b2b-audit`，抽離 Brand／Category revenue 與 Sales & Traffic 唯讀語意。`FbaRevenueReports` 擁有品牌營收雙 leg durable state machine、同一份 All Listings＋FBA Customer Shipment Sales snapshot、不可變站點時間窗、30 分鐘 no-blind-retry、context-bound handle migration／poll／read 與 generation-bound cache；`SalesAndTrafficReports` 只協調固定 DAY＋SKU lease，只有 begin 套用 moving 95-day gate，既有 status／read 保持已接受的 immutable selection。兩邊 reader 結果都在 semantic boundary 重新驗證 exact mode／marketplace／dates／schema／source／currency／identity 並投影 public allowlist；legacy semantic errors 保持 `{code,message}`，internal／upstream errors仍走 canonical sanitizer，terminal Amazon Request ID 不在 lifecycle 轉譯時遺失。相關 RED 已實際證明 pending HTTP 200、DTO 多欄位、跨午夜 lease、A→B context handle 污染、stale generation cache、錯 selection reader 與 nested extra-field 缺口，修後完整 `npm run check` 為 145 個測試檔／1,447 項測試；首輪 Validate 與 Windows x64 CI 均成功。本段仍只有 local／fixture／scripted／demo／CI 證據，本輪沒有合併、部署、安裝、Notebook Key、live Amazon、Pages 或真實裝置驗證。

S11 issue #80 已發布為 stacked Draft PR #121，分支為 `codex/s11-fba-inbound-reads`，base 固定為 S10 的 `codex/s10-brand-sales-traffic-reads` exact head `bca9623fb9995d0c245f06e0de1c7cc72dec5155`。`FbaInboundReads` 是 shipment與noncompliance兩條 read leg 的單一 semantic owner；`ApiRouter` 只捕捉一份不可變 `SpExecutionContext` 並交給兩條 leg，不再直接建立、輪詢、下載或解析 inbound report。production adapter 只接受 typed identity 並固定官方 GET endpoints、region-global pacing、timeout、redirect rejection、一次 401 refresh與bounded transient retries；v0日期範圍只有明確400／422才依序改走v0 active與modern plan fallback，其他auth／throttle／server／network／abort failure不會被偽裝成備援成功。舊production-capable inbound facades與對應巨型 facade test已移除；本機`npm run check`已通過146個測試檔／1,454項測試，`npm audit --omit=dev`為0 vulnerabilities，`git diff --check` clean。首個implementation head `31f935962eee8984185c23dc726471523f21b9cf`的Validate與Windows x64 CI均成功；本次交接證據回填會形成新的docs-only final head，仍須讓兩條CI在該head重跑。#80與前置implementation issues #70／#73／#77目前全都仍是OPEN；本段只有local／fixture／scripted／demo／CI證據，沒有合併、部署、安裝、Notebook Key、live Amazon、Pages、真實裝置或Amazon mutation證據。

S12 issue #81 已發布為 stacked Draft PR #122，分支為 `codex/s12-aged-inventory-reads`，base 固定為 S11 final head `8ffa11a4023e86f21dce61872fe68c1fc2ec9c55`。main-only `AgedInventoryReads` 是固定 aged-inventory begin／status／read、regional schema、parser、逐列 evidence、demo／live 與 public snapshot 的唯一 semantic owner；`ReportsRuntime` 仍唯一擁有 durable lifecycle、opaque handles與文件下載。任何 estimated excess、storage cost 或 AIS coverage 不完整時，逐 SKU 已知值與 reported counts保留，但 marketplace與renderer tier totals均為null；workbook也不再把部分回傳值描述為全站合計。舊 `sp-api.ts` aged façade／parser／第二套 Reports transport與router gateway已刪除；`sp-api.ts`為9,288行，`api-router.ts`為8,934行。最高穩定public route的partial-total RED與parser／numeric adversarial RED均已先失敗再轉綠；本機`npm run check`通過147個測試檔／1,463項測試、typecheck與production build，`npm audit --omit=dev`為0 vulnerabilities，`git diff --check` clean。implementation／Windows-fix head `37fbe5f41362f86f079a8da675c712aef3aa6760`的Validate run `32808044696`／job `97681860954`與Windows x64 run `32808044661`／job `97681861137`均成功；Windows包含runner validation、unsigned package、ASAR addon boundary與packaged Bridge smoke，PR workflow依規則跳過artifact upload。#81與前置issues #73／#77仍是OPEN。本段只有local／fixture／scripted／demo／CI證據，沒有合併、部署、安裝、Notebook Key、live Amazon、Pages、真實裝置或Amazon mutation證據。

S13 issue #82 已發布為 stacked Draft PR #123，分支為 `codex/s13-a-plus-content-reads`，base 固定為 S12 final head `f12629b056aa19da17258df152e707b5e8dada93`。main-only `AplusContentReads` 是 publish-record、content-document、document-relation 完整分頁、evidence precedence、demo／live 與 public snapshot 的唯一 semantic owner；production adapter 只接受三種封閉 GET plan，不讓 caller 傳 URL、method、host、任意 query 或 write capability。任一 exact publish record 或 `CONTENT_PUBLISHED` relation badge 都保持正向權威；不存在 positive 時，warning、malformed、conflict、incomplete relationship 或單純文件存在／approval 一律 fail closed，且 incomplete relationship seed 不會觸發未證明安全的 per-ASIN 呼叫。semantic audit 固定 25,000 relation-row／page budgets、256 MiB aggregate reservation、每頁 16 MiB與每 ASIN 100 documents公開上限；adapter固定12秒request／body deadline、redirect rejection、regional pacing、一次401 refresh、最多兩次bounded 429／500／503 retry、完整受控Retry-After與discarded-body cancellation。舊`sp-api.ts` A+ façade與router三callback gateway已刪除；`sp-api.ts`為8,866行，`api-router.ts`為8,809行。本機`npm run check`通過148個測試檔／1,483項測試、typecheck與production build；`npm audit --omit=dev`為0 vulnerabilities，`git diff --check` clean。implementation／review-fix head `288ad402f7bf8f01fac1e040cf41fb60571302a0`的Validate run `32813195392`／job `97696398035`與Windows x64 run `32813195216`／job `97696397540`均成功；Windows包含runner validation、unsigned package、ASAR addon boundary與packaged Bridge smoke，PR workflow依規則跳過artifact upload。#82與前置issues #74／#77仍是OPEN。本段只有local／fixture／scripted／demo／CI證據，沒有合併、部署、安裝、Notebook Key、live Amazon、Pages、真實裝置或Amazon mutation證據。

S14 issue #83 已發布為 stacked Draft PR #124，分支為 `codex/s14-customer-feedback-reads`，base 固定為 S13 final head `9af562812b8968c4849ab2c4430746ea5640c3e3`。main-only `CustomerFeedbackReads` 是 supported marketplace、relationships-proven child／standalone identity、exact ASIN／marketplace、204、raw response schema、signed topic impact、demo／live 與 sanitized result 的唯一 semantic owner；`review-audit.ts` 只聚合已驗證 evidence，不再解析 raw Amazon JSON。production adapter 只接受固定 `getItemReviewTopics` GET plan，維持跨 job／region 的 App-session 全域 1 request/second、12 秒 request／body deadline、16 MiB body bound、一次 401 refresh、一次 bounded 500／503 retry與最高25分鐘canonical安全Retry-After；429不在transport內 replay，但其安全Retry-After會在queue turn釋放前成為全域quota fence。官方operation沒有cursor，固定一頁並限制最多十筆正向／十筆負向主題。Router保留既有report/candidate job、背景進度、403 fan-out與terminal snapshot，但每個job只保存一份immutable `SpExecutionContext`，已刪除第二套transport／normal pacing queue。舊`sp-api.ts` Customer Feedback façade與巨型facade test已移除；demo candidates搬回relationship owner。`sp-api.ts`目前8,559行，`api-router.ts`目前8,802行。本機`npm run check`通過149個測試檔／1,511項測試、typecheck與production build；`npm audit --omit=dev`為0 vulnerabilities，`git diff --check` clean。implementation head `038dd6002e32b26ff63871b4f3c271d56d3a3d23`的Validate run `32820654386`／job `97717819904`與Windows x64 run `32820654372`／job `97717819766`均成功；Windows包含runner validation、unsigned package、ASAR addon boundary與packaged Bridge smoke，PR workflow依規則跳過artifact upload。本次交接證據回填會形成新的docs-only final head，仍須讓兩條CI在該head重跑。#83保持OPEN；兩個既有user-owned untracked duplicate files保持未追蹤且未納入工作。這些只有local／fixture／scripted／demo／CI證據，不能冒充合併、部署、安裝、Notebook Key、live Amazon、Pages、真實裝置或Amazon mutation。
S14的route-level 429只允許依安全Retry-After延後同一candidate一次；第二次429會保留為incomplete並前進，不會讓active job無限自動重送。

S15 issue #84 已發布為 stacked Draft PR #125，分支為 `codex/s15-orders-reads`，base 固定為 S14 final head `e50e3556a2efbb31c186e7a8a69d11b9cc91f441`。main-only `OrdersReads.read()` 是 dashboard page／connection probe rolling date、typed status、opaque pagination、demo／live、raw envelope normalization、FBA response fence 與 public DTO 的唯一 semantic owner；兩個 production caller 共用同一介面。production adapter只接受封閉 Orders page plan，固定 regional `GET /orders/2026-01-01/orders`、redirect rejection、AFN、included data與50／1筆page size，同一12秒deadline涵蓋最高16 MiB body；一次401 refresh後只對429／500／503最多再讀兩次。caller不能指定URL、method、token或retry。舊`sp-api.ts` Orders façade、raw model、normalizer、transport與demo order projection已移除，其他demo listing／variation只共用中立product catalog。最高穩定route RED先以「注入port 0次呼叫」失敗再轉綠；本機`npm run check`通過152個測試檔／1,550項測試、typecheck與production build，`npm audit --omit=dev`為0 vulnerabilities，`git diff --check` clean。`sp-api.ts`目前8,164行，`api-router.ts`目前8,816行。implementation head `5482c9cd0ebb19235d57e38d5e5bcafd3d8ed4fb`的Validate run `32827027686`／job `97737192577`與Windows x64 run `32827027642`／job `97737192218`均成功；Windows包含runner validation、unsigned package、ASAR addon boundary與packaged Bridge smoke，PR workflow依規則跳過artifact upload。本次交接證據回填會形成新的docs-only final head，仍須讓兩條CI在該head重跑。#84保持OPEN；兩個既有user-owned untracked duplicate files仍未追蹤且排除。本段只有local／fixture／scripted／demo／CI證據，沒有合併、部署、安裝、Notebook Key、live Amazon、Pages、真實裝置或Amazon mutation。

R01 issue #85 已發布為 stacked Draft PR #126，分支為 `codex/r01-api-router-contract`，base 固定為 S15 final head `d3b1a7b6086616424bd989c4ee71fb3aac66d045`。`ApiRouter.handle()` 維持唯一公開 seam，現在會在任何 handler 前 runtime 核對 request ID、固定 method、`/api/` path、純字串 query／headers、plain-object JSON 與單檔 multipart body；畸形 envelope 統一回 no-store `400 INVALID_REQUEST`。test-owned 單一 63 組 method／path 矩陣以 TypeScript AST 獨立盤點 production central switch，並鎖定 exact key 宣告、唯一 switch 與 canonical `404 NOT_FOUND` default；新增、遺漏、重複、case／prefix／suffix／wrong-method near miss 或在 switch 前加入旁路 dispatch 都會失敗。Sales、Listings、batch、images、Sale Price、subscription、replenishment、SKU command、product master 與 upload family 均另以 `handle()` 直接證明；SP／pre-commit／report／coordinator／replenishment／Ads／unknown errors 在 main／renderer 邊界共用 canonical sanitizer。第一個 public RED 實際把 malformed Listings JSON array 送進 route 並得到 `415 UNSUPPORTED_MEDIA_TYPE`，修後才成為 canonical 400；擴充 RED 另抓到非字串 query／header 與 hostile non-SP metadata。審查發現的 Windows `.pathname` 與未鎖定 route 前置旁路均已修正，原審查者複查後無剩餘 P0–P3。本機 `npm run check` 通過153個測試檔／1,663項測試、typecheck與production build，聚焦3檔／118 tests通過，`npm audit --omit=dev`為0 vulnerabilities，`git diff --check` clean；`sp-api.ts`仍為8,164行，`api-router.ts`目前8,881行。implementation head `40f5a4bb8c4660aa89f413ff15c872f7812f6c36`的Validate run `32832006634`／job `97752576719`與Windows x64 run `32832006519`／job `97752576796`均成功；Windows包含runner validation、unsigned package、ASAR addon boundary與packaged Bridge smoke，PR workflow依規則跳過artifact upload。本次交接證據回填會形成新的docs-only final head，仍須讓兩條CI在該head重跑。#85保持OPEN；兩個既有user-owned untracked duplicate files仍未追蹤且排除。本段只有local／static／fixture／test／CI證據，沒有合併、部署、安裝、Notebook Key、live Amazon、Pages、真實裝置或Amazon mutation。

R02 issue #86 已發布為 stacked Draft PR #127，分支為 `codex/r02-router-request-context`，base 固定為 R01 final head `233617a41ad89c0a741ff8242a458ff7239c2616`。main-only `RouterRequestContextAdapter` 讓每次 `ApiRouter.handle()` 只 lazy capture 一份 immutable `SpExecutionContext`；同一 operation 的深層 module capture 取得同一 frozen object，第二個 marketplace fail closed，成功 response 回傳前做 fresh terminal fence，operation 關閉後被 async callback 繼承的 scope不可重用。context 只含 marketplace、推導出的region、mode、不透明account scope與generation，不含Seller ID、token或secret，也不進入public DTO、URL、log或workbook。preview ticket的issue／reserve／consume同時綁exact context與router state revision；Product Master、SKU Command、短效snapshot／plan／job、content batch、Ads strategy、reconciliation、Standalone、A+與Audit Suite均保存main-only context，私有`AuditSuiteContext`已移出shared layer。`invalidateContext()`是SP／Ads credentials save／clear、lock、suspend與detected account／mode drift的唯一production invalidation interface：先讓舊generation失效，再一次清除SP／Ads短效cache、previews、reservations、snapshots、jobs、timers、selections、flights與coordinator state；`dispose()`只供process shutdown／test teardown。耐久idempotency ledger、report lease／tombstone、content provenance evidence與App-session pacing明確保留。content batch在approval、重新預檢與每個尚未開始的SKU前重驗context；listing price／content／image／sale／B2B與variation move在token後、真正PATCH前有最後fence，pre-send drift保持`commitPatchSent=false`，Amazon已接受後的drift保留`UPDATE_STATUS_UNKNOWN`與ledger鎖定，不blind retry。seller-specific content PTD cache綁credential generation，late response不能在invalidation後回填；connection test從credential summary開始固定revision，R2 image upload在讀storage後、object write前後重驗同一context。每個public Ads operation在第一個await前固定lifecycle signal並讓account／profile／token／campaign／report helper全程沿用，lock／suspend後不能重綁replacement controller。Standalone、A+與Audit Suite的selection／authorize／first-work／snapshot／workbook皆比較generation，Audit Suite另在同步發布前核對revision，舊run結果不能寫入新generation。第一個public RED證明Product Master在store read期間account A→B時曾錯回200；另有mid-batch lock、late PTD、preview resurrection、write pre-send、Ads first-work、R2 upload與coordinator late-publication RED。Spec／first-work與Standards最終複查均無剩餘P0–P3。local `npm run check`已通過155個測試檔／1,695項測試、typecheck與production build，`npm audit --omit=dev`為0 vulnerabilities，`git diff --check` clean；`sp-api.ts`目前8,266行，`api-router.ts`目前9,301行。implementation head `4b35337246764685796c38a40f5e41a40e2c666b`的Validate run `32841545023`／job `97781943245`與Windows x64 run `32841545150`／job `97781943833`均成功；Windows包含runner validation、unsigned package、ASAR addon boundary與packaged Bridge smoke，PR workflow依規則跳過artifact upload。耐久證據已記錄於PR comment `5409652409`；本次交接回填會形成docs-only final head，仍須讓兩條CI在該head重跑。#86保持OPEN，兩個既有user-owned untracked duplicate files仍未追蹤且排除。沒有合併、部署、安裝、Notebook Key、live Amazon、Pages、真實裝置、Validation Preview、PATCH、readback或Amazon mutation。

R03 issue #87 的發布候選位於 `codex/r03-fixed-report-broker`，base 固定為 R02 final head `46687e42e822b73cbe18c8c561c92d1381c65e4c`。main-only `FixedReportBroker` 現在是單一 `DurableReportLifecycle` 與單一 `ReportsRuntime` 的唯一 composition owner；原六種 SP 封閉意圖與唯一 `ads-sp-advertised-product` 意圖共用 durable identity、single-flight、單調狀態、30 分鐘 no-blind-retry guard與terminal／unknown tombstone。公開 SP／Ads handle 只含固定類型前綴、非身分 `broker.` 標記與 CSPRNG UUID，不含 generation、raw lease ID 或 stable fingerprint；只有當代 main-owned exact token map 能授權 status／document read，clear 先換 generation 並清空 token map，因此 stale token或改寫 generation 的偽造 handle 固定 `REPORT_MISMATCH`。已完成的 durable lease 可換發全新隨機 handle 而不重建報表。Brand／Category coordinator 是唯一可持久化 main-only `leaseBinding`／`handleBinding` 的使用者；binding 只作 stable lease equality與tamper witness，不作授權，也不進 ordinary receipt／public DTO。新式broker token缺少或帶有malformed binding會fail closed；R02 raw handle只允許一次equality-only migration，仍不能直接授權讀取。Ads public plan只接受 intent、marketplace與exact dates；shared policy在 start 固定執行31日與最近95個完整日限制，status／read只保留不會讓既有lease隨時間失效的固定31日驗證。Router只保存 broker-owned opaque Ads binding，不保存或呼叫raw combined scope、profile、create、status或download；每次create dispatch前、status durable commit前、download／receipt回傳前都重驗SP context、broker generation、combined scope與profile fingerprint。production create 的expected scope改為required；若POST已被接受後才發現drift，accepted reference仍形成`CREATION_UNKNOWN`，clear／abort與adapter outcome不明也不能降成可立即重試。未知scripted status會fail closed，下載rows走與production相同的strict parser／allowlist projection，DONE不因後續terminal回應倒退。legacy Ads coverage GET已改為demo直接讀注入資料、live只接回既有All Listings lease；missing固定回`REPORT_NOT_READY`，不會因GET隱含POST。最高public RED實際證明Ads accepted selection mismatch與coverage GET曾重複create；其餘RED鎖定日期policy、pre-dispatch account drift、post-status／download identity drift、clear／reuse／absent-read競態、SP stale／forged capability handle、公開binding外洩、持久化binding遺失／竄改、R02 raw-handle磁碟migration、Brand／Category跨clear／restart續接、DONE→FAILURE單調性、unknown status與row projection。本機`npm run check`通過156個測試檔／1,728項測試、typecheck與production build，`npm audit --omit=dev`為0 vulnerabilities，`git diff --check` clean；`sp-api.ts`為8,266行，`api-router.ts`為9,177行，broker為1,179行。尚未建立R03 PR或取得R03 CI；#87保持OPEN。兩個既有user-owned untracked duplicate files仍未追蹤且排除。本段只有local／static／fixture／scripted／test／build證據，沒有合併、部署、安裝、Notebook Key、live Amazon、Pages、真實裝置、Validation Preview、PATCH、readback或Amazon mutation。

交接目的：讓新的 Codex 對話不需要重讀原始聊天，也能安全地繼續開發、除錯與發布。

---

## 0. 給新 Codex 的第一句指令

使用者可以直接貼上：

> 請先完整讀取 `docs/CODEX_HANDOFF.md`，再依照其中的「必讀檔案順序」讀完相關檔案。先執行唯讀檢查與 `npm run check`，確認目前 GitHub `main`、本機分支、版本與 Actions 狀態，不要重建專案。這是正式的 AMZ.API Amazon FBA 控制台；不得把任何 API Secret、Refresh Token 或 Seller ID 寫入 GitHub、日誌或回覆。完成盤點後，先告訴我目前狀態、未完成驗證與你建議的下一步，再繼續修改。

---

## 1. 專案一句話

AMZ.API 是 Jasper 公司自用的 **Amazon FBA-only 營運控制台**：GitHub Pages 自動更新介面，macOS／Windows Notebook Key Bridge 在本機系統安全儲存區保存 Amazon SP-API 憑證並執行本機 API 請求；一般瀏覽器沒有受信任 Bridge 時保持鎖定。

這不是公開 SaaS、不是多租戶產品、不是 FBM 工具，也不是 Helium 10 的替代品。

---

## 2. 使用者真正想解決的痛點

使用者不想反覆進 Seller Central 點選繁瑣頁面，希望能輸入 Seller SKU 後完成大部分日常工作：

### 策劃區

- 廣告：SP 主要留在 Helium 10；AMZ.API 只需簡化 SB／SD 授權狀態與官方入口。
- 補貨：自動整合 FBA 可售、在途、銷速、交期、安全庫存、箱規與 AWD 路徑。
- 既有 Amazon 補貨 Skill 若可安全接入可列為選配，但內建補貨不能依賴外部 Skill 才能運作。

### 產品區

- 文案：查詢及修改產品名稱、產品亮點、五大產品要點、產品敘述與成分；全站門檻為 60／110／每項 150–200／1,800 Unicode 字元，原因只顯示一次，且能帶入相符的立即修改欄位。
- 圖片：拖拉上傳、排序、主圖選擇、尺寸與格式驗證、Amazon Validation Preview；全站少於 6 張才列為不足。
- 一鍵健檢所選站點全部 FBA 文案並匯出依 variation family 分頁、問題欄有色標示的 Excel；同一檔案可選檔或 drag/drop 回傳做整批零寫入預檢，再經一次本機身分確認逐 SKU 安全更新。Excel 特殊換行需無損 round trip。成分宣稱只採同次完整 Amazon `ingredients` 證據：多成分否定 single ingredient、文案 Tendon／Tendons 必須有對應成分，且含 Chicken 時會標示 hypoallergenic 宣稱待核對。
- 未綁變體健檢 Excel 依 variation family 分頁並使用淡色 family banding；`父變體橫排` 第一列橫排各 Parent SKU，各欄第二列起只接該 Parent 的 children，standalone／incomplete 分開留在各自工作表。
- 首頁 run-all 在背景並行執行文案、圖片、A+、未綁變體、訂閱省、B2B 價格、廣告覆蓋七項；一般健檢卡與 run-all 共用完全相同名稱與固定順序。180 天以上庫存與評論屬低頻工作，依此順序預設收合且不加入 run-all。

### 價格區

- 定價：依 Seller SKU 查價與安全調價。
- Amazon Business Price：全站只健檢目前 FBA SKU，並讓 `不符建議 B2B 價格` 與 `未正確設定階梯折扣` 兩個獨立問題同時成立；USD 建議價為一般售價少 US$1.00，建議階梯固定 5／5%、10／10%、15／15%、20／20%，結果可匯出 main-owned 五工作表 Excel。只有 seller-specific PTD 明確開放時才能預檢或更新 exact `audience=B2B` contribution。預設 price-only 固定省略 `quantity_discount_plan`；只有使用者明確選用且 QDP PTD 能力另行證明時，才可在同一次 combined 預檢／PATCH 更新完整 percent tiers。一般售價與其他 audiences 永遠不改。
- Subscribe & Save：目前公開 SP-API 能力不足的部分維持唯讀／官方頁完成人工設定。
- 促銷：限時售價 API；Coupon 及部分促銷資格在 Amazon 官方頁完成。

### 操作設計

- Apple 式極簡、人性化、美觀。
- 能自動化就自動化；能一鍵就不做成多步驟。
- 自動＝淺綠、一鍵＝淡藍、需人工＝黃色。
- 必須有防呆、衝突檢查、自我檢查與可理解的中文錯誤。
- FBA only；不得加入 FBM 操作入口或混入 FBM 商品。
- FBA 入庫貨件追蹤只放在頂部「報表區」，不在首頁或「營運區」重複顯示。

---

## 3. 已確定的架構

```text
GitHub repository / Actions
├─ GitHub Pages：最新 renderer UI
├─ Validate workflow：型別、測試、build
├─ macOS workflow：universal App、啟動檢查、DMG/ZIP
└─ Windows workflow：Windows 11 x64 App、原生 addon、NSIS/ZIP smoke

macOS／Windows AMZ.API Notebook Key
├─ 載入精確允許的 GitHub Pages origin
├─ Preload 提供窄化、白名單式 Bridge
├─ Main process 執行 Amazon SP-API
├─ safeStorage 以 macOS Keychain／Windows DPAPI 加密 Secret
└─ Touch ID／Windows Hello 保護敏感操作
```

重要邊界：

- GitHub 不保存也不應接收到 LWA Client Secret、Refresh Token 或完整 Seller ID。
- Amazon Access Token 只應短暫存在 main process 記憶體。
- 一般瀏覽器打開 GitHub Pages 只顯示鎖定／啟動頁；真正控制台在 AMZ.API App 視窗操作。
- Renderer 不應取得解密後 Secret，也不應擁有通用任意 IPC 或任意 Amazon URL 請求能力。
- Custom deep link 只用於啟動／聚焦 App，不得直接觸發 Amazon 寫入。
- 寫入固定走：讀舊值 → Amazon Validation Preview → 本機票證 → 防呆 → Touch ID／Windows Hello → 再檢查 → idempotency → 單次寫入 → 回查。

詳細安全邊界以 `SECURITY.md` 與 `docs/ARCHITECTURE.md` 為準。

---

## 4. Amazon 串接決策

目前以 Jasper 自家公司、Private Seller App、US marketplace 為第一優先。

需要的四項本機資料：

1. LWA Client ID
2. LWA Client Secret
3. NA Refresh Token
4. NA Seller ID / Merchant Token

Amazon App：

- 名稱：`AMZ.API`
- App Type：Production
- Business entity：Seller
- 不使用 Sandbox 作為正式資料來源
- 不委派 PII／RDT
- 建議角色：Product Listing、Pricing、Amazon Fulfillment、Inventory and Order Tracking
- 不需要 FBM、Buyer Communication、Buyer Solicitation 或其他 Restricted／PII 角色

完整申請與填寫流程見 Library／工作區文件 `AMZ.API_API串接SOP.md`。

已遇過的 Amazon 後台岔路：

- `Existing consolidated SPP Profile`：使用既有 Jasper Profile，不要建立重複 Profile。
- `No authorization allowed`：舊 Developer Central／錯誤 Profile；應使用已移轉並通過審核的 Solution Provider Portal Profile。
- Developer registration under review：等待審核，不要重建 App。
- `amzn1.sp.solution...` 是 Application ID，不是 LWA Client ID。

---

## 5. 目前最新狀態（重要）

### 已完成

- Repository 已正式命名為 `jspusa/AMZ.API`。
- GitHub Pages Source 使用 GitHub Actions。
- GitHub UI／Mac Key Bridge 雙成品架構已完成。
- Amazon Orders API 已在使用者真實帳號讀到 FBA 訂單，代表 LWA／Refresh Token 基本可用。
- v0.1.2 修正單一 SKU `getListingsItem` 不應帶 `productTypes` 的參數錯誤。
- v0.1.3 新增：
  - Mac 連線測試同時驗證 Orders 與 Listings，不再因 Orders 成功產生假綠燈。
  - Excel 批次 Listings 查詢回 400 時，自動安全降級為逐 SKU `getListingsItem` 只讀查詢。
  - App 內 SOP 角色名稱改為 `Inventory and Order Tracking`。
  - 版本升至 `0.1.3`。
- v0.1.3 已在真實 Mac／Amazon 帳號重現：Orders 成功，但 Listings probe 與 SKU `AFA12AM` 的 `getListingsItem` 均回 HTTP 400 `Invalid parameters`。
- v0.1.4 候選修正已完成：
  - Listings 單品查詢在完整官方參數回 400 時，只對唯讀 GET 依序測必要資料集與真正最小必填參數；任何寫入都不走降級路徑。
  - 連線 probe 可由標準參數降級為最小唯讀參數，並保留實際 operation、Amazon error code 與 Request ID。
  - Seller ID 輸入會拒絕 Marketplace ID、空白及不可見字元；更換 Refresh Token 時必須同時提供同帳號 Seller ID，避免跨帳號殘留。
  - Product Type Definitions 無法使用時，文案／圖片仍可唯讀，但所有編輯與 PATCH 明確停用。
  - 商品內容最終確認欄位不再用目標 SKU 當作假預填 placeholder；空白、字元不符、完全一致與送出中都有明確狀態，仍要求使用者手動輸入完整 SKU，不放寬寫入確認。
  - 沒有改動既定架構、沒有新增 FBM，也沒有放寬寫入安全邊界。
- v0.1.4 候選版已在同一台真實 Mac／同一加密 vault 重測：
  - Orders 仍可正常讀取。
  - 只帶 `marketplaceIds` 的最小 Listings probe 仍回 HTTP 400。
  - SKU `AFA12AM` 的完整、必要資料集，以及只含必填 `marketplaceIds` 的真正最小 `getListingsItem` 均回 HTTP 400；最後一次最小請求的 Request ID 已保留於本機診斷紀錄。
  - 同一 Refresh Token 的 Orders 可讀且包含 `AFA12AM`，US marketplace 也正確，因此將根因收斂為本機 Merchant Token／Refresh Token 的 Seller 帳號一致性。
  - Amazon Sellers API 在 NA 沒有可由 token 回傳 Seller ID 的 operation，程式不能安全自動猜測 Merchant Token；不得再盲目改參數或輪替 Secret。
  - 已在登入中的 Seller Central 本機核對，確認原先保存的 NA Merchant Token 與該帳號的官方 Merchant Token 不同；完整值未寫入 GitHub、文件或回覆。
  - 只在 Mac App 加密 vault 更新為正確 Merchant Token 後，「Orders 與 Listings 連線成功」與「Amazon SP-API 連線成功」均已通過。
  - SKU `AFA12AM` 的真實商品內容已成功載入：ASIN、FBA 履約、`PET_FOOD` 商品類型、標題、五大賣點與成分均有回傳；PTD 字數／欄位能力也正常顯示，不再回 HTTP 400。
  - SKU `AFA12AM` 的價格／訂閱唯讀查詢成功：LIVE／可購買狀態、標準價、有效價、最低價限制、S&S 資格、折扣與訂閱數均有回傳。
  - SKU `AFA12AM` 的促銷唯讀查詢成功：LIVE 狀態、標準價與目前無限時折扣均正確顯示；未填新折扣時建立按鈕保持停用。
  - US 全部商品 Excel 已由 Amazon Reports 建立並自動下載：商品內容表含 265 筆資料，`AFA12AM` 存在；兩筆無法確認為 FBA 的系列被排除並列於「錯誤與缺值」，另有 6 筆缺少成分提示。
  - Excel 未包含 Seller ID、Token、買家或訂單資料，且沒有公式錯誤。
  - SKU `AFA12AM` 的五大賣點 Amazon Validation Preview 已通過；最終確認欄位實際仍為空白，確認按鈕未啟用，因此沒有送出非預檢的真實 Amazon 寫入，商品內容未變更。
  - 最終確認 UI hotfix 已由 PR #3 合併至 `main` 並成功部署 GitHub Pages；真實 Mac App 已確認欄位保持空白、placeholder 改為通用指示、空白狀態有明確說明，正式更新按鈕保持停用。
  - hotfix 上線後重新唯讀查詢時，Amazon Listing attributes 只回傳一項 `Lean & Clean` 賣點；已依使用者先前提供內容在本機重建五項賣點並再次通過 Validation Preview，但未輸入最終確認 SKU、未執行真實寫入。
  - 已將驗證通過的 v0.1.4 安裝為 `/Applications/AMZ.API.app`，安裝後再次通過「Orders 與 Listings 連線成功」與 `AFA12AM` 商品內容回讀；原 v0.1.3 保留為 `/Applications/AMZ.API-v0.1.3-backup.app`。
- v0.1.5 修正已完成：
  - 整合尚未正式發布的 v0.1.4 Listings 核心修正，避免與已安裝的較早 v0.1.4 候選 build 混淆。
  - 修正 FBA Inventory v1 成功回應的 envelope：庫存摘要位於 `payload.inventorySummaries`，不再錯讀頂層欄位並誤報 `FBA_SKU_NOT_FOUND`；畸形 2xx 與合法空清單已分開處理。
  - 「近期營運」不再以單一 Orders 分頁計算「本頁銷售」；新增 Sales API `getOrderMetrics` 每日折線圖，預設 7 天並可切換 14／30 天。
  - 銷售趨勢固定 `fulfillmentNetwork=AFN`，以各站 IANA 時區處理日界與 DST，缺日補零且今日標示為未完成日；沒有加入 FBM。
  - 圖表日期與原有訂單查詢日期互相獨立；下方訂單仍保留 7／14／30／60／90 天範圍。
  - 沒有改動既定架構，也沒有放寬任何 Amazon 寫入安全邊界。
- PR #1 已 squash merge 到 `main`。
- 合併 commit：`c03514c53c537c4a44cf367b4783a62c45f06e08`。
- GitHub Actions：Validate、Pages、macOS universal build 均成功。
- 本機驗證：40/40 tests、TypeScript、main/preload/renderer build、`npm audit --omit=dev` 0 vulnerabilities。
- v0.1.5 PR #4 已 squash merge 到 `main`：`https://github.com/jspusa/AMZ.API/pull/4`；合併 commit：`41cbb5ffc0b1098450a562dc973262ec27c44846`。
- 分支上的 unsigned universal Mac workflow run `31079166726` 已完整通過打包、ad-hoc 簽章、Bridge 啟動 smoke test、DMG／ZIP 與 artifact 上傳。
- main 的 Validate run `31080698675`、Pages run `31080698660` 與 macOS universal run `31080698700` 均成功。
- v0.1.5 universal App 已安裝至 `/Applications/AMZ.API.app`；舊 v0.1.4 原封不動保留為 `/Applications/AMZ.API-v0.1.4-backup.app`。
- 真實 US 帳號唯讀驗證已通過：`AFA12AM` 的 SKU 指揮中心恢復 5/5 資料源，顯示非零 FBA 可售庫存與補貨結果，不再出現 `FBA_SKU_NOT_FOUND`。
- 真實 US Sales API 的 7／14／30 天 AFN/FBA 每日折線圖均完整載入，今日正確標示為即時／未完成資料；下方 Orders 日期範圍保持獨立。
- v0.1.6 銷售趨勢更新已完成：
  - 「近期營運」只保留 FBA 銷售折線圖，不再啟動 `/api/sp-api/orders`，也不再顯示訂單搜尋、訂單列表、分頁或單筆詳情。
  - 新增 90 天與自訂 1–90 天；自訂日期會在 renderer 與 main 雙重驗證，不可超過目前資料日，也不可超出 Sales API 去年同期可查範圍。
  - 每次查詢固定讀取本期與同月同日的去年同期，兩次都使用 Sales API `getOrderMetrics`、`granularity=Day`、站點 IANA 時區與 `fulfillmentNetwork=AFN`；沒有 FBM 或 Amazon 寫入。
  - 本期使用橘黃色實線與面積、去年同期使用灰色虛線；滑鼠／觸控／鍵盤可逐日顯示兩期金額，手機圖區在內部橫向捲動而不撐寬頁面。
  - 去年閏年的額外 2 月 29 日會排除；本期 2 月 29 日若去年沒有相同月日則明確留空，不會拿 2 月 28 日冒充。
  - 回傳 schema、日期、range、幣別與 totals 會 fail closed；同步或格式失敗會清除舊圖與舊 Live 狀態，不把過期數字顯示成即時。
- v0.1.6 PR #6 已 squash merge：`https://github.com/jspusa/AMZ.API/pull/6`；feature head：`6091ff0b9fd649d816c07c8ca7d1504724a5093f`；main merge commit：`d288ac40640c92e42e11474068a879625ed7212a`。
- feature 與 main tree SHA 均為 `51acbe37a642b8bf5e5537d91d6832bc6d004c39`，已確認安裝前 build 與部署後 main 的 source tree 完全相同。
- v0.1.6 分支 Mac build run `31085746949`、main Validate run `31086616683`、Pages run `31086617355`、main Mac build run `31086616734` 均成功；Pages deployment `5776424283` 已成功發布 `https://jspusa.github.io/AMZ.API/`。
- 本機驗證：62/62 tests、TypeScript、main/preload/renderer production build、`git diff --check` 與 `npm audit --omit=dev` 0 vulnerabilities；另完成 Playwright 桌面／390px 行動版、hover、鍵盤、90 天、自訂與錯誤邊界測試。
- v0.1.6 已安裝為 `/Applications/AMZ.API.app`，原 v0.1.5 原封不動備份為 `/Applications/AMZ.API-v0.1.5-backup.app`；安裝前後均確認 bundle ID `com.jspusa.amz-api`、`arm64`／`x86_64` 與 `codesign --verify --deep --strict`。
- 真實 Mac／Amazon 唯讀驗證已通過：App 正常啟動未閃退；US 站 7／14／30／90 天與自訂 90 天均載入本期及去年同期；每日提示同時顯示兩期金額；頁面底部沒有可見訂單明細區；回傳 notice 明確標示 AFN/FBA。
- 此次沒有讀取、修改或輸出 LWA Client Secret、Refresh Token 或完整 Seller ID，也沒有執行任何 Amazon 寫入。
- v0.1.7 已完成、合併、部署並安裝：
  - 商品內容更新移除重輸完整 SKU；支援 Touch ID 時直接顯示系統驗證，不先顯示額外確認對話框。Validation Preview、短效票證、舊值衝突、idempotency、單次寫入與送出後回查仍保留；無 Touch ID 時仍有原生確認 fallback。
  - Sale Price 明確對應 Seller Central「產品 → 管理所有庫存 → 編輯 SKU → Offer／商品報價 → Sale Price」，並說明不是廣告選單的價格折扣、管理促銷、Deals 或 Coupon；只更新 `discounted_price`。
  - Subscribe & Save 數字改稱「目前有效訂閱」：它是 Replenishment `listOffers` 查詢當下的 active subscriptions 快照，不是單月新增、歷史累計、配送次數或唯一顧客數。
  - 新增全站 FBA 內容健檢：Reports 清單搭配 Listings enrichment，檢查疑似錯字、少於五個賣點與成分狀態；Mac 內建字典每次最多檢查 5,000 個不重複英文單字，文案不送第三方也不自動改字。
  - 內容健檢採 fail closed：Listings 讀取失敗列為「讀取失敗／未完成」且不計入缺值或拼字統計；只有可確認為 `PET_FOOD` 的空成分算「缺成分」，其他商品類型列為「成分未驗證／需人工確認 PTD」。
  - 新增 Variation Family 唯讀地圖與拖拉規劃，只接受可證明為 FBA 的 child；跨站、product type、theme、缺維度、重複維度或 family 不完整會阻擋。Parent 只作唯讀容器，沒有 PUT／PATCH／DELETE，也沒有 FBM。
  - Electron 操作驗證曾抓到 variation lookup 一啟動就自行取消；根因是 Escape 鍵 effect 在 `busy` 變更時執行 cleanup 並誤 abort 目前 GET。現已把鍵盤 listener cleanup 與僅限卸載的 request abort 拆開，來源、目標與唯讀規劃均已在 Electron 展示模式通過。
  - 最終安全審查另補四項 fail-closed 防護：Reports 已證明為 FBA 的 SKU 不會因 Listings 缺 fulfillment 而消失；2xx 缺 attributes 會列為讀取未完成；renderer 遇到壞列、缺 SKU 或總數不一致會停止顯示；parent 宣告但搜尋漏回的 child 會讓 family 標為不完整。
  - 本機驗證：111/111 tests、TypeScript、main／preload／renderer production build、`git diff --check`、Electron 展示模式四項互動與 `npm audit --omit=dev` 0 vulnerabilities。
  - v0.1.7 PR #8 已 squash merge：`https://github.com/jspusa/AMZ.API/pull/8`；main merge commit：`a9a9468cdfb42ae4d1e0e1b268027bf9ca7220a0`。
  - PR Validate run `31098052301`、main Validate run `31098122975` 與 main macOS universal run `31098122782` 均成功。原 main Pages run `31098122375` 的 deploy 步驟在 GitHub 端逾時；全新 workflow dispatch run `31098952558` 已成功，Pages deployment `5778814747` 已發布 `https://jspusa.github.io/AMZ.API/`，且 live HTML 已核對為本次 renderer 資產。
  - main artifact 已核對 checksum、版本 `0.1.7`、bundle ID `com.jspusa.amz-api`、`arm64`／`x86_64` 與 `codesign --verify --deep --strict`；v0.1.7 已安裝為 `/Applications/AMZ.API.app`，原 v0.1.6 保留為 `/Applications/AMZ.API-v0.1.6-backup.app`。安裝後主程序可持續執行、未啟動即崩潰；真實 UI／Amazon 唯讀功能驗證仍待 Mac 解鎖。
- v0.1.7 頂部導覽與對稱版面 refinement 已由 PR #10 squash merge：`https://github.com/jspusa/AMZ.API/pull/10`；main merge commit：`4ebfb57357a1338cb2bb396c4a1d3abb9d8c88cf`。
  - 移除固定 `244px` 左側功能欄與手機底部三區捷徑；品牌與帳號使用等寬兩側，七個既有 FBA 工具在螢幕真正中心的頂部直接開啟原 drawer，全域 SKU、SKU 總覽、站點與系統健康留在第二列。
  - 手機工具列只在自身橫向捲動，沒有整頁水平溢出；新增 44px 觸控目標、鍵盤 focus、skip link 與 sticky header offset。沒有改動 Amazon API、Touch ID、Validation Preview、idempotency、憑證邊界或 FBA-only 規則。
  - 本機驗證：113/113 tests、TypeScript、main／preload／renderer production build、`git diff --check` 與 `npm audit --omit=dev` 0 vulnerabilities；Playwright 已檢查 1440／1024／390／320px、sticky header、七工具可達、促銷 drawer 開啟與 Escape 關閉。
  - PR 與 main Validate 均成功。首次 Pages run `31101756336` 的 build／artifact 上傳成功但 GitHub `deploy-pages` 逾時；同一 main SHA 的 workflow dispatch runs `31102544468`、`31102720169`、`31103081735` 隨後被 Pages 服務取消，官方 Pages API 對該 `pages_build_version` 回傳 `deployment_cancelled`。不得為此重建專案或改用非既定部署架構；應以新的文件／程式 commit 產生新 main SHA 後再從 `pages.yml` 乾淨部署，並以 live HTML 資產核對實際上線結果。
  - 新 main SHA `83ee7a91f993f5bf082cf3c1805e26ca45b67b3b` 的 run `31103608648` 已證明可正常建立並排入新 Pages deployment，但 GitHub 後端排隊超過 `actions/deploy-pages` 的 600,000ms 硬上限後再次逾時。run `31104818870` 也確認較大的 `timeout` 會被官方 action 強制封頂，因此不得把無效的 900,000ms 當成解法；`pages.yml` 改用官方 Node 24 的 `actions/deploy-pages@v5` 並保留預設上限。同 SHA 的 run `31105865973` 會直接讀到既有的 `deployment_cancelled`，不可反覆 dispatch；必須確認前次已取消，再以有意義的新 main commit 產生新的 `pages_build_version`。沒有更換環境、artifact、權限或部署架構。
  - 新 SHA `8863f052d898511f66646d8202cdbd487a77281f` 的 v5 run `31106153276` 仍因相同硬上限取消。最終部署步驟因此改成官方 `actions/github-script@v9` 直接呼叫同一組 GitHub Pages Create／Get／Cancel REST endpoints：沿用 `upload-pages-artifact@v4` 的 `artifact_id`、`github.sha`、既有 OIDC 與 `github-pages` environment，不新增 PAT／secret，也不輸出 OIDC token；每 15 秒輪詢，45 分鐘才取消，step 上限 50 分鐘。`cancel-in-progress` 同時改為 `false`，避免下一次 main push 中斷仍在 Pages queue 的 deployment。
- v0.1.7 全站內容健檢工作流 refinement 已完成：
  - 首頁在 SKU 指揮中心下方新增顯眼的「全站內容健檢」入口；完成後顯示待確認項目數，能直接繼續上次結果。
  - 健檢結果依站點保存在 Dashboard 記憶體，只在這次 App 使用期間存在；關閉 drawer、切到特定 SKU 編輯再返回，都不必重新掃描，且保留原篩選與搜尋文字。沒有把商品文案寫入 `localStorage`，App 重新啟動後仍需重掃。
  - 新增「匯出全部待確認項目 Excel」：只匯出疑似錯字、賣點不足、缺成分、成分未驗證或讀取未完成的 SKU，工作簿包含商品內容與逐項說明；純 renderer 本機產生，不新增 Bridge API、不需重裝 Mac App，也不執行 Amazon 寫入。
  - `GooToE` 已加入 Mac 拼字檢查白名單；即使本機字典回傳 `Goatee` 建議，也不會建立疑似錯字項目。
  - 本機驗證：117/117 tests、TypeScript、main／preload／renderer production build、`git diff --check` 與 `npm audit --omit=dev` 0 vulnerabilities；Playwright 已確認桌面流程、有效 `.xlsx` 下載、編輯後返回、drawer 關閉後重開保留結果，以及 390px 無整頁水平溢出。
- v0.1.8 experience／inventory refinement 已發布並安裝：
  - 全站內容健檢白名單新增 `Decapterus`、`Gluconate`、`Niacinamide`、`Reishi`、`purr-fectly`；疑似錯字在標題、賣點與成分原文中紅字定位。`U+200B` 等不可見字元集中在單一說明區，列出 SKU、欄位、前後詞與可讀上下文，不會自動修改文案。
  - 舊版健檢 Excel 曾使用唯一「內容健檢」工作表；目前未發布工作樹已升級為 schema v2 的「說明與索引」＋變體 family／未綁變體／資料未完成工作表，最後兩欄仍為「類型／說明」。既有全商品 Excel 維持原格式。
  - 銷售自訂日期擴為 1–365 天，renderer 與 main 雙重拒絕 366 天；去年同期仍受 Sales API 兩年 horizon 保護。補貨的 SKU 銷速改用 Sales API exact `sku`＋`AFN`，不再因 Orders 前五頁掃描上限漏掉高銷量 SKU。
  - 主頁新增唯讀「180 天以上庫存」：請求 `GET_FBA_INVENTORY_PLANNING_DATA`，分開顯示官方庫齡、`estimated-excess-quantity` 與 `days-of-supply`。解析器依報表實際欄位選擇區域 366–455／456+ 尾段或非區域 `365-plus` 尾段，缺少完整區間即 fail closed；沒有推測、促銷、移除或 FBM 寫入。
  - 首頁與頂部導覽依「產品 → 價格 → 策劃」重排；七個工具順序固定為文案、圖片、變體規劃、定價、促銷、補貨、廣告。大段自動化／系統資訊預設收合，Product Master UI 暫時隱藏，所有 drawer 與 Mac ConnectionPanel 改為中央 Modal。
  - 促銷主要頁只保留 Listings Items `discounted_price` 對應的 Sale Price；Coupon、Subscribe & Save、Deals 與 Ads 的官方入口集中在「Amazon 官方完成」，沒有假 Coupon 設定表單。
  - App 圖示保留原藍色背景，白色 `A` 改為 `J`，底部箭頭改為紅色；Touch ID、Validation Preview、idempotency、Keychain、FBA-only 與 no-FBM 邊界未放寬。
  - PR #16 已 squash merge 到 `main`；合併 commit 為 `dcb57dfd20f240a3c1bb0f0dfffa5f2324aa0b91`。main Validate run `31242263937`、Pages run `31242263943` 與 macOS universal run `31242263938` 均成功；live Pages 已核對 `index-D0omFruY.js`／`index-CppLgiXq.css` 與 v0.1.8 功能字串。
  - main artifact 的 DMG／ZIP SHA-256 與 workflow 清單一致；App 版本為 `0.1.8`、bundle ID 為 `com.jspusa.amz-api`、包含 `arm64`／`x86_64`，deep ad-hoc codesign 驗證通過。v0.1.8 已安裝為 `/Applications/AMZ.API.app`，v0.1.7 原封不動保留為 `/Applications/AMZ.API-v0.1.7-backup.app`；啟動後主程序與 helper 持續執行，未重現未預期結束。
  - 本機與 CI 驗證：137/137 tests、TypeScript、main／preload／renderer production build、`git diff --check`、敏感資料差異掃描與 `npm audit --omit=dev` 0 vulnerabilities；Playwright 已確認中央 Modal、產品優先層級與 390px 無整頁水平溢出。
- v0.1.9 已發布並安裝；下列實作已通過自動／展示驗證，但仍不代表通過真實 Amazon：
  - 「全站內容健檢」改稱「全站文案健檢」；待確認項目 Excel 改成顯眼的全寬入口，不可見字元只展開一筆範例，其餘收合。保留同次 App 使用期間的結果、搜尋與篩選，能進入 SKU 編輯再返回；拼字白名單保留 `GooToE` 並加入 `Decapterus`、`Gluconate`、`Niacinamide`、`Reishi`、`purr-fectly`。
  - 主頁新增全站 FBA 圖片健檢，將少於五張圖片與讀取未完成分開顯示；結果在同次 App 使用期間保留，能進入圖片編輯再返回。全程沿用 FBA-only Reports／Listings 證據，不加入 FBM。
  - Subscribe & Save 全站健檢以同次完整分頁的 FBA Inventory 證明 SKU，再讀 Replenishment offers 與最多 23 個已完成月份 metrics；畫面提供 6／12／23 個月、目前有效訂閱、可證明的訂閱營收與逐 SKU 折線，缺月省略而不補 0。只有每個納入 SKU × 所選月份都有營收值才顯示完整總額，否則明示 coverage 並保留缺值。Excel 匯出全部所選月份並固定建立 0／5／10／15／20% 五張工作表；Amazon 未回傳 Seller 折扣時儲存格保持空白且明示並非 0%。Seller Replenishment API 不支援 SG／AU，因此這兩站只顯示能力說明並在送出前停用掃描。
  - FBA 庫齡報表改為非重疊完整庫齡桶，分開顯示 Amazon 官方庫齡、estimated excess、days of supply、下月倉儲成本與 AIS 預估附加費，並可匯出 Excel。estimated excess、storage cost 或 AIS 任一商品缺值時都不顯示部分全站總額。現有 FBA Inventory／Reports 公開欄位不提供逐 SKU 或批次 lot expiration date，因此 UI 只說明能力邊界，不會拿庫齡冒充近效期／已過期清單。
  - 會計中心已建立公開 SP-API allowlist、能力清單與下載「規劃」route。Renderer 只會收到 capability、state、notice 與 next step，不會收到 upstream path／body；目前沒有真正建立、輪詢或下載會計報表。Fee Preview 只接受至少早於送出當下 72 小時的開始時間，結束時間由 main process 固定為 request NOW；日期／站點變更會取消舊規劃回應。Finances JSON、Amazon-generated settlement、人工前置、Brazil-only 與不可用能力分開標示；一般 US／CA／JP／SG／AU／UK／DE 發票及 Seller Central 帳單沒有通用公開下載 API，也不使用私有接口。
  - Variation Family 已建立雙 family 並排、child 暫存拖拉、目標 CHILD PTD 動態必要欄位，以及解除舊 parent／加入新 parent 的兩階段專用 route。每階段的程式契約包含重新讀取、Amazon Validation Preview、直接 Touch ID／系統確認、持久 idempotency、單次 PATCH 與唯讀回查；真正 commit PATCH 前的重新讀取／PTD／preview 若失敗，會明示尚未送出並安全釋放 claim，正式 PATCH 或已接受後回查不明才保留 unknown 防重送。目前只完成單元、router、SP-API mock 與 demo 互動驗證，從未在真實 Amazon 執行這條變體寫入。未取得使用者對指定 SKU 的另行明確授權前，嚴禁用真實帳號測試 detach 或 attach。
  - 定價與策劃區改成水平排列；主 UI 預設字級放大，系統資訊新增字級選擇；renderer 與 App 圖示的 `J`／紅色勾箭頭重新置中。銷售自訂天數仍由 renderer 與 main 雙重限制 1–365 天。
  - 最終本機 tree 已通過 `npm run check`：41 個測試檔、243 tests、TypeScript 與 main／preload／renderer production build；`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 與敏感資料掃描通過。Playwright 以 1440px／390px 大字體實走首頁、120 天自訂換算、滑鼠／鍵盤圖表 tooltip、文案健檢 Excel／快取／編輯返回、帳務邊界與變體暫存拖拉／CHILD PTD；390px 無整頁水平溢出。
  - PR #18 已 squash merge；main Validate run `31249715994`、Pages run `31249715991` 與 macOS universal run `31249715993` 均成功。live HTML 已核對為 `index-CeGzNNQP.js`／`index-BWn9y9lU.css`，且新 JS 包含全站文案、圖片、訂閱省健檢、FBA 帳務中心與 1–365 天功能字串。
  - main artifact `9019652910`（`AMZ.API-unsigned-3fa27e165a42a441be67abb44e5fcfcc37d264bc`）已核對 workflow digest、DMG／ZIP SHA-256、版本 `0.1.9`、bundle ID `com.jspusa.amz-api`、`x86_64`／`arm64` 與 deep strict ad-hoc codesign。v0.1.9 已安裝並持續執行，沒有立即崩潰；舊 v0.1.8 原封不動保留為 `/Applications/AMZ.API-v0.1.8-backup.app`。
- v0.1.10 已發布、部署並安裝：
  - 首頁改為三個置中頂部選單「產品區／價格區／營運區」，只保留近期 FBA 銷售、同日期品牌營收與五個一鍵健檢入口；Mac 安全連線整合至右上角。字級偏好只放大文字、不縮放卡片或控制項；390px 大字級沒有整頁水平溢出。
  - 連線證據分成「Live 憑證已設定／尚未驗證」與同站點成功 API read 後的「Amazon 已連線」；System Health 只核對本機設定，不再把已設定憑證冒充即時連線成功。
  - 圖片健檢新增與同次掃描 snapshot 綁定的 Excel：唯一 export ID 同時綁 account scope、marketplace 與短效結果，下載不重跑整站 Listings；工作簿分為「圖片健檢」與「範圍與狀態說明」，讀取未完成不填假圖片數。
  - Subscribe & Save 對缺 Seller SKU／缺 offer／缺月份採 fail closed；保留已證明 FBA、可核對 offer 與未回 offer 的精確範圍，未知不推論為 0 訂閱或不符合資格。來源不完整時只顯示已核對值並讓營收總額保持空白；Excel 同步明示部分範圍。
  - 冗餘庫存健檢只依 Amazon `estimated excess quantity`，不以庫齡判斷冗餘；完整庫齡仍可另行查看。倉儲成本或 AIS 空值只有在對應官方數量為 0 時才能當 0，其餘維持 partial／unavailable，不套自訂費率。
  - Variation 改掛置於工具頂端，解除舊 parent 與加入新 parent 明確分成兩階段；attach 必須由 relationships 與 attributes 同時證明已 standalone，detach 回查也必須核對 normalized relationships。相同 idempotency key 可 replay，新的操作 key 不會誤用 24 小時內舊完成結果；正式 PATCH 的 401／429／transport 不自動重送。
  - 新增全站未綁變體健檢與 Excel；只有完整且格式正確的 Amazon relationships 明確沒有 parent 才列入，畸形列、空白或被改寫的 Seller SKU 一律停止／列為未完成。
  - 新增品牌營收甜甜圈：依所選銷售日期讀官方 FBA Customer Shipment Sales report，固定品牌顏色、保留未分類 FBA 出貨列，滑鼠／鍵盤顯示金額與占比；renderer 不跨帳號快取。新增廣告覆蓋能力頁，只接受符合 ProductAI 命名的 ENABLED Sponsored Products 證據，以 SKU 優先、同 ASIN 補充；Live 尚未連接 Ads API 時固定停止並不顯示推測結果。
  - 會計入口移至營運頂部導覽並改稱 FBA 帳務中心；一般站點不顯示 Brazil/V2 能力。Fee Preview 只收至少早於 request NOW 72 小時的開始時間，結束時間由 main 固定為當下；目前仍只有公開能力與安全規劃，沒有真正下載會計報表。
  - 發布前本機驗證為 53 個測試檔、300 tests、TypeScript 與 production build 全通過；`npm audit --omit=dev`、`git diff --check`、試算表實際匯入／render 與 Playwright 1440px／390px 大字級均通過。沒有加入 FBM，也沒有讀取或輸出 Secret、Refresh Token 或完整 Seller ID。
  - PR #20 已 squash merge：`https://github.com/jspusa/AMZ.API/pull/20`；release main commit 為 `5949f605da420f7664bcaf9507f9fc9cde16dcf1`。main Validate run `31271753649`、Pages run `31271753667` 與 macOS universal run `31271753671` 皆成功。
  - live Pages 已核對為 `index-BU633FN_.js`／`index-Dl_rQ4s3.css`，兩者與 release commit 本機 production build 的 SHA-256 完全一致，不是只根據 build／upload 成功就宣稱已上線。
  - main artifact `9025861198`（`AMZ.API-unsigned-5949f605da420f7664bcaf9507f9fc9cde16dcf1`）已核對 GitHub digest、DMG／ZIP checksum、版本 `0.1.10`、bundle ID `com.jspusa.amz-api`、`x86_64`／`arm64` 與 deep strict ad-hoc codesign。
  - v0.1.10 已安裝為 `/Applications/AMZ.API.app`；舊 v0.1.9 已備份為 `/Applications/AMZ.API-v0.1.9-backup.app`。安裝後 App 可正常啟動且未閃退。
  - 真實 US 帳號唯讀驗證已讀取 Sales 7 天折線與去年同期；`AFA12AM` 的 Listings、FBA Inventory、價格、文案、圖片與 Subscribe & Save 均有載入。測試當下 FBA 數量為 9,745，文案完整度 5/5，圖片 7 張；這些數值是當時快照，不得當作恆定現值。
  - 全站文案健檢真實掃描 266 個 FBA SKU：265 個完成、1 個未完成，共 72 個待確認項目；`GooToE` 白名單、同次 App cache 與 Excel 儲存均已實測。全站圖片健檢真實掃描 266 個 FBA SKU：19 個少於 5 張、1 個讀取未完成，cache 可繼續使用。
  - v0.1.10 當時的未綁變體全站掃描仍在真實驗證，品牌營收也曾發現報表日期視窗的時區錯誤。相關程式修正已納入 v0.1.11 並發布；新的 main artifact 仍須解鎖後以真實 Amazon 唯讀流程重新核對，不能把單元測試取代 live 證據。
  - Variation detach／attach、價格、Sale Price、文案與圖片的任何真實寫入均未執行，也未獲使用者對特定操作的明確授權。
- v0.1.11 已發布、部署並安裝：
  - 頂部新增「報表區」與 Amazon API 文件庫，依 2026-08-09 官方清單列出 109 個唯一公開 report types、15 類用途、角色／FBA 邊界、官方連結與 App 接線狀態；目前 App 可直接匯出的六項健檢 Excel 與「Amazon 有文件但尚未接線」明確分開，不使用 Seller Central 私有接口。
  - 首頁的近期 FBA 銷售與品牌營收縮成精簡並排區；品牌會隨同一日期範圍自動載入，不再要求手動同步。品牌仍使用官方 FBA shipment report 加上目前 Listing 標題前綴分類，因 Sales API 聚合趨勢不含 Seller SKU／ASIN／標題，不能安全拿同一筆 Sales API 資料推測品牌。
  - Reports 建立加入 account scope、marketplace、mode 與 report options 的 durable lease／single-flight；品牌、未綁變體、評論與內容／圖片匯出會共用相容的 all-listings report。Terminal／建立結果不明時不自動盲目重建；只有明確的使用者再試才可在安全等待後重建。
  - 未綁變體改用 `searchListingsItems` 每批最多 20 SKU，同批讀 relationships／summaries／fulfillmentAvailability／productTypes；沒有逐 SKU fallback。Seller SKU、目前站點 summary、seed／live ASIN 與 relationships 任一缺失、歧義或衝突都列為未完成。
  - 新增 FBA 評論主題健檢：只有 Listings relationships 證明為 child 或 standalone 的非 parent FBA ASIN 才會讀 Customer Feedback；parent 明確排除。畫面與 Excel 提供正向前五、負向後五、全部主題與未完成範圍，但明示公開 API 不提供商品總星等、總評論數或完整 review 全文。
  - Subscribe & Save 遇到 FBA Inventory Seller SKU 缺少、被改寫、過長或含控制／不可見字元時不再讓整站死亡；異常列只計入來源不完整，既有可辨識 FBA SKU 繼續核對，營收與 Excel 不冒充全站完整數字。
  - 文案健檢 Excel 會以 rich text 將疑似錯字片段標紅；結果中的「立刻修改」只顯示有問題欄位，但會用 audit 時原文／token／fingerprint 對新讀 Amazon 文案重新定位。內容已被其他系統修正、移動、重複歧義或 identity drift 時退回完整編輯，不會把舊索引寫到錯誤賣點。
  - Variation Family 可選 Seller SKU 或 10 碼 ASIN 查詢，結果仍顯示 exact Seller SKU；解除／綁定區改為不裁切的桌面與 390px 版面。ASIN 找不到或不唯一會 fail closed，不改變既有兩階段 Preview／Touch ID／單次 PATCH／回查安全鏈。
  - 銷售趨勢新增預設關閉的迷你滑板，可用按鈕／方向鍵移動與跳躍；系統資訊新增「API 版本更新建議」與只依本次 App 內已開啟健檢入口產生的下一步靈感，不分析 SKU、銷售或憑證。
  - 品牌日期修正延續 RFC3339／marketplace timezone 守門，Amazon metadata 也採相同 strict parser；`CANCELLED` 與 `FATAL` 分開說明，CANCELLED 不自動重送。新的 main artifact 尚未完成真實 Amazon 報表重測，不能宣稱 live 通過。
  - 本機最終 `npm run check` 已通過 63 個測試檔／392 tests、TypeScript 與 main／preload／renderer production build；`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 與 renderer／diff 敏感資料掃描通過。1280px／390px Playwright 已實走首頁、報表下拉／文件庫、評論 cache／前五後五、SKU／ASIN 變體抽屜、版本建議與迷你滑板，沒有整頁水平溢出；品牌自動流程以無憑證假 Bridge 精確建立一次。
  - PR #22 已 squash merge：`https://github.com/jspusa/AMZ.API/pull/22`；release main commit 為 `ec1e971db25cbbb4db9a25386a8c1e2fdc46b021`。PR Validate run `31279053866`、main Validate run `31279106129`、Pages run `31279106107` 與 macOS universal run `31279106105` 均成功。
  - live Pages 已核對為 `index-BipfoazU.js`／`index-CxJSY15F.css`；SHA-256 分別為 `3a80fbfb817a2e2fe3b25ceada876ff81f7e1ae7dd52f6a50c36c6a699e52811`／`ce45944a74eddccdc45a1b8ddcc2a0944b8bb5ff27612e30ddfb5b84317cf9d4`，與 release commit 本機 production build 完全一致。
  - main artifact `9027927355`（`AMZ.API-unsigned-ec1e971db25cbbb4db9a25386a8c1e2fdc46b021`）已核對 GitHub digest、DMG／ZIP checksum、版本 `0.1.11`、bundle ID `com.jspusa.amz-api`、`x86_64`／`arm64` 與 deep strict ad-hoc codesign；短期保存至 2026-08-22。
  - v0.1.11 已安裝為 `/Applications/AMZ.API.app`，原 v0.1.10 已可回復地保留為 `/Applications/AMZ.API-v0.1.10-backup.app`。安裝後主程序與 helpers 持續執行、沒有立即崩潰；Mac 因鎖定無法完成 UI 與真實 Amazon 唯讀驗證。
- v0.1.12 已發布、部署並安裝：
  - 將 SP-API／R2／Skill 與 Ads 敏感資料輸入全部移入 packaged main-owned local editor；remote Pages renderer 只取得 redacted status、開啟本機 editor、測試與清除能力，不再接收或保存 Secret／Refresh Token。
  - 首頁加入「一鍵執行全部 FBA 健檢」背景 coordinator、Amazon Ads 唯讀連線／覆蓋能力、評論主題、未綁變體、庫齡、文案、圖片與 Subscribe & Save 的 fail-honest 範圍；報表建立由 durable lease／single-flight 共用，terminal／建立不明不會因首頁自動載入而盲目重建。
  - PR #24 已 squash merge：`https://github.com/jspusa/AMZ.API/pull/24`；release main commit 為 `e5b6a12b967613da9bbd0c8817225fbf2c9bfab1`。PR Validate run `31297884608`、main Validate run `31298271175`、Pages run `31298271176` 與 macOS universal run `31298271179` 均成功。
  - live Pages HTML／JS／CSS 已取得 200 並核對 production output；main artifact `9033689855`（`AMZ.API-unsigned-e5b6a12b967613da9bbd0c8817225fbf2c9bfab1`）的 GitHub digest為 `sha256:be8c76a607f78a575ab9cbe0c85d76221e638e0e1f13ecfb04fc46070886b09c`。DMG SHA-256 為 `0f4bf46669180fbb6086aba2d9358ee4da09ad6e57f7a3872c83fced65185038`；ZIP SHA-256 為 `c4d4db8c139bef6d0be755f8df033ec2202eb1c8595dbc1c3e4c126460fa853c`。App 版本、bundle ID、universal 架構與 deep strict ad-hoc codesign 均通過。
  - v0.1.12 已安裝為 `/Applications/AMZ.API.app`，舊 v0.1.11 保留為 `/Applications/AMZ.API-v0.1.11-backup.app`；啟動後沒有 Apple crash dialog。真實 US 唯讀載入取得 7 天 Sales 與品牌營收，品牌區顯示 23,765 件 FBA 已出貨；評論背景 job 完成 257 個 non-parent candidates，其中 8 個列為未完成。這些是 2026-08-09 當次快照，不得當作恆定現值。
  - 真實 Subscribe & Save 掃描發現 Amazon Replenishment 分頁對 exact SKU `ADT03AM` 重複回傳；v0.1.12 會因此整站停止。品牌圖例未依占比排序且文字受壓縮、頂部導覽箭頭重複、評論負向 impact 容易被誤解成商品負星等，均已轉為 v0.1.13 修正項目。
- v0.1.13 已發布、部署並安裝：
  - 品牌占比依金額由高到低，改為上方大型實心圓餅與下方兩欄完整圖例；零值仍保留於圖例。產品／價格／營運／報表四個頂部選單各只保留一個置中 chevron。
  - 首頁健檢順序改為文案、圖片、未綁變體、FBA 180+ 庫齡、Subscribe & Save、Ads、評論，讓互相關聯的兩組入口相鄰。
  - Subscribe & Save 對 exact SKU 的 offer／單月份 metric 重複、衝突或資料值無效採 row-level 隔離：該 SKU／月份列入「問題 SKU」，其他正常 FBA SKU 繼續；整體與營收 coverage 降為 partial，總額保持缺值，不補 0、不重複加總。Marketplace、program、Amazon fulfillment、月份區間、pagination 與 root 契約錯誤仍整體 fail closed。
  - 評論負值改稱「負向影響值」，明示是 Amazon 負向主題對星等下降方向的原始 impact，不是商品負星等或 1–5 星制；關閉 drawer 後 main process 會保持官方 1 request/second 節流在背景續跑，重開只接回既有 job。
  - 本機已通過 `npm ci`、`npm run check`（71 個測試檔／474 tests、TypeScript 與 production build）、`npm audit --omit=dev` 0 vulnerabilities、targeted regression、`git diff --check` 與 1280px／390px 假 Bridge 視覺驗收。
  - PR #25 已 squash merge：`https://github.com/jspusa/AMZ.API/pull/25`；release main commit 為 `74d13dc21d4b0e1fd8a2acf9294473c89c409e5f`。PR Validate run `31305731260`、main Validate run `31305784898`、Pages run `31305784896` 與 macOS universal run `31305784906` 均成功。
  - live Pages production assets 為 `index-DDQbFOo0.js`／`index-BPWCqre2.css`；SHA-256 分別為 `728c618568984a3c788524b8cb043bd5652f3043b8e0178d17f318bfb0e0d7f2`／`ab1eda8c5521533b20b8accf4b18416484970dbb9d4ad2b5312e93e8f9802ca7`，與 release production output 完全一致。
  - main artifact `9035956569`（`AMZ.API-unsigned-74d13dc21d4b0e1fd8a2acf9294473c89c409e5f`）GitHub digest、內部 DMG／ZIP checksum、版本 `0.1.13`、bundle ID `com.jspusa.amz-api`、`x86_64`／`arm64` 與 deep strict ad-hoc codesign 均已驗證；v0.1.13 已安裝並啟動。真實 UI／Amazon 唯讀重測仍待 Mac 解鎖後完成。
- v0.1.14 已發布、部署、安裝並完成核心真實唯讀重測：
  - Subscribe & Save 的官方完整月區間改採月末日 `T00:00:00Z`；exact SKU 後的單列 interval／offer／metric／duplicate 問題改為逐列隔離，其他正常 FBA SKU 與月份繼續。Marketplace、program、Amazon fulfillment、pagination 與 root contract 仍整體 fail closed；沒有補 0、改寫 identifier 或冒充完整營收。
  - 庫齡畫面新增站點實際完整庫齡層級與 AIS 預估附加費層級；US 顯示 0–30、31–60、61–90、91–180、181–270、271–365、366–455、456+ 天，AIS 另顯示各官方 tier、已回傳 SKU coverage 與部分合計。主清單仍只列實際 180+，不把 estimated excess 或 AIS basis 當成已老化庫存。
  - 評論 job 在 drawer 關閉時由首頁只用既有 `jobId` 做 GET observer，直接顯示百分比與 `x / total`；main 背景 runner 不受 drawer 影響。Terminal snapshot、marketplace、mode、job identity 均 fail closed，短暫 network／429／5xx 只做 bounded GET retry，不會 POST 建立新 job。
  - 迷你滑板圖提高垂直空間，新增明確輪子與左右滑行／滾動動畫；WASD、方向鍵、editable element 與 reduced-motion 守門保留。Variation 長 family 改為內部捲動，解除區 sticky 且以紅／藍／綠區分解除、來源與目標，避免拖曳最下方 child 時整頁過長。
  - 本機已通過 `npm ci`、`npm run check`（72 個測試檔／485 tests、TypeScript 與 production build）、`npm audit --omit=dev` 0 vulnerabilities、targeted regressions、`git diff --check` 與 1280px／390px 假 Bridge 視覺驗收。
  - PR #27 已 squash merge：`https://github.com/jspusa/AMZ.API/pull/27`；release main commit 為 `2b9a8585daf1cfb3ed95ed72add916a142864d6f`。PR Validate run `31320775118`、main Validate run `31320824609`、Pages run `31320824620` 與 macOS universal run `31320824613` 均成功。
  - live Pages production assets 為 `index-k-6ZStSt.js`／`index-BCiGbUcL.css`；SHA-256 分別為 `29e88dea57aaf3522506fddcb410aeea6ec4f04d93a970d6a46ba7fc1a150bde`／`a30519ee0e9a978c3888102c4672ec916acbd57a03fd7d56f9ca4e18feaeff2e`，與 release production output 完全一致。
  - main artifact `9040153961`（`AMZ.API-unsigned-2b9a8585daf1cfb3ed95ed72add916a142864d6f`）GitHub digest、內部 DMG／ZIP checksum、版本 `0.1.14`、bundle ID `com.jspusa.amz-api`、`x86_64`／`arm64` 與 deep strict ad-hoc codesign 均已驗證；v0.1.14 已安裝並正常啟動。
  - 2026-08-09 真實 US 6 個月 Subscribe & Save 唯讀重測不再整站停止：325 個 FBA Inventory rows 中 1 列無法原樣辨識；151 個 offer 可核對，89 個具 CURRENT_FBA 證據的精確問題 SKU 被隔離，其他結果正常顯示；coverage 保持 partial，完整營收／幣別保持缺值。這是當次快照，不得當作恆定現值。
- v0.1.15 已發布、部署並安裝：
  - 品牌／品類共用同一份 FBA Customer Shipment Sales report 快照；品類依 Supply BUSINESS REPORT 的最早關鍵字規則分類為 Turkey Tendons/Tendon、Turkey、Chicken、Salmon、Buffalo、Fish、Air Dried 與其他，平手依固定順序，切換不會另建報表。main 綁定 jobId、mode、marketplace、精確日期與 expiry；A→B→A 測試只建立兩份日期不同的報表。含站點今天時顯示實際 dataThrough，不冒充完整日。
  - Subscribe & Save 改為「全部／0／5／10／15／20／有問題」篩選；正常卡片直接顯示 SKU、Seller 折扣、目前價格與目前有效訂閱。開啟即顯示全站月底有效訂閱折線，選 SKU 顯示單品，再選同一 SKU 或取消可回全站；滑鼠與鍵盤均可讀值，缺值不補 0。
  - Subscribe & Save Excel 固定建立五張無問題的標準折扣表與一張「問題 SKU」表；未知／非標準折扣、具 CURRENT_FBA 證據的上游問題與只能安全輸出計數的問題不會塞入 0%、重複加總或冒充完整總額。
  - 所有 drawer 關閉控制統一為 36×36；迷你滑板數值固定顯示在折線圖下方。首頁健檢卡加入明確狀態色、狀態 pill 與「狀態收斂進度」，避免 7/7 失敗被誤認為成功。
  - 本機已通過 `npm ci`、`npm run check`（72 個測試檔／496 tests、TypeScript 與 production build）、`npm audit --omit=dev` 0 vulnerabilities、targeted regressions、`git diff --check`、1280px／390px 假 Bridge 視覺驗收與 Subscribe & Save 工作簿實際開啟驗證。
  - PR #29 已 squash merge：`https://github.com/jspusa/AMZ.API/pull/29`；release main commit 為 `ac5c18b2319061bcb06600967d4acec84c55d5f3`。PR Validate run `31325089229`、main Validate run `31325158196`、Pages run `31325158204` 與 macOS universal run `31325158197` 均成功。
  - live Pages production assets 為 `index-BQAL3keX.js`／`index-DjizWppD.css`；HTML、JS、CSS SHA-256 分別為 `d51a07348a48fa9505d61563cc805d820d2a77f3a71a24ad8bf72bee703d09dd`、`d7a26c926b2ce3efd066e12648116cadf2baba1e6db613c7efbd66d3f0afee5a`、`397fc523727b1805f3aff3ef5c512cfc67a97031484fd4e59e7c428d650dcddf`，與 release production output 完全一致。一般瀏覽器仍停在安全 WebGate，沒有 Amazon API 請求。
  - main artifact `9041374594`（`AMZ.API-unsigned-ac5c18b2319061bcb06600967d4acec84c55d5f3`）已核對 GitHub digest、內部 DMG／ZIP checksum、版本 `0.1.15`、bundle ID `com.jspusa.amz-api`、`x86_64`／`arm64` 與 deep strict ad-hoc codesign。
  - v0.1.15 已安裝為 `/Applications/AMZ.API.app`，原 v0.1.14 保留為 `/Applications/AMZ.API-v0.1.14-backup.app`。首次啟動在 Keychain 解密前等待且尚未建立視窗；確認無 Amazon 請求後只重啟一次，隨後 App 正常顯示首頁、`Amazon 已連線`、Live 7 天 Sales、品牌／品類切換、「狀態收斂進度」與系統資訊版本 0.1.15，沒有 crash dialog。
  - v0.1.15 只完成首頁自動 US Sales 唯讀載入與品牌 report 整理中的可見證據；品類實際分類數值、Subscribe & Save 新篩選、全站／SKU 折線與六張 Excel 仍待追加真實唯讀驗證。沒有執行 Amazon 寫入。
- v0.1.16 Windows Notebook Key 已發布：
  - WebGate 與本機連線文案由 Mac 鑰匙改為平台中立的「Notebook 鑰匙」；一般瀏覽器仍沒有 Bridge／Amazon API。Windows 下載固定指向 `https://github.com/jspusa/AMZ.API/releases/tag/notebook-key-windows`，Mac 仍保留既有 `amz-api://launch`。
  - Windows 11 x64 版沿用同一 renderer、窄化 preload、main API router、FBA-only 範圍與寫入安全鏈。Secret 只進 main-owned 本機 editor，Electron `safeStorage` 在 Windows 使用 DPAPI；沒有明文 fallback，也沒有把憑證送到 Pages。
  - 新增 first-party x64 N-API addon，以 `IUserConsentVerifierInterop::RequestVerificationForWindowAsync` 綁定目前 AMZ.API 視窗；HWND 必須有效且屬於目前程序。只有 Windows 回傳 `Verified` 才放行，取消、未設定、錯誤或逾時一律 fail closed，沒有按鈕 fallback。
  - Packaged App 啟動會驗證 addon 固定 ASAR-unpacked 路徑、manifest SHA-256、AMD64 架構與 N-API export，但 preflight 不會主動彈出 Windows Hello。Windows 未建立 publisher-bound Authenticode 鏈前，in-app check／install updater 固定停用。
  - Windows 2025 workflow 會實際編譯 addon、讀回 8 個 Electron fuses，並分別啟動 win-unpacked、展開後 ZIP 與 NSIS 實際安裝版；三者都必須同時出現 Bridge ready 與 addon-ready sentinel。PR 不上傳可執行 artifact；只有 main／manual trusted run 會上傳。
  - 本機最終 `npm run check` 通過 76 個測試檔／517 tests、TypeScript 與 production build；`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 通過。PR #31 已 squash merge：`https://github.com/jspusa/AMZ.API/pull/31`；release main commit 為 `654d70c0ed554b1b9cdd078fc0587d15274c2500`。main Validate run `31351732388`、Pages run `31351732381`、macOS run `31351732405` 與 Windows run `31351732415` 均成功。
  - live Pages production assets 為 `index-CgWtRJve.js`／`index-BuIzmwBr.css`；HTML、JS、CSS SHA-256 分別為 `30e1d0b98cfa785c02a2123d5c54e0ee5589648556d89140521c79e654d640bf`、`833704b3d89a9ebaddf9e111ff3e192fe37638815ee3ec6ab379fba9cf617f06`、`5563b1c6567b8b63a408492721d1887078738188a3d897e863d37f2e3b25d30f`，與 release production output byte-for-byte 相同；全程以 `curl` 驗證，沒有再開瀏覽器。
  - 固定 Windows prerelease 的 NSIS EXE SHA-256 為 `997209481a290a4e05dfc5111222d3deee9f2ff55bd5bff247deef06bbd8a3c0`，portable ZIP 為 `2b086fbd36c2ca8be7891a53a0d70cebc243b909b6ba2b9ba0c862799ab83b0a`；公開 `SHA256SUMS.txt` SHA-256 為 `426ff11bacc76166de15100ccd1e8dd6bc1d43cfb84428da25248bb8d5b7f12d`，與 trusted Windows run 原檔 byte-for-byte 相同。真正員工 Windows 11 Pro 裝置的 Hello UI／硬體與 DPAPI 使用者隔離尚未實測，不能用 CI smoke 冒充完成。
- v0.1.20 FBA 入庫商品明細官方續頁已發布、安裝並 live 驗證：
  - v0.1.19 真實 US 30 天唯讀工作已證明活動中清單備援可讀 31 票，但每票第一頁 25 筆商品後的官方 `NextToken` 被舊程式當成局部異常；前三票連續發生後觸發既有熔斷，因此只保留 75 列已核對資料，目標貨件若排在後面就不會讀到商品明細。這不是憑證遺失，也沒有 Amazon 寫入。
  - 修正後，第一頁固定呼叫 `/fba/inbound/v0/shipments/{shipmentId}/items`；只有該回應提供安全 opaque token 時，才固定呼叫 `/fba/inbound/v0/shipmentItems` 並帶 `QueryType=NEXT_TOKEN`、原 token 與 exact marketplace。renderer、URL、log 與工作簿都不取得 token。
  - 續頁若回傳 `ShipmentId` 必須與原貨件完全一致；Amazon 官方 model 允許省略時，仍只接受由 exact by-shipment 回應建立的同一 token chain。重複／無前進 token、跨頁重複商品、頁數或筆數超限都停止該票並保留先前已核對列；401／403／429／5xx、網路與 abort 仍依既有全域邊界停止，不盲目新增 Amazon 請求。
  - 本機 `npm run check` 通過 100 個測試檔／812 tests、TypeScript 與 production build；`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 通過。PR #45 head `a2a80dc3360859052b726a2054081113b6e350bf` 已 squash merge，main 為 `7425b8e49e027028efdfac6b101bb8d7480e5b02`；PR Validate `32561751139`、PR Windows CI `32561751161`、main Validate `32561974878`、Pages `32561974784`、macOS `32561974803` 與 Windows CI `32561974758` 均成功。Windows 結果仍只是 CI，沒有實機測試。
  - main macOS artifact `9473081924` 名稱為 `AMZ.API-unsigned-7425b8e49e027028efdfac6b101bb8d7480e5b02`，GitHub digest 為 `sha256:fb5c205b7f23b1fa18f8075f51db72ec6ba7c04b8d1f711fe3b34321a4322757`。DMG 為 246,861,081 bytes、SHA-256 `89e3e1aa35e6878018aa09c06ec80e22eb369d4be418aacc0fc71aafa6c4e9d4`；universal ZIP 為 221,569,042 bytes、SHA-256 `8228d8a735a24af5b613d6defbe2c2b31b56e12b9393f6b4a3e44cbc22551009`；均與 manifest 一致。外層／內層 ZIP、DMG CRC、版本／build 0.1.20、bundle `com.jspusa.amz-api`、`x86_64`／`arm64` 與 deep strict ad-hoc codesign 全通過。
  - `/Applications/AMZ.API.app` 已由 v0.1.19 正常退出後安裝 exact artifact v0.1.20；備份為 `/Applications/AMZ.API-v0.1.19-backup.app`。啟動無 crash dialog，沿用 Keychain vault且未重輸密鑰，首頁為 `Amazon 已連線`，系統資訊顯示 0.1.20。曾崩潰的手工 canary 沒有再使用。
  - 2026-08-22 真實 US 30 天（2026-07-24 至 2026-08-22）只啟動一次：11／31 時已越過舊版第三票熔斷點，最後 31／31 票與 803 列商品全部完成；多票顯示 26／27／30 個 SKU，證明第 25 筆後續頁已承接。總計預期 335,091、Amazon 已接收 225,440、尚未接收 111,410、多接收 1,759。清單來自活動中備援，所以 job／UI 仍誠實標為 partial；每日問題報表 unavailable，不能宣稱 0 瑕疵。沒有 Amazon mutation。
  - `FBA-入庫貨件-US-2026-08-22.xlsx` 已下載；OOXML 與 7 個 worksheet 均通過完整性檢查。工作表為「貨件摘要」32 rows、「商品接收明細」804 rows、「僅顯示差異」525 rows、三層瑕疵各 2 rows，以及「資料來源與限制」15 rows；瑕疵表只有 unavailable 說明，不能冒充零問題。
- v0.1.19 FBA 入庫清單備援已發布並安裝：
  - 真實診斷已排除「金鑰遺失」：同一已連線 Notebook Key 對 v0 日期清單得到固定 HTTP 400，但固定 2024-03-20 `listInboundPlans` 唯讀探測成功。v0 日期序列化改為 UTC `Z` 後仍是 400。
  - v0 日期清單只有明確 400／422 時，才先嘗試固定 `QueryType=SHIPMENT`＋活動狀態清單；若該清單也明確 400／422，才改用固定 2024-03-20 plan／shipment GET。401／403／429／5xx、網路或未知失敗不會跳過安全邊界繼續備援。
  - 活動狀態清單不受使用者日期限制，且可能缺少 CLOSED／CANCELLED／DELETED；新版 plan 清單依 plan `lastUpdatedAt`，也不等同舊版貨件最後更新日期。兩種備援即使逐貨件 items 與每日問題報表都完整，job 仍固定是 partial；畫面、parser 與 Excel 都明示範圍限制。
  - 新版 plan／shipment 內部 ID 只留在 main，renderer 只收到安全 shipment confirmation ID。所有請求仍是固定 GET、signal-aware、一次 401 refresh 與有限 GET 重試；沒有 Amazon mutation。
  - 本機 `npm run check` 通過 100 個測試檔／807 tests、TypeScript 與 production build；`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 通過。PR #44 已 squash merge，main 為 `cae2bd51cfeebc3bc9a8a4e77deaabd5af4e4bc1`；main Validate `32560390860`、Pages `32560390900`、macOS `32560390832` 與 Windows CI `32560390825` 均成功。Windows 結果仍只是 CI，未做 Windows 實機驗證。
  - main macOS artifact `9472647652` 的 GitHub digest 為 `sha256:22a3beb9243dae7cf2bda76dc3235422de1325e271d5da6e62301a1e31a45781`；DMG SHA-256 為 `bf9cc3931e20236357b348cc2e7f6e389ad07908a152aba5b59d177da83813f1`，universal ZIP 為 `ff3837763485fcd9b49cf073bccbf104a86d0f38b54ebf1fa2068ee6bf83ecf8`。版本／build 0.1.19、bundle `com.jspusa.amz-api`、`x86_64`／`arm64` 與 deep strict ad-hoc codesign 均通過；正式 artifact 已安裝，v0.1.18 保留為備份，Keychain vault 未清除。
  - 2026-08-22 真實 US 30 天結果為 partial：31 票活動中貨件；前三票各讀到 25 列後遇官方續頁 token，舊程式熔斷並保留 75 列。已核對預期 33,747、Amazon 已接收 33,592、尚在接收 403、多接收 248；這些只涵蓋已核對列，不能冒充完整 31 票總計。每日問題報表 unavailable，不能宣稱 0 瑕疵。沒有 Amazon mutation。
- v0.1.18 FBA 入庫診斷修正版已發布並安裝：
  - 根因：v0.1.17 將多種安全失敗壓成同一句 generic notice，且逐貨件商品明細連續三票異常時會丟掉前面已核對的部分結果；首頁再把任何 terminal failure 誤標為「需要重新接回」。這不能證明憑證真的斷線。
  - 修正後，global 401／403／429／5xx／網路失敗仍立即停止；逐貨件 local 失敗連續三票時只停止後續商品明細請求，保留已核對列，其餘貨件明確標成未知，不補 0。failed job 只回固定公開文案、安全診斷代碼與經 allowlist 的 Amazon Request ID，不回 raw upstream message、URL、report/document/account scope。
  - 首頁狀態改成「同步未完成」。renderer 對沒有新 diagnosis 欄位的 v0.1.17 reply 保持相容；只有 v0.1.18 Notebook Key 才能產生新診斷證據。
  - 本機 `npm run check` 通過 99 個測試檔／800 tests、TypeScript 與 production build；`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 通過。PR #43 已 squash merge，main 為 `494c6c50e36c2e7b751e64526b98e8e40c5b0435`；四條 main workflows 全綠，macOS artifact 已安裝為 v0.1.18 且 Keychain vault 保留。Windows 仍只有 CI，沒有實機測試。
- v0.1.17 FBA 入庫貨件追蹤與廣告策略表已發布、部署並安裝：
  - 營運區與首頁新增 30／90／180 天一鍵唯讀同步。main 背景工作依 account scope、mode、marketplace 與 exact date range 綁定；關閉 drawer 只停止 renderer observer，Notebook Key 仍會讀完全部所選貨件與每票商品。切換日期會取消舊 active range，相同 active range 才 single-flight。
  - 數量只採官方 Fulfillment Inbound v0 的 `QuantityShipped`／`QuantityReceived`，分別顯示預期、Amazon 已接收、尚在接收與多接收；接收中不稱短少或遺失，已關閉且仍有差異才建議回 Seller Central 核對。API 未提供的 title／ASIN／EAN 維持空白，不猜值。
  - 貨件／包裝箱／產品層級原因來自每日 `GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA`。報表不可用、部分或沒有回傳列時不冒充 Seller Central 即時「零瑕疵」；區間外 problem shipment 只保留匿名計數，不把識別碼送到 renderer。
  - 新增狀態／關鍵字／僅差異篩選、逐貨件 SKU 明細與 7 張中文 Excel。全域 401／403／429／5xx／網路錯誤會停止；逐貨件資料連續三次異常會熔斷，避免對全部貨件大量重試。未來日期在任何 account／report／shipment read 前依站點時區拒絕。
  - 廣告區新增「廣告策略表」：同一個 1–31 個完整日區間，main 分別取得目前 FBA SKU、Sales & Traffic SKU 銷量／營收與 Sponsored Products advertised-product 報表。只按 exact Seller SKU，或在缺 SKU 時按唯一的目前 FBA ASIN 歸因；不確定列進「未完成明細」，不複製或猜測數值。
  - 策略表依同期銷售額由高到低、SKU 由小到大破同額，按 ceil 20／50／80% 分成 T1–T4；預設 SP 日預算／目標 ACoS 為 T1 300／35%、T2 100／30%、T3 50／30%、T4 50／50%，均明示為可覆寫建議。SB／SD 攻守、再行銷、規格與其他廣告保持人工欄位；價格沒有可信同快照來源時固定空白，絕不以銷售額除以件數推算。
  - Sponsored Products 報表只自動產生實際花費、14 日歸因銷售、14 日購買次數、實際 ACoS 與花費排名；缺值保持未回報，不補 0。輸出為 29 欄中文策略表、「資料來源與規則」、「未完成明細」三張工作表，中文檔名為 `FBA-廣告策略-站點-日期.xlsx`。
  - Ads create POST 不盲目重送；帳號、profile、mode、站點、日期與報表設定均由 main 綁定。reportId、profileId、account scope 與 signed URL 不進 renderer。關閉 drawer 不取消 main 背景工作，重新開啟只 GET 接回；明確 terminal 失敗須等安全間隔並由使用者按重試。
  - 本機 `npm run check` 通過 99 個測試檔／796 tests、TypeScript 與 production build；`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 通過。PR #41（feature head `9ff8b1dc1298315796265c78fa2e73eca259f96d`）已 squash merge，main 為 `ef5bd04a8c87bf51743fe72e95e3a59073f14b4f`；PR Validate `32455147085`、PR Windows CI `32455147120`、main Validate `32455530327`、Pages `32455530245`、macOS `32455530465` 與 Windows CI `32455530213` 均成功。Windows 結果仍只是 CI，未做 Windows 實機驗證。
  - live Pages 使用 `index-gQ4mCeON.js`／`index-DGiYkoEJ.css`；HTML、JS、CSS SHA-256 分別為 `6ffdac2a898c5487d569f7438e89fa96875f566e8a23a096c25b4cbb668c8bb7`、`1c528959a628d27cd925469c16a27bc2ce23877b4411e310a30d50cd140258ef`、`f28c0df72f5d1c541de48f82bcc616a869cd3910db1c25d1b66d5852cc11a511`，三者與 exact main production output byte-for-byte 相同。
  - main macOS artifact `9437191218` 名稱為 `AMZ.API-unsigned-ef5bd04a8c87bf51743fe72e95e3a59073f14b4f`，GitHub metadata digest 為 `sha256:6ee034932ca5043774ea5110bd6c7133d93b72fd9b7c90dc434a9aa756209ea1`。DMG 為 246,079,435 bytes、SHA-256 `1f01c0455d0f7ca506a537e889be5d3de2443e571e27cfc59d332e0c1e8b3ab2`；universal ZIP 為 221,564,636 bytes、SHA-256 `1267d63573ccb54e825ca9cf3cc8d510fa2c100694de9d3abca8741859b24c82`；兩者與 `SHA256SUMS.txt` 完全一致，inner ZIP、DMG CRC、版本／build 0.1.17、bundle `com.jspusa.amz-api`、executable `AMZ.API`、`x86_64`／`arm64` 與 deep strict ad-hoc codesign 全通過。
  - `/Applications/AMZ.API.app` 已由 v0.1.16 安全備份後安裝 v0.1.17；備份為 `/Applications/AMZ.API-v0.1.16-backup.app`。啟動沿用原 Keychain vault且未重輸密鑰，同一程序在初次視窗讀取短暫等待後正常顯示首頁，沒有反覆重啟；系統資訊顯示「目前本機 App 0.1.17」。
  - 2026-08-21 真實 US 唯讀邊界：2026-07-23 至 2026-08-21 入庫同步只啟動一次，隨即以安全失敗通知收斂，沒有貨件／SKU／數量／三層瑕疵或 7-sheet Excel 可驗證，也沒有 Amazon mutation；不得寫成 0 貨件或 0 瑕疵。廣告 drawer 可見，但獨立 Amazon Ads LWA 尚未設定，故 Reporting v3、策略表與 3-sheet／29 欄 Excel 均保持未驗證。
  - Supply Boss API v4 production 沿用 server-side 兩檔 public allowlist；已將 private R2 的 `macos-dmg` 更新為 `AMZ.API-0.1.17-universal.dmg`（246,079,435 bytes；SHA-256 同上），Windows NSIS 卡維持 v0.1.16。portable ZIP 與 checksum manifest 仍只作內部 artifact，不顯示成員工下載卡；下載頁密碼與 session 規則未更改。
- 2026-08-23 v0.1.31 A+ 跨文件正向證據修正已發布、部署並安裝：
  - v0.1.30 live A+ canary 的 273 個 FBA SKU／260 個唯一 ASIN 全部顯示資料未完成；可見範例與多列顯示「文件與 ASIN 關聯互相衝突」，但沒有逐列 runtime payload 可證明 273 列全為同一 reason code。以同形狀 fixture 確定性重現後，確認其中一個核心缺口是同 ASIN 的文件 A 有 exact `CONTENT_PUBLISHED`，文件 B 的 malformed relation 卻以 ASIN-wide `conflictAsins` 抹除文件 A 的正向證據；SP-API 路徑與 renderer DTO 並未製造這個重現狀態。
  - v0.1.31 按 `(marketplaceId, path contentReferenceKey, asin)` 保留關聯 tuple；任一 exact `CONTENT_PUBLISHED` 可證明 published，另一文件的 negative／malformed relation 只使整體 partial。`contentReferenceKeySet` 是不參與 tuple 的 optional metadata，畸形時只降 partial；完全沒有 positive 的 negative／malformed 資料仍 fail closed，不能誤標 missing。
  - 兩個新回歸測試先重現紅燈，再鎖定跨文件 positive＋malformed 與 malformed optional metadata 的 positive／negative 邊界。本機 `npm run check` 通過 121 個測試檔／1,172 passed、TypeScript 與 production build；main Validate 為 1,171 passed／1 skipped（1,172 total，CI 無 LibreOffice round-trip 環境）。`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 與敏感資料差異掃描通過。兩路獨立官方契約／安全審查均無 P0–P3 finding。
  - PR #67 已 squash merge；唯一綁定本次發版程式碼的 release code main SHA 為 `fd02266279414e4e716316dbedfe7a507079bb10`。Validate `32639133396`、Pages `32639133424`、macOS `32639133384` 與 Windows `32639133408` 均以該 exact SHA 完成且成功。
  - Pages artifact `9493121214` 名稱為 `github-pages`，609,952 bytes；GitHub metadata digest 為 `sha256:c4e1897d81d14afaed0b96b30d9f723c53c22e0b5f499109b26153402775197a`。
  - live Pages 與 exact release-code production output byte-for-byte 相同：`index.html` SHA-256 `22e469637c98535839045ba9ee3fa40297cc7b5d1e87087931dfaf7036a639ec`；`assets/index-dSMhpleG.js` 為 `6268adfaea0af32edce86f6e223e3ef56200333afd3565cbbb45604bd39834b5`；`assets/index-CxpMZYNx.css` 為 `db15d2e7679dca4574dd8ae81dac3c646f33bb666948020f24eca383b7069ca4`；`assets/content-spelling-rules-D5UQWRoO.js` 為 `8ceffb80713771a64e53ece53bb47cc47321f46c8ebe713d6c7ee7e564762cd2`。
  - macOS artifact `9493175573` 名稱為 `AMZ.API-unsigned-fd02266279414e4e716316dbedfe7a507079bb10`，468,416,071 bytes；GitHub metadata digest 與下載 outer ZIP SHA-256 同為 `3633dcc113b54732669e6040939c898f590a35f6bbb6db84b16bb601707b2591`。DMG SHA-256 為 `5317006e185c37a046c1492ec9a45a5f88cc31567f91bccf106b19bed6fc0a95`，universal ZIP 為 `37756a1d5d47e7460a24d5bec9a26ce2b034e1624fdda23c64009ba1896c47f7`；checksum manifest、DMG CRC、版本／build 0.1.31、bundle `com.jspusa.amz-api`、`x86_64`／`arm64` 與 deep strict codesign 均通過。`app.asar` SHA-256 為 `790f0f87c742d1dd78d6c4269132104bb7d60be1c410f897280215c4184a05c5`，ASAR header integrity 為 `6c79c3d9f37ae659221c10ca040c7d7d2c6587ec67977c6b34707283e4410ecc`。
  - exact verified v0.1.31 App 已安裝為 `/Applications/AMZ.API.app`；installed `app.asar` 匹配 artifact，原 v0.1.30 保留於 `/Applications/AMZ.API-v0.1.30-backup.app`。既有 encrypted vault 安裝前後 byte hash 相同；userData 與更舊備份未清除或重建。App 主程序已啟動，正式 A+ UI canary 因 Mac 系統仍鎖定而尚未完成。
  - Windows artifact `9493173753` 名稱為 `AMZ.API-Notebook-Key-Windows-x64-fd02266279414e4e716316dbedfe7a507079bb10`，244,662,879 bytes；GitHub metadata digest 與下載 outer ZIP SHA-256 同為 `63372bb403c1446fc6e8c8436e09f0eeb3ab7f162648378f73d5f503ef3c7b60`。Setup EXE SHA-256 為 `49580cd8baf57fa23b1de73967fd5e1974a33f94277beea69b824dd84fb0e15e`，portable ZIP 為 `70b090b44712f3f109b11f25ac0edc08712bfddb77ae2053201111da5ab664c3`；checksum manifest、版本 0.1.31 與 Windows Hello addon packed manifest/hash 均匹配。這仍只是 CI，不是真實 Windows 11、Windows Hello 或 DPAPI 實機證據。
  - 本版發布、安裝與驗證沒有 Amazon mutation。正式 A+ canary 完成前不得把單元測試或 v0.1.30 失敗結果冒充 live 通過。
- 2026-08-23 v0.1.30 A+／B2B 數量折扣與父變體橫排修正已發布、部署、安裝並完成部分 live canary：
  - B2B 從 Active／All Listings reports 讀取 canonical Business Price 與 Quantity Price Type／Lower Bound／Price 1–5，並對 duplicate header、斷層、畸形或衝突資料 fail closed；未綁變體工作簿第四張表改為第一列橫排 Parent、各欄第二列起只接該 Parent children 的 `父變體橫排`。
  - 版本為 0.1.30；`npm run check` 通過 121 個測試檔／1,170 tests，audit 0、diff check 與敏感資料差異掃描通過。PR #66 的 release code main SHA 為 `b6d3d8b3593283c8c1fa1495ab66af4e1b877569`；Validate `32637192073`、Pages `32637192029`、macOS `32637192058` 與 Windows `32637192081` 均成功。
  - 正式 US B2B 唯讀 canary 完成 274 個 FBA SKU；範例 `1ABRD001A0` 已顯示 Business Price US$9.69 及 5+／10+／20+／50+ 的 fixed unit tiers 9.5／9.4／9.3／9.2，不再顯示「Amazon 未能確認」。總結為需處理 268、價格不符 223、階梯不符 224、高於一般售價 11、未設定 4、已設定 232、資料未完成 27。
  - 正式 variation 唯讀 canary 完成 274 個 FBA SKU；輸出實際工作簿含 `未綁變體`、`讀取未完成`、`所有變體`、`父變體橫排` 四張表。`父變體橫排` 為 A1:Z20，第一列 26 個 Parent、第二列起各自只接 children；實際 workbook 已完成匯入、render 與公式錯誤掃描。
  - 正式 A+ 唯讀 canary 仍將 273 個 FBA SKU／260 個唯一 ASIN 全部標為資料未完成，證明 v0.1.30 的正向 precedence 邊界仍不足；此 live 失敗直接促成上方 v0.1.31 修正。三項 canary 均沒有 Amazon mutation。
  - macOS artifact `9492668997`、Windows artifact `9492683284`、Pages exact-byte 證據與安裝 hash 已在 v0.1.31 工作中重新核對；v0.1.30 App 現保留為 `/Applications/AMZ.API-v0.1.30-backup.app`。
- 2026-08-23 v0.1.29 全站健檢可用性、A+／B2B 與 Excel 修正已發布、部署並安裝：
  - 文案健檢卡不再先用一大段文字重複列出全部原因；每個原因只在逐列區顯示一次。`立即修改` 會 fresh-read Amazon 原文並聚焦有問題欄位，證據不足才要求完整編輯。同一份 Excel 經 Excel／LibreOffice 儲存後可用 main-owned bounded digest 正確核對；未改內容回 `CONTENT_UNCHANGED`，真正改動識別、變體分類或原文仍 fail closed。
  - A+ 會保留 publish record 與 duplicate relation 中的 exact `CONTENT_PUBLISHED` 正向證據；同一 document 的重複 metadata 使用最新 display 資料並標 partial，仍繼續走完整 ASIN relations。真正 published／not-published 衝突保持 incomplete，非目標畸形 relation 不再污染已知 target；前台移除沒有決策價值的 `API 不可用` 篩選，但 unavailable 列仍納入 `需處理`。
  - B2B exact Active Listings price 可覆蓋同 SKU 較舊的 Listings contribution；若 Active 與完整 all-listings exact report 真正衝突，仍保持 incomplete，第三個 Listings positive 不能洗掉。每列獨立標示 `不符建議 B2B 價格` 與 `未正確設定階梯折扣`，兩者可同時成立；USD 建議價固定為一般售價少 US$1.00，建議 percent tiers 固定為 5／5%、10／10%、15／15%、20／20%，unknown evidence 不得推成 mismatch。
  - B2B 完成 snapshot 由 main 綁 account／mode／marketplace／job／context 後匯出五張工作表；首頁待處理數會對同一 SKU 的重疊建議去重。B2B 匯出按鈕已恢復為 176×42 左右的水平控制，不再撐成整段直立色塊。
  - Variation Excel 的 family 使用較淡交替底色與 medium boundary，新增 `全部變體（直式）`：每個 Parent 後緊接其 children，再接下一個 Parent；standalone 與 incomplete 另行附後。四張 variation QA PNG 與 B2B 五張 worksheet render 均已逐張檢查。
  - 版本為 0.1.29；`npm run check` 通過 121 個測試檔／1,154 tests、TypeScript 與 main／preload／renderer production build，`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 與敏感資料差異掃描通過。獨立最終安全複審未發現剩餘 P0／P1／P2。
  - 1440×1000 本機 fake Bridge Playwright 已核對首頁 `成功 2 個需調整／確認`、B2B 全部 3／需處理 2／價格 1／階梯 2、正常匯出按鈕、0 水平 overflow、3 個 mismatch findings；Amazon mutation request 與外部 request 均為 0。
  - PR #64 已 squash merge；唯一綁定本次發版程式碼的 release code main SHA 為 `c8a79446c448f7b5de51dac10ac117800811fdba`。Validate `32634112294`、Pages `32634112275`、macOS `32634112270` 與 Windows `32634112308` 均以該 exact SHA 完成且成功。後續 docs-only main SHA 只代表證據文件更新，不得取代此 release code／artifact SHA。
  - Pages artifact `9491835227` 的 GitHub metadata digest 為 `sha256:82bde88c41f09c9927ae371901488a4e5b8dc7d1d80c1bf218999cb4e4d037ac`。live Pages 與 exact release-code production output byte-for-byte 相同：`index.html` 為 `8ccd6960876e07449ca8deb432e66fd05ba90f7322ed91920e408d5ef69906d4`；`assets/index-COOMaJhS.js` 為 `b60047c6b8559e7fc3c4ec524fc7b3d7fd17f25652874e8d7a8d63397d8fc588`；`assets/index-CxpMZYNx.css` 為 `db15d2e7679dca4574dd8ae81dac3c646f33bb666948020f24eca383b7069ca4`；`assets/content-spelling-rules-D5UQWRoO.js` 為 `8ceffb80713771a64e53ece53bb47cc47321f46c8ebe713d6c7ee7e564762cd2`。
  - macOS artifact `9491880832` 名稱為 `AMZ.API-unsigned-c8a79446c448f7b5de51dac10ac117800811fdba`，467,807,316 bytes；GitHub metadata digest 與下載 outer ZIP SHA-256 同為 `9ac574917335e6617069e1a1428c1270c0da771c4443595b7b4155700bd13602`。DMG SHA-256 為 `16bb67f86d8f2052e82ed838db9fb2fe97a3feadd28693dce692a84d1a55b3bb`，universal ZIP 為 `babe5be3da17a41345c27e8d1c6de30984211e8b28e52321645221cc4e71f3a9`；兩者與 manifest 完全一致，ZIP／DMG、版本／build 0.1.29、bundle `com.jspusa.amz-api`、`x86_64`／`arm64`、deep strict ad-hoc codesign 與 `app.asar` 均通過。
  - exact verified v0.1.29 App 已先在 `/Applications` staging 驗證再原子安裝為 `/Applications/AMZ.API.app`；installed `app.asar` SHA-256 為 `4323ffd0224a9935fa0c54d34e50fc153b7924229d660dcd33ede1ddc7b622f1` 且匹配 artifact，原 v0.1.28 保留於 `/Applications/AMZ.API-v0.1.28-backup.app`。既有 userData、encrypted vault 與更舊備份未清除或重建。安裝後主程序、GPU／network／renderer helpers 與一個 App 視窗持續存在，沒有啟動即崩潰。
  - Windows artifact `9491898018` 名稱為 `AMZ.API-Notebook-Key-Windows-x64-c8a79446c448f7b5de51dac10ac117800811fdba`，244,659,524 bytes；GitHub metadata digest 為 `sha256:c14100b0424d47582b59be6f31e47707bbccc645efea36877792a6fdb1bf9e4f`。Windows workflow 已完成封裝、ASAR addon boundary、packaged Bridge smoke 與 artifact upload；這仍只有 GitHub Windows runner 的 CI 證據，不是真實 Windows 11、Windows Hello 或 DPAPI 實機驗證。
  - 本次只部署、安裝與做非破壞 smoke；沒有要求或記錄憑證，沒有執行正式 Amazon A+／B2B／文案唯讀 canary、Touch ID／Windows Hello、Validation Preview、PATCH、readback 或任何 Amazon mutation。
- 2026-08-23 v0.1.28 B2B／A+ 官方證據修正已發布、部署並安裝：
  - B2B audit 固定唯讀並只提供 exact Seller SKU 的 Seller Central handoff；移除唯讀／不支援摘要、內部編輯器與 seller-specific PTD 說明。摘要只保留全部、需處理、高於一般售價、未設定、已設定、資料未完成六項；百分比數量折扣改成「5 件以上／省 5%」等逐階卡片。
  - Active Listings Business Price 改由 main-owned、account／marketplace／mode／report type／options 綁定的 `DurableReportLifecycle` single-flight 建立與沿用；data GET 不隱含 POST，unknown create 會留下持久 tombstone 並禁止盲目重送。一般售價／Buy Box ERROR 與 B2B 證據分離；Active unavailable 時可由 all-listings exact positive 保留已設定，但 Active duplicate／malformed／ASIN 或來源衝突一律 incomplete，不能被 Listings positive 洗掉。
  - A+ 只使用公開 A+ Content API：完整 child／standalone 讀全部 publish-record pages，account-wide `searchContentDocuments` 列出文件名稱、審核狀態與 badges，再逐文件以 `listContentDocumentAsinRelations` 核對 ASIN 關聯。只有 exact publish record 或 `CONTENT_PUBLISHED` 是正向發布證據；文件存在或 APPROVED 不等於已發布。只有 publish-record 空清單、文件清單及全部文件關聯皆完整且無衝突時才可標未發布，其他缺口維持 incomplete／unavailable。
  - 版本為 0.1.28；本機 `npm run check` 通過 119 個測試檔／1,142 tests、TypeScript 與 production build，`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 通過。獨立最終安全複審未發現剩餘 P0／P1／P2。
  - 1440×1000 本機 fake Bridge Playwright 已核對 AFA135AM 顯示 US$17.45、TRPL03 在一般價缺失時仍保留 US$14.50、六項 B2B 篩選、折扣卡片、A+ 文件名稱／審核／關聯、0 水平 overflow、exact Seller Central handoff；Amazon mutation request 與外部 request 均為 0。
  - PR #62 已 squash merge；唯一綁定本次發版程式碼的 release code main SHA 為 `00c8c5e523bbedcfcb957912b2324e8731d0285d`。Validate `32630335282`、Windows `32630335278`、Pages `32630335306`、macOS `32630335292` 均以該 exact SHA 完成且成功。後續 docs-only main SHA 只代表證據文件更新，不得取代此 release code／artifact SHA。
  - Pages artifact `9490847650` 的 GitHub metadata digest 為 `sha256:590cc76d58d489ea591711cabbc5fe0e6a8e62f238bf492ab303b84664a12c0a`。live Pages 七個檔案與 exact release-code production output byte-for-byte 相同：`index.html` 為 `13a1b2917600d119a0577a2fa437c9b9af921a45a63af5ec39fc31bc6762a7d0`；`assets/index-DOLR7axp.js` 為 `80f57d30d61ff65913a89baaa5f2da6aa379ab0a493240d115152f63ddee3008`；`assets/index-B2No2iKP.css` 為 `f32b5831964c6ef2f1fce6c75720f5bfc8746a0ce4404d74aef1079c1815e24d`；`assets/content-spelling-rules-D5UQWRoO.js` 為 `8ceffb80713771a64e53ece53bb47cc47321f46c8ebe713d6c7ee7e564762cd2`；三份 spellcheck license 分別為 `2a7e8d8ae9e8facc84818546ae2a8d83aec5e9c80a675ff789acd1c338b53b3d`、`c7cc929b57080f4b9d0c6cf57669f0463fc5b39906344dfc8d3bc43426b30eac`、`ca4662cb5d1b738fbe5350c0d5485ba11773b4b7208974082ae6e129a52d631d`。
  - macOS artifact `9490891204` 名稱為 `AMZ.API-unsigned-00c8c5e523bbedcfcb957912b2324e8731d0285d`，467,976,131 bytes；GitHub metadata digest 為 `sha256:e2246d07c437f0a1c05abbfc03447e61fb507580a8f3759d8c1541424a689325`。DMG 為 246,264,091 bytes、SHA-256 `5bd976d5c2dff64cdc8296ed8482aa2992d8ff015a892be3f48d8a436a8e3dd2`；universal ZIP 為 221,711,396 bytes、SHA-256 `27b80d763e8eb47d06bc8a4f5f4c24e4a50d262921962f9b2e662b5173ffaf78`。兩者與 manifest 完全一致，ZIP CRC、DMG checksum、版本／build 0.1.28、bundle `com.jspusa.amz-api`、`x86_64`／`arm64`、deep strict ad-hoc codesign 與 `app.asar` 均通過。
  - exact verified v0.1.28 App 已原子安裝為 `/Applications/AMZ.API.app`；installed `app.asar` SHA-256 為 `0c53d93c0a18fed0bdd3dfdf239273ed7c9462b4d569af1be5726a083968da57` 且匹配 artifact，原 v0.1.27 保留於 `/Applications/AMZ.API-v0.1.27-backup.app`。既有 userData、encrypted vault 與更舊備份未清除或重建。
  - Windows artifact `9490899997` 名稱為 `AMZ.API-Notebook-Key-Windows-x64-00c8c5e523bbedcfcb957912b2324e8731d0285d`，244,647,564 bytes；GitHub metadata digest 為 `sha256:c32ccc630cba7a34395f4e13aa53b8542893790907b798ff4688ca7cd84a47ce`。portable ZIP 為 142,921,191 bytes、SHA-256 `013dc1018c87b74014e2ca4e95026ec3198fe504fc99cf38ae0520180d7bb309`；Setup EXE 為 101,725,677 bytes、SHA-256 `39420c37a2cdc2808eafeee90333706665f2ccb730105672b500f0070aaaefc6`；manifest 與 ZIP CRC 均通過。這仍只有 GitHub Windows runner 的 CI／封裝／Bridge smoke 證據，不是真實 Windows 11、Windows Hello 或 DPAPI 實機驗證。
  - v0.1.28 已啟動主程序與 GPU／network helpers，但尚未建立 renderer；應由使用者完成原生 Keychain 重新授權後再執行 A+／B2B 正式 Amazon 唯讀 canary。這次沒有清除或重建 vault，沒有要求或記錄憑證，沒有執行 Touch ID／Windows Hello、PATCH、readback 或任何 Amazon mutation。
- 2026-08-23 v0.1.27 全站健檢修正已發布、部署並安裝：
  - 文案卡維持每項原因只呈現一次；立刻修改仍以 fresh Amazon 原文與 ingredients fingerprint 聚焦相符欄位，證據不足或漂移才 fail closed 回完整編輯。同一份文案 Excel 回傳仍使用 main-owned digest bounded recovery，識別、變體分類或原文真正變更才停止。
  - 「一鍵執行全部」不再建立第二套結果區或啟動 legacy suite 重複掃描；它直接 fan out 至七張既有卡片的 main-owned job。任一 active job 由 main single-flight 沿用，仍可補啟動其餘項目；啟動失敗與 terminal failure 都留在對應卡片，舊 cache 不得冒充本次結果。legacy `/audit-suite`／合併匯出 route 暫留相容性但首頁不可達。
  - A+ publish record parser 接受官方 optional `contentSubType: null`，但核心 marketplace／ASIN／reference／content type／locale 仍嚴格驗證；畸形 object／number 不會被當成 published。B2B 在 Listings 缺 exact B2B contribution 時，可用同次 FBA all-listings 的 exact positive Business Price 作唯讀設定證據；canonical Listings 優先，兩者衝突或報表價格畸形時保持 incomplete。
  - 「所有變體」Excel 依連續 family 交替深藍／淺藍整區底色並加 medium 外框；其他工作表的既有 style indices 不變。A+／B2B 摘要與篩選各只保留一組可點擊數字，B2B 在 960px 實測七顆同列。
  - 版本為 0.1.27；本機 `npm run check` 通過 119 個測試檔／1,104 tests、TypeScript 與 production build，`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 通過。
  - PR #60 已 squash merge；唯一綁定本次發版程式碼的 release code main SHA 為 `d7136660eb71a4308625f49334a159c5351f7c08`。Windows `32622496558`、Validate `32622496640`、macOS `32622496513`、Pages `32622496523` 均以該 exact SHA 完成且成功。後續 handoff 證據若由 docs-only PR 合併，較新的 main SHA 只代表文件更新，不得取代 `d7136660eb71a4308625f49334a159c5351f7c08` 或冒充新的 release artifact SHA。
  - Pages artifact `9488775387` 的 GitHub metadata digest 為 `sha256:3227c75144037825e560dbe36fdfe6ce2072df4ac0c17331c1724e761b6907c6`。live Pages 七個檔案與 exact release-code production output byte-for-byte 相同：`index.html` 為 `c959e87fb4bfc0daa548f97e9bfd9886d48b730a7e243836c5c7b2e60adbfa74`；`assets/index-BHFBc7TA.js` 為 `8bafaf9e136743c17178e3fa41bf913d29b09b64cb3d6ccdbbfc1851830bf0e1`；`assets/index-B6K8uvya.css` 為 `7a37cae20691079c07f955bb4777ad70966bdaed94203aac8a892c68b239eee5`；`assets/content-spelling-rules-D5UQWRoO.js` 為 `8ceffb80713771a64e53ece53bb47cc47321f46c8ebe713d6c7ee7e564762cd2`；三份 spellcheck license 分別為 `2a7e8d8ae9e8facc84818546ae2a8d83aec5e9c80a675ff789acd1c338b53b3d`、`c7cc929b57080f4b9d0c6cf57669f0463fc5b39906344dfc8d3bc43426b30eac`、`ca4662cb5d1b738fbe5350c0d5485ba11773b4b7208974082ae6e129a52d631d`。
  - macOS artifact `9488815906` 名稱為 `AMZ.API-unsigned-d7136660eb71a4308625f49334a159c5351f7c08`，467,981,932 bytes；GitHub metadata digest 與下載 outer ZIP SHA-256 同為 `2e45d0e0649aa1be040fcd795dfd04e2916b928455744f366db6be5037fc490e`。DMG 為 246,272,513 bytes、SHA-256 `1817b0ace15b1eee401eb6550e7358a0688850c63f89ae420560a2b6d8694bc8`；universal ZIP 為 221,708,775 bytes、SHA-256 `554219f1a206dd957ecfa930f950f7f45d504a7de509102b3b2648ed0f332e6d`。outer／inner ZIP 與 DMG checksum 均通過；artifact 內 `app.asar` 為 18,438,690 bytes、SHA-256 `81afa93c7784fa15588b60731d1ef546951f9a548c45c8d2ccd68a7c5eca18a3`。
  - exact verified v0.1.27 App 已安裝為 `/Applications/AMZ.API.app`；版本／build 0.1.27、bundle `com.jspusa.amz-api`、`x86_64`／`arm64`、deep strict codesign 與 installed `app.asar` 均匹配 artifact，原 v0.1.26 保留於 `/Applications/AMZ.API-v0.1.26-backup.app`。既有 userData、encrypted vault 與更舊備份未清除或重建。
  - Windows artifact `9488849759` 名稱為 `AMZ.API-Notebook-Key-Windows-x64-d7136660eb71a4308625f49334a159c5351f7c08`，244,644,529 bytes；GitHub metadata digest 與 outer ZIP SHA-256 同為 `3ecdad334e7c7eb947ecf6140b288131bab58b401a1a5a6020e3ea2d87844d06`。內層 portable ZIP 為 `d8eb011742247e807310baf8df8fdf360d51cfc360af0f9b534495abdc060213`，Setup EXE 為 `2c4e01330c2d48fe9e59e8c832e3ebc70b61804590d4a4f5f06b30f74bd7323`；這仍只有 GitHub Windows runner 的 CI／封裝證據，不是真實 Windows 11、Windows Hello 或 DPAPI 實機驗證。
  - 使用者原始 `FBA-文案健檢-US-2026-08-22.xlsx` 已由 v0.1.27 parser 與同一 main-owned snapshot digest 做離線完整性核對：273／273 列的識別欄、變體分類與原始文案均接受，0 列誤判竄改；其中 9 列由 bounded 舊換行相容邏輯唯一復原，2 列只有允許編輯的「更新…」值不同。這證明先前的假竄改會被正確復原，但尚未執行 Amazon Validation Preview 或任何寫入。
  - v0.1.27 正式 Amazon 唯讀 canary 尚未完成：目前 Mac 鎖定，Notebook Key 停在原生 Keychain 重新授權等待；程序尚未建立 renderer。不得清除或重建 vault，也不得要求、記錄或公開 LWA Secret、Refresh Token、完整 Seller ID 或 access token；本次尚未執行 Touch ID／Windows Hello、PATCH、readback 或任何 Amazon mutation。
- 2026-08-23 v0.1.26 單項健檢可用性已發布、部署並安裝：
  - 文案、圖片、未綁變體、Subscribe & Save、B2B、廣告覆蓋與庫齡統一改由 main-owned standalone job coordinator 執行；A+ 與評論沿用各自 main-owned coordinator。每個工作都綁 account scope、mode、marketplace、job/context ID 與短效 lease。關閉抽屜只停止 renderer observer，Notebook Key 主程序仍會繼續，首頁以 GET-only observer 顯示即時進度並接回 terminal snapshot；切換帳號、站點、模式或 credential lifecycle 時舊結果 fail closed。
  - B2B 唯讀列改成「請到 Amazon 後台編輯」，每個 SKU 透過窄化 IPC 開啟固定 Seller Central inventory URL，`searchTerm` 只接受精確 SKU 並以 `encodeURIComponent` 編碼；不允許 renderer 傳入任意 URL。每列顯示一般售價減 USD 1 的建議 B2B 價格、5／5%、10／10%、15／15%、20／20% 建議階梯，以及 Amazon 回傳的 canonical QDP／未設定／不明證據；原有 Preview、native confirmation、idempotency、單次 PATCH、readback 與 no-blind-retry 邊界沒有放寬。
  - A+ 只回答是否有官方 publish record；移除所有 Brand Story／From the brand 功能與 UI，以及類型／語系／筆數雜訊。warning-only 空頁會繼續翻完合法 page token 並保持未知；後頁找到 exact publish record 時保留正向證據。問題列可前往固定白名單的 Amazon A+ Content Manager 核對。
  - 文案錯字例外新增 `differentiator`、`GANODERMA`、`CORNUCOPIAE`、`Staffordshire`、`American`、`Siberian`；`Cocker` 只有在同一段連續 `Cocker Spaniel` 中才豁免。既有 60／110／150–200／1,800 Unicode 字元門檻不變。
  - 未綁變體 Excel 新增第三張「所有變體」工作表；每個 family 固定先列精確 Parent SKU，再依 SKU 排序列出已驗證 child SKU。若 parent 不在 FBA 報表，只用 child relationship 回傳的精確 parent SKU 建立空白標題列，不猜商品名稱、Product Type 或 ASIN。
  - 本機 `npm run check` 通過 118 個測試檔／1,095 tests、TypeScript 與 production build；`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 通過。1440×1000 本機 fake Bridge Playwright 已驗證關閉 B2B drawer 後首頁持續顯示 1／3 背景進度、重新接回完成結果、B2B 建議價／QDP／Seller Central handoff、A+ presence-only 與三張變體工作表，整頁無水平 overflow，外部 request 與 PATCH／PUT／DELETE 均為 0。另一組文案桌面 QA 證明舊「本次錯誤原因」標題為 0、兩項 fixture 原因各只出現一次；「立刻修改」fresh GET 後只顯示相符的亮點與敘述欄，「完整編輯」fresh GET 後顯示全部九個欄位，兩條路徑都沒有寫入或外部 request。同檔 Excel 特殊換行 bounded recovery 與識別欄 fail-closed 由自動測試覆蓋。依使用者指示沒有做 mobile 視覺測試；正式 Amazon 唯讀 canary、任何 Preview／mutation 與真實 Windows Hello 仍未執行。
  - GitHub PR #58 已 squash merge；release code main SHA 為 `9d8a445b4d1d9285f2bb13530dd00b0e92342488`。main Validate `32616632575`、Pages `32616632534`、macOS universal `32616632654` 與 Windows x64 `32616632536` 均成功。
  - live Pages 七個檔案與 exact main production output byte-for-byte 相同：`index.html` SHA-256 `f4345ef85e358fa1529d2fb93569ed8447622f0aa20cd6f7a7195c7c9afc9e03`；`assets/index-D4-Ocoj_.js` SHA-256 `d2cd61844fcb40220241682b9ec75026a2b5bd9e8c7ec8648f6d37fe2979ff96`；`assets/index-DMwIbyEH.css` SHA-256 `8f46f6d961ffe61acb457a8ad101181667847e666bd6b78827c473e05129f7c4`；`assets/content-spelling-rules-D5UQWRoO.js` SHA-256 `8ceffb80713771a64e53ece53bb47cc47321f46c8ebe713d6c7ee7e564762cd2`；三份 spellcheck license SHA-256 也逐檔相同。
  - main macOS artifact `9487205056` 名稱為 `AMZ.API-unsigned-9d8a445b4d1d9285f2bb13530dd00b0e92342488`，467,972,891 bytes；GitHub metadata digest 與下載 outer ZIP SHA-256 同為 `e56103011fde02abbbe8a849bb1f12ef132513b5d1e68be0b1f7bdf17b35effb`。DMG 為 246,263,511 bytes、SHA-256 `5056a3178dfec98eb1ef8789cb2010a5d1cef63259d5d152517db5b7d7b28dd5`；universal ZIP 為 221,708,736 bytes、SHA-256 `b76928a5d1b8836f2c132900ce05004a5b4e8262820b234c6ebac193d9cfe048`。outer／inner ZIP、DMG CRC、版本／build 0.1.26、bundle `com.jspusa.amz-api`、executable、`x86_64`／`arm64` 與 deep strict ad-hoc codesign 均通過；DMG／ZIP 內 `app.asar` 完全相同，18,441,782 bytes、SHA-256 `f84ff2b33abcc360da7dedc0657c4c5707e4711ab16a770809f429dfe3cd3d53`。
  - exact verified v0.1.26 DMG 已原子安裝為 `/Applications/AMZ.API.app`；原 v0.1.25 可復原地保留為 `/Applications/AMZ.API-v0.1.25-backup.app`，既有 userData、Keychain vault 與更舊備份均未清除。已安裝 App 再次通過版本／build、bundle、雙架構、deep strict codesign 與 `app.asar` 比對，主程序啟動 12 秒後仍穩定且 AppleScript 回報 0.1.26。這次沒有主動啟動 Amazon 健檢、Preview、生物辨識或 mutation。
  - main Windows artifact `9487189929` 名稱為 `AMZ.API-Notebook-Key-Windows-x64-9d8a445b4d1d9285f2bb13530dd00b0e92342488`，244,644,439 bytes；GitHub metadata digest 為 `sha256:e04de0b318f560598e6566f192f5956c87c3e855f5bf9af52896f399eb1ebbd9`。Windows workflow 與 packaged Bridge smoke 成功，但這不是員工 Windows 11／Hello／DPAPI 實機證據，固定 prerelease 仍為 v0.1.16。
- 2026-08-23 v0.1.25 全站七項健檢已發布、部署並安裝：
  - 首頁一般健檢卡與 run-all 共用同一個 canonical schema v3，固定依序執行文案、圖片、A+、未綁變體、訂閱省、B2B 價格、廣告覆蓋七項；七個 worker 在 main 背景並行，A+ 與 variation 共用同次完整 all-listings／relationships 證據。舊 schema v2 Pages／Notebook Key 組合會顯示明確升級訊息，不會靜默少跑兩項。
  - 新增 FBA-only A+ 全站唯讀健檢：只有 relationships 已證明為 child／standalone 且身分完整的 Seller SKU 才會依 marketplace＋ASIN 去重讀取全部 official publish-record pages；parent 排除，relationship／身分不完整列保留為 incomplete 且不發 A+ request。只有 warning-free 完整空頁可標沒有 A+；403、warning、pagination／schema 缺口保持 unavailable／incomplete。公開 API 無法驗證 From the brand／Brand Story，固定明示不可驗證。main-owned job 綁 account／mode／marketplace／context，支援長時間 observer reconnect、rate／Retry-After pacing、heartbeat lease 與 stale active abort。
  - B2B 健檢新增高於一般售價狀態；編輯器預設只改價格並完整保留既有 `quantity_discount_plan`。只有使用者明確切換 combined 模式，且 seller-specific PTD 的 exact B2B price／QDP branch、1–5 階 percent tiers 與每個 requested numeric constraint 都能證明時，才會帶數量折扣。建議預設為一般售價減 USD 1，以及 5／10／15／20 件各 5%／10%／15%／20%；多個 levels 本身是正常結構。Preview、native confirmation、idempotency、單次 PATCH、完整 offer guard、price／tiers canonical readback 與 no-blind-retry 邊界均保留；本次發布沒有執行 Amazon Preview 或 mutation。
  - 文案健檢摘要數字本身可直接篩選，全部待確認精確包含 issue 與讀取未完成列；原因仍只顯示一次。成分規則前台統一顯示「成分宣稱不一致」，並在完整且非空的 Amazon ingredients 證據下額外核對 Tendon／Tendons 與 Chicken＋hypoallergenic 文案。WebGate 兩行標題已改為獨立 block，桌面 1440×1000 真實 layout rect 間距 7px、沒有重疊或水平 overflow。
  - 本機 `npm run check` 通過 113 個測試檔／1,046 tests、TypeScript 與 production build；`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 與固定敏感字串掃描通過。桌面 fake Bridge QA 已實走七項順序、文案摘要篩選／不重複、A+ POST→GET job 與 B2B price-only／combined 切換；combined 四階全部在 1440×1000 drawer 可見，外部 request 與 PATCH 均為 0。依使用者指示沒有做 mobile 視覺測試。獨立 final review 沒有剩餘 P0／P1／P2。
  - GitHub PR #56 已 squash merge；release code main SHA 為 `06f6a6887eb1624f40dd4eb4f9920665b6d85ec6`。main Validate `32594914170`、Pages `32594914229`、macOS universal `32594914224` 與 Windows x64 `32594914169` 均成功。
  - live Pages 與 exact main production output byte-for-byte 相同：`index.html` SHA-256 `2be2dfdc0d1e2f673023c6d46124748ee9b08de2c7b8fd62bc8031001551f379`；`assets/index-DsvRqMPA.js` SHA-256 `67e89e831625dca40d8069417e19c7580391c50cb02043eab02ae3cab5c78aaf`；`assets/index-dXe1Fas3.css` SHA-256 `4fb0add0bb4d0a78029135779d869deaa548c1e6a7a2e7b5fe483b2740dd09fd`；`assets/content-spelling-rules-BcfLoQVC.js` SHA-256 `462e192e5b70d219095b87e4996b7910584fad8b58129554edfd7e93cdd04806`。
  - main macOS artifact `9481336965` 名稱為 `AMZ.API-unsigned-06f6a6887eb1624f40dd4eb4f9920665b6d85ec6`，467,974,842 bytes；GitHub metadata digest 與下載 outer ZIP SHA-256 同為 `5006ad249a0f8ff1ce738530213cefc415700363a53bb2afb06c6cea70d2baf1`。DMG 為 246,275,909 bytes、SHA-256 `a09641f4770f4e73f922f13e83cf4c19d6de9f153084639bd9b60f43b1ec2e31`；universal ZIP 為 221,698,289 bytes、SHA-256 `9aa487b9ada5322aca3046ad326fb47b621431d2540b482cee90b8b95a7da76c`。inner／outer ZIP CRC、DMG CRC、版本／build 0.1.25、bundle `com.jspusa.amz-api`、executable、`x86_64`／`arm64` 與 deep strict ad-hoc codesign 均通過；DMG／ZIP 內 `app.asar` 皆為 18,372,836 bytes、SHA-256 `26672e2f5dfe355c2ca5f2b1997e1296c1dcc31f3265a8668edbc92a49db4ae3`。
  - main Windows artifact `9481356277` 名稱為 `AMZ.API-Notebook-Key-Windows-x64-06f6a6887eb1624f40dd4eb4f9920665b6d85ec6`，244,628,701 bytes；GitHub metadata digest 與下載 outer ZIP SHA-256 同為 `a8858349dc36b85e5b9f0177a8db0a6fc9d76d7de10573fac9621b0feb9dd7a4`。NSIS EXE 為 101,719,536 bytes、SHA-256 `eaa42b2a4fe6d7e12a4d1da3ee90a96b3ccf2e05df7ef8bfcc90ce923b949899`；portable ZIP 為 142,908,469 bytes、SHA-256 `aa3a78c53d793a1dd8a3a7f31558d5a48699915ddc446338b533fab8ed78fc47`。package 版本為 0.1.25 且 Windows Hello native addon 可由 CI 載入；這不是員工 Windows 11／Hello／DPAPI 實機證據，固定 prerelease 仍為 v0.1.16。
  - exact verified v0.1.25 DMG 已安裝為 `/Applications/AMZ.API.app`，原 v0.1.24 可復原地保留為 `/Applications/AMZ.API-v0.1.24-backup.app`；既有 userData、Keychain vault 與更舊備份均未清除。已安裝 App 的版本／build、bundle、雙架構、deep strict codesign 與 `app.asar` 均匹配 artifact，主程序可正常啟動。Mac 當時鎖定且自動解鎖未成功，因此沒有核對 v0.1.25 UI 的 Amazon 連線、US／Live 或執行 A+／B2B 唯讀 canary；沒有 Amazon request、Preview、生物辨識或 mutation。
- 2026-08-23 v0.1.24 B2B live-shape hotfix 已發布、部署並安裝：
  - 真實 v0.1.23 唯讀 canary 共 274 列，當時 missing 0、configured 0、unsupported 42、incomplete 232。根因不是使用者沒有商品，而是 B2B parser 把 Listings Items 的 derived `offers` view 當成 explicit 設定真相、要求 optional audience、讀錯 canonical `price.currencyCode`，並把非價格 Issue 與 seller-specific PTD 的 ancestor flags 過度合併。v0.1.24 改以 `attributes.purchasable_offer` 的 exact marketplace／currency／`audience=B2B` contribution 判斷 explicit configured／missing；optional `offers`／`issues` 缺省可接受，present-but-malformed 仍 fail closed，IVP audiences 不再混入 base B2B。
  - Listings 身分必須由目標站 summary 證明 exact SKU／ASIN／非 generic Product Type；一致的重複 productTypes 證據可接受，跨站-only、缺失或衝突皆在 PTD／Preview 前停止。Issue 依 marketplace、官方 price categories 與 exact offer attributes 分流；INVALID_IMAGE 等明確非價格錯誤不再污染 B2B 健檢，無 scope、雙欄矛盾或 malformed ERROR 仍 fail closed。一般 ALL 與 B2B base price 都只接受一個無日期 metadata 的 canonical block／schedule，未證明 current value 時不提供編輯。
  - seller-specific PTD 寫入能力改為 bounded、selector-aware、conservative proof：只接受 exact B2B branch 的 `value_with_tax` leaf 明示 `editable:true`，任何 relevant `editable:false`／`readOnly:true`、不明 applicator、無法組合的 `$ref`／allOf／oneOf／anyOf、錯誤 type／cardinality 或 budget exhaustion 都只讀。Schema 只接受可信 Amazon host 與 checksum，12 秒／16 MiB／global work-path budget 超限均 controlled fail closed；不會因 syntactic branch 誤開寫入。
  - Validation Preview 與正式 receipt 皆要求 exact SKU、well-formed Issues 與 non-empty `submissionId`。正式 PATCH 只有 exact `INVALID` 才是明確拒絕；缺失／未知／空白 status、`ACCEPTED` 加 ERROR 或任何矛盾 receipt 都是 `UPDATE_STATUS_UNKNOWN`，鎖住 ledger 且不盲目重送。寫入鏈仍保留完整非目標 offer guard、commit 前 fresh read／PTD／Preview、一次 PATCH 與 canonical readback；本次發布沒有執行任何 B2B Preview 或 mutation。
  - 發布前 `npm run check` 通過 108 個測試檔／956 tests、TypeScript 與 production build；B2B 最終聚焦矩陣 118／118 全綠；`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 通過。獨立 PTD／write-readback／release review 均沒有剩餘 P0／P1／P2。測試檔曾被一個唯讀 Vitest list 命令誤覆為 JSON，發布當下即停止；之後從 main session 的 53 個成功 patch 紀錄 lossless 重建，再完整重跑 956 tests 才放行，產品碼與 Amazon 狀態未受影響。
  - GitHub PR #54 已 squash merge；release main SHA 為 `1675ceafd5f22ca02dd962cc3e855b2c2d1f1940`。main Validate `32587051334`、Pages `32587051388`、macOS universal `32587051327` 與 Windows x64 `32587051348` 均成功。
  - live Pages 與 exact main production output byte-for-byte 相同：`index.html` 917 bytes、SHA-256 `daae918c4b4e50648f12c4ae8d6e3c863130aae7cfc8ec2aed90dcbb30d3d480`；`assets/index-ivFp6W-b.js` 1,695,285 bytes、SHA-256 `7d84687aa897fdc732d87a0f2fb058f15486bfb2f16099efd3521d417b280bdb`；`assets/index-CkA1HDGF.css` 295,811 bytes、SHA-256 `1ae58d0481fbbbb3dad56cf51efd9c24140c8c62aef0a2e527c097dfd0d6a565`；`assets/content-spelling-rules-BcfLoQVC.js` 622,239 bytes、SHA-256 `462e192e5b70d219095b87e4996b7910584fad8b58129554edfd7e93cdd04806`。
  - main macOS artifact `9479371387` 名稱為 `AMZ.API-unsigned-1675ceafd5f22ca02dd962cc3e855b2c2d1f1940`，467,656,736 bytes，GitHub metadata／下載 ZIP SHA-256 同為 `b1116c39b6140e0fca88b030e9560c5571802956775f6b7a10e64cc6834f0aae`。DMG 為 245,984,456 bytes、SHA-256 `66cb5b9b33de17bac67a858168b30904abedebed07b1e6fa892fdd7689080561`；universal ZIP 為 221,671,636 bytes、SHA-256 `bda7f1cfd422b5c54434a31799bf4ccf186dc67fe420e224fa0c9e79c08fdfd8`。manifest、inner／outer ZIP CRC、DMG CRC、版本／build 0.1.24、bundle `com.jspusa.amz-api`、executable、`x86_64`／`arm64` 與 deep strict ad-hoc codesign 全通過；DMG／ZIP 內 `app.asar` 皆為 18,233,985 bytes、SHA-256 `1562fc9d5646c0a27f7d82c4509ac1c0e33d8e5bcac7eef0bebbf6824e035f2a`。
  - main Windows artifact `9479380546` 名稱為 `AMZ.API-Notebook-Key-Windows-x64-1675ceafd5f22ca02dd962cc3e855b2c2d1f1940`，244,580,643 bytes，GitHub metadata digest `sha256:6719c0a3e2903841f89c38515997450df01ae36aa23145de5d4a6e5b78a1cd69`。這只證明 CI 封裝，不是 Windows Hello／DPAPI 實機證據，員工固定 prerelease 仍為 v0.1.16。
  - exact verified DMG 已安裝為 `/Applications/AMZ.API.app`；原 v0.1.23 保留為 `/Applications/AMZ.API-v0.1.23-backup.app`，更舊備份、userData 與 Keychain vault 都未清除。已安裝 App 版本／build 0.1.24、bundle、雙架構、deep strict codesign 與 `app.asar` 均逐項匹配 artifact；UI 顯示 Amazon 已連線、US 美國站與 Live 7 天 Sales。FBA-only B2B 唯讀 canary 完成 274 列，互斥價格狀態為未設定 170、已設定 58、資料未完成 46；完成分類的 228 列皆唯讀，連同未完成列共 274 列不可直接修改。沒有開啟 Validation Preview、沒有生物辨識、沒有 Amazon mutation。
- 2026-08-22 v0.1.23 已發布、部署並安裝：
  - 導覽與排程：FBA 入庫貨件追蹤只保留在頂部「報表區」，不在首頁或「營運區」重複入口；首頁的「低頻健檢」預設收合，依序放 180 天以上庫存與評論。一鍵 run-all 在背景並行執行文案、圖片、未綁變體、訂閱省、廣告覆蓋五項，狀態固定依此順序顯示，低頻工作不會被自動帶入。
  - 圖片：全站不足門檻改為少於 6 張；0–5 張列為不足，6 張通過。讀取未完成仍獨立 fail closed，不補成 0 張。
  - B2B：新增 `/api/sp-api/business-pricing-audit` 的 FBA-only 全站健檢，以及 `/api/sp-api/business-pricing` 的單 SKU GET／零寫入 POST Preview／PATCH 更新。身分必須 exact match Seller SKU、ASIN、marketplace；可寫能力只採帶目前 Seller ID 的 seller-specific PTD。正式更新只 merge `audience=B2B` 的 `our_price`，保留一般 `ALL` offer、B2B quantity discount plan 與其他 audiences，並維持 fresh read／PTD checksum／Amazon Validation Preview／native confirmation／idempotency／單次 PATCH／canonical readback；任何不明結果停止且不盲目重送。
  - 文案：維持產品名稱 60、產品亮點 110、每項產品要點 150–200、產品敘述 1,800 Unicode 字元門檻；移除卡片中重複原因，並讓立即修改直接聚焦且顯示相符原因。只有 Amazon `ingredients` 可證明至少兩個不同成分時，標題／亮點／要點中的單一成分聲明才警示；括號逗號不拆項、讀取不完整不推論，相關原文或成分 fingerprint 漂移即 stale。
  - Excel：同一選檔區支援按鈕與 drag/drop，問題欄保留顏色；回傳原檔仍嚴格核對 account／站點／mode／識別欄／family／原始文案。CR／U+0085／U+2028／U+2029 無損 round trip；舊檔只有 main-owned 完整 digest 唯一命中時才 bounded recovery，公式、巨集、外部連結、歧義或被改過的原值仍整批零寫入停止。
  - 發布前檢查：`npm run check` 通過 108 個測試檔／901 tests、TypeScript 與 main／preload／renderer production build；B2B focused 63 tests 全綠；`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 通過，變更檔敏感字串掃描未發現真實憑證。獨立唯讀 release review 沒有剩餘 P0／P1／P2；1440px／390px 本機 fake Bridge Playwright 已驗證導覽、五項 run-all、低頻收合、圖片 5／6 邊界、文案原因／立即修改／Excel drag-drop 與無整頁水平 overflow，全程沒有 Amazon 或 Excel 寫入。真實未修改工作簿 273／273 列另已走正式 ApiRouter no-op path 得到 `CONTENT_UNCHANGED`。
  - GitHub：PR #52 已 squash merge；feature commit `04137d9` 與 release main `d0e3255b53ad76306c78d8075e720a14e76367da` 的 tree 均為 `fa8bd51113a51c6a7b6d6a44ac17cd7b1ebfee06`。PR Validate `32577908909` 與 Windows `32577908903` 成功；main Validate `32578198343`、Pages `32578198322`、macOS universal `32578198324`、Windows x64 `32578198328` 均成功。
  - live Pages 與 exact main production output byte-for-byte 相同：`index.html` SHA-256 `2fff073f34008cd0937666a335618b8b952ba6c9a66cc9bf463f2a1730876b73`；`assets/index-BvQWF2fI.js` 為 `878ee20edc7dcd355de32814661518b4661a376f37408e97611e322b2ee2fa59`；`assets/index-CkA1HDGF.css` 為 `1ae58d0481fbbbb3dad56cf51efd9c24140c8c62aef0a2e527c097dfd0d6a565`；`assets/content-spelling-rules-BcfLoQVC.js` 為 `462e192e5b70d219095b87e4996b7910584fad8b58129554edfd7e93cdd04806`。
  - main macOS artifact `9477138571` 名稱為 `AMZ.API-unsigned-d0e3255b53ad76306c78d8075e720a14e76367da`，GitHub metadata digest `sha256:501c4d5c770d690d4e9455a86d6ae5cdf0ced0f87f08fff17e0e43806adfc64d`。DMG 為 246,044,763 bytes、SHA-256 `33414ed4c4a1abbb0931e9782c08d06ed1f44f883c3317e095d1c599cf08384f`；universal ZIP 為 221,664,534 bytes、SHA-256 `1b4dfd39380d45f2cfed4c2291fabbd8c23724a019b9d89d8441f9adfe8411c2`；`SHA256SUMS.txt` SHA-256 為 `75028523d3beaecbe81148966f98b60afff4454e02cace9ceaa0deaeaac682f8`。上傳時 GitHub 將 manifest 的 `release/` 路徑前綴攤平，因此以逐檔計算核對；DMG verify、ZIP CRC、版本／build 0.1.23、bundle `com.jspusa.amz-api`、executable `AMZ.API`、`x86_64`／`arm64` 與 deep strict ad-hoc codesign 均通過，DMG／ZIP 內 `app.asar` 同為 `6593b50506d6a7e540567ff09d3b7111357a0b5d1f1b9b2d91b83f1707dee136`。
  - main Windows artifact `9477152941` 名稱為 `AMZ.API-Notebook-Key-Windows-x64-d0e3255b53ad76306c78d8075e720a14e76367da`，GitHub metadata digest `sha256:e368b9d5fbdd5e5ad1d8b5cbbc25ea2ff420001429a36989f4cf56fca8d93a87`。這只證明 CI 封裝，未做真實 Windows Hello／DPAPI 員工裝置驗證。
  - `/Applications/AMZ.API.app` 當時由上述 verified DMG 安裝；原 v0.1.22 可復原地保留為 `/Applications/AMZ.API-v0.1.22-backup.app`，原 userData 未清除。第一次讀取既有 vault 曾停在 macOS SecurityAgent 系統提示，之後由使用者本人核准；v0.1.23 隨後顯示 Notebook Key／Amazon 已連線、US／Live 7 天 Sales，並完成 274 列 FBA B2B 唯讀 canary（missing 0、configured 0、unsupported 42、incomplete 232）。沒有 v0.1.23 Amazon mutation、生物辨識寫入確認或憑證變更；v0.1.23 現已保留為 `/Applications/AMZ.API-v0.1.23-backup.app`。
- 2026-08-22 v0.1.22 文案健檢 UI／Excel round-trip hotfix 已上線：
  - 健檢卡片不再同時顯示巨型原因彙總與逐項原因；每則原因只出現一次。單 SKU 立刻修改摘要只顯示聚焦欄位數，完整原因預設收合；產品亮點與產品敘述也建立 raw value／fingerprint／length evidence，fresh Amazon 原文、Seller SKU、ASIN、Product Type 或門檻任一變動仍 stale fail closed。Excel 選檔區只顯示一次檔名並保留鍵盤與螢幕閱讀器操作。
  - 真實未另存工作簿 273 列中有 9 列被誤判竄改；hash-only evidence 唯一命中根因是原始產品要點的 U+2028 LINE SEPARATOR 在舊 OOXML 讀回時被正規化成 LF。新版以 numeric character references 無損保存 CR／U+0085／U+2028／U+2029；舊 v2 只在 main-owned 完整 digest 唯一命中時 bounded 復原，exact digest 永遠先行，同一 recovered 欄若也被編輯則要求重新匯出，不猜內容或放寬 SKU／ASIN／family／原值核對。
  - Legacy candidates 改為逐筆產生，先套 request-wide rows／work／hash／bytes budget再核對；歧義或超限 fail closed。rich-text 顯示 marker 不再改寫 immutable raw，content-audit cell 若含 OOXML 無法無損保存的控制字元或超過 32,767 code points，匯出時明確拒絕而不靜默替換／截斷。
  - 本機 `npm run check` 通過 105 個測試檔／860 tests、TypeScript 與 main／preload／renderer production build；`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 通過。真實舊檔 273／273 列已走正式 ApiRouter no-op path 得到 `CONTENT_UNCHANGED`；1440px／390px Playwright 已驗證原因不重複、立即修改聚焦 8 個欄位、檔名只顯示一次且無水平 overflow。
  - PR #50 已 squash merge，main 為 `fc39db989d0703d317cf9e6385a11cdf449fee95`；PR Validate `32571733444` 與 Windows CI `32571733420` 成功，main Validate `32571978501`、Pages `32571978502`、macOS `32571978505` 與 Windows CI `32571978518` 也全部成功。Windows 結果仍只是 CI，未做真實 Windows Hello 硬體驗證。
  - live Pages 為 `index-Cujd3mng.js`／`index-BqPIRvz0.css`／`content-spelling-rules-BcfLoQVC.js`；HTML、JS、CSS 與 spelling chunk SHA-256 分別為 `58f27a7314a7c14caa278ed5ff5bb3f2dd31bf4171724aec33909a39f949e780`、`79ad4d7093eab10bc64378c1dbe6bd84f1491b9d4a64ef6741c5c89050d34a0c`、`c7748f4b124ceaafb034e5267fc4d4b11d1c070e7d14afc6fd4846640d11f70f`、`462e192e5b70d219095b87e4996b7910584fad8b58129554edfd7e93cdd04806`，四者與 exact main production output byte-for-byte 相同。
  - main macOS artifact `9475589086` 名稱為 `AMZ.API-unsigned-fc39db989d0703d317cf9e6385a11cdf449fee95`，GitHub metadata digest 為 `sha256:9d04966bc67a3cd35974fa52b76fcfbd1832cdd4aa6728b8f5437816ff8f0e0e`。DMG 為 246,626,167 bytes、SHA-256 `43d4baccce8cfe048680c03eefbb49425934470059878135fe57e32ef2dbf6ee`；universal ZIP 為 221,644,972 bytes、SHA-256 `e9a839e1bf4fa2ecd5120a54940d9515c3a2395468f80fe973750bbf11069d0e`。兩者與 manifest 一致，ZIP／DMG CRC、版本／build 0.1.22、bundle `com.jspusa.amz-api`、`x86_64`／`arm64` 與 deep strict ad-hoc codesign 均通過。Windows artifact `9475598988` metadata digest 為 `sha256:e6aed9857aff140fc285d2160bc4c7d3142a19e3ee86416fd150054a903d7cdf`。
  - `/Applications/AMZ.API.app` 已由 v0.1.21 安全備份後安裝 v0.1.22；備份為 `/Applications/AMZ.API-v0.1.21-backup.app`。App 沿用原 Keychain／userData 並持續執行，首頁顯示 Amazon 已連線，系統資訊顯示「目前本機 App 0.1.22」。發布驗證沒有執行 Amazon 文案 mutation 或生物辨識確認；安裝後使用者另產生的一筆零寫入 Validation Preview 保持未勾選、未提交。
- 2026-08-22 v0.1.21 新增全站文案健檢與 Excel round trip：
  - `item_name`、`title_differentiation`、每項 `bullet_point`、`product_description` 分別套用內部目標 60／110／150–200／1,800 Unicode 字元；API 與前台保留實際字數、上下限與逐條要點索引，讀取未完成列不做缺值或字數推論。
  - 全站 relationships 以官方批次查詢分 child family，已證明 parent 排除；standalone 固定進「未綁變體」，缺列／400／ASIN 或關係衝突固定進「資料未完成」，不以名稱或 ASIN 相似度猜 family。
  - Excel schema v2 保留灰色原值與可編輯更新值；問題欄黃底、疑似錯字片段紅字。main parser 拒絕公式、巨集、外部連結、Defined Names、未知欄、重複 SKU、異常 ZIP/XML；工作簿不使用會在 Excel／LibreOffice 另存時產生 `_xlnm._FilterDatabase` 的 AutoFilter，已完成真實 LibreOffice 開啟／另存／重新匯入測試，公式樣式的 family key 仍可 inert round trip。
  - 掃描授權證據以 account／marketplace／live-demo／export／fetchedAt-scoped SHA-256 列摘要在裝置端保存固定 24 小時；不落地 Seller SKU、ASIN、文案、Excel 或 proposed edits。鎖屏、睡眠與 App 重啟後同檔仍可重新預檢，換帳號／站點／模式或到期則 fail closed；集合限制 8 份／50,000 列／8 MiB，超量確定性淘汰最舊證據而不碰 idempotency ledger。
  - 回傳 Excel 的 POST 只做逐 SKU fresh read／PTD／Amazon Validation Preview，任一失敗整批零寫入。renderer 會逐 SKU 展開完整 Amazon 原值／Excel 更新值與 Validation 提醒，使用者勾選已核對後，PATCH 才會在全批再預檢後要求一次 Touch ID／Windows Hello；每 SKU 仍各自有 ledger、單次 PATCH 與 canonical readback，拒絕或不明即停止後續，沒有跨 SKU 原子交易，也不自動重送。
  - 本機 v0.1.21 候選已通過 `npm run check`：105 個測試檔／854 tests、TypeScript 與 main／preload／renderer production build；`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 通過。實際 `.xlsx` 已通過 ZIP、LibreOffice 開啟另存再匯入、openpyxl sheet／freeze／顏色核對；前台逐欄 diff 已做 1440px／390px Playwright 視覺 QA且無整頁水平溢出。尚未用真實 Amazon／真實 Windows Hello 執行任何文案 mutation。
  - PR #48 已 squash merge，main 為 `c919cd9714095330c150879b0eb1bb474817e3dd`；main Validate `32568946207`、Pages `32568946205`、macOS `32568946198` 與 Windows CI `32568946195` 均成功。live Pages assets 為 `index-CFy0t-bz.js`／`index-CddE3IYJ.css`，SHA-256 分別為 `51a1d55ea4e96af41390f4f19fb319e54f42a901d5aa0b27de42a54e14b020a0`／`8b9335242a20aa2112b9d042ee63532d300381bbac2933838a672658e0c4725c`，已確認含新門檻與同 Excel 回傳入口。
  - main macOS artifact `9474859261` 名稱為 `AMZ.API-unsigned-c919cd9714095330c150879b0eb1bb474817e3dd`，GitHub metadata digest 為 `sha256:af9c17898c06b360b894ec91aba00e183c249b115881e93f9068d151e60ad686`。DMG 為 246,204,272 bytes、SHA-256 `3c3093e3c94d477b18baf491613f5eb15f3b2ac04cf45f392500cba299be169c`；universal ZIP 為 221,642,538 bytes、SHA-256 `930b2ad3c75acb8d961834b8e4d3b17c8acdcc93210dba17153f17e0c92afd29`。兩者與 manifest 一致，ZIP／DMG CRC、版本／build 0.1.21、bundle `com.jspusa.amz-api`、`x86_64`／`arm64` 與 deep strict ad-hoc codesign 均通過。v0.1.21 已安裝並持續執行，v0.1.20 原封不動保留為 `/Applications/AMZ.API-v0.1.20-backup.app`；Keychain／本機 userData 未清除。

### 2026-08-25 S15 Orders reads extraction（stacked Draft PR #125）

- Ticket／base：S15 branch 為 `codex/s15-orders-reads`，固定疊在 S14 final head `e50e3556a2efbb31c186e7a8a69d11b9cc91f441`；issue #84 是 SP-API read-only migration 的明確 completion gate。公開 `GET /api/sp-api/orders` route、query、既有 14 日預設、明確 1–90 日、status、opaque pagination token、response DTO與 Orders-first connection attribution皆未改名；renderer／preload／main trust boundary、FBA-only及所有write seam均未擴張。
- TDD／ownership：第一個route-level RED在 production change 前注入 `OrdersReadsPort` sentinel，確認舊router 0次呼叫新介面而失敗；修後route以`dashboard-page`送出明確30日fixture，connection test以`connection-probe`共用同一個`OrdersReads.read()`。semantic owner自行計算rolling 30／14／1日range、捕捉一份immutable `SpExecutionContext`、處理demo／live、legacy raw normalization、public DTO與最後`fulfilledBy === "AMAZON"` fence；caller不能提供RFC3339 cutoff、page size、AFN、transport或retry controls。
- Fixed external seam：`orders-reads-production.ts`固定regional `GET /orders/2026-01-01/orders`、redirect rejection、`includedData=PROCEEDS,FULFILLMENT,CANCELLATION,PROMOTION`、`fulfilledBy=AMAZON`與dashboard／probe 50／1筆page size；pagination token只作opaque URLSearchParams value逐字往返，不解碼、不trim、不自動吃完。同一12秒deadline涵蓋headers與最高16 MiB body，headers後caller abort仍有效，未使用的non-2xx body先取消。401只invalidate並force refresh一次，之後只有429／500／503最多兩次bounded GET retry；其他status、3xx、network、timeout、abort、oversize與malformed 2xx都不盲目重送。成功DTO仍保留既有request ID、rate limit、next token與last-updated-before；非成功狀態沿用既有canonical status／message／Retry-After及main-boundary sanitizer。
- Migration／guards：舊`sp-api.ts` `searchOrders`、Orders input／raw types、normalizer、transport與demo order projection均已刪除；`sp-api-demo.test.ts`不再保留legacy façade test。Listing price、variation、catalog export及unbound demo consumers改讀`demo-fba-catalog.ts`的中立product facts，不依賴Orders private internals。architecture tests鎖定semantic port／page adapter都只有`read`、router恰有兩個production caller、renderer／preload／shared／sibling不得importproduction或raw page types、semantic不得反向依賴legacy／production／write／vault，並阻止舊symbols回流。
- Local／CI evidence：focused Orders／architecture／marketplace／demo suites共114項先全綠；final `npm run check`通過152個測試檔／1,550項測試、typecheck與production build，`npm audit --omit=dev`為0 vulnerabilities，`git diff --check` clean；獨立Standards與Spec review皆無P0–P3。以cloc預設duplicate suppression量測，`src`為96,950行有效程式碼，連同`tests`／`scripts`／`.github`為154,540行；`sp-api.ts`為8,164實體行，`api-router.ts`為8,816實體行。implementation head `5482c9cd0ebb19235d57e38d5e5bcafd3d8ed4fb`的Validate run `32827027686`／job `97737192577`與Windows x64 run `32827027642`／job `97737192218`均成功；Windows包含runner validation、unsigned package、ASAR addon boundary與packaged Bridge smoke，PR workflow依規則跳過artifact upload。兩個既有user-owned untracked duplicate files保持未追蹤且未納入。本次docs-only evidence head仍需重跑兩條CI，#84保持OPEN；本段不代表合併、部署、Pages、artifact安裝、Notebook Key、live Amazon、macOS／Windows實機或任何mutation。

### 2026-08-25 S14 Customer Feedback reads extraction（stacked Draft PR #124）

- Ownership：`CustomerFeedbackReads.read()`是supported marketplace、relationships-proven child／standalone identity、exact requested ASIN／marketplace、204、raw payload schema、topic evidence、demo／live分流與sanitized domain result的唯一semantic owner。`variation-catalog-reads.ts`繼續唯一負責relationships證明、parent排除與candidate／demo candidate建立；`review-audit.ts`只聚合typed evidence、coverage、排名與public snapshot，不再解析raw Amazon JSON。`ApiRouter`保留既有report／candidate job、background progress、403 fan-out、observer reconnect與30分鐘terminal snapshot，不再擁有Customer Feedback HTTP或normal-rate queue。renderer／preload／shared DTO、FBA-only範圍與所有write seam均未改動。
- Rate-limit coordinator：production adapter對429零次transport replay；安全numeric或canonical HTTP-date Retry-After會在queue turn釋放前先成為跨job／region的global quota fence，parseable但非canonical、畸形或超過25分鐘的header不會建立長期timer。router只可依同一套sanitized bound延後同一candidate一次，第二次429直接保留為incomplete並前進；無header時固定等待2秒。credential／context invalidation仍不清App-session quota fence。
- Identity／evidence contract：semantic boundary在任何adapter call前重新核對US／JP／UK／DE、十碼ASIN、非空且不失真的Seller SKU／title、`child | standalone`與固定`FBA_LISTING_REPORT_RELATIONSHIPS_NON_PARENT_ASIN` marker；parent、unsupported、未證明或畸形candidate不碰I/O。200 response必須exact match requested ASIN與marketplace，日期與topic schema完整；只採`asinMetrics`，parent／browse-node／child aggregate一律忽略。正負`starRatingImpact`必須是finite原值，缺值不補0、不取絕對值；每類最多十個topic、每topic最多二十段snippet，重複topic與畸形值fail closed。204是成功但沒有topic；403可由router沿既有規則fan-out sanitized incomplete，不冒充零評論。
- Transport／bounds：production `CustomerFeedbackPageAdapter.read()`只接受marketplace、ASIN、expected mode與signal，固定official regional HTTPS endpoint、GET與`sortBy=STAR_RATING_IMPACT`，caller不能傳host、URL、method、query、body、token或write capability。官方`getItemReviewTopics`沒有cursor，故此operation的page bound固定一頁，positive／negative各最多十筆。單一long-lived adapter跨job與region共用App-session queue，前次實體request完整結束後至少1,050ms才開始下一次；credential／account／mode invalidation不清quota fence。request與body stream各有12秒deadline，deadline先封閉失敗結果再cancel reader，避免stream done競態；redirect rejected，200 body宣告或實際超過16 MiB即cancel並fail closed，JSON使用fatal UTF-8。401只refresh一次；500／503只retry一次並接受最高25分鐘的安全Retry-After；429不在transport replay。排隊中的caller可立即abort且不越過仍在執行的前一筆request；token waiter abort會立即釋放queue，未完成token Promise即使稍後完成也不能再dispatch。fetch與body read同樣受caller abort；Request ID、Retry-After與error只以canonical sanitized metadata離開owner。
- RED／GREEN evidence：最高穩定public review-audit route先注入新的`customerFeedbackReads.read`並讓舊facade故意throw，舊router仍呼叫legacy symbol而形成單一預期RED；最小constructor seam接線後轉綠。後續module-missing、parent／identity guard、signed evidence、ASIN／marketplace mismatch、Retry-After、secret redaction、demo、fixed request、global cross-region pacing、401、503、oversize與architecture removal均逐項先RED再GREEN。最終focused suite覆蓋unsupported marketplace、204／403、missing impact、in-flight context invalidation、predecessor與token都未settle時的立即abort、body timeout cancel競態、mode-change-before-401-retry、429 zero transport replay、global Retry-After fence、非canonical日期拒絕與persistent 503 exact retry bound。
- Local evidence：目前code tree執行`npm run check`通過149個測試檔／1,511項測試、typecheck與production build；`npm audit --omit=dev`為0 vulnerabilities，`git diff --check` clean。S14 branch為`codex/s14-customer-feedback-reads`，base固定S13 final head `9af562812b8968c4849ab2c4430746ea5640c3e3`；`sp-api.ts`為8,559行，`api-router.ts`為8,802行。兩個既有user-owned untracked duplicate files保持未追蹤且未納入工作。
- External evidence：stacked Draft PR #124以`codex/s13-a-plus-content-reads`為base；implementation head `038dd6002e32b26ff63871b4f3c271d56d3a3d23`的Validate run `32820654386`／job `97717819904`與Windows x64 run `32820654372`／job `97717819766`均成功。Windows包含runner validation、unsigned package、ASAR addon boundary與packaged Bridge smoke；PR workflow依規則跳過artifact upload。本次evidence-only交接提交形成的新final head仍必須讓兩條CI重跑。#83保持OPEN；本輪沒有合併、Pages部署、artifact安裝、Notebook Key、live Amazon、Touch ID／Windows Hello、Validation Preview、PATCH、readback或任何Amazon mutation。

### 2026-08-25 S13 A+ Content reads extraction（stacked Draft PR #123）

- Ownership：`AplusContentReads.read()` 是 A+ publish records、content documents、document-ASIN relations、完整分頁、evidence merge、demo／live分流與public snapshot的唯一semantic owner。`ApiRouter`只捕捉一份不可變`SpExecutionContext`、啟動／輪詢背景job與投影既有DTO；standalone與Audit Suite共用同一個owner。production `AplusContentPageAdapter.read()`只接受`publish-records`、`content-documents`、`document-relations`三種discriminated plan；caller不能傳host、path、method、任意query、body、token refresh、retry policy或write capability。renderer／preload／shared contracts、FBA-only seed、existing routes與所有write seam均未改動。
- Evidence contract：publish-record完整正向證據與relation的exact `CONTENT_PUBLISHED`都是authoritative positive；另一文件的negative／malformed／warning只會把完整度降為partial，不得覆寫positive。沒有positive時，publish list不完整、relationship索引不完整、badge衝突、畸形資料、文件單純存在、approval metadata或`CONTENT_NOT_PUBLISHED`都不能證明已發布；complete negative才可判定not published。relationship discovery不完整時不再拿未證明完整的seed觸發per-ASIN publish-record calls。每ASIN公開文件最多100筆，但裁切前會保留至少一筆authoritative positive witness；同ASIN／evidence class的投影只計算一次並共用readonly結果，避免same-SKU quadratic projection。
- Transport／bounds：production adapter固定官方`/aplus/2020-11-01`三條GET路徑、站點、HTTPS region endpoint與`redirect: "error"`；維持region-global pacing、一次401 refresh、最多兩次429／500／503 transient retry與完整但最高25分鐘的controlled Retry-After。request與body stream各有12秒deadline，caller abort會取消reader；每個200 body最多16 MiB，宣告或實際超限、timeout、401 replacement、retry replacement與final non-200都會取消或discard body，並保留安全status／Amazon Request ID。semantic audit先為每頁保留16 MiB，成功後按實際bytes退款；throw／oversize／timeout保留reservation，因此256 MiB audit-wide budget不能被error path繞過。raw relation candidate不論target、duplicate或malformed都消耗25,000 row budget；page token progression與總page budget同樣bounded。
- RED／GREEN evidence：最高穩定seam先以缺少`AplusContentReads` module建立預期RED，再鎖定standalone／suite只可呼叫單一semantic read。review RED另外實際證明第101筆authoritative positive曾被100-document裁切、成功response headers後body可無限stall、non-target／malformed relation rows曾能繞過budget、同ASIN投影為quadratic、連續throw可避開aggregate byte budget，以及declared oversized body未被cancel；上述案例均在修正後轉綠。最終8個焦點測試檔180 tests通過；獨立Standards與Spec review均未留下P0–P3。
- Local evidence：final code tree執行`npm run check`通過148個測試檔／1,483項測試、typecheck與production build；`npm audit --omit=dev`為0 vulnerabilities，`git diff --check` clean。stacked Draft PR #123的base為S12 final head `f12629b056aa19da17258df152e707b5e8dada93`；首個implementation commit為`dec5aa74fe4147d295ef6f173cbe8daf5df74ada`，review-fix code head為`288ad402f7bf8f01fac1e040cf41fb60571302a0`。兩個既有user-owned untracked duplicate files保持未追蹤且未納入commit。
- CI evidence：code head `288ad402f7bf8f01fac1e040cf41fb60571302a0`的Validate run `32813195392`／job `97696398035`成功，包含locked dependencies、typecheck、1,483項test、production build與renderer plaintext-secret-fixture檢查；Windows x64 run `32813195216`／job `97696397540`成功，包含Windows runner validation、unsigned package、ASAR addon boundary與packaged Bridge smoke。artifact upload依Draft PR workflow規則skipped，因此沒有可下載artifact、安裝、Pages、macOS package或真實Windows裝置通過聲稱。本次handoff回填形成docs-only final head後，必須再確認該head的Validate／Windows checks成功。
- Live evidence：PR只寫`Refs #82`，沒有使用`Closes`；#82與前置implementation issues #74／#77仍為OPEN。本輪沒有合併、Pages部署、artifact安裝、Notebook Key、live Amazon、Touch ID／Windows Hello、Validation Preview、PATCH、readback或任何Amazon mutation。

### 2026-08-25 S12 Aged Inventory reads extraction（stacked Draft PR #122）

- Ownership：`AgedInventoryReads` 只公開 `begin()`、`status()`、`read()`，是固定 aged-inventory selection、regional schema、TSV parser、逐列 evidence、demo／live分流、expiry boundary與public snapshot的唯一semantic owner。`ReportsRuntime`繼續唯一擁有固定intent、durable lifecycle、opaque handles、30分鐘no-blind-retry與document download；`ApiRouter`只做HTTP／Excel translation與standalone polling。舊`sp-api.ts` aged production façade、parser、第二套Reports transport，以及router gateway／wrapper均已刪除；renderer／preload／shared contracts與write seams未擴張。
- Evidence contract：US／UK／DE只接受regional `366-455`＋`456-plus` tail，其他支援站點只接受global `365-plus` tail；選定的庫齡桶必須完整、非重疊且逐列有值。estimated excess、storage cost與AIS任一SKU缺值時，row原值／null與reported counts原樣保留，但marketplace total必須為null；缺少整個cost欄位不能因storage volume為0捏造費用0，只有同列官方basis明確為0且estimate留白才安全呈現該列0。currency混用、錯站點schema、重複或被改寫SKU、AIS generation不完整全部fail closed。
- Renderer／workbook／context：renderer重新驗證summary coverage，partial時不顯示部分全站合計；每個AIS tier的quantity與charge各自要求全部SKU coverage。workbook保留每列／每區間證據與空白，並明示partial不計算全站合計；庫齡、estimated excess與expiry不互相冒充。Standalone先捕捉一份完整`SpExecutionContext`並核對bound account／mode／marketplace，再把同一object傳給begin、每次status與read；demo read先驗opaque receipt且snapshot不含report ID、document ID或account scope。
- RED／GREEN evidence：先在`/api/sp-api/aged-inventory?...data=1`注入兩列完整官方schema，其中一列缺quantity／cost／AIS evidence；舊行為錯誤回傳7／2.5／1.2的partial marketplace totals，形成預期RED。實作後同一路由保留已知row值與1／2 coverage，同時三個summary totals均為null。parser與numeric review另以重複／alias header、quoted-field grammar、row／column／field／document bounds、畸形grouped decimal、underflow、unsafe integer／exact cents、逐tier coverage與JPY小數顯示建立預期RED後轉綠；header只建立一次normalized index。替代巨型facade tests改由`AgedInventoryReads` public seam鎖定18個domain案例；production report type／POST no-replay／status／download安全則沿用`ReportsRuntime`既有owner tests，不重複測第二套transport。最終10個相關測試檔共158 tests通過，三軸獨立review均未留下P0–P3。
- Local evidence：`npm run check`通過147個測試檔／1,463項測試、typecheck與production build；`npm audit --omit=dev`為0 vulnerabilities，`git diff --check` clean。stacked Draft PR #122的base為S11 final head `8ffa11a4023e86f21dce61872fe68c1fc2ec9c55`；implementation候選head為`19d0abcc8893df43393a0e3a09a4f46d76156b9a`，Windows換行守門修正後的code head為`37fbe5f41362f86f079a8da675c712aef3aa6760`。
- CI evidence：首輪Validate run `32807758662`／job `97681079369`成功；首輪Windows run `32807758681`／job `97681079225`只因architecture source-scan硬編碼LF而失敗，production與其餘測試未形成失敗證據。commit `37fbe5f41362f86f079a8da675c712aef3aa6760`只把讀入的CRLF正規化為LF，完整保留header Map／`headerIndexes.get()`／禁止`headers.map()`三項guard。該exact head的Validate run `32808044696`／job `97681860954`成功；Windows x64 run `32808044661`／job `97681861137`亦成功，包含Windows runner validation、unsigned package、ASAR addon boundary與packaged Bridge smoke。artifact upload依`pull_request` workflow規則skipped，因此沒有可下載artifact、安裝、Pages、macOS package或真實Windows裝置通過聲稱。
- Live evidence：PR只寫`Refs #81`，沒有使用`Closes`；#81與前置implementation issues #73／#77仍為OPEN。本輪沒有合併、Pages部署、artifact安裝、Notebook Key、live Amazon、Touch ID／Windows Hello、Validation Preview、PATCH、readback或任何Amazon mutation。

### 2026-08-25 S11 FBA Inbound reads extraction（stacked Draft PR #121）

- Ownership：`FbaInboundReads` 只公開 `readShipments()` 與 `readNoncompliance()`，是 shipment range／fallback／collector composition 與 inbound noncompliance report semantic flow 的唯一 owner；同一個注入的 `ReportsRuntime` 仍唯一擁有固定 report intent、durable lease、opaque handle、poll 與 document download。`ApiRouter` 只驗輸入、捕捉一次不可變 `SpExecutionContext`、協調背景 job、延長 TTL 與投影既有 public DTO；兩條 read leg 共用同一個 context object。舊 `sp-api.ts` shipment／noncompliance production-capable facade 與 router gateway 已刪除，renderer／preload／shared contracts、FBA-only scope與所有 write seam均未改動。
- Shipment transport／fallback：`fba-inbound-reads-production.ts` 的 typed adapter 固定 Fulfillment Inbound v0 shipment／items 與 2024-03-20 plan／shipment GET；caller 不能指定 URL、method、body、region、token refresh 或 retry policy。adapter 維持 region-global 500ms pace、15 秒 timeout、一次 401 refresh與最多兩次 429／5xx transient retry，對外只保留安全 status／錯誤。exact DATE_RANGE 只有明確 400／422 才改讀固定 v0 active，active 亦只有 400／422 才改讀 modern；403、429、503、network、timeout與 caller abort皆 fail honest，不觸發語意 fallback。
- Pagination／coverage：Marketplace Day window 嚴格限制 1–180 日並跨 DST 計算；日期在任何 transport 前驗證。semantic layer預先取得的第一個 shipment-list page可明確注入 collector，後續仍只使用 opaque `NextToken` 與原 shipment binding；collector保留 token progression、visible Shipment ID、duplicate SKU、page／row budgets與 partial coverage規則。逐貨件 local 400／404／409／422、format或pagination failure保留已核對 item rows、把該票標成 partial，並在連續三票 local failure後停止其餘 items fan-out；global auth／throttle／server／network／timeout／abort立即停止整次工作。active／modern fallback無法證明完整日期範圍，因此即使 items完成仍保持 partial；unavailable／partial不會補成 0 或 complete，internal modern plan／shipment identity不進 public DTO。
- Noncompliance／context：`readNoncompliance()` 只送固定 inbound-noncompliance intent到同一個 `ReportsRuntime`，沿用 durable 30 分鐘 no-blind-retry、explicit retry、最多 150 次且每次 2 秒的 bounded poll與 opaque lease／document handles；只有 ready 後才解析下載文字。context在 runtime與 semantic boundary前後反覆驗證，帳號／mode／generation切換不能回傳舊 shipment或 report結果。noncompliance unavailable會保留已驗證 shipment snapshot並只把公開 job降為 partial，空 issue rows不會被稱為已證明的 0 瑕疵。demo完整文件只由composition root注入的 demo Reports adapter提供，不能作為 live fallback。
- RED／GREEN evidence：先以缺少 `fba-inbound-reads` module 的預期 RED證明新 seam尚不存在，再補齊 fixed 400／422 fallback、active短路、403／429／503／network不 fallback、180日與 DST、opaque continuation、原 shipment binding、internal ID redaction、production 401／retry／pacing／timeout／abort，以及兩條 leg共用一份 captured context。安全稽核另以 `redirect` 原為 `undefined` 的預期 RED鎖定跨 origin redirect缺口，修後 production fetch固定 `redirect: "error"` 且3xx不 replay。最終 local `npm run check` 為 146 個測試檔／1,454 項測試、typecheck與 production build全通過；`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` clean。這些是 local／fixture／scripted adapter／demo證據，不是 packaged Bridge或 live Amazon。
- CI evidence：S11已發布為stacked Draft PR #121，base為`codex/s10-brand-sales-traffic-reads` exact head `bca9623fb9995d0c245f06e0de1c7cc72dec5155`，首個implementation head為`31f935962eee8984185c23dc726471523f21b9cf`。Validate run `32801969449`／job `97664469891`成功，包含locked dependencies、typecheck、1,454項test、production build與renderer plaintext-secret-fixture檢查；Windows x64 run `32801969472`／job `97664470010`成功，包含Windows runner validation、unsigned package、ASAR addon boundary、packaged artifacts與Bridge smoke。artifact upload依Draft PR workflow規則skipped，因此沒有可下載artifact、安裝、Pages、macOS package或真實Windows裝置通過聲稱。本次證據回填形成docs-only final head後，必須再確認該head的Validate／Windows checks成功。
- Live evidence：PR只寫`Refs #80`，沒有使用`Closes`；#80與parent／implementation issues #69／#70／#73／#77仍維持OPEN，不能因這個tracer bullet冒充已關閉。S11沒有合併、Pages部署、artifact安裝、Notebook Key、真實Amazon帳號、Touch ID／Windows Hello、Validation Preview、PATCH、readback或任何Amazon mutation。

### 2026-08-25 S10 Brand Sales／Sales & Traffic read extraction（stacked Draft PR #118）

- Ownership：`ReportsRuntime` 仍是固定 report intent、durable lifecycle、opaque handle、production transport 與 document download 的唯一 owner；S10 沒有新增任意 report type／options／URL seam。`FbaRevenueReports` 只擁有 Brand／Category revenue 的雙 leg semantic state machine、job reuse／retry／poll／snapshot cache 與公開 view；`SalesAndTrafficReports` 只擁有固定 DAY＋SKU selection 的 begin／status／read。`ApiRouter` 只做輸入與 HTTP DTO translation，不再保存第二套 Brand／S&T production-capable lifecycle。renderer／preload／shared contracts、FBA-only scope與所有 write seam均未改動。
- Brand／Category snapshot：同一 job 固定一份 canonical current-FBA catalog seeds 與一份 `GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_SALES_DATA` document，品牌與品類共用 exact start／end、immutable `dataStartTime`／`dataEndTime`／`windowCreatedAt` 與真實 `dataThrough`；current-day range 明示 incomplete cutoff。`brand-sales-reads.ts` 只接已下載文字與 canonical seeds，保留未分類品牌、Supply BUSINESS REPORT category first-keyword 規則與同一幣別彙總；`brand-sales-demo.ts` 只能由 composition root 注入 canonical demo listings。
- Sales & Traffic：`sales-and-traffic-reads.ts` fail closed 驗證 official report type、exact `dateGranularity=DAY`／`asinGranularity=SKU`、單一 marketplace、strict date／SKU／child ASIN／non-negative number／currency 與 duplicate identity。moving 95-day／1–31 complete-day gate只在 explicit begin 建立 selection；status／read 只重新驗證已接受的 immutable dates與 opaque handles，因此跨 marketplace midnight 不會放棄既有 lease。Advertising strategy A→B→A 只建立 A、B 兩個 exact selection，回 A 時不隱含第三次 create。
- Context／migration／cache：Brand 的 start、legacy raw-handle adopt、project、poll、document read 與 cache commit全部傳遞同一個 captured `SpExecutionContext`；ReportsRuntime 在 durable lookup／mutation 前驗 expected context。A→B switch 不得把 B lease鏡像到 A job，也不得把 A raw handle採納到 B lease。舊 generation 的 in-flight data flight對所有 joiner fail 409，不能 cache／回傳 stale projection；fresh generation必須重新讀。partial success、terminal／unknown tombstone、30 分鐘 retry guard與 no-blind-retry保持不變。
- Public DTO／redaction：Brand 既有 local semantic responses精確保持 `{code,message}` 與需要時的 `Retry-After`；lease／document／upstream integrity errors仍走 `publicSpApiError` 的 rich sanitized DTO。production terminal status的 Amazon Request ID會帶到 lifecycle error後再由 canonical public seam清理。Brand 與 S&T injected reader結果都必須 exact match job mode／marketplace／dates／schema／source／cutoff／currency，並逐欄投影 root、row、segment與 summary allowlist；額外 `reportId`、internal欄位或錯 selection不得穿過 renderer boundary。
- RED／GREEN evidence：發布候選期間先觀察到並鎖定 malformed timestamp、Advertising A→B→A duplicate create、pending Brand GET 200、semantic error rich-field drift、internal error minimal-field drift、pre-leg context create、跨午夜 accepted lease、錯 identity snapshot、stale generation flight、terminal Request ID loss、S&T reader rejection downgrade、nested allowlist與 A→B raw-handle adopt等預期 RED，之後逐項轉綠。最終 local `npm run check` 為 145 個測試檔／1,447 項測試、typecheck與 production build全通過；`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` clean。這些是 local／fixture／scripted adapter／demo證據，不是 packaged Bridge或 live Amazon。
- CI evidence：S10 已發布為 stacked Draft PR #118，base 為 `codex/s09-catalog-reports-b2b-audit`，首個 PR head 為 `605b41dcb30ab8bc0ac4018624b985a922a7e378`。Validate run `32753806556`／job `97516611031` 成功，包含 locked dependencies、typecheck、test、production build與 renderer plaintext-secret-fixture檢查；Windows x64 run `32753806563`／job `97516610936` 成功，包含 Windows runner validation、unsigned package、ASAR addon boundary、packaged artifacts與 Bridge smoke。artifact upload依 PR workflow規則 skipped，因此沒有可下載 artifact、安裝、Pages、macOS package或真實 Windows裝置通過聲稱。
- Live evidence：S10 尚未使用已安裝 Notebook Key或真實 Amazon帳號執行。既有歷史 Brand／Category／S&T數字不能冒充本次抽離通過；本輪沒有 Touch ID／Windows Hello、Validation Preview、PATCH、readback或任何 Amazon mutation。

### 2026-08-24 S09 catalog reports／B2B read-only extraction（stacked Draft PR #117）

- Ownership：`ReportsRuntime` 仍是 report create／poll／durable lifecycle、opaque handle 驗證與 `readDocument()` 的唯一 owner；原始 report／document ID、metadata、signed URL 與下載不離開 runtime／production adapter。`FbaCatalogReports` 是上層 semantic coordinator，只在明確 begin 建立固定 All Listings，且只有 B2B begin 同時建立固定 Active Listings；status／read／optional Active lookup 只沿用既有 lease，不會隱含 POST。coordinator 在 runtime 與 domain read 前後重驗 marketplace／mode／account generation，不擁有 transport、credential、store、workbook 或 mutation。
- Pure read domain：`catalog-report-reads.ts` 接收 runtime 已下載的 All／Active 文字與注入的封閉 `ListingsReadAdapter`，負責 FBA-only parse、exact Seller SKU／ASIN identity、catalog export enrichment／progress，以及 B2B read-only audit。它不接 report handle、不 poll／download、不讀 credential／store、不接 production adapter，也不呼叫 PTD、Preview 或 write module。`business-pricing-evidence.ts` 是更底層的 pure leaf，只做 raw Listings offer／issue normalization、exact marketplace price／quantity-plan evidence與 canonical equality，沒有 I/O、context 或 mutable state。
- Fail-honest 語意：Active Listings unavailable 只代表 optional source 目前不可用，不等於 Business offer absence；只有完整負面證據才可判 missing。unknown／ambiguous／malformed／conflicting evidence 不會建立建議價格或階梯 mismatch，也不能被另一個 positive source 洗掉。全站 B2B audit row 固定 `editable: false`；S09 不接 seller-specific PTD、Validation Preview、PATCH、readback 或任何寫入。`ACCOUNT_SCOPE_CHANGED`、`REPORT_MODE_CHANGED`、`SP_CONTEXT_INVALIDATED` 與 AbortError 不得被 Active fallback 降級。
- Demo／live 分離：demo export／identity／seed／B2B snapshot 只由注入的 demo source 提供；`routerDemoReportsAdapter` 另有明確 mode guard，拒絕任何 live request。舊 All／Active Listings create、status、document 與 catalog type／parser facade 已移除；live 只能把 `ReportsRuntime.readDocument()` 的文字交給 fixed Listings read adapter。scripted fixture 不得成為 live fallback，demo 結果也不得冒充 Notebook Key／Amazon 證據。
- Public DTO redaction：Listings upstream `errors[].message` 不得進入成功的 catalog export 或 B2B incomplete row；輸出只使用固定 allowlisted 中文診斷與經 `publicSpApiRequestId` 清理的 Request ID。fixture 已以惡意 URL、Seller ID、token-like 文字與 NUL control character 鎖定不外洩。
- Local evidence（2026-08-24）：review-fix RED 已先證明 Active AbortError／identity fence、demo document-dispatch 與 successful-DTO upstream-message 洩漏缺口，再轉為 GREEN；最後一輪相關 B2B、catalog export、identity、variation、review、advertising、router 與 architecture focused 回歸共 263 項通過。其後以目前 S09 candidate tree 實際執行完整 `npm run check`，143 個測試檔／1,399 項測試、typecheck 與 production build 全部通過；`npm audit --omit=dev` 為 0 漏洞，`git diff --check` 通過。這些仍是 fixture／scripted-adapter／local build 證據，不是 packaged Bridge、安裝、Notebook Key 或 live Amazon 驗證。
- CI evidence：S09 已發布為 stacked Draft PR #117，base 為 `codex/s08-reports-runtime-lifecycle`，首個 PR head 為 `12a5dae790eaafaea598f42016d388812238009f`。Validate run `32742906387`／job `97481376357` 成功，包含 locked dependencies、typecheck、test、production build 與 renderer plaintext-secret-fixture 檢查；Windows x64 run `32742906431`／job `97481376362` 成功，包含 Windows runner validation、unsigned package、ASAR addon boundary、packaged artifacts 與 Bridge smoke。artifact upload 依 PR workflow 規則 skipped，因此沒有可下載 artifact、安裝、Pages、macOS package 或真實 Windows 裝置通過聲稱。
- Live evidence：S09 尚未在已安裝 Notebook Key 或真實 Amazon 帳號執行。v0.1.30 的 274 列 B2B live canary 只是既有產品行為的歷史基線，不證明本次抽離；本次沒有 PTD、Validation Preview、Touch ID／Windows Hello、PATCH、readback 或 Amazon mutation。

### 已完成與仍待真實 Windows／Mac／Amazon 驗證

正式基線 v0.1.31 的 PR、四條 main Actions、Pages、Mac／Windows artifacts 與 exact Mac 安裝均已完成；v0.1.30 的 B2B／未綁變體正式 Amazon 唯讀 canary 已完成，A+ canary 全數 incomplete 後以同形 fixture 鎖定並修正一個核心缺口，v0.1.31 A+ canary 尚待 Mac 解鎖。本次發布與安裝沒有 Amazon mutation；seller-specific PTD、真實 B2B Preview／PATCH／readback 仍未執行。受保護員工 Mac 下載檔仍是舊版，Windows 固定 prerelease 仍為 v0.1.16，且尚未在員工真實 Windows 11 Pro 裝置做人機驗證。下列範圍必須分開理解：

1. v0.1.31 的 source／Pages／Mac／Windows artifact／Mac 安裝證據已補齊；Windows runner 只證明封裝、Bridge 與 addon 可載入，不得冒充真實 Windows Hello 指紋／臉部／PIN 或 DPAPI 跨使用者驗證。員工 Windows 安裝來源目前仍是固定 v0.1.16 prerelease／受保護 installer。
2. v0.1.30 已顯示 `Amazon 已連線`、US／Live，並完成 274 列 B2B 與 274 列 variation 唯讀 canary；A+ 的 273 列全數 incomplete 是 live 失敗證據，不是可沿用的通過證據。v0.1.31 目前已完成 exact App 安裝與主程序啟動，A+ 正式唯讀 canary 尚待 Mac 解鎖。更早歷史版本的品牌／品類與「狀態收斂進度」只能作各自時間點證據，不得冒充目前 live 完成。
3. v0.1.14 的真實 US 6 個月 Subscribe & Save 已證明單列問題可隔離、其他 offer 繼續；它只能保留為舊版歷史快照，不能自動證明 v0.1.15 的新篩選、全站／SKU 折線或五張正常表加一張問題表。這些仍待 6／12／23 個月追加唯讀重測。
4. 全庫齡層級、AIS tier、評論首頁背景 observer、長 variation family、滑板動畫、36×36 關閉控制與健檢狀態 pill 已通過 production build、測試與 1280px／390px 假 Bridge 視覺驗收；不能以 mock 數值冒充 live Amazon。
5. 評論負向數值必須保持原始負號並標示為 impact；公開 API 仍不提供商品總星等、總評論數或完整 review 全文。v0.1.12 的 23,765 件品牌出貨、257 個 non-parent review candidates，以及 v0.1.14 的 S&S aggregate 都只是各自時間點快照，不得當作恆定現值。
6. v0.1.31 保留文案 drag/drop、逐欄原因／立即修改、同檔 Excel round trip 與成分宣稱核對，並維持可關閉抽屜繼續執行的單項健檢；本版完整回歸為 1,172 tests。使用者原始 Excel 的 273 列離線完整性證據仍屬 v0.1.27 歷史結果；真實 Amazon Validation Preview、文案批次 mutation 與 Windows Hello 實機確認仍未執行。
7. v0.1.30 的全站 B2B audit 已由真實 274 列 US read 證明可讀 canonical fixed／percentage quantity tiers；`父變體橫排` 亦由真實 274 列匯出證明。獨立單 SKU 的 price-only／combined 寫入能力仍受 PTD／Preview／native confirmation／readback 邊界保護。沒有 seller-specific PTD、B2B Preview、PATCH 或 readback；未取得 exact SKU／變更值的另行明確授權前只能做唯讀診斷，商品內容、圖片、一般價格、Sale Price、B2B Price、QDP 與 Variation 不得因發布而自動寫入。
8. 報表文件庫列的是 109 個官方公開 report types 與能力說明，不代表 App 已建立 109 種通用下載器；廣告策略 Reporting v3 已接線但尚未設定真實 Ads LWA，既有廣告覆蓋 Live Ads API 也未因此自動完成，FBA 帳務中心未接線能力仍須保持 unavailable／plan-only。
9. 目前仍是內部 App：Mac 為 ad-hoc、尚無 Apple Developer ID 簽章／公證；Windows fixed prerelease 為 unsigned、尚無 publisher-bound Authenticode，SmartScreen 可能警告且 in-app updater 已停用。所有新增驗證必須保持 FBA-only；任何寫入只限使用者明確授權的 exact SKU／欄位，且不得使用 Seller Central 私有接口。

### 最近的真實錯誤

- 症狀：Orders 可讀，但文案、價格、促銷與 Excel 曾回 `Invalid parameters provided.`
- 最近 Excel Request ID：`c8907d99-12e1-4d62-8766-e6c31e0df848`
- v0.1.3 與修正 Merchant Token 前的 v0.1.4 候選版，真實 Listings probe／單一 SKU 均回 HTTP 400；Amazon Request ID 已保留於本機診斷紀錄。
- 已對照 Amazon 官方文件，完整與最小 `getListingsItem` 參數組合均合法；更新成同一授權帳號的正確 Merchant Token 後，probe 與 `AFA12AM` 商品內容皆成功，故此次 400 根因已確認為帳號識別值不一致。
- SKU 指揮中心曾在 Seller Central 明確有 FBA 庫存時誤報找不到 SKU；根因已確認是程式把官方 `payload.inventorySummaries` 錯讀成頂層 `inventorySummaries`，不是 LWA、Merchant Token 或 SKU 錯誤。
- 不應重建整個 Amazon App，也不應要求使用者輪替或公開 Secret。

---

## 6. 目前安裝檔

- 目前 `/Applications/AMZ.API.app` 的正式基線是 v0.1.31；來源為 release code main `fd02266279414e4e716316dbedfe7a507079bb10` 的 macOS artifact `9493175573`。版本／build 0.1.31、bundle `com.jspusa.amz-api`、雙架構、deep strict codesign、ASAR header integrity 與 `app.asar` 已逐項匹配；原 v0.1.30 保留於 `/Applications/AMZ.API-v0.1.30-backup.app`，既有 userData／Keychain vault 與更舊備份未清除或重建。App 主程序已啟動，但正式 A+ UI canary 尚待 Mac 解鎖；沒有執行 Touch ID、Validation Preview、PATCH 或任何 mutation。完整 workflow、digest、Pages、DMG／ZIP 與 Windows CI-only 證據見上方 v0.1.31 紀錄。
- v0.1.20 main macOS workflow run：`32561974803`；artifact：`9473081924`，名稱 `AMZ.API-unsigned-7425b8e49e027028efdfac6b101bb8d7480e5b02`；GitHub metadata digest：`sha256:fb5c205b7f23b1fa18f8075f51db72ec6ba7c04b8d1f711fe3b34321a4322757`。DMG 為 `AMZ.API-0.1.20-universal.dmg`（246,861,081 bytes；SHA-256 `89e3e1aa35e6878018aa09c06ec80e22eb369d4be418aacc0fc71aafa6c4e9d4`）；ZIP 為 `AMZ.API-0.1.20-universal.zip`（221,569,042 bytes；SHA-256 `8228d8a735a24af5b613d6defbe2c2b31b56e12b9393f6b4a3e44cbc22551009`）；`SHA256SUMS.txt` SHA-256 為 `fa5e91e6b1ad85bceb7fbf289e0c6644e17a59b36eb58df2d89d78e671f728c9`。
- v0.1.20 曾作為 universal 內部測試 App 完成版本／build、bundle ID、executable、雙架構與 deep strict ad-hoc codesign 核對；這是歷史 artifact 紀錄，不是目前安裝版本。
- v0.1.19 main macOS workflow run：`32560390832`；artifact：`9472647652`，名稱 `AMZ.API-unsigned-cae2bd51cfeebc3bc9a8a4e77deaabd5af4e4bc1`；GitHub metadata digest：`sha256:22a3beb9243dae7cf2bda76dc3235422de1325e271d5da6e62301a1e31a45781`。DMG SHA-256 為 `bf9cc3931e20236357b348cc2e7f6e389ad07908a152aba5b59d177da83813f1`；ZIP SHA-256 為 `ff3837763485fcd9b49cf073bccbf104a86d0f38b54ebf1fa2068ee6bf83ecf8`，均與 artifact 內 checksum manifest 一致。
- v0.1.19 已由本次安裝保留為 `/Applications/AMZ.API-v0.1.19-backup.app`。曾手工重包的臨時 canary 會被 macOS 終止且出現「重新打開／報告」對話框，已完全排除為正式安裝來源；不得再使用該臨時 App。
- v0.1.17 main macOS workflow run：`32455530465`；artifact：`9437191218`，名稱 `AMZ.API-unsigned-ef5bd04a8c87bf51743fe72e95e3a59073f14b4f`；GitHub metadata digest：`sha256:6ee034932ca5043774ea5110bd6c7133d93b72fd9b7c90dc434a9aa756209ea1`，保存至 `2026-09-04T06:47:01Z`。DMG 為 `AMZ.API-0.1.17-universal.dmg`（246,079,435 bytes；SHA-256 `1f01c0455d0f7ca506a537e889be5d3de2443e571e27cfc59d332e0c1e8b3ab2`）；ZIP 為 `AMZ.API-0.1.17-universal.zip`（221,564,636 bytes；SHA-256 `1267d63573ccb54e825ca9cf3cc8d510fa2c100694de9d3abca8741859b24c82`）；`SHA256SUMS.txt` 自身 SHA-256 為 `05afb64ef24c5291126ef815c3b8f439a505f35d8b2572bf7f0a30bd0475ce13`，兩個 payload hash 均完全一致。
- 受保護的 Supply Boss API v4 下載站目前只提供 Mac DMG 與 Windows NSIS installer 兩個員工入口。Mac 卡的 private R2 物件已更新為上述 v0.1.17 DMG／SHA；Windows 卡維持 v0.1.16，portable ZIP 與 `SHA256SUMS.txt` 只保留為內部驗證 artifact。下載站密碼未更改。
- Windows v0.1.16 固定內部 prerelease：`https://github.com/jspusa/AMZ.API/releases/tag/notebook-key-windows`。NSIS 安裝檔為 `AMZ.API-Notebook-Key-Windows-x64-Setup.exe`（101,400,294 bytes；SHA-256 `997209481a290a4e05dfc5111222d3deee9f2ff55bd5bff247deef06bbd8a3c0`）；portable ZIP 為 `AMZ.API-Notebook-Key-Windows-x64.zip`（142,515,498 bytes；SHA-256 `2b086fbd36c2ca8be7891a53a0d70cebc243b909b6ba2b9ba0c862799ab83b0a`）。兩者與公開 `SHA256SUMS.txt`、GitHub asset digest 完全一致，匿名下載均回 200。此版本未簽章；員工安裝前必須核對 SHA，並預期 SmartScreen 警告。
- v0.1.16 main Windows workflow run：`31351732415`；artifact：`9049261782`，名稱 `AMZ.API-Notebook-Key-Windows-x64-654d70c0ed554b1b9cdd078fc0587d15274c2500`；GitHub artifact digest：`sha256:3902fb2eeec61b3e081391a4e7dcd43d02a9beec314a3c267b7187c277fe3c6d`，保存至 `2026-08-24T03:13:10Z`。用於固定 prerelease 的 trusted workflow run 為 `31351186684`，artifact `9049090358`，digest `sha256:684aa093428ff63df64d2e51c74ae3c086bbe74658b9ce0afa164c92b7035005`；其三個實檔已下載並逐一核對。
- v0.1.16 main macOS workflow run：`31351732405`；artifact：`9049246734`，名稱 `AMZ.API-unsigned-654d70c0ed554b1b9cdd078fc0587d15274c2500`；GitHub artifact digest：`sha256:303773960c146c94cf2f883381297c93c8051dd78eac642e8869be55bab3bb7f`。該版後來確實成為本次安裝前的 `/Applications/AMZ.API.app`，並已原樣移到 `/Applications/AMZ.API-v0.1.16-backup.app`；更舊備份若仍存在，也不得在未核對版本前覆蓋。
- v0.1.15 main macOS workflow run：`31325158197`；artifact：`9041374594`，名稱 `AMZ.API-unsigned-ac5c18b2319061bcb06600967d4acec84c55d5f3`；GitHub artifact digest：`sha256:1f13c1284c75942e15d9029bf2720ef0519a4a8786bc256bdff0b63c2ad1644d`，保存至 `2026-08-23T17:03:27Z`。DMG SHA-256：`3f3d52d7bcd2d33b973c81365308e011b56addfcb1e5c28676466fcc74bf1b9f`；ZIP SHA-256：`1acc5e3d36586d1091e604a9e2ce08aa96db338df84948c0f89de1f4c2a23695`；兩者均與 artifact 內 `SHA256SUMS.txt` 一致。
- v0.1.14 main macOS workflow run：`31320824613`；artifact：`9040153961`，名稱 `AMZ.API-unsigned-2b9a8585daf1cfb3ed95ed72add916a142864d6f`；GitHub artifact digest：`sha256:0b7d41a687b27b0415c5ee5ee5e05c26f8c2ba72b7b024399912276b3a528d70`，保存至 `2026-08-23T15:23:29Z`。DMG SHA-256：`588e1263c5f0de4a7423ab4d88821a7dc1d24871518b22c6cc45c24ed46407ec`；ZIP SHA-256：`ade7265c4d5c990518dcbe98d3863205b62d7aacd7b88cc3cdbc439a8c08da45`；兩者均與 artifact 內 `SHA256SUMS.txt` 一致。
- v0.1.13 main macOS workflow run：`31305784906`；artifact：`9035956569`，名稱 `AMZ.API-unsigned-74d13dc21d4b0e1fd8a2acf9294473c89c409e5f`；GitHub artifact digest：`sha256:fe1ab191997cb468159d38bc4780f5233cd85bee73cd22b79dd287a79484f760`，保存至 `2026-08-23T09:28:46Z`。DMG SHA-256：`60f58c24e08474161c2536fac0f756692aa235f563cea1d3423291f1c06c42e6`；ZIP SHA-256：`002ad700aab28d4fee9499350a2d77a088806bcd91fd388772aa1be58fca39ab`；兩者均與 artifact 內 `SHA256SUMS.txt` 一致。
- v0.1.12 main macOS workflow run：`31298271179`；artifact：`9033689855`，名稱 `AMZ.API-unsigned-e5b6a12b967613da9bbd0c8817225fbf2c9bfab1`；GitHub artifact digest：`sha256:be8c76a607f78a575ab9cbe0c85d76221e638e0e1f13ecfb04fc46070886b09c`。DMG SHA-256：`0f4bf46669180fbb6086aba2d9358ee4da09ad6e57f7a3872c83fced65185038`；ZIP SHA-256：`c4d4db8c139bef6d0be755f8df033ec2202eb1c8595dbc1c3e4c126460fa853c`；兩者均與 artifact 內 `SHA256SUMS.txt` 一致。
- v0.1.11 main macOS workflow run：`31279106105`；artifact：`9027927355`，名稱 `AMZ.API-unsigned-ec1e971db25cbbb4db9a25386a8c1e2fdc46b021`；GitHub artifact digest：`sha256:abdabd850ffa4a68a1034c3a61495944206dfb86dc80c437e20a764cb609e3e4`，短期保存至 `2026-08-22T21:25:18Z`。DMG SHA-256：`7aa7001adc5a867740527a8d1788abc2cd6ab0d888c0557561ed1882b4d47fe3`；ZIP SHA-256：`e6a3f18fa3b880edbbce98722137fba50d85e1d2f4cfa32b9c8439ed51529753`；兩者均與 artifact 內的 `SHA256SUMS.txt` 一致。
- v0.1.10 main macOS workflow run：`31271753671`；artifact：`9025861198`，名稱 `AMZ.API-unsigned-5949f605da420f7664bcaf9507f9fc9cde16dcf1`；GitHub artifact digest：`sha256:39bdc11f1bc78d4c680a93c1c204c65f2e8e82a4475e379bd21b3f81772051ed`。DMG SHA-256：`c02dccc1fdb3de253ced71a82e7d01fc885f0662b6ddf1f16d0cc0f7ac37643c`；ZIP SHA-256：`578e96dd7b5b465c9b9e44648de6fa1f9a7db3ee18f2e2c65de120a7644f6891`；兩者均與 artifact 內的 `SHA256SUMS.txt` 一致。
- v0.1.9 main macOS workflow run：`31249715993`；artifact：`9019652910`，名稱 `AMZ.API-unsigned-3fa27e165a42a441be67abb44e5fcfcc37d264bc`；GitHub artifact digest：`sha256:d66863e149c0ab6a1c65394bb9dbcd93ebe58051bdff7c802613272e38fa0ce9`（短期保存至 2026-08-22）。DMG SHA-256：`7e74d7ba0dd31ce2a7ea7a795cb1a6b4f88ee922f847383a962fdae51f5d052c`；ZIP SHA-256：`d543b790527b13cc6b4836757bf9297405d37a24d961571be3e45cac931a9cbc`；均與 artifact 內的 `SHA256SUMS.txt` 一致。
- v0.1.7 main macOS workflow run：`31098122782`；artifact：`8966405377`，名稱 `AMZ.API-unsigned-a9a9468cdfb42ae4d1e0e1b268027bf9ca7220a0`；GitHub artifact digest：`sha256:bf5c4a9cf79a59a8abc11ce25cf0db31bbe9c8c846316f7fc268969f49b370cf`（短期保存至 2026-08-20）。DMG SHA-256：`550cc0ed24f69f8661aed372f22ca22ac6f88ed9d8acb79d2af5573cc9ba2de3`；ZIP SHA-256：`c6ebda5b1631ee2d80058734667ef1a5a7b2ab6128edb463a883098198156609`；均與 artifact 內的 `SHA256SUMS.txt` 一致。
- v0.1.6 當時的實際安裝來源：分支 workflow run `31085746949`、artifact `8961382972`，名稱 `AMZ.API-unsigned-6091ff0b9fd649d816c07c8ca7d1504724a5093f`；GitHub artifact digest：`sha256:a365a0d997abd53839ff64086ded2edd8479e11aafcafae380b4653fc7b782c4`。
- v0.1.6 分支 DMG SHA-256：`c9a20a9638088f43b690a762746efd034c8c8a05836f1d740c149a138c9c53ec`；ZIP SHA-256：`b369dba980de343527c6a602090e0a06c37d508870a690478dfac7bc45375a9c`；均與 artifact 內的 `SHA256SUMS.txt` 一致。
- v0.1.6 main macOS workflow run：`31086616734`；artifact：`8961800029`，名稱 `AMZ.API-unsigned-d288ac40640c92e42e11474068a879625ed7212a`；GitHub artifact digest：`sha256:1ad52cb1ca34decec9f76805b129916725dcacac0588bc96f1be0a911f757c5e`（短期保存至 2026-08-20）。main DMG SHA-256：`0c45bf2720365d08f588c40b2c4f1e9e63a02bb1e950f66af80b43a078fbcff9`；ZIP SHA-256：`43faaf83c53ceebb031169874454bb36f78eaf108d5da415f18e7df809134ae3`；均與 main artifact 內的 `SHA256SUMS.txt` 一致。
- v0.1.5 桌面 DMG 若仍保留，其 SHA-256 為 `3f37a6a0fd520839ecb73d8344b3a048265e8e345289d4693fdd75a1a5b6ef38`。
- 舊 v0.1.3 Library 檔名：`AMZ.API-0.1.3-universal.dmg`；舊 DMG SHA-256：`12c709019558d2060e88a9f8af33d121040af3ae80a56748a1cc41c5769ea232`。
- 同一 bundle ID／Keychain vault，覆蓋安裝時應保留本機憑證。
- 目前為內部測試版／ad-hoc 驗證流程，不可宣稱已完成 Apple Developer ID 公證正式發布。

---

## 7. 必讀檔案順序

新 Codex 必須依序讀取，不要只看 README 就開始改：

1. `docs/CODEX_HANDOFF.md` — 本文件，狀態與交接入口。
2. `README.md` — 功能、第一次使用、發布方式。
3. `SECURITY.md` — 不可破壞的安全邊界。
4. `docs/ARCHITECTURE.md` — GitHub UI、Mac Bridge、程序與信任邊界。
5. `package.json` — 版本、scripts、Electron build 設定。
6. `src/shared/contracts.ts` — Renderer／Preload／Main 的資料合約。
7. `src/main/index.ts` — App 啟動、視窗、IPC、更新與請求協調。
8. `src/main/credential-vault.ts` — Keychain-backed secret vault。
9. `src/main/amazon/sp-execution-context.ts` — 不可變 marketplace／region／mode／account generation 與失效契約。
10. `src/main/amazon/sp-api-error.ts` — canonical SP error vocabulary 與 renderer-boundary sanitizer。
11. `src/main/api-router.ts` — 所有 UI API 路由、preview／commit 與輸入驗證。
12. `src/main/amazon/listings-reads.ts` — 封閉的 Listings／PTD item、search、definition 語意與 scripted adapter。
13. `src/main/amazon/listings-reads-production.ts` — 固定 GET endpoint、token／retry／fallback 與 PTD schema 外部 seam。
14. `src/main/amazon/listings-response-error.ts` — Listings read／write 共用 status、issue 與 upstream error mapping。
15. `src/main/amazon/exact-seller-sku-batches.ts` — 不 trim／不 alias 的固定 20-SKU batch planner。
16. `src/main/amazon/variation-family.ts` — family member、role、theme、dimension 與 relationship 純 normalization。
17. `src/main/amazon/unbound-variation-audit.ts` — explicit relationships evidence 與 deterministic workbook family rows。
18. `src/main/amazon/variation-family-reads.ts` — exact SKU／ASIN member、declared children 與 child pagination。
19. `src/main/amazon/variation-relationship-evidence.ts` — 固定 relationship batch 與逐列 identity／role classification。
20. `src/main/amazon/variation-catalog-reads.ts` — FBA grouping、unbound／review seed 的高階唯讀組合 seam。
21. `src/main/amazon/customer-feedback-reads.ts` — Customer Feedback identity、raw schema、signed topic evidence、demo／live 與 semantic result 唯一 owner。
22. `src/main/amazon/customer-feedback-reads-production.ts` — 固定 getItemReviewTopics GET、App-session global pace、abort、body bound 與 bounded retry adapter。
23. `src/main/amazon/orders-reads.ts` — Orders rolling dates、status／cursor、demo／live、raw normalization、FBA fence 與 public DTO 唯一 owner。
24. `src/main/amazon/orders-reads-production.ts` — 固定 Orders v2026 GET、AFN、50／1筆 page、token refresh 與 bounded transient retry adapter。
25. `src/main/amazon/demo-fba-catalog.ts` — Orders 與 legacy demo listing／variation 共用的中立product facts，不含transport或order語意。
26. `src/main/amazon/review-audit.ts` — 只聚合已驗證 Customer Feedback evidence、coverage、排名與 public snapshot。
27. `src/main/amazon/reports-runtime.ts` — 六種固定 Reports intent、durable lifecycle、opaque handle 與文件唯一 owner。
28. `src/main/amazon/reports-runtime-production.ts` — 固定 report create／status／document transport、bounded GET retry 與下載邊界。
29. `src/main/amazon/business-pricing-evidence.ts` — 無 I/O 的 B2B offer／issue normalization 與 canonical equality pure leaf。
30. `src/main/amazon/catalog-report-reads.ts` — All／Active Listings 文字的 FBA parser、Listings enrichment、export／identity 與 B2B 唯讀 audit。
31. `src/main/amazon/fba-catalog-reports.ts` — 只協調 runtime、context、live read 與注入 demo source 的 catalog semantic coordinator。
32. `src/main/amazon/revenue-report-windows.ts` — Brand shipment不可變站點時間窗、strict report日期／timestamp與S&T已接受日期 selection。
33. `src/main/amazon/brand-sales-reads.ts` — canonical current-FBA seeds＋shipment document的pure Brand／Category snapshot與public allowlist projection。
34. `src/main/amazon/fba-revenue-reports.ts` — Brand revenue雙 leg durable coordinator、expected context、reuse／retry／poll與generation-bound cache。
35. `src/main/amazon/brand-sales-demo.ts` — 只使用注入 canonical demo listings的Brand demo source。
36. `src/main/amazon/sales-and-traffic-reads.ts` — fixed DAY＋SKU document parser、strict identity／number／currency與public snapshot projection。
37. `src/main/amazon/sales-and-traffic-reports.ts` — S&T begin／status／read semantic coordinator與accepted-lease context fence。
38. `src/main/amazon/sales-and-traffic-demo.ts` — 只使用注入 canonical demo listings的S&T demo source。
39. `src/main/amazon/fba-inbound-shipments.ts` — v0 shipment／items normalization、opaque continuation、duplicate與page／row budgets。
40. `src/main/amazon/fba-inbound-modern.ts` — bounded modern plan／shipment fallback collector與partial coverage。
41. `src/main/amazon/inbound-noncompliance.ts` — daily report strict parser、public issue filtering與demo document。
42. `src/main/amazon/fba-inbound-reads.ts` — shipment／noncompliance兩條leg、400／422 fallback、同一execution context與ReportsRuntime composition。
43. `src/main/amazon/fba-inbound-reads-production.ts` — 固定official GET endpoints、global pace、timeout、token refresh與bounded transient retry。
44. `src/main/amazon/fba-inventory-replenishment.ts` — FBA Inventory／Replenishment 封閉語意、evidence、audit 與 scripted adapter。
45. `src/main/amazon/fba-inventory-replenishment-production.ts` — 固定官方 request、token refresh 與 intent-specific retry／no-replay 外部 seam。
46. `src/main/amazon/replenishment-audit.ts` — offers／metrics strict normalization、分頁、月份與 coverage 規則。
47. `src/main/amazon/sp-api.ts` — 尚未抽離的 Listings write／legacy demo facade與production adapter composition；Orders read語意已移除。
48. `src/main/local-store.ts` — 商品主檔與 idempotency ledger。
49. `src/preload/index.ts` — 窄化 Bridge。
50. `src/renderer/src/connection-panel.tsx` — Notebook Key 安全連線與 API SOP。
51. `src/renderer/src/components/sku-operations-drawer.tsx` — 文案與 Excel。
52. 其他 `src/renderer/src/components/*drawer.tsx` — 價格、促銷、圖片、補貨、廣告。
53. `.github/workflows/*.yml` — Validate、Pages、macOS 與 Windows build／release。
54. `tests/*.test.ts` — 已建立的安全與回歸契約。

---

## 8. 新 Codex 開始工作前的檢查

```bash
git status -sb
git remote -v
git fetch origin
git log --oneline --decorate -10
npm ci
npm run check
npm audit --omit=dev
```

注意：

- v0.1.31 release code main commit 為 `fd02266279414e4e716316dbedfe7a507079bb10`，對應 PR #67、Pages、macOS artifact 與 main Windows CI；固定員工 Windows prerelease 仍是 v0.1.16。開始新工作前仍須 `git fetch origin` 並核對 merge base；後續 docs-only main commit 不得冒充新的 release artifact SHA，不得把本機 `out/` 或未受信任 PR artifact 誤認成已發布 App，本機 `main` 若尚未 fast-forward 也不得直接從舊 local `main` 建立新分支。
- 工作區可能存在使用者或其他 agent 的變更；不得 `git reset --hard`、`git checkout --` 或直接覆蓋。
- 修改後應建立修復分支／PR，通過 Actions 再合併。
- 真實 Amazon 驗證只能由使用者在自己的 Notebook Key 本機加密憑證環境執行；Linux／CI 不得假裝已測過 SP-API live，Windows runner 也不得假裝已完成員工裝置的 Windows Hello／DPAPI 人工驗證。

---

## 9. 不可違反事項

- 不要要求使用者在聊天貼 LWA Client Secret、Refresh Token、完整 Seller ID。
- 不要把 Secret 寫入 GitHub、`.env`、localStorage、URL、console、crash log 或 Excel。
- 不要為了方便把 Amazon API 直接搬到 GitHub Pages browser JavaScript。
- 不要讓任意 GitHub／遠端 origin 取得 preload IPC。
- 不要提供通用 `amazon:request(method, path, body)` IPC。
- 不要在 timeout／429／5xx 後自動重送 Amazon 寫入。
- 不要把 Coupon、Subscribe & Save 或 Ads API 未開放能力假裝成已完成。
- 不要加入 FBM 功能或讓 FBM 商品混入補貨／內容匯出。
- 不要只因 Orders 成功就宣稱 Seller ID／Listings 已成功。
- 不要更名；產品名稱確定是 `AMZ.API`，不是 Amazon-FBA-OS。

---

## 10. 交接後建議的第一個任務

下一個安全任務是待 Mac 解鎖後接回已啟動的 exact v0.1.31 Notebook Key，核對 Amazon 連線、US／Live 並重跑正式 A+ 唯讀 canary。若系統要求，使用者只透過原生 Keychain 流程重新授權；不要在 Mac 冒充 Windows Hello、不要清除或重建既有 vault，也不要自動執行任何 Amazon 寫入。

### A. v0.1.31 發布與 live 證據

1. 本機 `npm run check` 為 121 files／1,172 passed；main Validate 為 1,171 passed／1 skipped（1,172 total），audit 0、diff check、PR #67、release code SHA `fd02266279414e4e716316dbedfe7a507079bb10` 的四個 main Actions、live Pages 關鍵檔案與 exact macOS artifact 安裝均已完成。後續 docs-only main SHA 只代表證據文件更新，不得冒充新的 release code 或 artifact SHA。
2. v0.1.30 的正式 B2B／variation canary 已通過；A+ 全數 incomplete 已由同形 fixture 重現並鎖定跨文件 conflict poisoning 核心缺口。v0.1.31 正確保留跨文件 exact `CONTENT_PUBLISHED`，optional route metadata 畸形只降 partial，無 positive 仍 fail closed；live A+ 尚待驗證。
3. exact v0.1.31 App 已安裝，v0.1.30 備份與既有 vault 均保留；主程序已啟動，沒有啟動即崩潰。正式 A+ UI canary 尚待 Mac 解鎖，不能以 CI 或舊版失敗結果冒充完成。
4. Mac 解鎖後先核對 Notebook Key／Amazon 連線、US／Live 與目前 App 0.1.31，再只執行 A+ 唯讀 canary。沒有另行明確授權 exact SKU、欄位與變更值前不得 PATCH；任何不明結果立即停止，不盲目重送。
5. Windows CI 不能替代真實 Windows 11 Pro 的 DPAPI／Windows Hello 驗證；目前員工固定 prerelease 仍是 v0.1.16。

### B. 廣告策略 live 待辦

1. Amazon Ads 獨立 LWA 尚未設定；先用 main-owned 本機安全 editor 完成 Ads LWA 與 US profile 驗證，不得把 Secret 或 profile ID 放入聊天／Pages。之後才用最近 30 個完整日核對 FBA SKU、Sales & Traffic、SP 實際花費／14 日歸因銷售／購買次數、實際 ACoS、花費排名與 T1–T4。
2. 廣告策略缺報表列必須保持「未回報」，不得補 0；價格、SB／SD 策略與規格保持人工欄位。下載後核對三張工作表與 29 欄、分開來源時間；關閉 drawer 再重開只能 GET 接回同一 job。只有第一次真實 Reporting v3 成功後才能標成已驗證。

### C. Windows 11 Pro x64 實機驗證

1. 只從固定 `notebook-key-windows` prerelease 下載 EXE 或 ZIP；安裝前依 `SHA256SUMS.txt` 核對 SHA-256。不要改抓 PR／fork／過期 Actions artifact。
2. 在一台員工 Windows 11 Pro x64 筆電核對 SmartScreen 警告、NSIS 安裝／移除、版本 0.1.16、Notebook Key Bridge ready、WebGate 開啟與一般瀏覽器無 Bridge 的鎖定狀態。Windows unsigned 版不得啟用 in-app updater。
3. 使用 main-owned 本機安全 editor；不得把 Client Secret、Refresh Token 或完整 Seller ID 貼到聊天、Pages 或瀏覽器。核對保存後 renderer 只看到 redacted status，另一個 Windows 使用者不能解密原使用者的 DPAPI vault。
4. 以 Windows Hello 實測成功、取消、未設定／不可用與 Windows 提供的 PIN fallback；記錄的只能是通過／拒絕與安全錯誤碼，不得記錄生物特徵種類或憑證。測試停在敏感操作授權邊界，不執行 Amazon mutation。
5. CI 已證明 addon 可載入、HWND 屬於目前程序且三種 package 可啟動；它沒有證明實際指紋／臉部／PIN UI。只有上述實機矩陣完成後，才能把 Windows Notebook Key 標為已完成員工驗收。

### D. 接回目前 Mac App

1. 目前安裝的是 exact main artifact v0.1.31；v0.1.30 備份、更舊備份與原 userData／Keychain vault 均保留。不要以工作樹 build 覆蓋目前安裝檔，也不要清除 Keychain item 或 encrypted vault。
2. App 主程序正在執行；Mac 解鎖後應接續同一程序核對連線狀態，不要盲目重啟、重建 vault 或為了唯讀 canary 進入 Touch ID／commit。

### E. 依序完成既有新功能的真實唯讀證據

1. 品牌／品類：在同一日期範圍先看品牌、切至品類、再切回品牌；核對總額不變、八個品類依 Supply 最早關鍵字規則分類、未命中歸「其他」，且 main 沒有為回到品牌另建相同 report。範圍含站點今天時核對 `dataThrough`，不得把當天未完成資料冒充完整日。
2. Subscribe & Save：先用 6 個月核對「全部／0／5／10／15／20／有問題」篩選、正常卡片欄位、預設全站折線、選取 SKU、取消或重選同 SKU 返回全站；問題 SKU 只能出現在問題範圍，未知折扣不得進 0%。
3. Subscribe & Save Excel：核對 0／5／10／15／20% 五張無問題折扣表與獨立「問題 SKU」表。再視需要追加 12／23 個月；缺月、unknown discount、部分 coverage 與無法安全輸出 identifier 的範圍必須保持原樣，不得補 0 或顯示假的全站總額。
4. 首頁健檢狀態：核對成功、部分完成、失敗與未執行的外卡片狀態清楚；「狀態收斂進度」只表示步驟已結束，不得把全部失敗顯示為成功。
5. 追加核對全庫齡層級與 AIS tier 的真實 US report、評論 drawer 關閉後首頁進度，以及長 variation family 的實際內容；只做唯讀，不進 Preview／Touch ID／commit。

### F. 其餘既有唯讀矩陣

1. 評論主題：接回既有 job 後關閉 drawer，等待背景進度增加再重開；負數必須顯示為「負向影響值」且明示不是商品負星等。核對 parent 排除、child＋standalone non-parent 與六張 Excel。
2. 未綁變體：完成批次掃描與 Excel，確認缺 relationships／站點或 ASIN 衝突列為未完成；Seller SKU／ASIN family 查詢只做唯讀，結果都要顯示 exact Seller SKU。
3. 文案：核對 Excel 疑似錯字片段為紅字；以一個有問題欄位測「立刻修改」fresh read 與 stale fallback，只能走到 Amazon Validation Preview，未獲另行授權不得 commit。
4. 報表文件庫：核對 109 個官方 report types 的分類、說明與「已接線／尚未接線／不適用」狀態。文件列出不等於 App 已能下載全部 109 種。

### G. 若某一 endpoint 失敗

依 endpoint 分開診斷，不把所有失敗歸因於「API 沒串好」：文案／圖片／variation 看 Listings Items 與 PTD；FBA 庫存看 FBA Inventory；訂閱省看 Replenishment；品牌／品類／評論／Excel／健檢／庫齡看 Reports、Customer Feedback 與 Listings enrichment；會計先分辨 Finances JSON、FBA report、Amazon-generated report、人工前置與 unavailable。保留錯誤 code、Amazon message、Request ID、App version 與 marketplace，但不得記錄或輸出 Secret、Refresh Token 或完整 Seller ID。

---

## 11. 完成定義

只有適用平台與 Amazon 範圍的下列條件都成立，才能向使用者宣稱「已串好」：

- Notebook Key 顯示正確版本；Windows 版必須另在真實 Windows 11 Pro x64 完成安裝、Bridge、DPAPI 與 Windows Hello 成功／取消／不可用／PIN fallback 人工驗證，不能拿 CI 或 Mac 測試代替。
- Orders 與 Listings probe 均 live success。
- US Seller SKU 文案、價格、促銷狀態能只讀查詢。
- US Seller SKU 的 FBA 庫存／補貨能只讀查詢，且 7／14／30／90 天、自訂 1–365 天與去年同期 AFN 銷售趨勢完整載入。
- 180 天以上 FBA 庫齡報表能唯讀載入，庫齡與 Amazon 預估冗餘不混為同一指標；它與評論健檢只放在首頁預設收合的「低頻健檢」，不進 run-all。
- 首頁 run-all 精確包含文案、圖片、A+、未綁變體、訂閱省、B2B 價格、廣告覆蓋七項；七項在背景並行執行，名稱與一般健檢卡完全一致並固定依此順序顯示。任一失敗要保留自己的終局狀態，不能把「全部結束」冒充成功。
- 全站文案與圖片健檢能以真實 Amazon FBA 範圍載入，cache／編輯／返回流程正常；文案門檻精確為產品名稱 60、產品亮點 110、每項產品要點 150–200、產品敘述 1,800 Unicode 字元，圖片 0–5 張列不足、6 張通過，讀取未完成不推論。原因只能顯示一次，摘要數字本身可直接篩選，立即修改要聚焦並保留相符原因。成分宣稱只在完整且非空的 Amazon ingredients 證據下核對：至少兩個不同成分才可否定 single ingredient，Tendon／Tendons 需有同詞成分，ingredients 含 Chicken 時標示 hypoallergenic 待核對；括號逗號與不完整讀取不得誤判。
- 文案 Excel 可按鈕選檔或 drag/drop，且只含 FBA 商品；schema v2 必須含「說明與索引」、已證明的變體 family 分頁、「未綁變體」與 fail-closed「資料未完成」，並保留原始／更新欄、問題顏色與「類型／說明」。CR／U+0085／U+2028／U+2029 必須無損 round trip；舊檔只能用 main-owned 唯一完整 digest bounded recovery。
- 回傳文案健檢 Excel 時，無變更、篡改、過期、跨站點／帳號、公式／巨集／外部連結與任何 SKU 預檢失敗都必須在第一筆 Amazon PATCH 前停止；通過後一次 native confirmation 只授權該 main-owned batch，逐 SKU ledger／readback 與遇不明停止後續不得放寬。
- A+ 全站健檢必須以同次完整 FBA all-listings 證明 exact Seller SKU／ASIN，並用 relationships 排除已證明的 parent。完整 child／standalone 依 marketplace＋ASIN 去重讀取全部官方 publish-record pages；relationship 未完成列保留 exact FBA ASIN 只作 account-wide Content Documents／ASIN relations 的 match target，不得發該 ASIN 的 publish-record request，也不得以空結果誤標 missing。只有 exact publish record 或文件關聯的 schema-valid `CONTENT_PUBLISHED` 可證明已發布；文件存在或 APPROVED 本身不能冒充發布證據。同一 ASIN＋document relation 只要含 published positive 就必須保留，即使另有重複／較舊的 `CONTENT_NOT_PUBLISHED` 或 malformed row 也只能把證據完整度降為 partial；完全沒有 published positive 的 malformed／negative 關聯仍 fail closed。同一文件的重複 metadata 採最新 display data、標為 partial 並繼續遍歷 relations。只有 warning-free、完整分頁的 publish-record 空清單，且 Content Documents 與每份文件的 ASIN relations 亦完整覆蓋時才可標沒有 A+；任一 exact positive record 必須保留，即使 optional warnings envelope 無法解析也不得丟失。403、warning-only 空清單、文件／關聯覆蓋未完成、沒有 published positive 的 schema／identity 衝突、分頁缺口保持 unavailable／incomplete；介面可顯示官方文件名稱、文件審核狀態與關聯狀態，不建立公開 API 無法證明的 theme 或內容類型欄位。
- Subscribe & Save 全站健檢能以完整 FBA Inventory 分頁證明 SKU，正確顯示目前有效訂閱、最多 23 個已完成月份與缺月；開啟顯示全站歷史並能切換／取消單一 SKU。Excel 必須產生 0／5／10／15／20% 五張無問題工作表與獨立「問題 SKU」工作表；未知折扣、問題列與缺值不得冒充 0 或完整總額。
- FBA 冗餘庫存只依 Amazon `estimated excess quantity`，庫齡不會被列為冗餘；storage cost／AIS 缺值不會產生假的 0 或部分全站總額。
- 未綁變體健檢能以真實 FBA relationships fail closed 載入並匯出 Excel；工作簿必須含淡色 family banding 的 `所有變體`，以及第一列橫排已驗證 Parent SKU、各欄第二列起只接該 Parent children 的 `父變體橫排`。standalone／incomplete 只能留在各自工作表，不得混進 parent-column mapping。畸形、缺失或被改寫的識別碼不得被列為可安全操作。
- 品牌與品類營收能以同一份、同日期的真實 FBA Customer Shipment Sales report 核對總額；品牌保留未分類列，品類依 Supply 的最早關鍵字規則產生八類，切換不得另建相同 report。含站點今天時必須顯示實際 `dataThrough`；廣告覆蓋在 Ads API 尚未連線時必須維持 unavailable，不能宣稱已有真實 campaign 覆蓋結果。
- FBA 入庫貨件必須只出現在頂部「報表區」，不在首頁或「營運區」重複入口；並以真實 US 30 天背景 job 證明可完成。預期／Amazon 已接收／尚在接收／多接收、完整／部分 coverage、daily/problem-only 三層瑕疵邊界與 7-sheet Excel 均須驗證；安全失敗、空列或 unavailable 不得冒充 0 貨件、0 差異或 0 瑕疵。
- 廣告策略必須以真實 US 最近 30 個完整日證明目前 FBA、Sales & Traffic 與 SP Reporting v3 可完成；T1–T4、缺值不補 0、價格／SB／SD／規格人工欄保持空白，以及 3-sheet／29 欄 Excel 均須驗證。Ads LWA 未設定或 Reporting 未成功時只能標為未驗證。
- 首頁全站健檢外卡片必須區分未執行、執行中、成功、部分完成與失敗；「狀態收斂進度」不得因所有步驟都已結束而把全部失敗冒充成功。
- B2B 全站健檢必須用同次完整 all-listings 證明 FBA 範圍，exact 核對 Seller SKU／ASIN／marketplace，並把 configured／missing／above-standard／incomplete 分開；`不符建議 B2B 價格` 與 `未正確設定階梯折扣` 是獨立且可重疊的問題，USD 建議價為一般售價少 US$1.00，percent tiers 固定 5／5%、10／10%、15／15%、20／20%。audit 全部固定唯讀，只提供 Seller Central handoff，不顯示 PTD／唯讀／不支援篩選或內部編輯器；完成 snapshot 的 Excel 必須由 main 綁 account／mode／marketplace／job／context 並固定五張工作表。Active Listings report 必須經 main-owned、account／marketplace／mode／type／options 綁定的 durable lifecycle single-flight 建立與沿用；data GET 不得隱含 POST。一般售價／Buy Box ERROR 與 Business Price／數量折扣證據分開；Active Listings 的 exact `Business Price` 可覆蓋較舊 Listings contribution，canonical `Quantity Price Type`＋連續成對的 `Quantity Lower Bound 1–5`／`Quantity Price 1–5` 可補足尚未同步的 `quantity_discount_plan`。Active 與 Listings 兩邊 canonical plan 相同才合併；衝突、duplicate headers／rows、缺口、斷層、malformed value、ASIN／身分衝突一律 ambiguous，不能被第三個 positive 洗掉；Active quantity 欄完全不可用時也不能抹除 Listings canonical plan。unknown evidence 不能冒充 mismatch，只有完整負面證據才可標未設定。獨立單 SKU 真實更新仍必須先由帶目前 Seller ID 的 seller-specific PTD 明確開放 exact B2B price path，再呈現一般價與 B2B canonical diff，只 merge `audience=B2B` contribution 並保留一般 `ALL` 與其他 audiences。price-only 必須省略並守住既有 `quantity_discount_plan`；combined 只有在使用者明確選用、canonical 1–5 階 percent tiers 與完整 QDP PTD path 都可證明時才可帶 plan。兩者都要經 fresh read、Validation Preview、native confirmation、idempotency、單次 PATCH 與 price／tiers canonical readback；不明結果禁止重送。
- 會計中心只把公開 capability 與安全 access plan 標為完成；除非日後另行實作並驗證 report lifecycle，不得宣稱已下載報表、一般發票或 Seller Central 帳單。
- Variation family 與 CHILD PTD 必須先通過真實唯讀驗證；目前 mutation 只能標為 mock/demo 已驗證。只有在使用者另行明確授權指定 SKU，且 detach 與 attach 各自完成 preview、Touch ID、單次 PATCH 與唯讀回查後，才可對該次操作宣稱真實寫入成功。
- 寫入前顯示 canonical diff、通過 Amazon Validation Preview、要求本機確認／Touch ID／Windows Hello。
- 寫入後回查；結果不確定時阻止盲目重送。
- Secret 仍只存在各 Notebook Key 的本機加密 vault：macOS Keychain 或目前 Windows 使用者的 DPAPI，不進 Pages、renderer、GitHub、日誌或回覆。
