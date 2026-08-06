"use client";

import {
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  buildVariationMovePlan,
  parseVariationFamilyResponse,
  variationLookupKeyAction,
  variationFamilyErrorMessage,
  type VariationFamilyView,
  type VariationMemberView,
  type VariationMovePlan,
} from "../variation-planner";

type VariationPlannerDrawerProps = {
  initialMarketplaceId: string;
  initialSellerSku?: string;
  onContextResolved?: (marketplaceId: string, sellerSku: string) => void;
  onClose: () => void;
};

type ApiProblem = {
  code?: string;
  message?: string;
  requestId?: string | null;
};

const MARKETPLACES = [
  { id: "ATVPDKIKX0DER", label: "US · 美國站", sample: "AFA-TRKY-4OZ" },
  { id: "A1VC38T7YXB528", label: "JP · 日本站", sample: "AFA100-JP" },
  { id: "A2EUQ1WTGCTBG2", label: "CA · 加拿大站", sample: "Seller SKU" },
  { id: "A19VAU5U5O7RUS", label: "SG · 新加坡站", sample: "Seller SKU" },
  { id: "A39IBJ37TRP1C6", label: "AU · 澳洲站", sample: "Seller SKU" },
  { id: "A1F83G8C2ARO7P", label: "UK · 英國站", sample: "Seller SKU" },
  { id: "A1PA6795UKMFR9", label: "DE · 德國站", sample: "Seller SKU" },
];

function memberDimensions(member: VariationMemberView): string {
  const values = member.dimensions.flatMap((dimension) =>
    dimension.values.map((value) => `${dimension.label}: ${value}`),
  );
  return values.length ? values.join(" · ") : "Amazon 未回傳維度值";
}

function requestErrorMessage(
  status: number,
  problem: ApiProblem,
): string {
  const message = variationFamilyErrorMessage(status, problem);
  return `${message}${problem.requestId ? `（Request ID: ${problem.requestId}）` : ""}`;
}

