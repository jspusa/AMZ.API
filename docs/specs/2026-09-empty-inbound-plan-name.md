# 空白入庫計畫名稱的效期讀取相容性

接續 Issue #263，版本 0.1.72。Base 為已交付的 `26f2f693299721e3e759467a58b680e9c7bca04f`，分支 `codex/inbound-empty-plan-name-20260913` 另保留 .71 交付文件。

## 已確認的問題

可信 .71 已安裝，原生首頁 Amazon 已連線。一次實際同步已取得 284 個 FBA 核心品號，效期來源回傳固定診斷「Amazon 入庫計畫名稱格式無法辨識，已停止效期讀取。（空字串）」。來源仍 partial；32 個銷售偏慢或待核對、284 批次待確認、0 已確認清售風險。同步是在使用者同時操作期間出現，agent 僅觀察 running 到終態，未再點同步或重試。

這次已由原生安全診斷確認 `name === ""`，不再只是合成假設。Amazon [固定版本官方模型](https://github.com/amzn/selling-partner-api-models/blob/3659f96867bfc669aca7a524c2f95744ff0e4478/models/fulfillment-inbound-api-model/fulfillmentInbound_2024-03-20.json) 的 InboundPlanSummary.name 是無 minLength 的字串。顯示名称空白不應阻止按原始計畫 ID 讀取商品效期。

## 變更契約

- 只有計畫名稱的精確空字串使用既有「未提供名稱」表示，source label 使用既有「入庫計畫 · 原 ID」。名稱不作身分，原 ID、scope、來源版本、商品與效期證據維持不變。
- 不引入 null checkpoint schema，不 trim／alias 識別碼或名稱。名稱 null、非文字、只含空白、首尾空白、控制字元及超過既有上限仍拒絕。
- 必須繼續讀取該計畫的商品與所有分頁；不能略過空名稱計畫、補空商品清單或把缺效期補成日期。
- 保留 checkpoint schema 1、bounded continuation、cache、取消、context fence、來源完整度與保密邊界。入庫申報數量仍不是現存批次餘量；未知餘量不加入行事曆。
- 本輪不修改圖片準備、最終指紋批准、SKU 確認、人工公告、價格表、Vine、偏好與變體工作區。

## 驗收

1. 真實 reader → coordinator → sync seam 的合成空名稱計畫先紅：應讀回商品日期並完成同步，保持核心估算、來源完整和未知餘量不進行事曆。
2. 缺名稱與正常名稱維持既有結果；空名稱 checkpoint 可 round trip／續讀及重用，拒絕範圍與 fixed diagnostics 不退化。
3. 完成聚焦測試、`npm run check`、`npm audit --omit=dev`、`git diff --check`、两軸 review，再核對 exact source CI、Pages、兩平台 artifact、下載頁與實際安裝。
4. 新版原生同步要讀到實際可取得的申報效期；若顯示另一項具體錯誤，保留 partial 繼續診斷，不以單一解析修正宣布完整目標完成。
