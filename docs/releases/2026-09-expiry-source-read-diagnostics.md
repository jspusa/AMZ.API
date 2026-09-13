# 效期來源讀取診斷交付紀錄

Issue #281；[規格](../specs/2026-09-expiry-source-read-diagnostics.md)。開始來源為 `20580a9615b01166950db46abbe617df67d99bee`。2026-09-14 最新狀態：PR #282 已合併，0.1.75 runtime source 為 `3a40cc0309d89abed80b25df40ca2c8e29188708`；實際安裝仍為 0.1.74／runtime `8352a502aefe8eae61912c26496cd749490bcdc5`。以下交付表優先於後方歷史階段中的「尚待」記錄。

## 最終來源與分層交付

| 證據層 | 2026-09-14 已核對結果 |
|---|---|
| ★ 已驗：本機檢查與審查 | Final candidate `39a21ecec0cf6aabadb091a866c1e90fa62c7992`：326 files／4,106 tests、typecheck、build、stylesheet composition、diff check 通過，production audit 0；Standards／Spec 各 0 findings，原兩項 P2 已閉合。 |
| ★ 已驗：runtime source | PR #282 合併至 `3a40cc0309d89abed80b25df40ca2c8e29188708`；candidate 與合併來源的完整 tree 相同。source/config proof 綁定 .75、該 main SHA 與 `updateChannel=disabled`。 |
| ★ 已驗：exact main CI | [Validate 34768163236](https://github.com/jspusa/AMZ.API/actions/runs/34768163236)、[macOS 34768163156](https://github.com/jspusa/AMZ.API/actions/runs/34768163156)、[Windows 34768163182](https://github.com/jspusa/AMZ.API/actions/runs/34768163182)、[Pages 34768163171](https://github.com/jspusa/AMZ.API/actions/runs/34768163171) 均為上述 main SHA 的 push、attempt 1、success。 |
| ★ 已驗：Pages bytes | Artifact `10320104343` 的 HTML 與 11 個 JS／CSS 共 12 檔，全部與線上 bytes／SHA-256 相同；包含 health、price-list、variation lazy modules。 |
| ★ 已驗：兩平台產物 | Mac artifact `10320149340`、Windows artifact `10321345868` 的壓縮包、manifest 與下表檔案 bytes／hash 已核對。Mac ZIP App 是 x86_64＋arm64 universal、ad-hoc deep-strict codesign 有效，兩個 slice 的 fuses 已驗；Windows x64 EXE、Hello addon、packed native manifest／unpacked addon、ASAR 與 fuses 已靜態核對。 |
| ★ 已驗：Mac server receipt | `macos-dmg`／.75／246,882,328 bytes／下表 DMG hash，`completionManifestValidated=true`。這只證明伺服器上傳完成回執。 |
| ★ 已驗：Windows server receipt | 依 Mac→Windows 順序各完成一次上傳；`windows-installer`／.75／102,065,166 bytes／下表 Setup.exe hash，`completionManifestValidated=true`。同樣只證明伺服器上傳完成回執。 |
| ☆ 待完成：安裝與原生 | 實際 Mac 仍 .74。目前 CUA 回報 Mac 鎖定、自動解鎖失敗；已提出一次新的解鎖請求，待使用者處理。.75 尚未安裝、啟動或執行原生 GET／同步。 |
| ☆ 待完成：員工下載 | 受保護下載頁的精確登入需求仍 pending；登入後實際下載事件與保存檔案 bytes／hash 未驗。Mac 解鎖與員工下載頁登入是兩個獨立步驟。 |

| 可信檔案 | Bytes | SHA-256 |
|---|---:|---|
| ★ `AMZ.API-0.1.75-universal.dmg` | 246882328 | `1ee8f38bcf26dbfdc2ab3cd5a8e76019eddf1b0ab708c14432ac7d7ed983c0d7` |
| ★ `AMZ.API-0.1.75-universal.zip` | 222193456 | `9e22110e4a17691b70ffa916625c88526c4d36cee1376aac730d2b38ac5c26e3` |
| ★ `AMZ.API-Notebook-Key-Windows-x64.zip` | 143379462 | `71fdebbea5755ba7c573d77d2bcefb5dd83fc7b617bb7d0a2da9c713c7777694` |
| ★ `AMZ.API-Notebook-Key-Windows-x64-Setup.exe` | 102065166 | `64266b899bd8a0e31d5aa19465bcb2ca6b2d0508e086b0a4161cd188885e115c` |

Mac ZIP ASAR SHA-256：`019c403eb33ed1f2bed2cf07f6d6d3b0e330699fedfa5d6f72394494394e02e9`；Windows ASAR：`e93cc935f9a77a73d5d6d74327456b0ee211342cd0ec0156a6b62d13616b7418`。Mac 證據目前只到 ZIP 內 App，尚未掛載 DMG 或核對安裝後 App；Windows 只做靜態檢查，沒有執行 EXE。這些證據不代表 Developer ID／公證、Authenticode／SmartScreen、真實 Touch ID／Windows Hello 或 live Amazon 驗收。

本輪 filtered evidence 都在 `/tmp/amz-api-v0175-verified/`：`final-complete-candidate-reviews.json`、`source-main-verification.json`、`observed-main-ci.json`、`pages/pages-byte-verification.json`、`macos/verification.json`、`macos/zip-bundle-verification.json`、`macos/zip-bundle-fuses-verification.json`、`windows/verification-result.json`、`windows/fuses-verification.json`、`portal-upload-macos-dmg-receipt.json` 與 `portal-upload-windows-installer-receipt.json`。Final source proof SHA-256 為 `075a3d86333c83c584a56910390421fd17bfb19204832384463e4ef8e51ddd19`，release configuration SHA-256 為 `cf84d62bd93f170ed66eecbf61972377611a06de374ad88a6235a0777d893f58`。`active-release.json` 已整理為 final candidate、4,106 tests、兩軸 0 findings、四條 CI、三個 artifact 與兩份 upload receipt 的一致狀態，供接回待辦；各項結論仍由上述對應 verification 支持。

## 待接續與來源界線

1. 待使用者解鎖後，由既有安全流程正常退出 .74、保存備份並安裝可信 .75，核對安裝 ASAR 與保留資料，再確認原生首頁。Runtime checkout 固定 `/Users/jasper/.codex/worktrees/amz-expiry-source-read-diagnostics-20260913/AMZ.API`，HEAD 為上述 .75 source 且 detached clean。
2. .75 安裝後先以既有本機 GET 讀 .74 保存的來源摘要，記錄歷史時間、遍歷狀態與可證明的計數。舊紀錄未保存的 operation／page／code／responseState 必須維持未記錄；不能由歷史 HTTP 合計推定目前根因，也不能讓本機 GET 隱含新的 Amazon 同步。
3. 員工完成受保護下載頁登入後，另驗兩平台實際下載 bytes／hash。完整 #263 仍未完成；.75 的原生摘要、未來首次明確同步、真正效期來源與多日期仍需各自實機證據。.74 同步維持首次且僅一次，先前已驗功能保留。本輪 CI、artifact、Pages bytes 與 server upload 已有完整證據，接續不重做。

本次文件交接在 `/Users/jasper/.codex/worktrees/amz-source-diagnostics-delivery-handoff-20260914/AMZ.API`／`codex/source-diagnostics-delivery-handoff-20260914`，從 .75 runtime source 建立，只改本帳本與 `docs/CODEX_HANDOFF.md`。後續 docs commit／HEAD 只代表交接文字，artifact、helper、安裝與 runtime 證據仍綁定 `3a40cc0309d89abed80b25df40ca2c8e29188708`。

## .74 最新實機證據

使用者解除原生啟動等待後，0.1.74 首頁與 Amazon 連線已確認。首次且唯一效期同步於 2026-09-13 23:12:14（Asia/Taipei）顯示終態 partial：284 個 FBA 品號、33 個銷售偏慢／待核對品號，36 個入庫計畫不可讀。這是不可讀數，不是所有計畫數，也不證明同一 operation 或 HTTP 狀態。

本機重新讀取保留相同時間、計數與 partial 狀態。人工公告 4 項、既有人工效期及促銷月曆保留，圖片門檻 8，八欄與捲動提示仍可見。未重送同步，沒有 native 最終寫入批准或 Amazon mutation。聚合證據：`/tmp/amz-api-v0174-verified/native-acceptance-resumed-20260913.json`。

當時員工下載頁仍顯示登入表單；已另行指出精確的下載頁登入需求，當時無須再要求 Mac 解鎖。0.1.74 的安裝、CI、Pages、兩平台可信產物及伺服器上傳已驗，員工實際下載 bytes 尚待。2026-09-14 新觀察到的 Mac 鎖定另列於上方交付表。原已驗圖片、Vine、偏好、價目表、變體及表格流程不重做。

## 歷史：本機初驗與 P2 修正

0.1.75 診斷補強已完成本機檢查：326 files／4,070 tests、typecheck、build、stylesheet composition 與 `git diff --check` 通過，production audit 0。最初完整檢查只在兩項仍固定 .74 的版本測試失敗，將預期版本明確更新為 .75 後重新通過，未放寬功能 assertion。stylesheet fingerprint 保持 `ff016e1e974b03b58bdf23378722b9416f78285c8052bf82581df8d686637926`。

Public seam 先重現診斷丟失，之後驗證 production adapter → reader → coordinator → 保存 → 重開／GET 的操作分類；30 項來源診斷測試包含舊 schema 2 的 36 筆歷史分類、超過 cursor 時限的純本機讀取、未知／型別／合計／context／sentinel 保護及零額外上游請求。Renderer 新增兩項先紅後綠，15 項流程測試通過；synthetic CUA 檢查預設收折、歷史／未記錄文案與 390px 無溢出，暫時 viewport／tab／server 已恢復或結束。八欄樣式沒有修改。

第一次獨立 Spec 審查找到兩項 P2：部分遍歷保留快取重複計入本輪完成，以及不存在的日期被正規化為有效時間。兩項已在 public GET 先重現，再修正投影與 DTO 一致性；120／150 個舊 cache、過期部分遍歷 tombstone、非法日期、合法閏日／offset 及微秒未來邊界皆已驗，底層快取／遍歷／request 未改。複查中既有 B2B recent-work 的 65 筆磁碟 fixture 曾超過 5 秒，原測試未改，單檔 9 tests 與第二次完整檢查通過。

本機證據：`/tmp/amz-expiry-source-diagnostics-revised-check-r2.log`、`/tmp/amz-expiry-source-diagnostics-recent-work-focused.log`、`/tmp/amz-expiry-source-diagnostics-audit.log`、`/tmp/inventory-expiry-source-summary-evidence/verification.json`。修訂後 exact candidate 複審及 CI／產物／安裝證據尚待。完整 #263 仍未完成；真正效期來源與多日期尚無實機驗收。

## 歷史：發布前完整分類補強

`1bdf738` 已完成兩軸 0 findings 與 PR Validate／Windows 檢查，但尚未合併。最後唯讀核對發現 adapter 已解析的固定 code／response state 仍會在來源保存時丟失，因此在同一未發布版本補齊，避免安裝後又只看到泛化原因。新增分類只依官方模型的 operation／400／BadRequest／完整精確訊息；其他 operation、狀態、代碼與近似文字保守不分類。這不是本帳號 live 原因的推論。

Renderer 保留分類與回應狀態，舊資料標示未記錄；public DTO 拒絕非法組合，聚合鍵分開保留不同固定維度。原 cursor、schema 2 歷史相容、嚴格日期、本輪互斥計數、128 KiB／2 秒錯誤讀取與 404 不讀 body 政策保持。Adapter 107 項聚焦驗證通過；renderer 16 項測試通過，390px 的摘要段落沒有溢出，viewport／暫時頁面與 server 已清理。最終來源保存檢查、完整 check、exact candidate 複審及 CI 需在補強完成後另行記錄。

新增本機證據：`/tmp/amz-expiry-source-diagnostics-body-renderer-red.log`、`/tmp/amz-expiry-source-diagnostics-body-renderer-green.log`、`/tmp/inventory-expiry-source-summary-complete-evidence/verification.json`。

補強後完整檢查已通過：326 files／4,106 tests、typecheck、build、stylesheet composition、diff check，production audit 0。來源摘要的 41 項測試包含 6,000 個來源／全部 200 種合法固定分類、旧三欄保存、未記錄與新回應狀態、嚴格日期及本輪互斥計數；相關 9 files／305 tests 另已通過。最終 check：`/tmp/amz-expiry-source-diagnostics-complete-check.log`；audit：`/tmp/amz-expiry-source-diagnostics-complete-audit.log`。補強後 final candidate 的兩軸複審與 CI 尚待，尚未合併／安裝 .75。
