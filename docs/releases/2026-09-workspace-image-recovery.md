# 0.1.80 全頁工具與圖片進度回查

Issue [#305](https://github.com/jspusa/AMZ.API/issues/305)；[需求規格](../specs/2026-09-workspace-image-recovery.md)。

Base `68e8db8b26e12cadb7a23e986a4f3bdad18a9a69`；獨立工作副本 `codex/workspace-image-recovery-20260916`，原 checkout 的未追蹤檔保持原樣。

## 診斷

- 使用者報告 Amazon 圖片已更新，但批次畫面仍為已接受、回查確認 0。此為使用者 storefront 觀察，不能替代 canonical 回查。
- 最小 main-owner 測試先重現：初次 bounded observer 結束後才讓 canonical 圖片同步，再按手動進度 GET，原實作仍只投影舊 accepted 狀態。修正以顯式 GET refresh 啟動新一輪唯讀回查，普通輪詢不新增 upstream 工作。
- 原生 .79 已重現價目表 generic workspace 錯誤；關閉返回首頁後再次從價格區開啟仍相同。未重新載入或退出 App，也未操作 Amazon 寫入。
- .79 與後續下載入口 UI 兩份舊 price-list lazy chunk 的公開 URL 均已 404；目前 Pages chunk 可用。實際 Dashboard 入口以缺少延遲 chunk 重現相同訊息，而 real panel mount 正常；改為 eager import 後同一回歸通過。原生 packaged App 不提供 DevTools，未取得該舊程序的 exception，因此不把 fixture 根因當成確定的原生 exception。
- 已僅按使用者提供的 SKU 範圍唯讀確認十個最新 durable image entries 都仍存在；未輸出帳號、指紋、原始收據或憑證。換版及回查證據另行記錄。

## 驗證紀錄

- WIP 獨立安全審查發現進行中 observer 斷線後 manual GET 會被停用；已修正並補新舊 Bridge 的重接測試，相關三檔 65 tests 通過。此限定 review 不替代最終兩軸 review。
- 本機 production fixture 已用真實選單核對圖片、價目表、AWD 與文件庫完整頁面；圖片恢復表含已確認／待同步與回查時間。390 px document 無水平溢位，進度表在自身容器捲動；深色大字價目表正常。均為 synthetic UI，不代表 Amazon 回查成功。
- 第一輪 full check 4,319 tests 通過、3 個既有 CSS fingerprint 基準因刻意樣式修改而待同步；未降低斷言或變更 renderer trust boundary。最終結果另記。

## 交付狀態

| 層級 | 狀態 | 界線 |
|---|---|---|
| 實作與定點回歸 | ☆ 進行中 | main 回查／恢復、全頁導覽及價目表入口 |
| 全檢查與兩軸 review | ☆ 待完成 | 不沿用 .79 成功證據 |
| Exact-source CI／Pages／兩平台產物 | ☆ 待完成 | 固定最終 main SHA 後核對 |
| 受保護下載與安裝 | ☆ 待完成 | 新專用下載網址；保留 vault／帳本／舊 App |
| 原生 UI／既有圖片 GET 回查 | ☆ 待完成 | 不送新的 Amazon mutation |
