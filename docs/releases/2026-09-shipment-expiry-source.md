# 0.1.74 貨件效期來源交付帳本

Issue #278，完整目標 #263 保持開啟；[功能規格](../specs/2026-09-shipment-expiry-source.md)。

## 已取得的 .73 實機證據

- .73 已恢復原生啟動與 Amazon 連線；首頁人工公告 4 項、圖片健檢門檻 8。
- 第一次且唯一同步：2026-09-13 21:22:26 Asia/Taipei，284 個全 FBA 核心品號、33 個銷售偏慢／待核對、284 批次未知、0 已確認風險。某計畫商品首頁 HTTP 400／BadRequest／other-input／body parsed，不能推定 legacy、登入或全輪第一個計畫。
- 重新讀取本機保留同次快照與核心估算；八個表格欄位分開、未知批次不進行事曆。沒有 retry／Amazon mutation。
- 最新實機紀錄：`/tmp/amz-api-v0173-r2-verified/native-acceptance-resumed-20260913.json`。先前 Mac／Keychain 啟動阻礙已解除；員工下載頁仍顯示登入過期，已留一次登入請求，實際 .73 新下載 bytes 尚未核對。不上傳重複產物。

## .74 程式與驗證

- 增加固定 shipment-items GET 與同 plan 批次跨貨件聚合；main-only schema 2 checkpoint 保存來源、游標與不可讀計畫。
- 個別已驗證來源的 HTTP 400／404／422 明確保留為 incomplete，其他可讀來源繼續；auth／context／abort／限流／network／成功資料格式錯誤仍停止。
- sourceComplete 與遍歷終態分开；終態 partial 保存已讀資料並停止，不由 GET 或本機重讀觸發另一輪。
- transport 新測試先 RED（固定路徑缺少 shipments/items），修正後 17 個 production adapter tests 通過：`/tmp/amz-shipment-expiry-transport-red.log`、`/tmp/amz-shipment-expiry-transport-green.log`。
- sync 的不可讀來源數測試先 RED（終態沒有說明來源數），修正後通過。
- Standards 審查發現跨切片遷移會遺失尚未重新讀到來源的確認餘量；4 個 RED 修正後 13 個整合測試通過，覆蓋 60 計畫／182 請求、重開、來源淘汰及庫存／日期／銷速失效。
- Spec 審查發現部分清單／checkpoint 時間沒有嚴格驗證；7 個 RED 修正後相關 131 個測試通過。schema 1 保留舊格式驗證後重掃，schema 2 所有入口均要求 RFC3339。
- 兩軸獨立複查均為 0 個未解發現。最終 `npm run check` 通過 325 files／4,029 tests、typecheck、build 及原 stylesheet fingerprint；`npm audit --omit=dev` 為 0。日誌：`/tmp/amz-shipment-expiry-final-check.log`、`/tmp/amz-shipment-expiry-final-audit.log`。

## 發布與驗收界線

目前只有工作分支實作；尚未宣稱 .74 CI、Pages、兩平台 artifact、安裝或實際貨件效期成功。後續必須核對同一 final source 的全部流程，再更新下載卡與實際 bytes、正常備份安裝、完成一次可信原生同步。保留全部先前圖片、Vine、偏好、價目表、變體與表格的驗收；不為程式驗收自行送 Amazon mutation。
