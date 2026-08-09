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
import {
  initialVariationDimensionValues,
  missingVariationFields,
  parseVariationJsonValues,
  parseVariationMovePreparation,
  parseVariationMovePreview,
  parseVariationMoveResult,
  updateVariationLeaf,
  type VariationFieldLeafView,
  type VariationFieldView,
  type VariationMoveAction,
  type VariationMovePreparation,
  type VariationMoveResult,
} from "../variation-move";

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

type StagedState = "planned" | "detached" | "attached";
type VariationIdentifierType = "sku" | "asin";

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

function requestErrorMessage(status: number, problem: ApiProblem): string {
  const message = variationFamilyErrorMessage(status, problem);
  return `${message}${problem.requestId ? `（Request ID: ${problem.requestId}）` : ""}`;
}

async function responseProblem(response: Response, fallback: string): Promise<Error> {
  let payload: ApiProblem = {};
  try {
    payload = (await response.json()) as ApiProblem;
  } catch {
    // The fallback is intentionally local and contains no credential details.
  }
  const message = payload.message?.trim() || fallback;
  return new Error(`${message}${payload.requestId ? `（Request ID: ${payload.requestId}）` : ""}`);
}

function targetParent(family: VariationFamilyView): VariationMemberView | null {
  return family.queried.role === "parent" ? family.queried : family.parent;
}

function nestedValue(root: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[key];
  }, root);
}

