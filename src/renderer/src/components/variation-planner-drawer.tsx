"use client";

import {
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
} from "../variation-planner";
import {
  initialVariationDimensionValues,
  missingVariationFields,
  parseVariationJsonValues,
  parseVariationMovePreparation,
  parseVariationMovePreview,
  parseVariationMoveResult,
  parseVariationMoveRecovery,
  parseVariationRequiredFields,
  parseVariationPreservedRequiredFields,
  updateVariationLeaf,
  type VariationFieldLeafView,
  type VariationFieldView,
  type VariationMoveAction,
  type VariationMovePreparation,
  type VariationMovePreview,
  type VariationMoveResult,
  type VariationRecoveryIntent,
} from "../variation-move";
import {
  MARKETPLACES,
  marketplaceById,
  marketplaceSelectLabel,
} from "../../../shared/marketplaces";
import {
  parseVariationPreviewDiagnostics,
  safeVariationDiagnosticText,
  type VariationPreviewDiagnostics,
} from "../variation-preview-diagnostics";

import UnboundVariationAuditPanel, {
  type UnboundVariationAuditCache,
} from "./unbound-variation-audit-panel";
import type { UnboundVariationAuditRow } from "../unbound-variation-audit";
import type {
  StandaloneAuditJob,
  StandaloneAuditMode,
} from "../standalone-audit";
import type { UnboundFamilyRecommendation } from "../../../shared/unbound-family-recommendations";

type Props = {
  auditMode?: StandaloneAuditMode;
  auditCache?: UnboundVariationAuditCache | null;
  auditJob?: StandaloneAuditJob | null;
  onAuditCacheChange?: (cache: UnboundVariationAuditCache) => void;
  onAuditJobChange?: (job: StandaloneAuditJob) => void;
  initialMarketplaceId: string;
  initialSellerSku?: string;
  presentation?: "drawer" | "workspace";
  workspaceBackLabel?: string;
  onBusyChange?: (busy: boolean) => void;
  onContextResolved?: (marketplaceId: string, sellerSku: string) => void;
  onClose: () => void;
};
type IdentifierType = "sku" | "asin";
type Values = Record<string, Array<Record<string, unknown>>>;
type StagedState = "planned" | "detached" | "attached";
type PreparedStages = Partial<
  Record<VariationMoveAction, VariationMovePreparation>
>;
type WriteBody = {
  action: VariationMoveAction;
  marketplaceId: string;
  sellerSku: string;
  expectedSourceParentSku: string | null;
  targetParentSku: string | null;
  variationTheme: string | null;
  dimensionNames: string[];
  dimensionValues: Values;
  requiredValues: Values;
  preserveRequiredFields?: string[];
  idempotencyKey: string;
};

function parentOf(family: VariationFamilyView) {
  return family.queried.role === "parent" ? family.queried : family.parent;
}
function fieldLabel(field: VariationFieldView) {
  return /contains_liquid|is_liquid/u.test(field.name)
    ? "是否含液體"
    : field.label;
}
function dimensionText(member: VariationMemberView, name: string) {
  return (
    member.dimensions
      .find((dimension) => dimension.name === name)
      ?.values.join(" · ") || "未回報"
  );
}
function nestedValue(root: unknown, path: string[]): unknown {
  return path.reduce<unknown>(
    (current, key) =>
      current && typeof current === "object" && !Array.isArray(current)
        ? (current as Record<string, unknown>)[key]
        : undefined,
    root,
  );
}
function readableValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "未設定";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value))
    return value.map(readableValue).join(" · ") || "未設定";
  if (typeof value === "object")
    return (
      Object.entries(value)
        .filter(([key]) => !["marketplace_id", "language_tag"].includes(key))
        .map(
          ([key, item]) =>
            `${key === "value" ? "" : `${key}: `}${readableValue(item)}`,
        )
        .join(" · ") || "未設定"
    );
  return String(value);
}
class VariationRequestError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly requiredFields: VariationFieldView[] | null = null,
    readonly binding?: {
      action?: unknown;
      marketplaceId?: unknown;
      sellerSku?: unknown;
      targetParentSku?: unknown;
    },
    readonly requiredFieldChoices: VariationFieldView[] | null = null,
    readonly diagnostics: VariationPreviewDiagnostics | null = null,
    readonly preservedRequiredFields: VariationFieldView[] | null = null,
  ) {
    super(message);
  }
}
async function responseError(
  response: Response,
  fallback: string,
): Promise<Error> {
  let problem: Record<string, unknown> = {};
  try {
    const raw: unknown = await response.json();
    if (raw && typeof raw === "object" && !Array.isArray(raw))
      problem = raw as Record<string, unknown>;
  } catch {
    /* Keep the local safe fallback. */
  }
  if (response.status === 404)
    return new Error(
      "請更新 AMZ.API Notebook Key，以使用變體必填資料編輯與安全預檢。",
    );
  const diagnostics = parseVariationPreviewDiagnostics(
    problem,
    response.status,
  );
  const message =
    safeVariationDiagnosticText(problem.message) ||
    variationFamilyErrorMessage(response.status, {
      code: diagnostics?.code ?? undefined,
    }) ||
    fallback;
  return new VariationRequestError(
    `${message}${diagnostics?.requestId ? `（Request ID: ${diagnostics.requestId}）` : ""}`,
    diagnostics?.code ?? undefined,
    problem.code === "VARIATION_FIELD_REQUIRED"
      ? parseVariationRequiredFields(problem.requiredFields)
      : null,
    {
      action: problem.action,
      marketplaceId: problem.marketplaceId,
      sellerSku: problem.sellerSku,
      targetParentSku: problem.targetParentSku,
    },
    problem.code === "VARIATION_FIELD_REQUIRED"
      ? parseVariationRequiredFields(problem.requiredFieldChoices)
      : null,
    diagnostics,
    problem.code === "VARIATION_FIELD_REQUIRED"
      ? parseVariationPreservedRequiredFields(problem.preservedRequiredFields)
      : null,
  );
}

