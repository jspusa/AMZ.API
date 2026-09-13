# macOS 發行驗證排程

Issue #275；接續尚未交付的 0.1.73。基線為 PR #274／main `b64796da043592c6fd5b8d95930fcfbb6d29ae67`。

## 問題與證據

Mac run `34756689931` 的兩次執行都因既有測試 5 秒逾時失敗：第一次為 Orders 靜態 import 掃描，第二次改為健檢工作區互動與 subscription XLSX 金額測試。三個 test 檔自表格 main 至本次來源未改；相同來源的 Linux、Pages、Windows 通過。第一次案例定點執行 497 ms 通過。本機亦曾遇到不同既有測試等待失敗，限制四個 workers 後完整通過。

上述現象支持並行資源競爭的推論，但沒有失敗當時的效能量測，不能宣稱已證實根因。兩次失敗 log 保留於 `/tmp/amz-api-v0173-verified/main-macos-attempt{1,2}-failure.log`；不對同一失敗來源做第三次不變重跑。

## 最小變更

- 僅 `.github/workflows/mac-dev.yml` 的 Validate 步驟設 `VITEST_MAX_WORKERS: "1"`，原命令仍為 `npm run check`。
- 鎖定的 Vitest 4.0.18 支援此變數；逐檔執行，保留隔離、原測試及原時間限制。單一測試內的非同步行為不改。
- 保留工作上限 50 分鐘、其他平台、package／smoke／artifact gate、權限、版本 0.1.73 及全部 runtime bytes。

## 驗收

1. 以相同變數完成本機全部 check，核對完整測試數；執行 production audit 與 diff check。
2. 對固定 HEAD 做 Standards／Spec review，再核對 PR checks。
3. 合併後以新 final main 跑完整 Mac CI，核對完整測試總數與既有 skip，不能用定點通過替代。
4. 新來源取代 b647 的 .73 交付來源；四條 CI、Pages 及兩平台 artifact 均須對新來源核對。未被 paths 觸發的流程只 dispatch 一次，不混用舊來源產物。
5. Mac CI 成功前不安裝或宣稱診斷版已可交付。可信 .73 安裝後的一次實機診斷及完整效期目標仍由原規格追蹤。
