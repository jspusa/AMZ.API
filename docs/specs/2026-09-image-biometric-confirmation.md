# 圖片登入與送出操作簡化

2026-09-12。Issue [#254](https://github.com/jspusa/AMZ.API/issues/254)。接續 [圖片、效期與 Vine 修正](2026-09-direct-images-expiry-vine.md)；原有庫存健康、價目表、偏好、變體、Vine、圖片數量與完整交付驗收範圍全部保留。

## 使用者要求

圖片服務應像其他 Notebook Key 操作一樣使用指紋，不要每次輸入下載頁密碼。Amazon 圖片預檢通過後，移除「重新輸入完整 SKU」；直接看商品與變更內容，再以一次本機身分確認送出。

## 行為

- 圖片服務首次連接需要證明既有員工身分；本機視窗明示一次設定與保存用途，驗證密碼成功且本機身分確認通過後，才存入獨立的 OS 加密憑證檔。既有版本未保存的密碼或記憶體 session 不得從瀏覽器或程序記憶體匯出來假造遷移。
- 之後建立圖片 session 時使用 Touch ID／Windows Hello 授權，通過後才解密本機保存的登入資料並向固定圖片登入端點驗證。取消、驗證失敗、安全儲存不可用或環境失效，都不發圖片 PUT。沒有一般確認按鈕或明文 fallback。
- 仍使用最長八小時、僅 main 記憶體的 image audience session；鎖定、睡眠、退出或安全 context 變更會清除 session。鎖定不刪除 OS 加密的登入資料，重新授權後可重建 session。
- 網路暫時失敗不清除有效的保存資料，也不要求重新輸入密碼；只有明確登入憑證遭拒時，才提供重新連接。新密碼須驗證及本機授權後原子替換。資料損壞或安全儲存錯誤保持可診斷的失敗，不悄悄覆蓋。
- Amazon 預檢通過後的確認頁顯示 exact Seller SKU、ASIN 與變更位置，不出現 SKU 輸入欄，也不把自動填入值冒充使用者重打的確認。
- 圖片送出保留 main-owned fresh Preview、execution context、exact identity、FBA／seller PTD、native confirmation、durable idempotency、一次 PATCH 及 canonical readback。移除圖片專用的重打 SKU 要求；價格與促銷的其他要求不在本次修改範圍。
- 新 Pages 與較舊 Notebook Key 的能力差異須明確處理，不能讓使用者走到無法理解的送出錯誤。

## 驗收

| 範圍 | 完成證據 |
| --- | --- |
| ☆ 初次設定 | 正確密碼、原生授權、OS 加密保存；取消、失敗或 context 漂移不保存／上傳 |
| ☆ 後續登入 | 重新建立 owner／App 後不要求密碼；先原生授權，再解密及登入；拒絕時零登入與零 PUT |
| ☆ 錯誤恢復 | 網路失敗保留憑證，明確錯誤密碼可安全更新；損壞、不可用加密及鎖定競態 fail closed |
| ☆ 圖片送出 | 不用重打 SKU；exact 商品與位置可核對；原生取消、過期／錯誤 Preview、身分漂移仍零 PATCH |
| ☆ 回歸與交付 | 聚焦 public seam tests、全 repo check、production audit、兩軸 review、same-source CI／Pages／雙平台 artifact、Mac 安裝與實際原生驗收；不為驗收自行送 Amazon mutation |

★ 表示已有驗收證據，☆ 表示仍待完成；實際狀態依本輪發行帳本更新。
