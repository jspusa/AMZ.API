# 0.1.76 計畫申報效期備援交付紀錄

2026-09-14；Issue #285，接續完整 #263。需求與來源界線見 [規格](../specs/2026-09-plan-declared-expiry-fallback.md)。開工 main `633be5e64c616c560a06d68c85aae6a77585a23d`。

## 行為與證據

.75 的 36 個 metadata 拒絕沒有觸及各計畫獨立的商品端點。本次只在精確 HTTP 400／BadRequest／parsed／other-input metadata 拒絕時讀同一計畫的申報商品；fresh list revision 相同的已保存拒絕直接讀商品，不重送已知失敗的 metadata。逐頁驗證、來源隔離與 context 邊界保持不變；商品來源完整與貨件明細未核對分開顯示，申報數量不能當作現存批次餘量。

| 層次 | 本輪狀態 |
|---|---|
| ★ 聚焦 RED → GREEN | 修改前 36 個 metadata 失敗導致 0 次商品讀取；修改後合成情境可取得 36 筆日期。新增 reader 42、DTO／renderer 23、coordinator 保存／重開 4 項測試通過。 |
| ★ 完整 check | `VITEST_MAX_WORKERS=4 npm run check` 通過：329 files／4,175 tests、typecheck、build 與 stylesheet verification。初次兩個舊版號 assertion 已更新；第二次既有批次保存測試逾時，單獨 9 項及降低並行度的完整檢查皆通過，未放寬測試或改動該功能。 |
| ★ 安全檢查 | `npm audit --omit=dev`：0 vulnerabilities。 |
| ★ 兩軸審查／PR／CI | 待 final candidate 與 exact source；未以舊版結果代替。 |
| ★ 產物／Pages／下載卡 | .76 待製作與核對；外部 helper 僅完成準備，148 合成案例不是交付證據。 |
| ★ 實機與 Amazon | 實際安裝仍 .75。首次且唯一 .75 同步的 36 個 metadata 拒絕已保存；本輪未重跑 .75，也未執行 Amazon mutation。.76 尚未安裝或實測，商品來源在本帳號是否可讀仍未知。 |
| ★ 完整 #263 | 未完成；需實際日期／來源／多日期／重開保存，以及最新版員工登入後下載 bytes 驗證。 |

## 下一步

同一 candidate 完成 check 與兩軸審查後才發行；各平台 artifact、Pages、安裝與員工實際下載分開核對。安裝前正常退出並保留 .75 App 與 userData。原生先讀本機保存摘要，再進行一次 .76 新能力驗收；不可將合成日期或未送出的請求稱為 live 成功。既有圖片、Vine、價目表、外觀與人工公告驗收保持原證據，不重做已完成工作。
