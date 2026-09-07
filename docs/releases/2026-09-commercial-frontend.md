# 2026-09-07 商用介面改版

使用者指出上一輪首頁仍缺少美感與人性化，並明確允許改變色系和加入流暢動畫；初版森林綠色系上線後，使用者要求改為配合既有 App Icon。本輪基準為 `e577d337028c0f799559a3d35e59111d1c8ae7b8`，屬於 Control Console Release；Notebook Key 版本與安全能力未變。

## 實際改動

- Icon 深藍漸層導覽列、霧白畫布與白色資料面板；使用現有本機字體，不新增字體外連或 UI 套件。品牌標誌改為與 App Icon 一致的深藍底、白色 J 與紅色箭頭。
- 可見的「營運工作台」標題、目前站點和工作區名稱；頁內「營運概況／公告日曆／商品健檢」提供可聚焦的定位入口。
- 主功能群、SKU／站點操作列分層；統一線條圖示，進入健檢時標示所屬功能群。窄視窗操作列改為可收縮欄位；月曆保留自己的水平捲動。
- 銷售總額放大，訂單、件數與去年同期分組；品牌／品類保留全部真實分類和既有固定色。讀取中、錯誤、零營收與資料範圍不以假數據美化。
- 將一鍵全部和個別七項健檢放在同一區；每張卡使用一致的圖示、狀態和底部操作，尚未執行明確標示。綠色自動、淡藍一鍵、黃色人工的語意繼續保留。
- 公告、即期品、日程、表單與同步資訊增加字級與層級；不改 Supply Boss schema、revision、資料來源或發布授權。
- 短入場／下拉動畫、hover／pressed 回饋；輪詢更新不重播整頁，`prefers-reduced-motion` 關閉新增動畫、位移和強制平滑捲動。

## 保留的操作契約

七項健檢順序、各自 main-owned job／cache、背景接回、失敗與不完整狀態、單層 workspace、返回焦點／位置、忙碌寫入限制保持。頁內連結與 skip link 必須 `preventDefault()`，只捲動並聚焦，不能寫入 URL hash；main 對 exact trusted document 的檢查保持不變。

Standards 與 Spec 由未參與實作的 reviewer 分別審查。兩者均抓到區段 anchor 可能改變 hash、導致 Bridge 被拒的 P1；已修正，新增事件測試覆蓋四個導覽入口、零額外 API、焦點與網址不變。確認修正後無未解 blocker。

## 驗證與界線

- 本機 `npm run check`：266 個測試檔、2,714 項測試通過，TypeScript、正式 build 及來源／打包 CSS 一致性檢查通過。`npm audit --omit=dev`：0 個漏洞。
- 正式 CSS composition 增加四個明確的主題檔案，保留來源順序與 build rule-stream fingerprint 檢查，未放寬驗證器。
- 已新增首頁狀態、頁內導覽、七個 workspace 返回、功能群定位、窄幅 CSS 與 reduced-motion 回歸檢查。
- 此輪沒有 browser／真實 Notebook Key 像素或動畫流暢度實測。程式、CSS、DOM 與互動測試不能代替使用者裝置上的視覺驗收；先前預覽 URL 被環境政策拒絕，未另找途徑繞過。
- 沒有執行真實 Amazon mutation、安裝桌面程式、變更受保護下載卡或啟用正式自動更新。

Actions 的實際發布狀態以 GitHub 對本輪合併 source 的紀錄為準；本文件不預先宣稱 Pages、簽章、artifact 或裝置驗收成功。
