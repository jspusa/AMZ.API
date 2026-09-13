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

PR #279 已合併，正式 runtime source 為 `8352a502aefe8eae61912c26496cd749490bcdc5`；review candidate `adcf94d126e2f2ef40f00e7c71f61724adec4eb2` 與正式 source 的 code tree 相同。所有正式流程 attempt 1 成功；來源／設定與 proof hash 綁定已由獨立 agent 唯讀核對，沒有發現不一致。

| 層級 | 正式證據 |
|---|---|
| ★ Validate | `34762096562` |
| ★ macOS | run `34762096626`、artifact `10318953145`；DMG／ZIP、universal、deep strict ad-hoc signature、ASAR／fuses 相符 |
| ★ Windows | run `34762096685`、artifact `10318778652`；PE AMD64、ASAR、unpacked Hello addon、manifest／fuses 相符 |
| ★ Pages | run `34762096547`、artifact `10319476635`；HTML 加 11 個 assets 的實際 bytes 相符 |
| ★ Mac 安裝 | `/Applications/AMZ.API.app` 為 .74；ASAR `a193a6ea9a90696f511159d2b4466e25b8e9d956a3cf1f757dfdf6379ba0785a`；vault／ledger 未變、.73 App 與 0700 userData 備份保留 |
| ★ 下載卡上傳 | Mac→Windows 依序完成；兩個 completion manifest 與可信 payload 的版本／size／hash 均相符 |
| ☆ 原生首次效期同步 | 尚未執行。程式 PID 存在，但 CUA exact-path 啟動／AX 持續逾時；已询問目前畫面，不推定 Mac 鎖定、Keychain 或登入原因 |
| ☆ 員工實際下載 | 頁面仍顯示登入過期；先前登入請求待回覆，不以卡片／upload receipt 當成實際 bytes |

| 對外安裝檔 | Bytes | SHA-256 |
|---|---:|---|
| ★ Mac DMG | 246,880,788 | `f494d6555384a170c6c7487d1af7bb595ea6b37444d0a03477f67fb4f3679866` |
| ★ Windows EXE | 102,061,191 | `532bad1d744014bee248fc8eb3fe94f803797b9420d83fd68122e3786d07a3f5` |

全部本機證據在 `/tmp/amz-api-v0174-verified/`：`release-config.json`、`source-main-verification.json`、各平台 CI／artifact／fuses、`installation-verification.json`、兩個 `portal-upload-*-receipt.json` 及 `pages/pages-byte-verification.json`。不要覆寫設定、重複下載／上傳、重裝或重做備份。下一步先恢復可信原生畫面，確認 .74／Amazon 連線後只做一次新的全 FBA 效期同步；依結果核對來源、多效期、保存與人工公告。員工登入後先記錄新時間，再見證兩個下載事件並驗證實際檔案。

保留全部先前圖片、Vine、偏好、價目表、變體與表格的驗收；不為程式驗收自行送 Amazon mutation。此次發布與安裝不等於完整效期來源、實際 Touch ID 或 Windows Hello 硬體成功，完整目標 #263 繼續。