export default function VariationPlannerDrawer({
  initialMarketplaceId,
  initialSellerSku = "",
  onContextResolved,
  onClose,
}: VariationPlannerDrawerProps) {
  const initialMarketplace = MARKETPLACES.some(
    (marketplace) => marketplace.id === initialMarketplaceId,
  )
    ? initialMarketplaceId
    : MARKETPLACES[0].id;
  const [marketplaceId, setMarketplaceId] = useState(initialMarketplace);
  const [sourceInput, setSourceInput] = useState(initialSellerSku);
  const [targetInput, setTargetInput] = useState("");
  const [sourceFamily, setSourceFamily] = useState<VariationFamilyView | null>(null);
  const [targetFamily, setTargetFamily] = useState<VariationFamilyView | null>(null);
  const [plan, setPlan] = useState<VariationMovePlan | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [targetLoading, setTargetLoading] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);
  const sourceAbortRef = useRef<AbortController | null>(null);
  const targetAbortRef = useRef<AbortController | null>(null);
  const autoLookupRef = useRef(false);
  const marketplace =
    MARKETPLACES.find((option) => option.id === marketplaceId) ?? MARKETPLACES[0];
  const busy = sourceLoading || targetLoading;

  const closeDrawer = useCallback(() => {
    sourceAbortRef.current?.abort();
    targetAbortRef.current?.abort();
    onClose();
  }, [onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) closeDrawer();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [busy, closeDrawer]);

  useEffect(() => () => {
    sourceAbortRef.current?.abort();
    targetAbortRef.current?.abort();
  }, []);

  const fetchFamily = useCallback(
    async (sellerSku: string, signal: AbortSignal) => {
      const params = new URLSearchParams({ marketplaceId, sku: sellerSku });
      const response = await fetch(`/api/sp-api/variation-family?${params}`, {
        cache: "no-store",
        signal,
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok) {
        throw new Error(
          requestErrorMessage(response.status, payload as ApiProblem),
        );
      }
      return parseVariationFamilyResponse(payload, { marketplaceId, sellerSku });
    },
    [marketplaceId],
  );

  const lookupSource = useCallback(
    async (sellerSku: string) => {
      const normalizedSku = sellerSku.trim();
      if (!normalizedSku) {
        setSourceError("請輸入完整 Seller SKU。");
        return;
      }
      sourceAbortRef.current?.abort();
      const controller = new AbortController();
      sourceAbortRef.current = controller;
      setSourceLoading(true);
      setSourceError(null);
      setSourceFamily(null);
      setPlan(null);
      try {
        const family = await fetchFamily(normalizedSku, controller.signal);
        if (sourceAbortRef.current !== controller) return;
        setSourceFamily(family);
        setSourceInput(family.queriedSku);
        onContextResolved?.(marketplaceId, family.queriedSku);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        if (sourceAbortRef.current === controller) {
          setSourceError(
            error instanceof Error ? error.message : "目前無法載入來源 family。",
          );
        }
      } finally {
        if (sourceAbortRef.current === controller) setSourceLoading(false);
      }
    },
    [fetchFamily, marketplaceId, onContextResolved],
  );

  const lookupTarget = useCallback(
    async (sellerSku: string) => {
      const normalizedSku = sellerSku.trim();
      if (!normalizedSku) {
        setTargetError("請輸入目標 parent 或其 child SKU。");
        return;
      }
      targetAbortRef.current?.abort();
      const controller = new AbortController();
      targetAbortRef.current = controller;
      setTargetLoading(true);
      setTargetError(null);
      setTargetFamily(null);
      setPlan(null);
      try {
        const family = await fetchFamily(normalizedSku, controller.signal);
        if (targetAbortRef.current !== controller) return;
        if (!family.parent && family.queriedRole !== "parent") {
          throw new Error("這個 SKU 沒有可確認的目標 parent 容器。");
        }
        setTargetFamily(family);
        setTargetInput(family.parent?.sellerSku ?? family.queriedSku);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        if (targetAbortRef.current === controller) {
          setTargetError(
            error instanceof Error ? error.message : "目前無法載入目標 family。",
          );
        }
      } finally {
        if (targetAbortRef.current === controller) setTargetLoading(false);
      }
    },
    [fetchFamily],
  );

  const runSourceLookup = useCallback(() => {
    void lookupSource(sourceInput);
  }, [lookupSource, sourceInput]);

  const runTargetLookup = useCallback(() => {
    void lookupTarget(targetInput);
  }, [lookupTarget, targetInput]);

  const handleSourceKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      const action = variationLookupKeyAction(
        event.key,
        event.nativeEvent.isComposing,
      );
      if (action === "ignore") return;
      event.preventDefault();
      if (action === "lookup") runSourceLookup();
    },
    [runSourceLookup],
  );

  const handleTargetKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      const action = variationLookupKeyAction(
        event.key,
        event.nativeEvent.isComposing,
      );
      if (action === "ignore") return;
      event.preventDefault();
      if (action === "lookup") runTargetLookup();
    },
    [runTargetLookup],
  );

  useEffect(() => {
    if (autoLookupRef.current || !initialSellerSku.trim()) return;
    autoLookupRef.current = true;
    void lookupSource(initialSellerSku);
  }, [initialSellerSku, lookupSource]);

  const changeMarketplace = (nextMarketplaceId: string) => {
    sourceAbortRef.current?.abort();
    targetAbortRef.current?.abort();
    setMarketplaceId(nextMarketplaceId);
    setSourceInput("");
    setTargetInput("");
    setSourceFamily(null);
    setTargetFamily(null);
    setPlan(null);
    setSourceError(null);
    setTargetError(null);
  };

  const sourceMembers = useMemo(() => {
    if (!sourceFamily) return [];
    if (sourceFamily.children.length) return sourceFamily.children;
    return sourceFamily.queried.role !== "parent" && sourceFamily.queried.fba
      ? [sourceFamily.queried]
      : [];
  }, [sourceFamily]);

  const planMember = (member: VariationMemberView) => {
    if (!sourceFamily || !targetFamily) return;
    setPlan(buildVariationMovePlan(sourceFamily, member, targetFamily));
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const sellerSku = event.dataTransfer.getData("text/plain");
    const member = sourceMembers.find((candidate) => candidate.sellerSku === sellerSku);
    if (member) planMember(member);
  };

  return (
    <div
      className="drawer-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) closeDrawer();
      }}
    >
      <aside
        className="order-drawer variation-planner-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="variation-planner-title"
      >
        <div className="drawer-header">
          <div>
            <p className="eyebrow">READ-ONLY VARIATION FAMILY</p>
            <h2 id="variation-planner-title">變體規劃</h2>
          </div>
          <button type="button" onClick={closeDrawer} disabled={busy} aria-label="關閉變體規劃">×</button>
        </div>

        <div className="variation-readonly-banner">
          <strong>唯讀規劃 · Amazon 不會收到變更</strong>
          <p>既有 child 改掛新 parent 必須先移除舊關係再重建，是非原子流程；v0.1.7 第一版不寫入。</p>
        </div>

        <label className="variation-marketplace">
          <span>Amazon 站點</span>
          <select value={marketplaceId} onChange={(event) => changeMarketplace(event.target.value)} disabled={busy}>
            {MARKETPLACES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>

        <div className="variation-planner-columns">
          <section className="variation-family-panel" aria-labelledby="variation-source-title">
            <div className="variation-section-heading"><span>01</span><div><strong id="variation-source-title">來源 family</strong><small>只顯示可確認的 FBA child</small></div></div>
            <div className="variation-search-row">
              <input value={sourceInput} onChange={(event) => setSourceInput(event.target.value)} onKeyDown={handleSourceKeyDown} placeholder={`例如 ${marketplace.sample}`} maxLength={40} autoComplete="off" spellCheck={false} disabled={busy} aria-label="來源 Seller SKU" />
              <button type="button" data-variation-lookup="source" onClick={runSourceLookup} disabled={busy || !sourceInput.trim()}>{sourceLoading ? "讀取中" : "讀取"}</button>
            </div>
            {sourceError && <div className="price-error" role="alert">{sourceError}</div>}
            {sourceLoading && <p className="variation-loading" role="status">正在唯讀整理 parent、children、theme 與維度…</p>}
            {sourceFamily && (
              <>
                <FamilySummary family={sourceFamily} />
                <div className="variation-child-list">
                  {sourceMembers.map((member) => (
                    <article
                      key={member.sellerSku}
                      className="variation-child-card"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "copy";
                        event.dataTransfer.setData("text/plain", member.sellerSku);
                      }}
                    >
                      <div><strong>{member.sellerSku}</strong><span>FBA child</span></div>
                      <p>{member.title}</p>
                      <small>{memberDimensions(member)}</small>
                      <button type="button" disabled={!targetFamily} onClick={() => planMember(member)}>加入唯讀規劃</button>
                    </article>
                  ))}
                  {!sourceMembers.length && <p className="variation-empty">這個 family 沒有可拖移的 FBA child。</p>}
                </div>
              </>
            )}
          </section>

          <section className="variation-family-panel target" aria-labelledby="variation-target-title">
            <div className="variation-section-heading"><span>02</span><div><strong id="variation-target-title">目標 parent</strong><small>可輸入 parent 或其中任一 child</small></div></div>
            <div className="variation-search-row">
              <input value={targetInput} onChange={(event) => setTargetInput(event.target.value)} onKeyDown={handleTargetKeyDown} placeholder="目標 parent SKU" maxLength={40} autoComplete="off" spellCheck={false} disabled={busy} aria-label="目標 Parent SKU" />
              <button type="button" data-variation-lookup="target" onClick={runTargetLookup} disabled={busy || !targetInput.trim()}>{targetLoading ? "讀取中" : "讀取"}</button>
            </div>
            {targetError && <div className="price-error" role="alert">{targetError}</div>}
            {targetLoading && <p className="variation-loading" role="status">正在唯讀確認目標 parent…</p>}
            <div
              className={`variation-drop-zone ${targetFamily ? "ready" : ""}`}
              onDragOver={(event) => { if (targetFamily) event.preventDefault(); }}
              onDrop={onDrop}
              aria-label="拖放 FBA child 到目標 parent 規劃區"
            >
              {targetFamily ? (
                <>
                  <span>唯讀目標</span>
                  <strong>{targetFamily.parent?.sellerSku ?? targetFamily.queried.sellerSku}</strong>
                  <p>{targetFamily.variationTheme ?? "Theme 未確認"} · {targetFamily.children.length} 個 FBA child</p>
                  <small>將左側 child 拖到這裡，或按「加入唯讀規劃」</small>
                </>
              ) : (
                <><span>先讀取目標 parent</span><p>這裡只產生記憶體中的規劃，不會送出 Amazon 請求。</p></>
              )}
            </div>
            {targetFamily && <FamilySummary family={targetFamily} compact />}
          </section>
        </div>

        {plan && <PlanReview plan={plan} onClear={() => setPlan(null)} />}

        <div className="variation-safety-boundary">
          <strong>能力邊界</strong>
          <p>Listings Items v2021-08-01 唯讀 · relationships／attributes／variationParentSku · FBA child only · Parent 僅限唯讀容器</p>
        </div>
        <div className="drawer-api-footnote">Read-only planner · No PUT · No PATCH · No DELETE · No FBM</div>
      </aside>
    </div>
  );
}