function displayValue(value: unknown): string | number | readonly string[] | undefined {
  return typeof value === "string" || typeof value === "number" ? value : "";
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
  const [sourceIdentifierType, setSourceIdentifierType] =
    useState<VariationIdentifierType>("sku");
  const [targetIdentifierType, setTargetIdentifierType] =
    useState<VariationIdentifierType>("sku");
  const [sourceFamily, setSourceFamily] = useState<VariationFamilyView | null>(null);
  const [targetFamily, setTargetFamily] = useState<VariationFamilyView | null>(null);
  const [stagedMember, setStagedMember] = useState<VariationMemberView | null>(null);
  const [stagedOriginalParentSku, setStagedOriginalParentSku] = useState<string | null>(null);
  const [stagedState, setStagedState] = useState<StagedState>("planned");
  const [plan, setPlan] = useState<VariationMovePlan | null>(null);
  const [preparation, setPreparation] = useState<VariationMovePreparation | null>(null);
  const [dimensionValues, setDimensionValues] = useState<
    Record<string, Array<Record<string, unknown>>>
  >({});
  const [jsonDrafts, setJsonDrafts] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [lastResult, setLastResult] = useState<VariationMoveResult | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [targetLoading, setTargetLoading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [writeAction, setWriteAction] = useState<VariationMoveAction | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const sourceAbortRef = useRef<AbortController | null>(null);
  const targetAbortRef = useRef<AbortController | null>(null);
  const preparationAbortRef = useRef<AbortController | null>(null);
  const autoLookupRef = useRef(false);
  const marketplace = MARKETPLACES.find((option) => option.id === marketplaceId) ?? MARKETPLACES[0];
  const busy = sourceLoading || targetLoading || preparing || Boolean(writeAction);

  const clearWorkflow = useCallback((keepStaged = false) => {
    preparationAbortRef.current?.abort();
    if (!keepStaged) {
      setStagedMember(null);
      setStagedOriginalParentSku(null);
    }
    setStagedState("planned");
    setPlan(null);
    setPreparation(null);
    setDimensionValues({});
    setJsonDrafts({});
    setFieldErrors({});
    setLastResult(null);
    setWorkflowError(null);
  }, []);

  const closeDrawer = useCallback(() => {
    sourceAbortRef.current?.abort();
    targetAbortRef.current?.abort();
    preparationAbortRef.current?.abort();
    onClose();
  }, [onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) closeDrawer();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, closeDrawer]);

  useEffect(() => () => {
    sourceAbortRef.current?.abort();
    targetAbortRef.current?.abort();
    preparationAbortRef.current?.abort();
  }, []);

  const fetchFamily = useCallback(async (
    identifier: string,
    identifierType: VariationIdentifierType,
    signal: AbortSignal,
  ) => {
    const params = new URLSearchParams({ marketplaceId });
    params.set(identifierType, identifier);
    const response = await fetch(`/api/sp-api/variation-family?${params}`, {
      cache: "no-store",
      signal,
    });
    const payload = (await response.json()) as unknown;
    if (!response.ok) throw new Error(requestErrorMessage(response.status, payload as ApiProblem));
    return parseVariationFamilyResponse(
      payload,
      identifierType === "asin"
        ? { marketplaceId, asin: identifier }
        : { marketplaceId, sellerSku: identifier },
    );
  }, [marketplaceId]);

  const lookupSource = useCallback(async (
    identifier: string,
    identifierType: VariationIdentifierType = sourceIdentifierType,
  ) => {
    const normalizedIdentifier = identifierType === "asin"
      ? identifier.trim().toUpperCase()
      : identifier.trim();
    if (
      !normalizedIdentifier ||
      (identifierType === "asin" && !/^[A-Z0-9]{10}$/u.test(normalizedIdentifier))
    ) {
      setSourceError(
        identifierType === "asin"
          ? "請輸入完整 10 碼 ASIN。"
          : "請輸入完整 Seller SKU。",
      );
      return;
    }
    sourceAbortRef.current?.abort();
    const controller = new AbortController();
    sourceAbortRef.current = controller;
    setSourceLoading(true);
    setSourceError(null);
    setSourceFamily(null);
    clearWorkflow();
    try {
      const family = await fetchFamily(
        normalizedIdentifier,
        identifierType,
        controller.signal,
      );
      if (sourceAbortRef.current !== controller) return;
      setSourceFamily(family);
      setSourceInput(family.queriedSku);
      setSourceIdentifierType("sku");
      onContextResolved?.(marketplaceId, family.queriedSku);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      if (sourceAbortRef.current === controller) {
        setSourceError(error instanceof Error ? error.message : "目前無法載入來源 family。");
      }
    } finally {
      if (sourceAbortRef.current === controller) setSourceLoading(false);
    }
  }, [clearWorkflow, fetchFamily, marketplaceId, onContextResolved, sourceIdentifierType]);

  const lookupTarget = useCallback(async (
    identifier: string,
    identifierType: VariationIdentifierType = targetIdentifierType,
  ) => {
    const normalizedIdentifier = identifierType === "asin"
      ? identifier.trim().toUpperCase()
      : identifier.trim();
    if (
      !normalizedIdentifier ||
      (identifierType === "asin" && !/^[A-Z0-9]{10}$/u.test(normalizedIdentifier))
    ) {
      setTargetError(
        identifierType === "asin"
          ? "請輸入完整 10 碼 ASIN。"
          : "請輸入目標 parent 或其 child SKU。",
      );
      return;
    }
    targetAbortRef.current?.abort();
    const controller = new AbortController();
    targetAbortRef.current = controller;
    setTargetLoading(true);
    setTargetError(null);
    setTargetFamily(null);
    setPlan(null);
    setPreparation(null);
    setLastResult(null);
    setWorkflowError(null);
    try {
      const family = await fetchFamily(
        normalizedIdentifier,
        identifierType,
        controller.signal,
      );
      if (targetAbortRef.current !== controller) return;
      const parent = targetParent(family);
      if (!parent) throw new Error("這個 SKU 沒有可確認的目標 parent 容器。");
      setTargetFamily(family);
      setTargetInput(parent.sellerSku);
      setTargetIdentifierType("sku");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      if (targetAbortRef.current === controller) {
        setTargetError(error instanceof Error ? error.message : "目前無法載入目標 family。");
      }
    } finally {
      if (targetAbortRef.current === controller) setTargetLoading(false);
    }
  }, [fetchFamily, targetIdentifierType]);

  const runSourceLookup = useCallback(
    () => void lookupSource(sourceInput, sourceIdentifierType),
    [lookupSource, sourceIdentifierType, sourceInput],
  );
  const runTargetLookup = useCallback(
    () => void lookupTarget(targetInput, targetIdentifierType),
    [lookupTarget, targetIdentifierType, targetInput],
  );

  const handleSourceKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    const action = variationLookupKeyAction(event.key, event.nativeEvent.isComposing);
    if (action === "ignore") return;
    event.preventDefault();
    if (action === "lookup") runSourceLookup();
  }, [runSourceLookup]);

  const handleTargetKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    const action = variationLookupKeyAction(event.key, event.nativeEvent.isComposing);
    if (action === "ignore") return;
    event.preventDefault();
    if (action === "lookup") runTargetLookup();
  }, [runTargetLookup]);

  useEffect(() => {
    if (autoLookupRef.current || !initialSellerSku.trim()) return;
    autoLookupRef.current = true;
    void lookupSource(initialSellerSku, "sku");
  }, [initialSellerSku, lookupSource]);

  const changeMarketplace = (nextMarketplaceId: string) => {
    sourceAbortRef.current?.abort();
    targetAbortRef.current?.abort();
    preparationAbortRef.current?.abort();
    setMarketplaceId(nextMarketplaceId);
    setSourceInput("");
    setTargetInput("");
    setSourceIdentifierType("sku");
    setTargetIdentifierType("sku");
    setSourceFamily(null);
    setTargetFamily(null);
    setSourceError(null);
    setTargetError(null);
    clearWorkflow();
  };

  const sourceMembers = useMemo(() => {
    if (!sourceFamily) return [];
    if (sourceFamily.children.length) return sourceFamily.children;
    return sourceFamily.queried.role !== "parent" && sourceFamily.queried.fba
      ? [sourceFamily.queried]
      : [];
  }, [sourceFamily]);

  const stageMember = (member: VariationMemberView) => {
    setStagedMember(member);
    setStagedOriginalParentSku(member.parentSku);
    setStagedState(member.parentSku ? "planned" : "detached");
    setPlan(null);
    setPreparation(null);
    setDimensionValues({});
    setJsonDrafts({});
    setFieldErrors({});
    setLastResult(null);
    setWorkflowError(null);
  };

  const loadPreparation = useCallback(async (
    member: VariationMemberView,
    family: VariationFamilyView,
  ) => {
    const parent = targetParent(family);
    if (!parent) return;
    preparationAbortRef.current?.abort();
    const controller = new AbortController();
    preparationAbortRef.current = controller;
    setPreparing(true);
    setPreparation(null);
    setWorkflowError(null);
    try {
      const params = new URLSearchParams({
        marketplaceId,
        sku: member.sellerSku,
        targetSku: parent.sellerSku,
      });
      const response = await fetch(`/api/sp-api/variation-move?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw await responseProblem(response, "無法準備變體必要欄位。");
      const raw = (await response.json()) as unknown;
      const next = parseVariationMovePreparation(raw, {
        marketplaceId,
        sellerSku: member.sellerSku,
        targetParentSku: parent.sellerSku,
      });
      setPreparation(next);
      const values = initialVariationDimensionValues(next);
      setDimensionValues(values);
      setJsonDrafts(Object.fromEntries(
        next.fields.filter((field) => field.jsonFallback).map((field) => [
          field.name,
          JSON.stringify(values[field.name] ?? [], null, 2),
        ]),
      ));
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setWorkflowError(error instanceof Error ? error.message : "目前無法準備變體欄位。");
    } finally {
      if (preparationAbortRef.current === controller) setPreparing(false);
    }
  }, [marketplaceId]);

  const moveStagedToTarget = () => {
    if (!sourceFamily || !targetFamily || !stagedMember) return;
    if (stagedState !== "detached") {
      setWorkflowError("請先按「確認解除變體」並完成 Amazon 唯讀回查，再拖往目標 family。");
      return;
    }
    const nextPlan = buildVariationMovePlan(sourceFamily, stagedMember, targetFamily);
    setPlan(nextPlan);
    setLastResult(null);
    setWorkflowError(null);
    if (nextPlan.status !== "blocked") void loadPreparation(stagedMember, targetFamily);
  };

  const sourceDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const sellerSku = event.dataTransfer.getData("text/plain");
    const member = sourceMembers.find((candidate) => candidate.sellerSku === sellerSku);
    if (member) stageMember(member);
  };

  const targetDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const sellerSku = event.dataTransfer.getData("text/plain");
    if (stagedMember?.sellerSku === sellerSku && stagedState === "detached") {
      moveStagedToTarget();
    }
  };

  const missingFields = useMemo(
    () => preparation ? missingVariationFields(preparation, dimensionValues) : [],
    [dimensionValues, preparation],
  );

  const refreshFamilies = useCallback(async () => {
    if (!sourceFamily) return;
    const sourceSku = sourceFamily.queriedSku;
    const controller = new AbortController();
    try {
      const targetSku = targetFamily
        ? targetParent(targetFamily)?.sellerSku ?? targetFamily.queriedSku
        : null;
      const [nextSource, nextTarget] = await Promise.all([
        fetchFamily(sourceSku, "sku", controller.signal),
        targetSku
          ? fetchFamily(targetSku, "sku", controller.signal)
          : Promise.resolve(null),
      ]);
      setSourceFamily(nextSource);
      if (nextTarget) setTargetFamily(nextTarget);
    } catch {
      // The write result already contains a verified single-SKU readback. A
      // family refresh failure is shown as a non-destructive warning only.
      setWorkflowError("變體寫入已回查完成，但 family 清單重新整理失敗；請稍後重新讀取兩側 SKU。");
    }
  }, [fetchFamily, sourceFamily, targetFamily]);

  const runWrite = async (action: VariationMoveAction) => {
    if (!stagedMember) return;
    if (action === "detach" && !stagedMember.parentSku) {
      setWorkflowError("Amazon 目前沒有可解除的來源 parent；請重新讀取來源 SKU。");
      return;
    }
    if (action === "attach" && !preparation) return;
    if (preparation?.blockers.length) {
      setWorkflowError(preparation.blockers.join(" "));
      return;
    }
    if (action === "attach" && missingFields.length) {
      setWorkflowError(`請先填完目標變體必填欄位：${missingFields.join("、")}。`);
      return;
    }
    const idempotencyKey = crypto.randomUUID();
    const body = action === "detach"
      ? {
          action,
          marketplaceId,
          sellerSku: stagedMember.sellerSku,
          expectedSourceParentSku: stagedMember.parentSku,
          targetParentSku: null,
          variationTheme: null,
          dimensionNames: [],
          dimensionValues: {},
          idempotencyKey,
        }
      : {
          action,
          marketplaceId,
          sellerSku: stagedMember.sellerSku,
          expectedSourceParentSku: null,
          targetParentSku: preparation!.targetParentSku,
          variationTheme: preparation!.variationTheme,
          dimensionNames: preparation!.dimensionNames,
          dimensionValues,
          idempotencyKey,
        };
    setWriteAction(action);
    setWorkflowError(null);
    setLastResult(null);
    try {
      const previewResponse = await fetch("/api/sp-api/variation-move", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!previewResponse.ok) {
        throw await responseProblem(previewResponse, "Amazon 變體預檢失敗。");
      }
      const previewRaw = (await previewResponse.json()) as unknown;
      parseVariationMovePreview(previewRaw, { action, marketplaceId, sellerSku: stagedMember.sellerSku });

      // No extra browser confirmation: the PATCH immediately invokes the
      // trusted Mac Bridge Touch ID/system prompt with a Main-generated reason.
      const commitResponse = await fetch("/api/sp-api/variation-move", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!commitResponse.ok) {
        throw await responseProblem(commitResponse, "Amazon 變體寫入或回查失敗。");
      }
      const resultRaw = (await commitResponse.json()) as unknown;
      const result = parseVariationMoveResult(resultRaw, {
        action,
        marketplaceId,
        sellerSku: stagedMember.sellerSku,
      });
      setLastResult(result);
      setStagedState(action === "detach" ? "detached" : "attached");
      if (action === "detach") {
        setStagedMember((current) => current
          ? { ...current, role: "standalone", parentSku: null }
          : current);
      }
      await refreshFamilies();
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : "變體操作沒有完成。");
    } finally {
      setWriteAction(null);
    }
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
            <p className="eyebrow">SAFE VARIATION FAMILY MOVE</p>
            <h2 id="variation-planner-title">變體規劃與改掛</h2>
          </div>
          <button type="button" onClick={closeDrawer} disabled={busy} aria-label="關閉變體規劃">×</button>
        </div>

        <div className="variation-readonly-banner writable">
          <strong>兩階段安全寫入 · 不會盲目重送</strong>
          <p>先把 FBA child 放進「解除變體」暫存區，再拖到另一個已查詢的 parent。Mac 會依 CHILD PTD 要求欄位，逐階段 Validation Preview、Touch ID、送出與唯讀回查。</p>
        </div>

        <label className="variation-marketplace">
          <span>Amazon 站點</span>
          <select value={marketplaceId} onChange={(event) => changeMarketplace(event.target.value)} disabled={busy}>
            {MARKETPLACES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>

        <div className="variation-planner-columns">
          <section className="variation-family-panel source" aria-labelledby="variation-source-title">
            <div className="variation-section-heading"><span>01</span><div><strong id="variation-source-title">來源 family</strong><small>可用 SKU 或 ASIN 查詢；結果一定顯示 Seller SKU</small></div></div>
            <div className="variation-search-row">
              <select
                value={sourceIdentifierType}
                onChange={(event) => {
                  setSourceIdentifierType(event.target.value as VariationIdentifierType);
                  setSourceInput("");
                  setSourceError(null);
                }}
                disabled={busy}
                aria-label="來源查詢識別類型"
              >
                <option value="sku">SKU</option>
                <option value="asin">ASIN</option>
              </select>
              <input value={sourceInput} onChange={(event) => setSourceInput(event.target.value)} onKeyDown={handleSourceKeyDown} placeholder={sourceIdentifierType === "asin" ? "例如 B09S5VY2JS" : `例如 ${marketplace.sample}`} maxLength={sourceIdentifierType === "asin" ? 10 : 40} autoComplete="off" spellCheck={false} disabled={busy} aria-label={sourceIdentifierType === "asin" ? "來源 ASIN" : "來源 Seller SKU"} />
              <button type="button" data-variation-lookup="source" onClick={runSourceLookup} disabled={busy || !sourceInput.trim()}>{sourceLoading ? "讀取中" : "讀取"}</button>
            </div>
            {sourceError && <div className="price-error" role="alert">{sourceError}</div>}
            {sourceLoading && <p className="variation-loading" role="status">正在整理來源 parent、children、theme 與維度…</p>}
            {sourceFamily && <FamilySummary family={sourceFamily} />}
          </section>

          <section className="variation-family-panel target" aria-labelledby="variation-target-title">
            <div className="variation-section-heading"><span>02</span><div><strong id="variation-target-title">目標 family</strong><small>可輸入 parent／child 的 SKU 或 ASIN</small></div></div>
            <div className="variation-search-row">
              <select
                value={targetIdentifierType}
                onChange={(event) => {
                  setTargetIdentifierType(event.target.value as VariationIdentifierType);
                  setTargetInput("");
                  setTargetError(null);
                }}
                disabled={busy}
                aria-label="目標查詢識別類型"
              >
                <option value="sku">SKU</option>
                <option value="asin">ASIN</option>
              </select>
              <input value={targetInput} onChange={(event) => setTargetInput(event.target.value)} onKeyDown={handleTargetKeyDown} placeholder={targetIdentifierType === "asin" ? "目標 ASIN" : "目標 parent SKU"} maxLength={targetIdentifierType === "asin" ? 10 : 40} autoComplete="off" spellCheck={false} disabled={busy} aria-label={targetIdentifierType === "asin" ? "目標 ASIN" : "目標 Parent SKU"} />
              <button type="button" data-variation-lookup="target" onClick={runTargetLookup} disabled={busy || !targetInput.trim()}>{targetLoading ? "讀取中" : "讀取"}</button>
            </div>
            {targetError && <div className="price-error" role="alert">{targetError}</div>}
            {targetLoading && <p className="variation-loading" role="status">正在確認目標 parent 與既有 child…</p>}
            {targetFamily && <TargetFamilyDetails family={targetFamily} />}
          </section>
        </div>

        <div className="variation-move-board">
        <section className={`variation-detach-stage ${stagedMember ? "occupied" : ""}`} aria-label="解除變體存放區">
          <div className="variation-section-heading"><span>解除</span><div><strong>解除變體存放區</strong><small>固定在兩個 family 摘要後；解除成功後卡片仍保留，可再拖往目標</small></div></div>
          <div
            className="variation-detach-drop"
            onDragOver={(event) => { if (sourceFamily) event.preventDefault(); }}
            onDrop={sourceDrop}
          >
            {stagedMember ? (
              <article
                className={`variation-staged-card ${stagedState}`}
                draggable={!busy && stagedState === "detached"}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "copy";
                  event.dataTransfer.setData("text/plain", stagedMember.sellerSku);
                }}
              >
                <div><strong>{stagedMember.sellerSku}</strong><span>{stagedState === "planned" ? "尚未解除" : stagedState === "detached" ? "已回查為獨立 SKU" : "已加入新 family"}</span></div>
                <p>{stagedMember.title}</p>
                <small>{stagedOriginalParentSku ? `原 Parent：${stagedOriginalParentSku}` : "原本沒有 parent"} · {memberDimensions(stagedMember)}</small>
                {stagedState === "planned" && <em>按下方「確認解除變體」後會先 Amazon 預檢，再直接顯示 Touch ID。</em>}
                {stagedState === "detached" && <em>解除已回查完成；現在可把這張卡拖到下方目標 family。</em>}
              </article>
            ) : (
              <p>把下方 FBA child 拖到這裡，或按「放入解除變體區」。</p>
            )}
          </div>
          {stagedMember && stagedState === "planned" && (
            <button
              className="price-primary-button danger-button"
              type="button"
              disabled={busy || !sourceFamily?.familyComplete || sourceFamily.mode !== "live" || !stagedMember.parentSku}
              onClick={() => void runWrite("detach")}
            >
              {writeAction === "detach" ? "等待 Touch ID／解除回查中…" : "確認解除變體"}
            </button>
          )}
          {stagedMember && stagedState === "detached" && (
            <strong className="variation-success">✓ 已確認解除；存放卡仍保留，可拖往目標 family</strong>
          )}
          {sourceFamily?.mode === "demo" && stagedMember && (
            <p className="variation-warning">目前為展示模式；按鈕保持停用，Amazon 不會收到解除寫入。</p>
          )}
        </section>

        <div className="variation-planner-columns">
          <section className="variation-family-panel source source-children" aria-labelledby="variation-source-children-title">
            <div className="variation-section-heading"><span>選</span><div><strong id="variation-source-children-title">可解除的 FBA child</strong><small>來源卡會保留；放入上方存放區不會立即修改 Amazon</small></div></div>
            <p className="variation-scroll-hint">清單會在這張藍色來源卡內捲動；紅色解除區會固定在上方，不必把整頁拖回頂端。</p>
            <div className="variation-child-list">
              {sourceMembers.map((member) => (
                <article
                  key={member.sellerSku}
                  className={`variation-child-card ${stagedMember?.sellerSku === member.sellerSku ? "selected" : ""}`}
                  draggable={!busy}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData("text/plain", member.sellerSku);
                  }}
                >
                  <div><strong>{member.sellerSku}</strong><span>FBA {member.role}</span></div>
                  <p>{member.title}</p>
                  <small>{memberDimensions(member)}</small>
                  <button type="button" disabled={busy} onClick={() => stageMember(member)}>放入解除變體存放區</button>
                </article>
              ))}
              {sourceFamily && !sourceMembers.length && <p className="variation-empty">這個 family 沒有可解除的 FBA child。</p>}
              {!sourceFamily && <p className="variation-empty">先在上方讀取來源 family。</p>}
            </div>
          </section>

          <section className="variation-family-panel target" aria-labelledby="variation-target-drop-title">
            <div className="variation-section-heading"><span>綁</span><div><strong id="variation-target-drop-title">拖往目標 family</strong><small>只接受已完成解除並唯讀回查的存放卡</small></div></div>
            <div
              className={`variation-drop-zone ${targetFamily && stagedMember && stagedState === "detached" ? "ready" : ""}`}
              onDragOver={(event) => {
                if (targetFamily && stagedMember && stagedState === "detached") event.preventDefault();
              }}
              onDrop={targetDrop}
              aria-label="把已解除並回查的 FBA child 拖到目標 parent"
            >
              {targetFamily ? (
                <>
                  <span>加入目標 parent</span>
                  <strong>{targetParent(targetFamily)?.sellerSku ?? "Parent 未確認"}</strong>
                  <p>{targetFamily.variationTheme ?? "Theme 未確認"} · {targetFamily.children.length} 個 FBA child</p>
                  <small>{stagedState === "detached" ? "把上方存放卡拖到這裡" : "請先完成解除變體與唯讀回查"}</small>
                </>
              ) : (
                <><span>先讀取目標 family</span><p>目標 parent 的標題、theme 與維度會在上方核對。</p></>
              )}
            </div>
            {targetFamily && stagedMember && (
              <button className="variation-target-action" type="button" onClick={moveStagedToTarget} disabled={busy || stagedState !== "detached"}>
                使用已解除的 {stagedMember.sellerSku}
              </button>
            )}
          </section>
        </div>
        </div>

        {plan && <PlanReview plan={plan} />}
        {preparing && <div className="validation-status demo" role="status"><strong>正在讀取 Amazon CHILD PTD 與必要變體欄位…</strong></div>}
        {workflowError && <div className="price-error" role="alert">{workflowError}</div>}

        {preparation && plan && plan.status !== "blocked" && (
          <section className="variation-write-review" aria-labelledby="variation-write-title">
            <div className="variation-plan-heading">
              <div><span>AMAZON CHILD PTD</span><h3 id="variation-write-title">完成目標 family 必要欄位</h3></div>
              <small>{preparation.productType} · {preparation.variationTheme}</small>
            </div>
            {preparation.blockers.length > 0 && (
              <div className="variation-plan-blockers"><strong>Amazon 安全檢查未通過</strong><ul>{preparation.blockers.map((item) => <li key={item}>{item}</li>)}</ul></div>
            )}
            <div className="variation-field-grid">
              {preparation.fields.map((field) => (
                <VariationFieldEditor
                  key={field.name}
                  field={field}
                  values={dimensionValues[field.name] ?? []}
                  jsonDraft={jsonDrafts[field.name] ?? ""}
                  error={fieldErrors[field.name] ?? null}
                  disabled={busy || stagedState === "attached" || !field.editable}
                  onLeafChange={(leaf, value) => {
                    setDimensionValues((current) => updateVariationLeaf({
                      values: current,
                      fieldName: field.name,
                      path: leaf.path,
                      value,
                    }));
                    setFieldErrors((current) => ({ ...current, [field.name]: "" }));
                  }}
                  onJsonDraftChange={(text) => setJsonDrafts((current) => ({ ...current, [field.name]: text }))}
                  onJsonCommit={() => {
                    try {
                      const values = parseVariationJsonValues({
                        text: jsonDrafts[field.name] ?? "",
                        marketplaceId,
                      });
                      setDimensionValues((current) => ({ ...current, [field.name]: values }));
                      setFieldErrors((current) => ({ ...current, [field.name]: "" }));
                    } catch (error) {
                      setFieldErrors((current) => ({
                        ...current,
                        [field.name]: error instanceof Error ? error.message : "JSON 格式不正確。",
                      }));
                    }
                  }}
                />
              ))}
            </div>
            {missingFields.length > 0 && <p className="variation-warning">尚待填寫：{missingFields.join("、")}</p>}
            {preparation.warnings.map((warning) => <p className="variation-warning" key={warning}>{warning}</p>)}

            <div className="variation-write-actions">
              {stagedState === "detached" && (
                <button
                  className="price-primary-button"
                  type="button"
                  disabled={busy || !preparation.writable || preparation.blockers.length > 0 || missingFields.length > 0 || Object.values(fieldErrors).some(Boolean)}
                  onClick={() => void runWrite("attach")}
                >
                  {writeAction === "attach" ? "等待 Touch ID／綁定回查中…" : "確認綁定變體"}
                </button>
              )}
              {stagedState === "attached" && <strong className="variation-success">✓ 已回查屬於 {preparation.targetParentSku}</strong>}
              {!preparation.writable && <small>目前為展示或唯讀模式，Amazon 不會收到寫入。</small>}
            </div>
            {lastResult && (
              <div className="validation-status live">
                <strong>{lastResult.notice}</strong>
                <p>{lastResult.action === "detach" ? "解除" : "加入"}已由 Amazon 回查確認；沒有自動重送。</p>
              </div>
            )}
          </section>
        )}

        <div className="variation-safety-boundary">
          <strong>能力邊界</strong>
          <p>Listings Items v2021-08-01 · CHILD Product Type Definition · FBA child only · Validation Preview · Touch ID · 持久 Idempotency · 送出後唯讀回查 · 不使用 Seller Central 私有接口</p>
        </div>
        <div className="drawer-api-footnote">Two explicit non-atomic stages · No blind retry · No FBM</div>
      </aside>
    </div>
  );
}

function FamilySummary({ family }: { family: VariationFamilyView }) {
  const parent = targetParent(family);
  return (
    <div className="variation-family-summary">
      <dl>
        <div><dt>查詢 SKU</dt><dd>{family.queriedSku}</dd></div>
        <div><dt>Parent</dt><dd>{parent?.sellerSku ?? "無 parent"}</dd></div>
        <div><dt>Theme</dt><dd>{family.variationTheme ?? "未確認"}</dd></div>
        <div><dt>Children</dt><dd>{family.children.length} FBA</dd></div>
      </dl>
      {parent && <p className="variation-parent-title">{parent.title}</p>}
      {!family.familyComplete && <p className="variation-warning">Family 清單不完整（分頁超限或 parent 宣告的 child 未全數回傳），請勿據此執行。</p>}
      {family.excludedChildren.map((item) => <p className="variation-warning" key={`${item.sellerSku}-${item.reason}`}>{item.sellerSku}：{item.reason}</p>)}
      <small>{family.notice}</small>
    </div>
  );
}

function TargetFamilyDetails({ family }: { family: VariationFamilyView }) {
  const parent = targetParent(family);
  const dimensions = family.children.flatMap((child) => child.dimensions.flatMap((dimension) =>
    dimension.values.map((value) => `${dimension.label}: ${value}`),
  ));
  return (
    <div className="variation-target-details">
      <span>目標商品</span>
      <strong>{parent?.title ?? "Amazon 未回傳 parent 標題"}</strong>
      <p>{parent?.productType ?? family.queried.productType} · Theme: {family.variationTheme ?? "未確認"}</p>
      <small>必要維度：{family.dimensionNames.length ? family.dimensionNames.join("、") : "Amazon 未回傳"}</small>
      {dimensions.length > 0 && <div className="variation-dimension-chips">{[...new Set(dimensions)].slice(0, 12).map((value) => <i key={value}>{value}</i>)}</div>}
    </div>
  );
}

function PlanReview({ plan }: { plan: VariationMovePlan }) {
  return (
    <section className={`variation-plan-review ${plan.status}`} aria-labelledby="variation-plan-review-title">
      <div className="variation-plan-heading"><div><span>MOVE REVIEW</span><h3 id="variation-plan-review-title">{plan.source.sellerSku} → {plan.targetParent.sellerSku}</h3></div></div>
      {plan.blockers.length > 0 && <div className="variation-plan-blockers"><strong>目前不可安全移動</strong><ul>{plan.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div>}
      <div className="variation-plan-warnings"><strong>非原子流程提醒</strong><ul>{plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>
      <div className="variation-plan-steps"><strong>實際執行順序</strong><ol><li>Amazon 預檢解除舊 parent 關係</li><li>Touch ID 後送出解除並回查</li><li>依 CHILD PTD 補齊所有變體維度</li><li>Amazon 預檢加入新 parent</li><li>Touch ID 後送出加入並回查</li></ol></div>
    </section>
  );
}

function VariationFieldEditor({
  field,
  values,
  jsonDraft,
  error,
  disabled,
  onLeafChange,
  onJsonDraftChange,
  onJsonCommit,
}: {
  field: VariationFieldView;
  values: Array<Record<string, unknown>>;
  jsonDraft: string;
  error: string | null;
  disabled: boolean;
  onLeafChange: (leaf: VariationFieldLeafView, value: string | number | boolean) => void;
  onJsonDraftChange: (value: string) => void;
  onJsonCommit: () => void;
}) {
  const row = values[0] ?? {};
  return (
    <fieldset className="variation-field-card" disabled={disabled}>
      <legend>{field.label}<code>{field.name}</code></legend>
      {!field.editable && <p className="variation-warning">Amazon CHILD PTD 將此欄位標示為唯讀。</p>}
      {field.jsonFallback ? (
        <label>
          <span>Amazon attribute JSON</span>
          <textarea value={jsonDraft} onChange={(event) => onJsonDraftChange(event.target.value)} onBlur={onJsonCommit} rows={5} spellCheck={false} />
        </label>
      ) : field.leaves.map((leaf) => {
        const value = nestedValue(row, leaf.path);
        const id = `variation-${field.name}-${leaf.path.join("-")}`;
        return (
          <label key={leaf.path.join(".")} htmlFor={id}>
            <span>{leaf.label}{leaf.required ? " *" : ""}</span>
            {leaf.enumValues.length ? (
              <select
                id={id}
                value={String(value ?? "")}
                onChange={(event) => {
                  const option = leaf.enumValues.find((candidate) => String(candidate) === event.target.value);
                  if (option !== undefined) onLeafChange(leaf, option);
                }}
              >
                <option value="">請選擇</option>
                {leaf.enumValues.map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}
              </select>
            ) : leaf.type === "boolean" ? (
              <select id={id} value={String(value ?? "")} onChange={(event) => onLeafChange(leaf, event.target.value === "true")}>
                <option value="">請選擇</option><option value="true">Yes</option><option value="false">No</option>
              </select>
            ) : (
              <input
                id={id}
                type={leaf.type === "number" || leaf.type === "integer" ? "number" : "text"}
                step={leaf.type === "integer" ? "1" : leaf.type === "number" ? "any" : undefined}
                value={displayValue(value)}
                onChange={(event) => {
                  if (leaf.type === "number" || leaf.type === "integer") {
                    const number = Number(event.target.value);
                    if (Number.isFinite(number)) onLeafChange(leaf, number);
                  } else {
                    onLeafChange(leaf, event.target.value);
                  }
                }}
                autoComplete="off"
              />
            )}
          </label>
        );
      })}
      {error && <small className="price-error">{error}</small>}
    </fieldset>
  );
}
