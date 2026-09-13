# macOS 建置測試穩定性

Issue [#268](https://github.com/jspusa/AMZ.API/issues/268)，接續 0.1.71 入庫效期診斷交付；base `2147d35243f109c99d5da2d745523feda28e9ec7`。本次只改善測試執行，不增加 Notebook Key 版本。

## 已觀察的問題

同一來源的 Mac CI `34748504816` 首次與唯一重跑都在兩個既有案例超過 5 秒：首頁工作區完整導覽，以及 Orders 私有 import 邊界。兩次其他 320 個測試檔均通過。兩個案例本機單獨執行分別約 283 ms／489 ms 通過，沒有功能斷言失敗；原 CI 資源競爭原因尚未量測。

## 契約

- 先量測實際測試階段與重複工作，再移除可證明多餘的測試成本，或依獨立使用情境整理測試。保留原本的全部行為與架構斷言。
- 首頁保留圖片預設 8 與選值不發請求、同頁捷徑、七項健檢的非 modal 工作區／焦點／捲動恢復、忙碌返回鎖定、真實 lazy 工作區、價目表同一 instance 保留及品牌返回。
- 架構檢查仍掃描原本全部 source，保留傳遞 import 與私有 Orders 型別／production 邊界；不得只取樣、略過 TSX 或接受 stale source 解析。
- 不延長 test timeout、不跳過／重試案例、不減少斷言、不改 production、憑證／Amazon／批准政策或版本。暫時量測輸出須移除。
- 聚焦測試、完整 `npm run check`、production audit、兩軸 review 與新的 exact source Mac CI 都須通過。新來源的 Pages、兩平台 artifact 與後續交付須重新核對，不能沿用舊 source 的成功證據。

本次不宣稱修復真實入庫效期原因；原生 .71 診斷與原始完整功能驗收持續進行。
