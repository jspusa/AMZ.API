# 圖片準備免登入，僅最後更新 Amazon 使用指紋

Issue [#265](https://github.com/jspusa/AMZ.API/issues/265)，版本 0.1.70，base `54a6bb6b97f0c887ca0330ae64a96c99bb0e6984`，分支 `codex/passwordless-image-preparation-20260913`。

## 使用者修正與重現

使用者明確要求拖入、排序與上傳準備均不輸入密碼或要求生物辨識，只有最後真正確認更新 Amazon 才像文案一樣使用指紋，且不用重打 SKU。這取代 0.1.66 的首次密碼及後續生物辨識解鎖圖片登入設計。現場首次圖片登入 sheet 已取消，原檔保留，未進行圖片服務上傳、Amazon Preview 或 PATCH。

公開 LocalImageUpload seam 在圖片服務已提供時，仍先呼叫 getImageStorage；測試注入拒絕解密的 vault，修正前重現 preparation must not unlock credential storage，修正後正常返回 byte-verified readyForAmazon。原生登入 owner、專用憑證 owner 和 IPC 一併退休。

## 實作契約

- Production composition 直接建立無登入介面的 HostedListingImages，只有 prepare/clear。上傳準備沒有密碼、token、credential vault 或 native approval 能力；不讀既有 image credential 或 R2 設定。舊磁碟加密檔保留且不解密；無 hosted provider 的明確 composition 保留原自有 R2 port 相容性。
- main 只呼叫固定 Supply Boss `/api/listing-images/v2/{UUIDv4}` PUT/GET。PUT body 只有 JPEG/PNG 原檔 bytes，固定 MIME、確切 Content-Length 與非秘密 X-Content-SHA256；不含 SKU、帳號、Amazon 憑證、外部 URL 或任意 bucket。origin、redirect:error、credentials:omit、大小與 deadline 均固定。
- 新服務使用獨立 v2 namespace，公開圖片為 `/listing-images/v2/{UUID}/{sha}.{ext}`。既有 v1 圖片、下載頁、公布欄、admin 驗證與 Site audience 不改。無登入圖片入口不是員工身分證明。
- 伺服器以單一 R2 ETag CAS ledger 在收 body 前原子預留：lifetime 10 GiB / 10,000 次、UTC 每日全站 500 次、來源 IP 每日 200 / 每小時 50 次。IP 只保存 hash；缺失 IP、損壞或不確定 ledger 均拒絕。失敗預留不退款，已有 UUID 不再次收 body 或建立圖檔，明確 CAS 衝突或 429 只有限退避，未知寫入只查詢。有限新增儲存不等於所有 Worker/R2 請求成本上限，也不能避免匿名額度被耗盡。
- 圖片限 10 MiB、寬高 500–40,000 px、最多 100M pixels；新 v2 檢查 PNG 完整 chunk/CRC/IEND 或 JPEG marker/SOS/EOI 結構。這不等於完整解碼或內容審查。條件式建立不可覆蓋；圖檔完成才返回 receipt，只有預留時為 202 pending。
- main 保留 security generation 與 exact context fence。未知 PUT 回覆、pending 或 404 只能 GET 查詢，不隱含重新 PUT；只有明確拒絕且已確認無預留／圖檔，之後使用者重新準備才允許新 operation。receipt 的 UUID/hash/size/type/dimensions/URL 完整相符，再匿名 bounded GET 核對實際 bytes 才 ready。
- 最終 Amazon 提交沿用文案的共用 native approval 策略與既有圖片 Write Gate：exact FBA/SKU/ASIN/PTD、owner snapshot、fresh Validation Preview、原生摘要、durable claim、一次 PATCH、canonical readback。圖片最終頁不重打 SKU；取消批准零 PATCH。準備、排序、預檢不能触發批准。

## 驗收與交付

1. 真 LocalImageUpload 與 ApiRouter 公開 seam 證明無 vault 解密、無 approval、無 Amazon read/write 即可完成圖片準備；context 漂移不接受遲到結果。
2. 回覆遺失、202 pending、錯誤 bytes/receipt、超限、跨 context 與 lock 復原保持受限。既有 final confirmation/native gate 測試證明一次批准、取消零 PATCH、無 SKU 重打。
3. Server 測試涵蓋有限 quota、CAS 競態與不確定結果、同 UUID no replay、格式限制、公開 namespace 隔離及舊 auth 保留。部署後以真正 JPEG/PNG 原檔驗證 receipt 與匿名 readback bytes；不以樣本檔頭當完整 live 圖片證明。
4. npm run check、production audit、兩軸 pinned review、exact source CI/Pages/Mac/Windows artifacts、受保護下載卡、正常備份安裝與原生無 prep prompt 驗收分層記錄。不能由 CI 推定真人指紋、Windows Hello 或 Amazon mutation。
5. 0.1.69 的效期核心報表修正已合併，但因新需求未安裝；本版一起交付。保留完整原始需求及已完成驗收，不重新產生已驗 Excel；接續全 FBA 效期/銷速、人工公告保留與原始交付未完成部分。

配額一致性依據：[R2 conditional writes](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)、[R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/)、[same-key write limits](https://developers.cloudflare.com/r2/platform/limits/)。
