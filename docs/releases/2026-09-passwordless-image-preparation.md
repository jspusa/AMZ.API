# 0.1.70 圖片準備免登入交付帳本

Issue #265；規格見 [圖片準備免登入](../specs/2026-09-passwordless-image-preparation.md)。

- Source base: `54a6bb6b97f0c887ca0330ae64a96c99bb0e6984`（0.1.69 健康核心修正已合併）。
- 目前安裝仍為可信 0.1.68；0.1.69 Mac CI 首次因既有 dashboard test 5 秒 timeout 失敗，定點一次通過，未重跑、未安裝。Windows 0.1.69 artifact 與 Pages 已驗，不能當本版證據。
- 本版 LocalImageUpload 公開重現先因 vault lookup 失敗，再移除 production 準備阶段 lookup；ApiRouter 證明正常 ready 與 context 失效拒絕，零批准及零 Amazon 呼叫。
- 本機全檢、兩軸 review、Site exact source/deployment、兩平台 exact CI/artifact、Pages、安裝、原生準備與效期同步、員工實際下載各層待驗，完成後以本輪實際證據更新。
- 原生圖片登入 sheet 已取消，原本圖片檔案保留；未送 Amazon Preview/PATCH。上傳準備不需要登入的改動仍須新服務及 Notebook Key 同時交付後才可實機驗收。
- 原始目標全部保留：自動入庫申報效期與全 FBA 銷速、人工即期品/促銷、僅已確認正缺口行事曆、兩種價目表、外觀保存、變體工作區、圖片排序/門檻/最終批准、進行中 Vine。已驗兩份 XLSX、偏好、Vine、門檻和變體導覽不因本輪重置。