export default function VariationPlannerDrawer({
  initialMarketplaceId,
  initialSellerSku = "",
  presentation = "drawer",
  workspaceBackLabel = "回首頁",
  onBusyChange,
  onContextResolved,
  onClose,
  auditMode = "live",
  auditCache = null,
  auditJob = null,
  onAuditCacheChange,
  onAuditJobChange,
}: Props) {
  const [marketplaceId, setMarketplaceId] = useState(
    MARKETPLACES.some((item) => item.id === initialMarketplaceId)
      ? initialMarketplaceId
      : MARKETPLACES[0].id,
  );
  const [showUnbound, setShowUnbound] = useState(!initialSellerSku);
  const [unboundSelection, setUnboundSelection] = useState<{
    row: UnboundVariationAuditRow;
    recommendation: UnboundFamilyRecommendation | null;
  } | null>(null);
  const [sourceInput, setSourceInput] = useState(initialSellerSku);
  const [targetInput, setTargetInput] = useState("");
  const [sourceIdentifierType, setSourceIdentifierType] =
    useState<IdentifierType>("sku");
  const [targetIdentifierType, setTargetIdentifierType] =
    useState<IdentifierType>("sku");
  const [sourceFamily, setSourceFamily] = useState<VariationFamilyView | null>(
    null,
  );
  const [targetFamily, setTargetFamily] = useState<VariationFamilyView | null>(
    null,
  );
  const [stagedMember, setStagedMember] = useState<VariationMemberView | null>(
    null,
  );
  const [originalParentSku, setOriginalParentSku] = useState<string | null>(
    null,
  );
  const [stagedState, setStagedState] = useState<StagedState>("planned");
  const [preparations, setPreparations] = useState<PreparedStages>({});
  const [selectedFieldChoices, setSelectedFieldChoices] = useState<
    Partial<Record<VariationMoveAction, VariationFieldView[]>>
  >({});
  const [preservedSelections, setPreservedSelections] = useState<
    Partial<Record<VariationMoveAction, string[]>>
  >({});
  const [values, setValues] = useState<Values>({});
  const [jsonDrafts, setJsonDrafts] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{
    body: WriteBody;
    result: VariationMovePreview;
  } | null>(null);
  const [lastResult, setLastResult] = useState<VariationMoveResult | null>(
    null,
  );
  const [recoveredReceipt, setRecoveredReceipt] = useState<VariationMoveResult | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [targetLoading, setTargetLoading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [writeAction, setWriteAction] = useState<VariationMoveAction | null>(
    null,
  );
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [previewDiagnostics, setPreviewDiagnostics] =
    useState<VariationPreviewDiagnostics | null>(null);
  const [failedPreviewAction, setFailedPreviewAction] =
    useState<VariationMoveAction | null>(null);
  const [sourceFilter, setSourceFilter] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const sourceAbortRef = useRef<AbortController | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const requiredFieldsHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const preservedFieldsHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const focusPreservedFieldsRef = useRef(false);
  const focusRequiredFieldsRef = useRef(false);
  const targetAbortRef = useRef<AbortController | null>(null);
  const preparationAbortRef = useRef<AbortController | null>(null);
  const recoveryAbortRef = useRef<AbortController | null>(null);
  const autoLookupRef = useRef(false);
  const operationRef = useRef(false);
  const previewKeyRef = useRef<string | null>(null);
  previewKeyRef.current = preview?.body.idempotencyKey ?? null;
  const sentKeysRef = useRef(new Set<string>());
  const unresolvedSkusRef = useRef(new Set<string>());
  const unresolvedIntentsRef = useRef(new Map<string, VariationRecoveryIntent>());
  const recoveryScope = JSON.stringify([
    auditMode, initialMarketplaceId, marketplaceId, sourceInput, targetInput,
    sourceIdentifierType, targetIdentifierType, stagedMember?.sellerSku,
    targetFamily && parentOf(targetFamily)?.sellerSku,
  ]);
  const recoveryScopeRef = useRef(recoveryScope);
  recoveryScopeRef.current = recoveryScope;
  const pendingIntent = stagedMember
    ? unresolvedIntentsRef.current.get(`${marketplaceId}:${stagedMember.sellerSku}`)
    : undefined;
  const busy =
    sourceLoading || targetLoading || preparing || recovering || Boolean(writeAction);
  const marketplace = marketplaceById(marketplaceId) ?? MARKETPLACES[0];
  const sourceMembers = useMemo(
    () =>
      !sourceFamily
        ? []
        : sourceFamily.children.length
          ? sourceFamily.children
          : sourceFamily.queried.role !== "parent" && sourceFamily.queried.fba
            ? [sourceFamily.queried]
            : [],
    [sourceFamily],
  );
  const filteredSourceMembers = sourceMembers.filter((member) =>
    `${member.sellerSku} ${member.title}`
      .toLocaleLowerCase()
      .includes(sourceFilter.toLocaleLowerCase()),
  );
  const plan = useMemo(
    () =>
      sourceFamily && targetFamily && stagedMember
        ? buildVariationMovePlan(sourceFamily, stagedMember, targetFamily)
        : null,
    [sourceFamily, targetFamily, stagedMember],
  );
  const requiredFields = useMemo(
    () => [
      ...new Map(
        [
          ...(selectedFieldChoices.detach ?? []),
          ...(selectedFieldChoices.attach ?? []),
          ...(preparations.detach?.requiredFields ?? []),
          ...(preparations.attach?.requiredFields ?? []),
        ].map((field) => [field.name, field]),
      ).values(),
    ],
    [preparations, selectedFieldChoices],
  );

  useEffect(() => {
    if (presentation === "workspace") headingRef.current?.focus();
  }, [presentation]);
  useEffect(() => {
    if (!focusRequiredFieldsRef.current) return;
    focusRequiredFieldsRef.current = false;
    requiredFieldsHeadingRef.current?.focus();
  }, [requiredFields]);
  useEffect(() => {
    if (!focusPreservedFieldsRef.current) return;
    focusPreservedFieldsRef.current = false;
    preservedFieldsHeadingRef.current?.focus();
  }, [preparations]);

  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  const closeDrawer = useCallback(() => {
    if (operationRef.current) return;
    sourceAbortRef.current?.abort();
    targetAbortRef.current?.abort();
    preparationAbortRef.current?.abort();
    recoveryAbortRef.current?.abort();
    setPreviewDiagnostics(null);
    setPreservedSelections({});
    setPreparations({});
    setPreview(null);
    onClose();
  }, [onClose]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) closeDrawer();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, closeDrawer]);
  useEffect(
    () => () => {
      sourceAbortRef.current?.abort();
      targetAbortRef.current?.abort();
      preparationAbortRef.current?.abort();
      recoveryAbortRef.current?.abort();
    },
    [],
  );

  const clearPlan = useCallback(() => {
    preparationAbortRef.current?.abort();
    recoveryAbortRef.current?.abort();
    setPreparations({});
    setSelectedFieldChoices({});
    setPreservedSelections({});
    setValues({});
    setJsonDrafts({});
    setFieldErrors({});
    setPreview(null);
    setPreviewDiagnostics(null);
    setLastResult(null);
    setRecoveredReceipt(null);
    setWorkflowError(null);
    setFailedPreviewAction(null);
  }, []);
  const fetchFamily = useCallback(
    async (
      identifier: string,
      identifierType: IdentifierType,
      signal: AbortSignal,
    ) => {
      const params = new URLSearchParams({
        marketplaceId,
        [identifierType]: identifier,
      });
      const response = await fetch(`/api/sp-api/variation-family?${params}`, {
        cache: "no-store",
        signal,
      });
      if (!response.ok)
        throw await responseError(response, "目前無法讀取變體清單。");
      return parseVariationFamilyResponse(
        await response.json(),
        identifierType === "asin"
          ? { marketplaceId, asin: identifier }
          : { marketplaceId, sellerSku: identifier },
      );
    },
    [marketplaceId],
  );
  const fetchRecovery = useCallback(async (
    sellerSku: string,
    mode: "live" | "demo",
    signal: AbortSignal,
    intent?: VariationRecoveryIntent,
  ) => {
    const params = new URLSearchParams({ marketplaceId, sku: sellerSku });
    const response = await fetch(`/api/sp-api/variation-move/recovery?${params}`, {
      cache: "no-store", signal,
    });
    if (response.status === 404) return null;
    if (!response.ok) throw await responseError(response, "狀態讀取未完成。");
    return parseVariationMoveRecovery(await response.json(), { mode, marketplaceId, sellerSku, intent });
  }, [marketplaceId]);

  const lookupSource = useCallback(
    async (input: string, kind: IdentifierType) => {
      if (operationRef.current) return;
      const identifier =
        kind === "asin" ? input.trim().toUpperCase() : input.trim();
      if (
        !identifier ||
        (kind === "asin" && !/^[A-Z0-9]{10}$/u.test(identifier))
      ) {
        setSourceError(
          kind === "asin"
            ? "請輸入完整 10 碼 ASIN。"
            : "請輸入完整 Seller SKU。",
        );
        return;
      }
      sourceAbortRef.current?.abort();
      const controller = new AbortController();
      sourceAbortRef.current = controller;
      clearPlan();
      setUnboundSelection(null);
      setSourceLoading(true);
      setSourceError(null);
      setSourceFamily(null);
      setStagedMember(null);
      setSourceFilter("");
      setUncertain(false);
      try {
        const family = await fetchFamily(identifier, kind, controller.signal);
        if (controller.signal.aborted || sourceAbortRef.current !== controller)
          return;
        setSourceFamily(family);
        setSourceInput(family.queriedSku);
        setSourceIdentifierType("sku");
        onContextResolved?.(marketplaceId, family.queriedSku);
      } catch (error) {
        if (!controller.signal.aborted)
          setSourceError(
            error instanceof Error ? error.message : "來源讀取失敗。",
          );
      } finally {
        if (sourceAbortRef.current === controller) setSourceLoading(false);
      }
    },
    [clearPlan, fetchFamily, marketplaceId, onContextResolved],
  );
  const lookupTarget = useCallback(
    async (input: string, kind: IdentifierType) => {
      if (operationRef.current) return;
      const identifier =
        kind === "asin" ? input.trim().toUpperCase() : input.trim();
      if (
        !identifier ||
        (kind === "asin" && !/^[A-Z0-9]{10}$/u.test(identifier))
      ) {
        setTargetError(
          kind === "asin"
            ? "請輸入完整 10 碼 ASIN。"
            : "請輸入目標 parent 或其 child SKU。",
        );
        return;
      }
      targetAbortRef.current?.abort();
      recoveryAbortRef.current?.abort();
      const controller = new AbortController();
      targetAbortRef.current = controller;
      preparationAbortRef.current?.abort();
      setTargetLoading(true);
      setTargetError(null);
      setTargetFamily(null);
      setPreparations({});
      setSelectedFieldChoices({});
      setPreservedSelections({});
      setPreview(null);
      setPreviewDiagnostics(null);
      setWorkflowError(null);
      setFailedPreviewAction(null);
      try {
        const family = await fetchFamily(identifier, kind, controller.signal);
        if (controller.signal.aborted || targetAbortRef.current !== controller)
          return;
        const parent = parentOf(family);
        if (!parent)
          throw new Error(
            "這個 SKU 沒有可確認的目標 parent；請改用其他 family。",
          );
        setTargetFamily(family);
        setTargetInput(parent.sellerSku);
        setTargetIdentifierType("sku");
      } catch (error) {
        if (!controller.signal.aborted)
          setTargetError(
            error instanceof Error ? error.message : "目標讀取失敗。",
          );
      } finally {
        if (targetAbortRef.current === controller) setTargetLoading(false);
      }
    },
    [fetchFamily],
  );
  const runSourceLookup = useCallback(
    () => void lookupSource(sourceInput, sourceIdentifierType),
    [lookupSource, sourceInput, sourceIdentifierType],
  );
  const runTargetLookup = useCallback(
    () => void lookupTarget(targetInput, targetIdentifierType),
    [lookupTarget, targetInput, targetIdentifierType],
  );
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
    void lookupSource(initialSellerSku, "sku");
  }, [initialSellerSku, lookupSource]);

  const prepareSelected = useCallback(
    async (member: VariationMemberView, target: VariationFamilyView | null) => {
      preparationAbortRef.current?.abort();
      const controller = new AbortController();
      preparationAbortRef.current = controller;
      setPreparing(true);
      setPreparations({});
      setSelectedFieldChoices({});
      setPreservedSelections({});
      setPreview(null);
      setPreviewDiagnostics(null);
      setWorkflowError(null);
      setFailedPreviewAction(null);
      const actions: VariationMoveAction[] = [
        ...(member.parentSku ? ["detach" as const] : []),
        ...(target ? ["attach" as const] : []),
      ];
      try {
        const key = `${marketplaceId}:${member.sellerSku}`;
        let recovered;
        try {
          recovered = await fetchRecovery(member.sellerSku, sourceFamily?.mode ?? auditMode, controller.signal);
        } catch (error) {
          if (controller.signal.aborted || preparationAbortRef.current !== controller) return;
          unresolvedSkusRef.current.add(key);
          setUncertain(true);
          throw error;
        }
        if (controller.signal.aborted || preparationAbortRef.current !== controller) return;
        if (unresolvedSkusRef.current.has(key) || recovered?.status === "pending" || recovered?.status === "unknown") {
          unresolvedSkusRef.current.add(key);
          if (recovered?.action && !unresolvedIntentsRef.current.has(key)) {
            unresolvedIntentsRef.current.set(key, {
              action: recovered.action, sourceParentSku: recovered.sourceParentSku, targetParentSku: recovered.targetParentSku,
            });
          }
          setUncertain(true);
          setWorkflowError(recovered === null
            ? "請更新 AMZ.API Notebook Key 至 0.1.63 或更新版本，以完成唯讀回查；目前操作仍禁止重送。"
            : "找到尚待確認的變體操作，請先重新讀取 Amazon 狀態。");
          return;
        }
        // A durable receipt is visible history, never a Preview for this new plan.
        setRecoveredReceipt(recovered?.status === "verified" ? recovered.result : null);
        const next: PreparedStages = {};
        const outcomes = await Promise.allSettled(
          actions.map(async (action) => {
            const targetSku =
              action === "attach" && target
                ? (parentOf(target)?.sellerSku ?? null)
                : null;
            const params = new URLSearchParams({
              marketplaceId,
              sku: member.sellerSku,
              action,
            });
            if (targetSku) params.set("targetSku", targetSku);
            const response = await fetch(
              `/api/sp-api/variation-move?${params}`,
              { cache: "no-store", signal: controller.signal },
            );
            if (!response.ok)
              throw await responseError(response, "無法讀取 Amazon 必填資料。");
            return [
              action,
              parseVariationMovePreparation(await response.json(), {
                marketplaceId,
                sellerSku: member.sellerSku,
                targetParentSku: targetSku,
                action,
              }),
            ] as const;
          }),
        );
        if (
          controller.signal.aborted ||
          preparationAbortRef.current !== controller
        )
          return;
        const results = outcomes.flatMap((outcome) =>
          outcome.status === "fulfilled" ? [outcome.value] : [],
        );
        const errors = outcomes.flatMap((outcome) =>
          outcome.status === "rejected"
            ? [
                outcome.reason instanceof Error
                  ? outcome.reason.message
                  : "必填資料讀取失敗。",
              ]
            : [],
        );
        if (errors.length) setWorkflowError(errors.join(" "));
        for (const [action, preparation] of results) next[action] = preparation;
        setPreparations(next);
        const defaults = Object.assign(
          {},
          ...results.map(([, preparation]) =>
            initialVariationDimensionValues(preparation),
          ),
        ) as Values;
        setValues((current) =>
          Object.fromEntries(
            Object.entries(defaults).map(([name, defaultsForField]) => [
              name,
              results.some(([, preparation]) =>
                preparation.fields.some(
                  (field) => field.name === name && !field.editable,
                ),
              )
                ? defaultsForField
                : (current[name] ?? defaultsForField),
            ]),
          ),
        );
        setJsonDrafts((current) => ({
          ...Object.fromEntries(
            Object.entries(defaults).map(([name, rows]) => [
              name,
              JSON.stringify(rows, null, 2),
            ]),
          ),
          ...current,
        }));
      } catch (error) {
        if (!controller.signal.aborted)
          setWorkflowError(
            error instanceof Error ? error.message : "必填資料讀取失敗。",
          );
      } finally {
        if (preparationAbortRef.current === controller) setPreparing(false);
      }
    },
    [marketplaceId, fetchRecovery, sourceFamily?.mode, auditMode],
  );
  useEffect(() => {
    if (stagedMember) void prepareSelected(stagedMember, targetFamily);
  }, [stagedMember, targetFamily, prepareSelected]);
  const selectUnbound = async (
    row: UnboundVariationAuditRow,
    recommendation: UnboundFamilyRecommendation | null,
    targetSku?: string,
  ) => {
    if (busy || operationRef.current) return;
    sourceAbortRef.current?.abort();
    targetAbortRef.current?.abort();
    const controller = new AbortController();
    sourceAbortRef.current = controller;
    targetAbortRef.current = controller;
    clearPlan();
    setSourceLoading(true);
    setTargetLoading(Boolean(targetSku));
    setSourceError(null);
    setTargetError(null);
    setSourceFamily(null);
    setTargetFamily(null);
    setTargetInput("");
    setStagedMember(null);
    setUnboundSelection(null);
    try {
      const [source, target] = await Promise.all([
        fetchFamily(row.sellerSku, "sku", controller.signal),
        targetSku
          ? fetchFamily(targetSku, "sku", controller.signal)
          : Promise.resolve(null),
      ]);
      if (controller.signal.aborted || sourceAbortRef.current !== controller)
        return;
      if (
        !source.familyComplete ||
        source.mode !== auditMode ||
        source.queried.role !== "standalone" ||
        source.queried.parentSku !== null ||
        !source.queried.fba ||
        !source.queried.relationshipSources.includes("relationships") ||
        source.queried.asin !== row.asin ||
        source.queried.productType !== row.productType
      ) {
        throw new Error(
          `${row.sellerSku} 目前已不是可確認的獨立 FBA 商品，或商品資料已變更。請重新掃描；本次未準備寫入。`,
        );
      }
      if (
        target &&
        (!target.familyComplete ||
          target.mode !== source.mode ||
          parentOf(target)?.sellerSku !== targetSku ||
          parentOf(target)?.productType !== row.productType)
      ) {
        throw new Error(
          "建議 family 的最新資料與來源商品不相容或尚未完整；請重新選擇目標。",
        );
      }
      setSourceInput(row.sellerSku);
      setSourceIdentifierType("sku");
      setSourceFamily(source);
      setSourceFilter("");
      setStagedMember(source.queried);
      setOriginalParentSku(null);
      setStagedState("detached");
      setUncertain(
        unresolvedSkusRef.current.has(`${marketplaceId}:${row.sellerSku}`),
      );
      setUnboundSelection({ row, recommendation });
      setShowUnbound(false);
      if (target) {
        setTargetFamily(target);
        setTargetInput(targetSku!);
        setTargetIdentifierType("sku");
      }
      autoLookupRef.current = true;
      onContextResolved?.(marketplaceId, row.sellerSku);
    } catch (error) {
      if (!controller.signal.aborted)
        setSourceError(
          error instanceof Error
            ? error.message
            : "未能重新核對商品，請重新掃描。",
        );
      controller.abort();
    } finally {
      if (sourceAbortRef.current === controller) setSourceLoading(false);
      if (targetAbortRef.current === controller) setTargetLoading(false);
    }
  };
  const stageMember = (member: VariationMemberView) => {
    if (busy || operationRef.current) return;
    clearPlan();
    setStagedMember(member);
    setOriginalParentSku(member.parentSku);
    setStagedState(member.parentSku ? "planned" : "detached");
    setUncertain(
      unresolvedSkusRef.current.has(`${marketplaceId}:${member.sellerSku}`),
    );
  };
  const changeMarketplace = (next: string) => {
    if (operationRef.current) return;
    sourceAbortRef.current?.abort();
    targetAbortRef.current?.abort();
    clearPlan();
    setMarketplaceId(next);
    setUnboundSelection(null);
    setShowUnbound(true);
    setSourceInput("");
    setTargetInput("");
    setSourceFamily(null);
    setTargetFamily(null);
    setStagedMember(null);
    setSourceError(null);
    setTargetError(null);
    setUncertain(false);
  };
  const discardPreparedEvidence = () => {
    setPreparations({});
    setSelectedFieldChoices({});
    setPreservedSelections({});
    setPreview(null);
  };
  const preparationFor = (action: VariationMoveAction) => {
    const prepared = preparations[action];
    if (!prepared) return null;
    return {
      ...prepared,
      requiredFields: [
        ...prepared.requiredFields,
        ...(selectedFieldChoices[action] ?? []).filter(
          (choice) => !prepared.requiredFields.some((field) => field.name === choice.name),
        ),
      ],
    };
  };
  const missingFor = (action: VariationMoveAction) => {
    const prepared = preparationFor(action);
    if (!prepared) return ["等待讀取必填資料"];
    const needsChoice = prepared.requiredFieldChoices?.some(
      (choice) => choice.editable && !choice.jsonFallback &&
        !prepared.requiredFields.some((field) => field.name === choice.name),
    ) &&
      !selectedFieldChoices[action]?.length;
    return [
      ...missingVariationFields(prepared, values),
      ...(needsChoice ? ["選擇要補充的商品欄位"] : []),
      ...(prepared.preservedRequiredFields ?? [])
        .filter((field) => !preservedSelections[action]?.includes(field.name))
        .map((field) => `確認保留既有答案：${fieldLabel(field)}`),
    ];
  };
  const canPreview = (action: VariationMoveAction) =>
    Boolean(
      stagedMember &&
      preparations[action]?.writable &&
        !preparationFor(action)?.requiredFields.some(
          (field) => !field.editable,
        ) &&
      sourceFamily?.mode === "live" &&
      sourceFamily.familyComplete &&
      !preparations[action]?.blockers.length &&
      !missingFor(action).length &&
      !Object.values(fieldErrors).some(Boolean) &&
      !busy &&
      !uncertain &&
      (action === "detach"
        ? stagedState === "planned"
        : stagedState === "detached" && plan?.status !== "blocked"),
    );
  const pickValues = (names: string[]) =>
    Object.fromEntries(names.map((name) => [name, values[name] ?? []]));
  const runPreview = async (action: VariationMoveAction) => {
    if (operationRef.current || !canPreview(action) || !stagedMember) return;
    const prepared = preparationFor(action)!;
    const body: WriteBody = {
      action,
      marketplaceId,
      sellerSku: stagedMember.sellerSku,
      expectedSourceParentSku:
        action === "detach" ? stagedMember.parentSku : null,
      targetParentSku: action === "attach" ? prepared.targetParentSku : null,
      variationTheme: action === "attach" ? prepared.variationTheme : null,
      dimensionNames: prepared.dimensionNames,
      dimensionValues: pickValues(prepared.dimensionNames),
      requiredValues: pickValues(
        prepared.requiredFields.map((field) => field.name),
      ),
      ...(preservedSelections[action]?.length
        ? { preserveRequiredFields: preservedSelections[action] }
        : {}),
      idempotencyKey: crypto.randomUUID(),
    };
    operationRef.current = true;
    setWriteAction(action);
    setPreview(null);
    setPreviewDiagnostics(null);
    setWorkflowError(null);
    setFailedPreviewAction(null);
    try {
      const response = await fetch("/api/sp-api/variation-move", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok)
        throw await responseError(response, "Amazon 變體預檢失敗。");
      const result = parseVariationMovePreview(await response.json(), {
        action,
        marketplaceId,
        sellerSku: stagedMember.sellerSku,
        preservedRequiredFields: prepared.preservedRequiredFields?.filter((field) =>
          body.preserveRequiredFields?.includes(field.name),
        ),
      });
      setPreview({ body, result });
    } catch (error) {
      setFailedPreviewAction(action);
      setPreviewDiagnostics(
        error instanceof VariationRequestError ? error.diagnostics : null,
      );
      if (
        error instanceof VariationRequestError &&
        (error.requiredFields?.length || error.requiredFieldChoices?.length ||
          error.preservedRequiredFields?.length) &&
        error.binding?.action === body.action &&
        error.binding.marketplaceId === body.marketplaceId &&
        error.binding.sellerSku === body.sellerSku &&
        error.binding.targetParentSku === body.targetParentSku
      ) {
        const additional = error.requiredFields ?? [];
        const choices = error.requiredFieldChoices;
        const preserved = error.preservedRequiredFields;
        const previousPreparation = preparations[action]!;
        focusRequiredFieldsRef.current = !preserved?.length;
        focusPreservedFieldsRef.current = Boolean(preserved?.length);
        setPreparations((current) => ({
          ...current,
          [action]: {
            ...previousPreparation,
            requiredFields: [
              ...new Map(
                [...previousPreparation.requiredFields, ...additional].map(
                  (field) => [field.name, field],
                ),
              ).values(),
            ],
            requiredFieldChoices: choices ?? previousPreparation.requiredFieldChoices,
            preservedRequiredFields: preserved ?? previousPreparation.preservedRequiredFields,
          },
        }));
        if (preserved) setPreservedSelections((current) => ({ ...current, [action]: [] }));
        setSelectedFieldChoices((current) => ({
          ...current,
          [action]: (current[action] ?? []).filter(
            (choice) => !additional.some((field) => field.name === choice.name) &&
              (!choices || choices.some((field) => field.name === choice.name)),
          ),
        }));
        const defaults = initialVariationDimensionValues({
          ...prepared,
          fields: [],
          requiredFields: additional,
        });
        setValues((current) => ({ ...defaults, ...current }));
        setJsonDrafts((current) => ({
          ...Object.fromEntries(
            Object.entries(defaults).map(([name, rows]) => [
              name,
              JSON.stringify(rows, null, 2),
            ]),
          ),
          ...current,
        }));
        setWorkflowError(
          preserved?.length
            ? "Amazon 要求再次提供現有商品資料。請在上方確認保留既有答案，再檢查綁定或解除內容。"
            : additional.length
            ? `Amazon 需要補充資料，已在上方加入欄位：${additional.map(fieldLabel).join("、")}。填完後可重新檢查；尚未送出修改。`
            : "Amazon 預檢未通過，無法確認要補的欄位。請在上方選擇要補充的商品資料，再重新檢查；尚未送出修改。",
        );
      } else {
        if (error instanceof VariationRequestError &&
          ["PREVIEW_CHANGED", "VARIATION_REQUIREMENTS_CHANGED"].includes(error.code ?? "")) {
          discardPreparedEvidence();
        }
        setWorkflowError(
          error instanceof Error ? error.message : "預檢未完成。",
        );
      }
    } finally {
      operationRef.current = false;
      setWriteAction(null);
    }
  };
  const runWrite = async () => {
    if (
      !preview ||
      preview.body.idempotencyKey !== previewKeyRef.current ||
      !stagedMember ||
      operationRef.current ||
      sentKeysRef.current.has(preview.body.idempotencyKey) ||
      uncertain
    )
      return;
    const { body } = preview;
    operationRef.current = true;
    sentKeysRef.current.add(body.idempotencyKey);
    setWriteAction(body.action);
    setPreviewDiagnostics(null);
    setWorkflowError(null);
    setLastResult(null);
    try {
      // The main-owned gate revalidates this exact preview and obtains native approval.
      const response = await fetch("/api/sp-api/variation-move", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok)
        throw await responseError(response, "Amazon 變體寫入或回查未完成。");
      const result = parseVariationMoveResult(await response.json(), {
        action: body.action,
        marketplaceId,
        sellerSku: body.sellerSku,
      });
      setLastResult(result);
      setPreview(null);
      setPreviewDiagnostics(null);
      setStagedState(body.action === "detach" ? "detached" : "attached");
      if (body.action === "detach")
        setStagedMember((current) =>
          current
            ? { ...current, role: "standalone", parentSku: null }
            : current,
        );
    } catch (error) {
      setPreview(null);
      setPreviewDiagnostics(null);
      if (
        error instanceof VariationRequestError &&
        [
          "ACTION_CANCELLED",
          "PREVIEW_EXPIRED",
          "PREVIEW_CHANGED",
          "VARIATION_REQUIREMENTS_CHANGED",
        ].includes(error.code ?? "")
      ) {
        const changed = ["PREVIEW_CHANGED", "VARIATION_REQUIREMENTS_CHANGED"].includes(error.code ?? "");
        if (changed) discardPreparedEvidence();
        setWorkflowError(`${error.message} 尚未送出修改，${changed ? "請重新讀取必填欄位後再檢查。" : "可重新檢查後再確認。"}`);
      } else {
        unresolvedSkusRef.current.add(`${marketplaceId}:${body.sellerSku}`);
        unresolvedIntentsRef.current.set(`${marketplaceId}:${body.sellerSku}`, {
          action: body.action, sourceParentSku: body.expectedSourceParentSku, targetParentSku: body.targetParentSku,
        });
        setUncertain(true);
        setWorkflowError(
          error instanceof Error ? error.message : "結果待確認；請勿重送。",
        );
      }
    } finally {
      operationRef.current = false;
      setWriteAction(null);
    }
  };
  const readCurrentState = async () => {
    if (!stagedMember || operationRef.current || busy) return;
    recoveryAbortRef.current?.abort();
    const controller = new AbortController();
    recoveryAbortRef.current = controller;
    const key = `${marketplaceId}:${stagedMember.sellerSku}`;
    const intent = unresolvedIntentsRef.current.get(key);
    const scope = recoveryScopeRef.current;
    const isCurrent = () => !controller.signal.aborted && recoveryAbortRef.current === controller && recoveryScopeRef.current === scope;
    setRecovering(true);
    try {
      const recovered = await fetchRecovery(stagedMember.sellerSku, sourceFamily?.mode ?? auditMode, controller.signal, intent);
      if (!isCurrent()) return;
      if (recovered === null) throw new Error("請更新 AMZ.API Notebook Key 至 0.1.63 或更新版本，以完成唯讀回查；目前操作仍禁止重送。");
      if (recovered.status !== "verified" || !recovered.result ||
        (!intent && stagedMember.parentSku !== recovered.sourceParentSku && stagedMember.parentSku !== recovered.targetParentSku) ||
        (recovered.action === "attach" && targetFamily && parentOf(targetFamily)?.sellerSku !== recovered.targetParentSku)) {
        setWorkflowError(`目前 Amazon 回傳 Parent：${recovered.observedParentSku ?? "無 parent"}。尚未證明本次操作完成，仍禁止重送。`);
        return;
      }
      unresolvedSkusRef.current.delete(key);
      unresolvedIntentsRef.current.delete(key);
      setUncertain(false);
      setWorkflowError(null);
      setPreview(null);
      setLastResult(recovered.result);
      setRecoveredReceipt(recovered.result);
      setStagedState(recovered.action === "detach" ? "detached" : "attached");
      if (recovered.action === "detach") setStagedMember((current) => current
        ? { ...current, role: "standalone", parentSku: null } : current);
    } catch (error) {
      if (isCurrent()) setWorkflowError(
        error instanceof Error ? error.message : "狀態讀取未完成。",
      );
    } finally {
      if (recoveryAbortRef.current === controller) setRecovering(false);
    }
  };
  const updateLeaf = (
    field: VariationFieldView,
    leaf: VariationFieldLeafView,
    value: string | number | boolean | null,
  ) => {
    setPreview(null);
    setPreviewDiagnostics(null);
    setValues((current) =>
      updateVariationLeaf({
        values: current,
        fieldName: field.name,
        path: leaf.path,
        value,
      }),
    );
    setFieldErrors((current) => ({ ...current, [field.name]: "" }));
  };
  const chooseField = (action: VariationMoveAction, name: string) => {
    if (busy || uncertain || stagedState === "attached") return;
    const prepared = preparations[action];
    const choice = prepared?.requiredFieldChoices?.find(
      (field) => field.name === name && field.editable && !field.jsonFallback &&
        !prepared.requiredFields.some((required) => required.name === name) &&
        !selectedFieldChoices[action]?.some((selected) => selected.name === name),
    );
    if (!prepared || !choice) return;
    setPreview(null);
    setPreviewDiagnostics(null);
    focusRequiredFieldsRef.current = true;
    setSelectedFieldChoices((current) => ({
      ...current,
      [action]: [...(current[action] ?? []), choice],
    }));
    const defaults = initialVariationDimensionValues({
      ...prepared,
      fields: [],
      requiredFields: [choice],
    });
    setValues((current) => ({ ...defaults, ...current }));
  };
  const removeSelectedField = (name: string) => {
    if (busy || uncertain || stagedState === "attached") return;
    setPreview(null);
    setPreviewDiagnostics(null);
    setSelectedFieldChoices((current) =>
      Object.fromEntries(Object.entries(current).map(([action, fields]) => [
        action,
        fields.filter((field) => field.name !== name),
      ])),
    );
  };
  const choosePreservedField = (action: VariationMoveAction, name: string, checked: boolean) => {
    if (busy || operationRef.current || uncertain || stagedState === "attached" ||
      !preparations[action]?.preservedRequiredFields?.some((field) => field.name === name)) return;
    setPreview(null);
    setPreviewDiagnostics(null);
    setPreservedSelections((current) => ({
      ...current,
      [action]: checked
        ? [...new Set([...(current[action] ?? []), name])]
        : (current[action] ?? []).filter((fieldName) => fieldName !== name),
    }));
  };
  const renderEditor = (field: VariationFieldView, fillOnly = false) => (
    <VariationFieldEditor
      fillOnly={fillOnly}
      key={field.name}
      field={field}
      values={values[field.name] ?? []}
      jsonDraft={jsonDrafts[field.name] ?? ""}
      error={fieldErrors[field.name]}
      disabled={
        busy || stagedState === "attached" || uncertain || !field.editable
      }
      onLeafChange={(leaf, value) => updateLeaf(field, leaf, value)}
      onRemove={
        Object.values(selectedFieldChoices).some((fields) =>
          fields.some((choice) => choice.name === field.name),
        ) &&
        !Object.values(preparations).some((prepared) =>
          prepared?.requiredFields.some((required) => required.name === field.name),
        )
          ? () => removeSelectedField(field.name)
          : undefined
      }
      onJsonDraftChange={(text) => {
        setPreview(null);
        setPreviewDiagnostics(null);
        setJsonDrafts((current) => ({ ...current, [field.name]: text }));
        try {
          const rows = parseVariationJsonValues({ text, marketplaceId });
          setValues((current) => ({ ...current, [field.name]: rows }));
          setFieldErrors((current) => ({ ...current, [field.name]: "" }));
        } catch (error) {
          setFieldErrors((current) => ({
            ...current,
            [field.name]:
              error instanceof Error ? error.message : "格式不正確。",
          }));
        }
      }}
    />
  );

  const content = (
    <>
      <div className="drawer-header variation-workspace-header">
        {presentation === "workspace" && (
          <button
            type="button"
            className="variation-workspace-back"
            onClick={closeDrawer}
            disabled={busy}
            aria-label={workspaceBackLabel === "回首頁"
              ? "返回 AMZ.API 首頁"
              : workspaceBackLabel}
          >
            ← {workspaceBackLabel}
          </button>
        )}
        <div>
          <p className="eyebrow">VARIATION WORKSPACE</p>
          <h2 id="variation-planner-title" ref={headingRef} tabIndex={-1}>
            變體規劃與改掛
          </h2>
          <p>選商品、補齊資料，再分別確認解除與綁定。</p>
        </div>
        {presentation === "drawer" && (
          <button
            type="button"
            onClick={closeDrawer}
            disabled={busy}
            autoFocus
            aria-label="關閉變體規劃"
          >
            ×
          </button>
        )}
      </div>
      <ol className="variation-stepper" aria-label="變體操作步驟">
        <li className={sourceFamily ? "done" : "current"}>
          <span>01</span>查詢與選擇
        </li>
        <li className={stagedMember ? "current" : ""}>
          <span>02</span>參考與填寫
        </li>
        <li
          className={
            stagedState === "detached" || stagedState === "attached"
              ? "done"
              : ""
          }
        >
          <span>03</span>解除舊關係
        </li>
        <li className={stagedState === "attached" ? "done" : ""}>
          <span>04</span>綁定新關係
        </li>
      </ol>
      <label className="variation-marketplace">
        <span>Amazon 站點</span>
        <select
          aria-label="Amazon 站點"
          value={marketplaceId}
          onChange={(event) => changeMarketplace(event.target.value)}
          disabled={busy}
        >
          {MARKETPLACES.map((option) => (
            <option key={option.id} value={option.id}>
              {marketplaceSelectLabel(option)}
            </option>
          ))}
        </select>
        <small>FBA 商品限定 · 每次處理一個 Seller SKU</small>
      </label>
      <div className="variation-entry-options" aria-label="選擇商品來源">
        <button
          type="button"
          aria-pressed={showUnbound}
          disabled={busy}
          onClick={() => setShowUnbound(true)}
        >
          從未綁清單開始
        </button>
        <button
          type="button"
          aria-pressed={!showUnbound}
          disabled={busy}
          onClick={() => setShowUnbound(false)}
        >
          輸入 SKU 拆／綁
        </button>
      </div>
      {showUnbound && (
        <section
          className="variation-workspace-section"
          aria-labelledby="variation-unbound-title"
        >
          <SectionTitle
            step="01"
            id="variation-unbound-title"
            title="未綁 FBA 商品"
            detail="沿用未綁變體健檢；選一個商品，直接準備綁定。"
          />
          <UnboundVariationAuditPanel
            marketplaceId={marketplaceId}
            marketplaceShort={marketplace.shortLabel}
            mode={auditMode}
            presentation="picker"
            disabled={busy}
            cachedResult={auditCache}
            initialJob={auditJob}
            onCachedResultChange={onAuditCacheChange}
            onJobChange={onAuditJobChange}
            onOpenSku={(sku) => void lookupSource(sku, "sku")}
            onSelectUnbound={(row, recommendation) =>
              void selectUnbound(row, recommendation)
            }
          />
          {sourceLoading && (
            <p role="status">正在重新核對來源與目標的 Amazon 資料…</p>
          )}
          {sourceError && (
            <p className="price-error" role="alert">
              {sourceError}
            </p>
          )}
        </section>
      )}
      {!showUnbound && (
        <>
          {unboundSelection && (
            <section
              className="variation-workspace-section"
              aria-labelledby="variation-recommendations-title"
            >
              <SectionTitle
                step="選"
                id="variation-recommendations-title"
                title={`${unboundSelection.row.sellerSku} 的 family 建議`}
                detail="比較同系列已綁商品；選擇後重新讀取兩邊最新資料。"
              />
              {unboundSelection.recommendation?.status === "tied" && (
                <p className="variation-warning">
                  最高同系列數量相同，沒有唯一首選；請比較商品及維度後自行選擇。
                </p>
              )}
              {unboundSelection.recommendation?.candidates.length ? (
                <div className="variation-table-scroll">
                  <table
                    className="variation-recommendations-table"
                    aria-label="建議目標 family 比較"
                  >
                    <colgroup>
                      <col style={{ width: 140 }} />
                      <col style={{ width: 220 }} />
                      <col />
                      <col style={{ width: 130 }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>證據星等</th>
                        <th>Parent SKU／主題</th>
                        <th>相似成員與原因</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unboundSelection.recommendation.candidates.map(
                        (candidate) => (
                          <tr key={candidate.parentSku}>
                            <td>
                              <strong>
                                {"★".repeat(candidate.stars)}
                                {"☆".repeat(3 - candidate.stars)}
                              </strong>
                              <small>
                                {candidate.tied ? "並列候選" : "同系列證據"}
                              </small>
                              <small>
                                相似 {candidate.matchingChildCount}／已讀取{" "}
                                {candidate.familyChildCount} 個
                              </small>
                            </td>
                            <td>
                              <strong>{candidate.parentSku}</strong>
                              <small>{candidate.variationTheme}</small>
                              {candidate.parentTitle && (
                                <span
                                  className="variation-cell-clamp"
                                  title={candidate.parentTitle}
                                >
                                  {candidate.parentTitle}
                                </span>
                              )}
                            </td>
                            <td>
                              <strong>
                                {candidate.matchingChildSkus.join(" · ")}
                                {candidate.matchingChildCount >
                                candidate.matchingChildSkus.length
                                  ? " …"
                                  : ""}
                              </strong>
                              {candidate.reasons.map((reason) => (
                                <small key={reason}>{reason}</small>
                              ))}
                            </td>
                            <td>
                              <button
                                type="button"
                                disabled={
                                  busy ||
                                  uncertain ||
                                  stagedState === "attached"
                                }
                                aria-label={`選擇建議 family ${candidate.parentSku}`}
                                onClick={() =>
                                  void selectUnbound(
                                    unboundSelection.row,
                                    unboundSelection.recommendation,
                                    candidate.parentSku,
                                  )
                                }
                              >
                                選擇此 family
                              </button>
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="variation-form-note">
                  ☆{" "}
                  {unboundSelection.recommendation
                    ? "沒有足夠且一致的同系列證據，請在下方輸入目標 family。"
                    : "這份健檢快照尚未提供 family 建議。可重新掃描，或在下方輸入目標；新版建議需要更新 Notebook Key。"}
                </p>
              )}
              <p className="variation-form-note">
                {unboundSelection.recommendation?.notice ??
                  "相似 SKU 不代表一定可合併，仍須檢查商品事實、主題與維度。"}
              </p>
            </section>
          )}
      <section
        className="variation-workspace-section"
        aria-labelledby="variation-lookup-title"
      >
        <SectionTitle
          step="01"
          id="variation-lookup-title"
          title="查詢來源與目標"
          detail="SKU 或 ASIN 查詢；只解除時可不填目標。"
        />
        <div className="variation-lookup-grid">
          <div className="variation-lookup source">
            <h4>來源 family</h4>
            <div className="variation-search-row">
              <select
                aria-label="來源查詢識別類型"
                value={sourceIdentifierType}
                disabled={busy}
                onChange={(event) => {
                      setSourceIdentifierType(
                        event.target.value as IdentifierType,
                      );
                  setSourceInput("");
                }}
              >
                <option value="sku">SKU</option>
                <option value="asin">ASIN</option>
              </select>
              <input
                aria-label={
                  sourceIdentifierType === "asin"
                    ? "來源 ASIN"
                    : "來源 Seller SKU"
                }
                value={sourceInput}
                onChange={(event) => setSourceInput(event.target.value)}
                onKeyDown={handleSourceKeyDown}
                placeholder={
                  sourceIdentifierType === "asin"
                    ? "完整 10 碼 ASIN"
                    : marketplace.sampleSku
                }
                maxLength={sourceIdentifierType === "asin" ? 10 : 40}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                data-variation-lookup="source"
                onClick={runSourceLookup}
                disabled={busy || !sourceInput.trim()}
              >
                {sourceLoading ? "讀取中…" : "讀取"}
              </button>
            </div>
            {sourceError && (
              <p role="alert" className="price-error">
                {sourceError}
              </p>
            )}
          </div>
          <div className="variation-lookup target">
            <h4>
              目標 family <small>選填</small>
            </h4>
            <div className="variation-search-row">
              <select
                aria-label="目標查詢識別類型"
                value={targetIdentifierType}
                disabled={busy}
                onChange={(event) => {
                      setTargetIdentifierType(
                        event.target.value as IdentifierType,
                      );
                  setTargetInput("");
                }}
              >
                <option value="sku">SKU</option>
                <option value="asin">ASIN</option>
              </select>
              <input
                aria-label={
                  targetIdentifierType === "asin"
                    ? "目標 ASIN"
                    : "目標 Parent SKU"
                }
                value={targetInput}
                onChange={(event) => setTargetInput(event.target.value)}
                onKeyDown={handleTargetKeyDown}
                placeholder="目標 parent 或 child"
                maxLength={targetIdentifierType === "asin" ? 10 : 40}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                data-variation-lookup="target"
                onClick={runTargetLookup}
                disabled={busy || !targetInput.trim()}
              >
                {targetLoading ? "讀取中…" : "讀取"}
              </button>
            </div>
            {targetFamily && (
              <button
                className="variation-text-button"
                disabled={busy}
                onClick={() => {
                  setTargetFamily(null);
                  setTargetInput("");
                  setPreview(null);
                  setPreviewDiagnostics(null);
                }}
              >
                移除目標，僅解除
              </button>
            )}
            {targetError && (
              <p role="alert" className="price-error">
                {targetError}
              </p>
            )}
          </div>
        </div>
        <FamilyComparison source={sourceFamily} target={targetFamily} />
        {(sourceFamily || targetFamily) && (
          <div className="variation-family-warnings">
            {[sourceFamily, targetFamily].filter(Boolean).map((family) => (
              <div key={family!.queriedSku}>
                {!family!.familyComplete && (
                  <p className="variation-warning">
                    {family === sourceFamily ? "來源" : "目標"} family
                    尚未完整讀取，操作已停用。
                  </p>
                )}
                {family!.excludedChildren.map((item) => (
                  <p className="variation-warning" key={item.sellerSku}>
                    {item.sellerSku}：{item.reason}
                  </p>
                ))}
              </div>
            ))}
          </div>
        )}
        <div className="variation-table-heading">
          <h4>
            來源 FBA 商品 <span>{sourceMembers.length}</span>
          </h4>
          {sourceMembers.length > 0 && (
            <input
              aria-label="篩選來源商品"
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value)}
              placeholder="搜尋 SKU 或商品名稱"
            />
          )}
        </div>
        <MemberTable
          members={filteredSourceMembers}
          dimensions={sourceFamily?.dimensionNames ?? []}
          selectedSku={stagedMember?.sellerSku}
          disabled={busy}
          onSelect={stageMember}
          label="來源商品選擇"
        />
        {!sourceFamily && (
          <p className="variation-empty">
            讀取來源後，選擇要解除或改掛的商品。
          </p>
        )}
      </section>
      <section
        className="variation-workspace-section"
        aria-labelledby="variation-fields-title"
      >
        <SectionTitle
          step="02"
          id="variation-fields-title"
          title="參考變體，補齊商品資料"
          detail="先填寫、再檢查；此處不會修改 Amazon。"
        />
        {stagedMember ? (
          <div className="variation-selection">
            <strong>{stagedMember.sellerSku}</strong>
            <span>{stagedMember.title}</span>
            <small>
              {stagedState === "planned"
                ? `目前 Parent：${originalParentSku}`
                : stagedState === "detached"
                  ? "已確認為獨立 SKU，可綁定目標"
                  : `已綁定：${lastResult?.targetParentSku ?? preparations.attach?.targetParentSku ?? targetFamily?.queriedSku}`}
            </small>
          </div>
        ) : (
          <p className="variation-empty">先從上方表格選一個商品。</p>
        )}
        {targetFamily && (
          <>
            <div className="variation-table-heading">
              <h4>目標現有變體參考</h4>
                  <span>
                    參考實際命名，請為所選商品填入正確且不重複的組合。
                  </span>
            </div>
            <MemberTable
              members={targetFamily.children}
              dimensions={targetFamily.dimensionNames}
              label="目標變體參考"
            />
          </>
        )}
        {preparing && (
          <p className="variation-loading" role="status">
            正在讀取 Amazon 必填欄位，包括變體與商品資料…
          </p>
        )}
        {plan?.blockers.length ? (
          <div className="variation-warning" role="alert">
            <strong>目標目前不可綁定</strong>
            <ul>
              {plan.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {preparations.attach && (
          <>
            <h4 className="variation-form-heading">
              新變體內容 <small>{preparations.attach.variationTheme}</small>
            </h4>
            <div className="variation-field-grid">
                  {preparations.attach.fields.map((field) =>
                    renderEditor(field),
                  )}
            </div>
          </>
        )}
        {Object.values(preparations).some((prepared) => prepared?.preservedRequiredFields?.length) && (
          <>
            <h4
              className="variation-form-heading"
              id="variation-preserved-fields-title"
              ref={preservedFieldsHeadingRef}
              tabIndex={-1}
            >
              保留現有商品資料
            </h4>
            <p className="variation-form-note">
              Amazon 要求再次提供此資料，答案保持不變。勾選後按下方「檢查」繼續。
            </p>
            {Object.entries(preparations).map(([stage, prepared]) => {
              const action = stage as VariationMoveAction;
              const stageLabel = action === "detach" ? "解除" : "綁定";
              return prepared?.preservedRequiredFields?.length ? (
                <div className="variation-table-scroll" key={action}>
                  <table className="variation-preserved-requirements" aria-label={`${stageLabel} · 保留現有商品資料`}>
                    <caption>{stageLabel} · ★ 已選擇保留　☆ 待確認</caption>
                    <thead>
                      <tr>
                        <th scope="col">商品資料</th>
                        <th scope="col">Amazon 現有答案</th>
                        <th scope="col">本次提供的答案</th>
                        <th scope="col">確認</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prepared.preservedRequiredFields.map((field) => {
                        const selected = preservedSelections[action]?.includes(field.name) ?? false;
                        return (
                          <tr key={field.name}>
                            <th scope="row">{fieldLabel(field)}</th>
                            <td>{readableValue(field.values)}</td>
                            <td>{readableValue(field.values)}</td>
                            <td>
                              <label className="variation-preserved-choice">
                                <input
                                  type="checkbox"
                                  aria-label={`${stageLabel} · ${fieldLabel(field)} · 保留既有答案並加入本次檢查`}
                                  checked={selected}
                                  disabled={busy || uncertain || stagedState === "attached"}
                                  onChange={(event) => choosePreservedField(action, field.name, event.target.checked)}
                                />
                                {selected ? "★ " : "☆ "}保留既有答案並加入本次檢查
                              </label>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null;
            })}
          </>
        )}
        {(requiredFields.length > 0 || Object.values(preparations).some(
          (prepared) => prepared?.requiredFieldChoices?.length,
        )) && (
          <>
            <h4
              className="variation-form-heading"
              id="variation-required-fields-title"
              ref={requiredFieldsHeadingRef}
              tabIndex={-1}
            >
              Amazon 必填商品資料／自選補充{" "}
              <span className="variation-required-badge">需要確認</span>
            </h4>
            <p className="variation-form-note">
              必填欄位與可選項目來自這個商品的 Amazon 定義。
              請依商品事實填寫；「否」也必須由你選擇。
            </p>
            {Object.entries(preparations).map(([action, prepared]) =>
              prepared?.requiredFieldChoices?.length ? (
                <label className="variation-field-card" key={action}>
                  <span>{action === "detach" ? "解除" : "綁定"}要補充的商品欄位</span>
                  <small>只加入你確認需要補充的欄位；候選項目不代表全部必填。</small>
                  <select
                    aria-label={`${action === "detach" ? "解除" : "綁定"}要補充的商品欄位`}
                    value=""
                    disabled={busy || uncertain || stagedState === "attached"}
                    onChange={(event) => chooseField(action as VariationMoveAction, event.target.value)}
                  >
                    <option value="">請選擇要補充的欄位</option>
                    {prepared.requiredFieldChoices.filter((choice) =>
                      choice.editable && !choice.jsonFallback &&
                      !prepared.requiredFields.some((field) => field.name === choice.name) &&
                      !selectedFieldChoices[action as VariationMoveAction]?.some((field) => field.name === choice.name),
                    ).map((choice) => (
                      <option key={choice.name} value={choice.name}>
                        {choice.label}（{choice.name}）
                      </option>
                    ))}
                  </select>
                </label>
              ) : null,
            )}
            <div className="variation-field-grid">
              {requiredFields.map((field) => renderEditor(field, true))}
            </div>
          </>
        )}
        {stagedMember &&
          !preparing &&
          !preparations.detach &&
          !preparations.attach && (
            <button
              className="variation-secondary-button"
              type="button"
              disabled={busy}
                  onClick={() =>
                    void prepareSelected(stagedMember, targetFamily)
                  }
            >
              重新讀取必填欄位
            </button>
          )}
        {Object.entries(preparations).flatMap(
          ([action, prepared]) =>
            prepared?.blockers.map((blocker) => (
              <p className="variation-warning" key={`${action}-${blocker}`}>
                {action === "detach" ? "解除" : "綁定"}：{blocker}
              </p>
            )) ?? [],
        )}
      </section>
      {workflowError && (
        <p className="price-error variation-workflow-error" role="alert">
          {workflowError}
        </p>
      )}
      {recoveredReceipt && (
        <div className="variation-table-scroll" role="status">
          <table aria-label="先前操作回查結果">
            <caption>★ 先前操作已由 Amazon 唯讀回查確認</caption>
            <thead><tr><th>Seller SKU</th><th>操作</th><th>原 Parent</th><th>完成後 Parent</th></tr></thead>
            <tbody><tr>
              <td>{recoveredReceipt.sellerSku}</td>
              <td>{recoveredReceipt.action === "detach" ? "解除" : "綁定"}</td>
              <td>{recoveredReceipt.sourceParentSku ?? "無 parent"}</td>
              <td>{recoveredReceipt.targetParentSku ?? "無 parent"}</td>
            </tr></tbody>
          </table>
          <p>新的修改仍須重新檢查內容並確認身分。</p>
        </div>
      )}
      {previewDiagnostics && <PreviewDiagnostics details={previewDiagnostics} />}
      {uncertain && (
        <div className="variation-unknown" role="status">
          <strong>結果待確認 · 已停止後續寫入</strong>
          <p>
            Notebook Key 可能已送出操作。請先讀取 Amazon
            現況；不會自動重送，也不會把尚未確認的解除當成完成。
          </p>
          {pendingIntent && (
            <p>
              待核對操作：{pendingIntent.action === "detach" ? "解除" : "綁定"}
              {" · "}{pendingIntent.sourceParentSku ?? "無 parent"}
              {" → "}{pendingIntent.targetParentSku ?? "無 parent"}
            </p>
          )}
          <button
            type="button"
            aria-label="重新讀取 Amazon 狀態"
            onClick={() => void readCurrentState()}
            disabled={busy}
          >
            重新讀取 Amazon 狀態
          </button>
        </div>
      )}
      <section
        className="variation-workspace-section"
        aria-labelledby="variation-confirm-title"
      >
        <SectionTitle
          step="03–04"
          id="variation-confirm-title"
          title="分階段檢查與確認"
          detail="每一步先顯示修改內容，再由 Notebook 鑰匙確認身分。"
        />
        <div className="variation-stage-grid">
          <div
            className={`variation-stage detach ${stagedState !== "planned" && stagedMember ? "complete" : ""}`}
          >
            <span className="variation-stage-number">03</span>
            <h4>解除舊關係</h4>
            <p>
              {stagedMember
                ? `${stagedMember.sellerSku} → 獨立 SKU`
                : "先選擇來源商品"}
            </p>
            {stagedMember && stagedState !== "planned" ? (
              <strong className="variation-success">
                ✓{" "}
                {originalParentSku
                  ? "解除已完成唯讀回查"
                  : "來源原本即為獨立 SKU"}
              </strong>
            ) : (
              <>
                <button
                  type="button"
                  className="variation-secondary-button"
                  aria-label="檢查解除內容"
                  disabled={!canPreview("detach")}
                  onClick={() => void runPreview("detach")}
                >
                  {writeAction === "detach" ? "處理中…" : "檢查解除內容"}
                </button>
                {stagedMember && missingFor("detach").length > 0 && (
                  <small>待填：{missingFor("detach").join("、")}</small>
                )}
                {failedPreviewAction === "detach" && !missingFor("detach").length && (
                  <small>預檢未通過，請依上方提示處理後重新檢查。</small>
                )}
              </>
            )}
          </div>
          <div
            className={`variation-stage attach ${stagedState === "attached" ? "complete" : ""}`}
          >
            <span className="variation-stage-number">04</span>
            <h4>綁定新關係</h4>
            <p>
              {targetFamily
                ? `加入 ${parentOf(targetFamily)?.sellerSku}`
                : "只解除時，完成上一步即可"}
            </p>
            {stagedState === "attached" ? (
              <strong className="variation-success">
                ✓ 綁定已完成唯讀回查
              </strong>
            ) : (
              <>
                <button
                  type="button"
                  className="variation-secondary-button"
                  aria-label="檢查綁定內容"
                  disabled={!canPreview("attach")}
                  onClick={() => void runPreview("attach")}
                >
                  {writeAction === "attach" ? "處理中…" : "檢查綁定內容"}
                </button>
                <small>
                  {stagedState === "planned"
                    ? "解除完成並回查後開放"
                    : !targetFamily
                      ? "請先讀取目標 family"
                      : missingFor("attach").length
                        ? `待填：${missingFor("attach").join("、")}`
                        : failedPreviewAction === "attach"
                          ? "預檢未通過，請依上方提示處理後重新檢查。"
                          : "目前欄位已填，仍須 Amazon 預檢確認"}
                </small>
              </>
            )}
          </div>
        </div>
        {sourceFamily?.mode === "demo" && (
          <p className="variation-warning">
            展示模式：可查看與填寫，Amazon 不會收到寫入。
          </p>
        )}
        {preview && (
          <div
            className="variation-preview"
            aria-labelledby="variation-preview-title"
          >
            <h4 id="variation-preview-title">
              {preview.body.action === "detach" ? "解除" : "綁定"}預檢通過 ·
              請確認修改內容
            </h4>
            <div className="variation-table-scroll">
              <table>
                    <caption>
                      ★ 已通過這次 Amazon 預檢；尚未送出正式修改
                    </caption>
                <thead>
                  <tr>
                    <th>欄位</th>
                    <th>修改前</th>
                    <th>修改後</th>
                  </tr>
                </thead>
                <tbody>
                  {!preview.result.changes?.some(
                    (change) => change.name === "parent_sku",
                  ) && (
                    <tr>
                      <th>Parent SKU</th>
                      <td>
                            {preview.body.expectedSourceParentSku ??
                              "無 parent"}
                      </td>
                      <td>{preview.body.targetParentSku ?? "無 parent"}</td>
                    </tr>
                  )}
                  {(preview.result.changes ?? []).map((change) => (
                    <tr key={change.name}>
                      <th>
                        {change.label}
                        {preview.body.preserveRequiredFields?.includes(change.name) && (
                          <small>保留既有答案；Amazon 要求再次提供</small>
                        )}
                      </th>
                      <td>
                            {change.name === "parent_sku" &&
                            change.before === null
                          ? "無 parent"
                          : readableValue(change.before)}
                      </td>
                      <td>
                            {change.name === "parent_sku" &&
                            change.after === null
                          ? "無 parent"
                          : readableValue(change.after)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
                  確認後將顯示 Touch ID／Windows
                  Hello。若修改任何欄位，需重新檢查。
            </p>
            <button
              className="price-primary-button"
              type="button"
              aria-label={
                preview.body.action === "detach"
                  ? "確認解除變體"
                  : "確認綁定變體"
              }
              disabled={busy || uncertain}
              onClick={() => void runWrite()}
            >
              {preview.body.action === "detach"
                ? "確認解除變體"
                : "確認綁定變體"}
            </button>
          </div>
        )}
        {lastResult && (
          <div className="variation-success" role="status">
            ✓ {lastResult.action === "detach" ? "解除" : "綁定"}已由 Amazon
            唯讀回查確認。
            {lastResult.action === "detach" && targetFamily
              ? "請繼續檢查綁定內容。"
              : ""}
          </div>
        )}
      </section>
      <details className="variation-details">
        <summary>詳細說明 ›</summary>
        <strong>兩階段安全寫入 · 不會盲目重送</strong>
        <p>
          解除與綁定分別執行 Validation Preview、Notebook 鑰匙（Touch
          ID／Windows
          Hello）、送出與唯讀回查。兩階段並非原子操作，解除完成後商品會暫時沒有
          parent；綁定未完成時仍保留目前商品供後續處理。
        </p>
        <p>
              Listings Items v2021-08-01 · CHILD Product Type Definition · FBA
              child only · 持久 Idempotency · 不使用 Seller Central 私有接口
        </p>
        {plan?.warnings.map((warning) => (
          <p key={warning}>{warning}</p>
        ))}
        {Object.values(preparations).flatMap(
          (prepared) =>
            prepared?.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            )) ?? [],
        )}
        <p>No blind retry · No FBM</p>
      </details>
        </>
      )}
    </>
  );
  if (presentation === "workspace")
    return (
      <section
        className="variation-planner-drawer variation-workspace"
        aria-labelledby="variation-planner-title"
      >
        {content}
      </section>
    );
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
        {content}
      </aside>
    </div>
  );
}

function PreviewDiagnostics({
  details,
}: {
  details: VariationPreviewDiagnostics;
}) {
  const unavailable = "未提供或無法安全顯示";
  const list = (items: string[] | null) =>
    items === null ? "格式不符或已隱藏" : items.join("、") || "公開回覆未列出";
  return (
    <details
      className="variation-workspace-section"
      aria-label="Amazon 檢查詳情"
    >
      <summary>查看 Amazon 檢查詳情</summary>
      <p className="variation-form-note">
        這是本次檢查的公開資訊；本機回覆狀態不代表 Amazon HTTP
        狀態，也不表示可以送出修改。
      </p>
      <div className="variation-table-scroll">
        <table aria-label="檢查回覆資訊">
          <tbody>
            <tr>
              <th scope="row">本機回覆 HTTP 狀態</th>
              <td>{details.localStatus}</td>
            </tr>
            <tr>
              <th scope="row">本機錯誤代碼</th>
              <td>{details.code ?? unavailable}</td>
            </tr>
            <tr>
              <th scope="row">Amazon 上游代碼</th>
              <td>{details.upstreamCode ?? unavailable}</td>
            </tr>
            <tr>
              <th scope="row">檢查作業</th>
              <td>{details.operation ?? unavailable}</td>
            </tr>
            <tr>
              <th scope="row">Request ID</th>
              <td>{details.requestId ?? unavailable}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {details.issues.length > 0 ? (
        <div className="variation-table-scroll">
          <table aria-label="Amazon 公開問題欄位">
            <thead>
              <tr>
                <th scope="col">問題代碼</th>
                <th scope="col">程度</th>
                <th scope="col">欄位名稱</th>
                <th scope="col">分類</th>
                <th scope="col">站點 ID</th>
              </tr>
            </thead>
            <tbody>
              {details.issues.map((issue, index) => (
                <tr key={index}>
                  <td>{issue.code ?? unavailable}</td>
                  <td>{issue.severity}</td>
                  <td>{list(issue.attributeNames)}</td>
                  <td>{list(issue.categories)}</td>
                  <td>{list(issue.marketplaceIds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>
          {details.issuesUnavailable
            ? "問題清單未提供或格式不完整。"
            : "公開回覆未列出可顯示的問題欄位，部分資訊可能已隱藏。"}
        </p>
      )}
      {details.omittedIssues > 0 && (
        <p>
          未全部列出：另有 {details.omittedIssues}{" "}
          則問題超過顯示上限或格式不完整。
        </p>
      )}
    </details>
  );
}

function SectionTitle({
  step,
  id,
  title,
  detail,
}: {
  step: string;
  id: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="variation-section-heading">
      <span>{step}</span>
      <div>
        <h3 id={id}>{title}</h3>
        <p>{detail}</p>
      </div>
    </div>
  );
}
function FamilyComparison({
  source,
  target,
}: {
  source: VariationFamilyView | null;
  target: VariationFamilyView | null;
}) {
  const rows: Array<[string, (family: VariationFamilyView) => string]> = [
    [
      "資料狀態",
      (family) => (family.familyComplete ? "★ 已完整讀取" : "☆ 尚未完整"),
    ],
    [
      "Parent SKU",
      (family) => parentOf(family)?.sellerSku ?? "無 parent（獨立 SKU）",
    ],
    ["商品名稱", (family) => parentOf(family)?.title ?? family.queried.title],
    ["商品類型", (family) => family.queried.productType ?? "未回報"],
    ["變體主題", (family) => family.variationTheme ?? "未回報"],
    [
      "FBA 商品數",
      (family) =>
        String(
          family.children.length
            ? family.children.filter((member) => member.fba).length
            : family.queried.role !== "parent" && family.queried.fba
              ? 1
              : 0,
        ),
    ],
  ];
  return (
    <div className="variation-table-scroll">
      <table className="variation-family-comparison">
        <colgroup>
          <col style={{ width: "22%" }} />
          <col style={{ width: "39%" }} />
          <col style={{ width: "39%" }} />
        </colgroup>
        <caption>Family 對照 · ★ 完整讀取　☆ 待確認</caption>
        <thead>
          <tr>
            <th>核對項目</th>
            <th>來源</th>
            <th>目標</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, read]) => (
            <tr key={label}>
              <th>{label}</th>
              <td>{source ? read(source) : "尚未讀取"}</td>
              <td>{target ? read(target) : "尚未選擇"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function MemberTable({
  members,
  dimensions,
  selectedSku,
  disabled,
  onSelect,
  label,
}: {
  members: VariationMemberView[];
  dimensions: string[];
  selectedSku?: string;
  disabled?: boolean;
  onSelect?: (member: VariationMemberView) => void;
  label: string;
}) {
  return (
    <div
      className={`variation-table-scroll ${onSelect ? "variation-source-table" : ""}`}
      tabIndex={onSelect ? 0 : undefined}
    >
      <table
        className="variation-member-table"
        aria-label={label}
        style={{
          minWidth: `${(onSelect ? 80 : 0) + 200 + 260 + dimensions.length * 160}px`,
        }}
      >
        <colgroup>
          {onSelect && <col style={{ width: 80 }} />}
          <col style={{ width: 200 }} />
          <col />
          {dimensions.map((name) => (
            <col key={name} style={{ width: 160 }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {onSelect && <th>選擇</th>}
            <th>Seller SKU／ASIN</th>
            <th>商品名稱</th>
            {dimensions.map((name) => (
              <th key={name}>{name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr
              key={member.sellerSku}
              className={selectedSku === member.sellerSku ? "selected" : ""}
            >
              {onSelect && (
                <td>
                  <button
                    type="button"
                    aria-label={`選擇 ${member.sellerSku}`}
                    aria-pressed={selectedSku === member.sellerSku}
                    disabled={disabled || selectedSku === member.sellerSku}
                    onClick={() => onSelect(member)}
                  >
                    {selectedSku === member.sellerSku ? "已選擇" : "選擇"}
                  </button>
                </td>
              )}
              <td>
                <strong>{member.sellerSku}</strong>
                <small>{member.asin ?? "ASIN 未回報"}</small>
              </td>
              <td>
                <span className="variation-cell-clamp" title={member.title}>
                  {member.title}
                </span>
                {member.title.length > 120 && (
                  <details className="variation-cell-full">
                    <summary>查看全文</summary>
                    <p>{member.title}</p>
                  </details>
                )}
              </td>
              {dimensions.map((name) => (
                <td key={name}>
                  <span
                    className="variation-cell-clamp"
                    title={dimensionText(member, name)}
                  >
                    {dimensionText(member, name)}
                  </span>
                </td>
              ))}
            </tr>
          ))}
          {!members.length && (
            <tr>
              <td
                colSpan={dimensions.length + (onSelect ? 3 : 2)}
                className="variation-empty"
              >
                尚無可顯示商品
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
function VariationFieldEditor({
  field,
  values,
  jsonDraft,
  error,
  disabled,
  fillOnly,
  onLeafChange,
  onJsonDraftChange,
  onRemove,
}: {
  fillOnly: boolean;
  field: VariationFieldView;
  values: Array<Record<string, unknown>>;
  jsonDraft: string;
  error?: string;
  disabled: boolean;
  onLeafChange: (
    leaf: VariationFieldLeafView,
    value: string | number | boolean | null,
  ) => void;
  onJsonDraftChange: (value: string) => void;
  onRemove?: () => void;
}) {
  const label = fieldLabel(field);
  const preserveExisting =
    !fillOnly && !field.editable && field.values.length > 0;
  if (preserveExisting)
    return (
      <fieldset className="variation-field-card variation-field-preserved">
        <legend>{label} · 保留 Amazon 現有值</legend>
        <small className="variation-field-name">{field.name}</small>
        <output aria-label={`${label} · Amazon 現有值`}>
          {readableValue(field.values)}
        </output>
        <p className="variation-form-note">
          此變體欄位由 Amazon
          限制修改，本次綁定會原樣保留，不會送出此欄位的變更。
        </p>
      </fieldset>
    );
  return (
    <fieldset className="variation-field-card" disabled={disabled}>
      <legend>
        {label}
        <span aria-label="必填"> *</span>
      </legend>
      <small className="variation-field-name">{field.name}</small>
      {onRemove && (
        <button
          type="button"
          className="variation-secondary-button"
          onClick={onRemove}
          aria-label={`移除自選欄位 ${field.name}`}
        >
          移除自選欄位
        </button>
      )}
      {!field.editable && (
        <p className="variation-warning">
          {field.jsonFallback || field.values.length > 1
            ? "此欄位包含目前無法安全編輯的複合或多筆資料。"
            : "此欄位目前不允許在變體工作台補填。"}
          請先到 Seller Central 商品編輯補齊，再重新讀取。
        </p>
      )}
      {field.jsonFallback ? (
        <label>
          <span>結構化商品資料</span>
          <small>
            Amazon 將此欄位定義為複合格式；請保留欄位名稱與資料型態。
          </small>
          <textarea
            aria-label={label}
            value={jsonDraft}
            rows={5}
            spellCheck={false}
            onChange={(event) => onJsonDraftChange(event.target.value)}
          />
        </label>
      ) : (
        field.leaves.map((leaf) => {
          const value = nestedValue(values[0] ?? {}, leaf.path);
          const hasExisting =
            fillOnly && leaf.currentValue !== null && leaf.currentValue !== "";
          const id = `variation-${field.name}-${leaf.path.join("-")}`;
          const optionValues = leaf.enumValues.length
            ? leaf.enumValues
            : leaf.type === "boolean"
              ? [true, false]
              : [];
          return (
            <label key={leaf.path.join(".")} htmlFor={id}>
              <span>
                {leaf.label}
                {leaf.required ? " *" : ""}
                {hasExisting ? " · Amazon 現有值" : ""}
              </span>
              {optionValues.length ? (
                <select
                  id={id}
                  aria-label={`${label} · ${leaf.label}`}
                  disabled={hasExisting}
                  value={String(value ?? "")}
                  onChange={(event) => {
                    const choice = optionValues.find(
                      (option) => String(option) === event.target.value,
                    );
                    onLeafChange(leaf, choice ?? null);
                  }}
                >
                  <option value="">請選擇</option>
                  {optionValues.map((option) => (
                    <option key={String(option)} value={String(option)}>
                      {typeof option === "boolean"
                        ? option
                          ? "是"
                          : "否"
                        : String(option)}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={id}
                  aria-label={`${label} · ${leaf.label}`}
                  readOnly={hasExisting}
                  type={
                    leaf.type === "number" || leaf.type === "integer"
                      ? "number"
                      : "text"
                  }
                  step={leaf.type === "integer" ? "1" : "any"}
                  value={
                    typeof value === "number" || typeof value === "string"
                      ? value
                      : ""
                  }
                  onChange={(event) => {
                    const text = event.target.value;
                    if (leaf.type === "number" || leaf.type === "integer")
                      onLeafChange(
                        leaf,
                        text === ""
                          ? null
                          : Number.isFinite(Number(text))
                            ? Number(text)
                            : null,
                      );
                    else onLeafChange(leaf, text);
                  }}
                  autoComplete="off"
                />
              )}
            </label>
          );
        })
      )}
      {error && (
        <small className="price-error" role="alert">
          {error}
        </small>
      )}
    </fieldset>
  );
}