function FamilySummary({ family, compact = false }: { family: VariationFamilyView; compact?: boolean }) {
  const parentSku = family.parent?.sellerSku ?? (family.queried.role === "parent" ? family.queried.sellerSku : null);
  return (
    <div className={`variation-family-summary ${compact ? "compact" : ""}`}>
      <dl>
        <div><dt>Parent</dt><dd>{parentSku ?? "無 parent"}</dd></div>
        <div><dt>Theme</dt><dd>{family.variationTheme ?? "未確認"}</dd></div>
        <div><dt>Children</dt><dd>{family.children.length} FBA</dd></div>
      </dl>
      {!family.familyComplete && <p className="variation-warning">Family 清單不完整（分頁超限或 parent 宣告的 child 未全數回傳），請勿據此執行。</p>}
      {family.excludedChildren.map((item) => <p className="variation-warning" key={`${item.sellerSku}-${item.reason}`}>{item.sellerSku}：{item.reason}</p>)}
      <small>{family.notice}</small>
    </div>
  );
}

function PlanReview({ plan, onClear }: { plan: VariationMovePlan; onClear: () => void }) {
  return (
    <section className={`variation-plan-review ${plan.status}`} aria-labelledby="variation-plan-review-title">
      <div className="variation-plan-heading"><div><span>READ-ONLY PLAN</span><h3 id="variation-plan-review-title">{plan.source.sellerSku} → {plan.targetParent.sellerSku}</h3></div><button type="button" onClick={onClear}>清除規劃</button></div>
      {plan.blockers.length > 0 && <div className="variation-plan-blockers"><strong>目前不可安全規劃</strong><ul>{plan.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div>}
      <div className="variation-plan-warnings"><strong>必要警告</strong><ul>{plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>
      <div className="variation-plan-steps"><strong>未執行的流程草案</strong><ol>{plan.proposedSteps.map((step) => <li key={step}>{step}</li>)}</ol></div>
      <p className="variation-no-write">這不是送出按鈕；Amazon 目前完全沒有變更。</p>
    </section>
  );
}
