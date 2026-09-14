import type { InventoryExpirySourceDiagnostics } from "../../../shared/inventory-health";

const unknownLabels = {
  "not-recorded": "這次同步尚未保存可核對的來源摘要。",
  "legacy-checkpoint": "舊版同步紀錄沒有可核對的來源摘要。",
  "stale-checkpoint": "同步紀錄的時間無法核對，來源摘要暫不顯示。",
  "context-mismatch": "同步紀錄與目前帳號環境不符，來源摘要暫不顯示。",
  "invalid-checkpoint": "同步紀錄格式無法核對，來源摘要暫不顯示。",
} as const;
const operationLabels = { plan: "計畫資料", "shipment-items": "貨件商品", "plan-items": "計畫商品" } as const;
const reasonLabels = {
  "legacy-v0-plan-unsupported": "回應提及舊版計畫限制",
  "inbound-plan-id-malformed": "回應指出計畫編號格式不符",
  "inbound-plan-unavailable": "回應指出計畫不可用",
  "invalid-status": "回應指出狀態不符",
  "other-input": "其他請求驗證問題",
  unknown: "原因未記錄",
} as const;

const codeLabels = { BadRequest: "BadRequest", InvalidInput: "InvalidInput", unknown: "無法辨識", "not-recorded": "未記錄" } as const;
const responseLabels = {
  parsed: "已讀取", empty: "空白", malformed: "格式無法辨識", oversize: "超過讀取上限",
  "timed-out": "讀取逾時", unavailable: "無法讀取", "not-read": "未讀取", "not-recorded": "未記錄",
} as const;

export default function InventoryExpirySourceSummary({ diagnostic }: { diagnostic?: InventoryExpirySourceDiagnostics }) {
  return <details className="inventory-health-method">
    <summary>來源讀取摘要</summary>
    {!diagnostic ? <p>目前 Notebook Key 未提供來源摘要；更新後可讀取已保存的同步紀錄。</p>
      : diagnostic.status === "unknown" ? <p>{unknownLabels[diagnostic.reason]}</p>
        : <>
          <p><time dateTime={diagnostic.recordedAt}>同步開始：{new Date(diagnostic.recordedAt).toLocaleString("zh-TW")}</time></p>
          {diagnostic.stale && <p>舊同步紀錄，只供查核當時的讀取結果，不代表目前來源可用。</p>}
          <p>{`本輪已列出 ${diagnostic.listedPlanCount} 個計畫；本輪已讀完 ${diagnostic.cachedPlanCount} 個；無法讀取 ${diagnostic.unavailablePlanCount} 個；待讀取 ${diagnostic.pendingPlanCount} 個。`}</p>
          {(diagnostic.planItemFallbackCount ?? 0) > 0 && <p>{`其中 ${diagnostic.planItemFallbackCount} 個計畫已讀取計畫申報商品；尚未核對其貨件明細。`}</p>}
          <p>{diagnostic.traversal === "complete" ? "此輪來源讀取已結束。" : "此輪來源尚未讀完，已列出數不代表全部計畫。"}已讀完的計畫仍可能沒有回傳效期，申報數量也不是現存批次餘量。</p>
          {([400, 404, 422] as const).filter(status => diagnostic.statusCounts[String(status) as "400" | "404" | "422"] > 0)
            .map(status => <p key={status}>{`HTTP ${status}：${diagnostic.statusCounts[String(status) as "400" | "404" | "422"]} 個計畫`}</p>)}
          {diagnostic.failures.map((failure, index) => <p key={index}>
            {`${failure.operation === "unknown" ? "舊版紀錄未保存失敗步驟" : `${operationLabels[failure.operation]} · ${failure.page === "first" ? "首頁" : failure.page === "next" ? "後續頁" : "頁次未記錄"}`} · HTTP ${failure.status} · ${failure.reason === "unknown" && failure.responseState !== "not-recorded" ? "原因尚無法辨識" : reasonLabels[failure.reason]}：${failure.count} 個計畫`}
            <br />{`Amazon 分類：${codeLabels[failure.code]} · 回應：${responseLabels[failure.responseState]}`}
          </p>)}
        </>}
  </details>;
}
