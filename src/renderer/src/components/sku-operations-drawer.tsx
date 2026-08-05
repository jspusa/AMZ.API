"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type ListingIssue = {
  code: string | null;
  severity: string;
  message: string;
  attributeNames: string[];
};

type FieldCapability = {
  supported: boolean;
  editable: boolean;
  minItems: number | null;
  maxLength: number | null;
  maxItems: number | null;
  reason: string | null;
};

type ContentCapabilities = {
  title: FieldCapability;
  bulletPoints: FieldCapability;
  ingredients: FieldCapability;
};

type ListingContent = {
  title: string;
  bulletPoints: string[];
  ingredients: string;
};

type SubmittedContent = Readonly<{
  title: string;
  bulletPoints: readonly string[];
  ingredients: string;
}>;

type ListingContentSnapshot = {
  mode: "live" | "demo";
  marketplaceId: string;
  sellerSku: string;
  asin: string | null;
  productType: string;
  status: string[];
  updatedAt: string | null;
  fetchedAt: string;
  requestId: string | null;
  issues: ListingIssue[];
  notice: string | null;
  content: ListingContent;
  capabilities: ContentCapabilities;
};

type RawCapability = Partial<FieldCapability> & {
  message?: string | null;
};

type RawContentSnapshot = Omit<
  Partial<ListingContentSnapshot>,
  "content" | "capabilities"
> & {
  sellerSku?: string;
  title?: string;
  bulletPoints?: string[];
  ingredients?: string | string[];
  content?: Partial<ListingContent> & {
    capabilities?: Partial<Record<string, RawCapability>>;
  };
  capabilities?: Partial<Record<string, RawCapability>>;
};

type MutationReply = {
  mode: "live" | "demo";
  status: "VALID" | "SIMULATED" | "ACCEPTED";
  notice: string;
  issues: ListingIssue[];
  requestId: string | null;
  validatedAt?: string;
  acceptedAt?: string;
  submissionId?: string | null;
};

type ExportReply = {
  ready: boolean;
  reportId: string | null;
  documentId: string | null;
  downloadUrl: string | null;
  status: string | null;
  progress: number | null;
  message: string | null;
  requestId: string | null;
};

type ApiProblem = {
  message?: string;
  requestId?: string | null;
};

type Draft = {
  title: string;
  bulletPoints: string[];
  ingredients: string;
};

const MARKETPLACES = [
  { id: "ATVPDKIKX0DER", label: "US · 美國站", short: "US", sampleSku: "AFA-TRKY-4OZ" },
  { id: "A1VC38T7YXB528", label: "JP · 日本站", short: "JP", sampleSku: "AFA100-JP" },
  { id: "A2EUQ1WTGCTBG2", label: "CA · 加拿大站", short: "CA", sampleSku: "AFA-TRKY-4OZ" },
  { id: "A19VAU5U5O7RUS", label: "SG · 新加坡站", short: "SG", sampleSku: "AFA-TRKY-4OZ" },
  { id: "A39IBJ37TRP1C6", label: "AU · 澳洲站", short: "AU", sampleSku: "AFA-TRKY-4OZ" },
  { id: "A1F83G8C2ARO7P", label: "UK · 英國站", short: "UK", sampleSku: "AFA-TRKY-4OZ" },
  { id: "A1PA6795UKMFR9", label: "DE · 德國站", short: "DE", sampleSku: "AFA-TRKY-4OZ" },
];

const DEFAULT_CAPABILITIES: ContentCapabilities = {
  title: {
    supported: true,
    editable: true,
    minItems: 1,
    maxLength: 200,
    maxItems: 1,
    reason: null,
  },
  bulletPoints: {
    supported: true,
    editable: true,
    minItems: 1,
    maxLength: 500,
    maxItems: 5,
    reason: null,
  },
  ingredients: {
    supported: true,
    editable: true,
    minItems: 1,
    maxLength: 5000,
    maxItems: 1,
    reason: null,
  },
};

function problemMessage(payload: ApiProblem, fallback: string): string {
  const requestId = payload.requestId ? `（Request ID: ${payload.requestId}）` : "";
  return `${payload.message || fallback}${requestId}`;
}

function createIdempotencyKey(): string {
  const values = new Uint32Array(3);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values);
  } else {
    values.set([
      Math.floor(Math.random() * 0xffffffff),
      Math.floor(Math.random() * 0xffffffff),
      Math.floor(Math.random() * 0xffffffff),
    ]);
  }
  return `content-${Date.now().toString(36)}-${Array.from(values, (value) =>
    value.toString(36),
  ).join("-")}`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function normalizedText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean).join("；");
  }
  return typeof value === "string" ? value : "";
}

function normalizedBullets(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5).map((item) => String(item ?? ""));
}

function positiveInteger(value: unknown, fallback: number | null): number | null {
  if (value === null) return null;
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : fallback;
}

function normalizeCapability(
  raw: RawCapability | undefined,
  fallback: FieldCapability,
): FieldCapability {
  return {
    supported: raw?.supported ?? fallback.supported,
    editable: raw?.editable ?? fallback.editable,
    minItems: positiveInteger(raw?.minItems, fallback.minItems),
    maxLength: positiveInteger(raw?.maxLength, fallback.maxLength),
    maxItems: positiveInteger(raw?.maxItems, fallback.maxItems),
    reason: raw?.reason ?? raw?.message ?? fallback.reason,
  };
}

function normalizeSnapshot(raw: RawContentSnapshot): ListingContentSnapshot {
  const nestedContent = raw.content ?? {};
  const rawCapabilities = raw.capabilities ?? nestedContent.capabilities ?? {};
  const titleCapability =
    rawCapabilities.title ?? rawCapabilities.itemName ?? rawCapabilities.item_name;
  const bulletCapability =
    rawCapabilities.bulletPoints ??
    rawCapabilities.bullets ??
    rawCapabilities.bulletPoint ??
    rawCapabilities.bullet_point;
  const ingredientCapability = rawCapabilities.ingredients;
  const ingredients = nestedContent.ingredients ?? raw.ingredients;

  return {
    mode: raw.mode === "live" ? "live" : "demo",
    marketplaceId: raw.marketplaceId ?? "",
    sellerSku: raw.sellerSku ?? "",
    asin: raw.asin ?? null,
    productType: raw.productType ?? "—",
    status: Array.isArray(raw.status) ? raw.status : [],
    updatedAt: raw.updatedAt ?? null,
    fetchedAt: raw.fetchedAt ?? new Date().toISOString(),
    requestId: raw.requestId ?? null,
    issues: Array.isArray(raw.issues) ? raw.issues : [],
    notice: raw.notice ?? null,
    content: {
      title: nestedContent.title ?? raw.title ?? "",
      bulletPoints: normalizedBullets(nestedContent.bulletPoints ?? raw.bulletPoints),
      ingredients: normalizedText(ingredients),
    },
    capabilities: {
      title: normalizeCapability(titleCapability, DEFAULT_CAPABILITIES.title),
      bulletPoints: normalizeCapability(
        bulletCapability,
        DEFAULT_CAPABILITIES.bulletPoints,
      ),
      ingredients: normalizeCapability(
        ingredientCapability,
        DEFAULT_CAPABILITIES.ingredients,
      ),
    },
  };
}

function normalizeMutationReply(raw: Partial<MutationReply>): MutationReply {
  return {
    mode: raw.mode === "live" ? "live" : "demo",
    status:
      raw.status === "ACCEPTED" || raw.status === "VALID"
        ? raw.status
        : "SIMULATED",
    notice: raw.notice ?? "Amazon 已接受這次內容處理。",
    issues: Array.isArray(raw.issues) ? raw.issues : [],
    requestId: raw.requestId ?? null,
    validatedAt: raw.validatedAt,
    acceptedAt: raw.acceptedAt,
    submissionId: raw.submissionId ?? null,
  };
}

function normalizeExportReply(raw: Record<string, unknown>): ExportReply {
  const reportId = raw.reportId ?? raw.report_id;
  const documentId = raw.documentId ?? raw.reportDocumentId ?? raw.document_id;
  const downloadUrl = raw.downloadUrl ?? raw.downloadURL ?? raw.url;
  const progress = raw.progress;
  return {
    ready: raw.ready === true,
    reportId: typeof reportId === "string" ? reportId : null,
    documentId: typeof documentId === "string" ? documentId : null,
    downloadUrl: typeof downloadUrl === "string" ? downloadUrl : null,
    status: typeof raw.status === "string" ? raw.status : null,
    progress: typeof progress === "number" && Number.isFinite(progress) ? progress : null,
    message: typeof raw.message === "string" ? raw.message : null,
    requestId: typeof raw.requestId === "string" ? raw.requestId : null,
  };
}

function toDraft(content: ListingContent): Draft {
  return {
    title: content.title,
    bulletPoints: Array.from(
      { length: 5 },
      (_, index) => content.bulletPoints[index] ?? "",
    ),
    ingredients: content.ingredients,
  };
}

function compactBullets(values: readonly string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

function contentMatches(left: SubmittedContent, right: SubmittedContent): boolean {
  return (
    left.title.trim() === right.title.trim() &&
    left.ingredients.trim() === right.ingredients.trim() &&
    JSON.stringify(compactBullets(left.bulletPoints)) ===
      JSON.stringify(compactBullets(right.bulletPoints))
  );
}

function immutableContent(content: ListingContent): SubmittedContent {
  return Object.freeze({
    title: content.title,
    bulletPoints: Object.freeze([...content.bulletPoints]),
    ingredients: content.ingredients,
  });
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function safeFilename(response: Response, fallback: string): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  let candidate = fallback;
  try {
    candidate = utf8Match?.[1]
      ? decodeURIComponent(utf8Match[1])
      : plainMatch?.[1] ?? fallback;
  } catch {
    candidate = fallback;
  }
  return candidate.replace(/[\\/:*?"<>|]/g, "-");
}

export default function SkuOperationsDrawer({
  initialMarketplaceId,
  initialSellerSku = "",
  onContextResolved,
  onClose,
}: {
  initialMarketplaceId: string;
  initialSellerSku?: string;
  onContextResolved?: (marketplaceId: string, sellerSku: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"single" | "export">("single");
  const [marketplaceId, setMarketplaceId] = useState(
    MARKETPLACES.some((item) => item.id === initialMarketplaceId)
      ? initialMarketplaceId
      : MARKETPLACES[0].id,
  );
  const [skuInput, setSkuInput] = useState(initialSellerSku);
  const [listing, setListing] = useState<ListingContentSnapshot | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [phase, setPhase] = useState<"edit" | "confirm" | "result">("edit");
  const [validation, setValidation] = useState<MutationReply | null>(null);
  const [result, setResult] = useState<MutationReply | null>(null);
  const [confirmationSku, setConfirmationSku] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [resultConfirmed, setResultConfirmed] = useState(false);
  const [submittedContent, setSubmittedContent] = useState<SubmittedContent | null>(
    null,
  );
  const [lookupLoading, setLookupLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportState, setExportState] = useState<
    "idle" | "starting" | "polling" | "downloading" | "done"
  >("idle");
  const [exportReply, setExportReply] = useState<ExportReply | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const lookupAbortRef = useRef<AbortController | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const autoLookupRef = useRef(false);
  const autoRecheckRef = useRef("");

  const marketplace =
    MARKETPLACES.find((item) => item.id === marketplaceId) ?? MARKETPLACES[0];
  const requestedContent = useMemo<ListingContent | null>(() => {
    if (!draft) return null;
    return {
      title: draft.title.trim(),
      bulletPoints: compactBullets(draft.bulletPoints),
      ingredients: draft.ingredients.trim(),
    };
  }, [draft]);
  const hasChanges = Boolean(
    listing && requestedContent && !contentMatches(listing.content, requestedContent),
  );
  const changedFields = useMemo(() => {
    if (!listing || !requestedContent) return [];
    const fields: string[] = [];
    if (listing.content.title.trim() !== requestedContent.title) fields.push("商品標題");
    if (
      JSON.stringify(compactBullets(listing.content.bulletPoints)) !==
      JSON.stringify(requestedContent.bulletPoints)
    ) {
      fields.push("五大賣點");
    }
    if (listing.content.ingredients.trim() !== requestedContent.ingredients) {
      fields.push("成分");
    }
    return fields;
  }, [listing, requestedContent]);

  const fieldErrors = useMemo(() => {
    if (!listing || !draft) return [];
    const failures: string[] = [];
    const titleCapability = listing.capabilities.title;
    const bulletCapability = listing.capabilities.bulletPoints;
    const ingredientCapability = listing.capabilities.ingredients;
    const titleChanged = listing.content.title !== draft.title;
    const bulletsChanged =
      JSON.stringify(compactBullets(listing.content.bulletPoints)) !==
      JSON.stringify(compactBullets(draft.bulletPoints));
    const ingredientsChanged = listing.content.ingredients !== draft.ingredients;
    if (
      titleChanged &&
      titleCapability.supported &&
      titleCapability.editable &&
      !draft.title.trim()
    ) {
      failures.push("商品標題不可空白");
    }
    if (
      titleChanged &&
      titleCapability.supported &&
      titleCapability.editable &&
      titleCapability.maxLength !== null &&
      draft.title.length > titleCapability.maxLength
    ) {
      failures.push(`商品標題超過 ${titleCapability.maxLength} 個字元`);
    }
    if (
      ingredientsChanged &&
      ingredientCapability.supported &&
      ingredientCapability.editable &&
      !draft.ingredients.trim()
    ) {
      failures.push("為避免誤刪法規資料，成分不可直接清空");
    }
    if (
      ingredientsChanged &&
      ingredientCapability.supported &&
      ingredientCapability.editable &&
      ingredientCapability.maxLength !== null &&
      draft.ingredients.length > ingredientCapability.maxLength
    ) {
      failures.push(`成分超過 ${ingredientCapability.maxLength} 個字元`);
    }
    draft.bulletPoints.forEach((bullet, index) => {
      if (
        bulletsChanged &&
        bulletCapability.supported &&
        bulletCapability.editable &&
        index < (bulletCapability.maxItems ?? 5) &&
        bulletCapability.maxLength !== null &&
        bullet.length > bulletCapability.maxLength
      ) {
        failures.push(`賣點 ${index + 1} 超過 ${bulletCapability.maxLength} 個字元`);
      }
    });
    if (
      bulletsChanged &&
      bulletCapability.supported &&
      bulletCapability.editable &&
      compactBullets(draft.bulletPoints).length < (bulletCapability.minItems ?? 1)
    ) {
      failures.push(`此商品類型至少需要 ${bulletCapability.minItems ?? 1} 個賣點`);
    }
    if (
      bulletsChanged &&
      bulletCapability.supported &&
      bulletCapability.editable &&
      bulletCapability.maxItems !== null &&
      compactBullets(draft.bulletPoints).length > bulletCapability.maxItems
    ) {
      failures.push(`此商品類型最多可填 ${bulletCapability.maxItems} 個賣點`);
    }
    return failures;
  }, [draft, listing]);

  const busy = lookupLoading || actionLoading || exportState === "starting" ||
    exportState === "polling" || exportState === "downloading";

  const closeDrawer = useCallback(() => {
    if (
      phase !== "result" &&
      hasChanges &&
      !window.confirm("尚有未送出的商品內容變更，確定要捨棄嗎？")
    ) {
      return;
    }
    lookupAbortRef.current?.abort();
    exportAbortRef.current?.abort();
    onClose();
  }, [hasChanges, onClose, phase]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || actionLoading) return;
      if (phase === "confirm") {
        setPhase("edit");
        setValidation(null);
        setConfirmationSku("");
        return;
      }
      closeDrawer();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actionLoading, closeDrawer, phase]);

  useEffect(
    () => () => {
      lookupAbortRef.current?.abort();
      exportAbortRef.current?.abort();
    },
    [],
  );

  const resetSingle = useCallback(() => {
    lookupAbortRef.current?.abort();
    setSkuInput("");
    setListing(null);
    setDraft(null);
    setPhase("edit");
    setValidation(null);
    setResult(null);
    setConfirmationSku("");
    setIdempotencyKey("");
    setResultConfirmed(false);
    setSubmittedContent(null);
    setError(null);
  }, []);

  const resetExport = useCallback(() => {
    exportAbortRef.current?.abort();
    setExportState("idle");
    setExportReply(null);
    setExportError(null);
  }, []);

  const changeMarketplace = (value: string) => {
    if (
      (listing || exportReply) &&
      !window.confirm("切換站點會清除目前內容與匯出進度，確定繼續嗎？")
    ) {
      return;
    }
    resetSingle();
    resetExport();
    setMarketplaceId(value);
  };

  const changeTab = (nextTab: "single" | "export") => {
    if (nextTab === tab) return;
    if (
      tab === "single" &&
      phase !== "result" &&
      hasChanges &&
      !window.confirm("尚有未送出的商品內容變更，確定切換嗎？")
    ) {
      return;
    }
    setTab(nextTab);
  };

  const fetchListing = useCallback(
    async (sellerSku: string, signal?: AbortSignal): Promise<ListingContentSnapshot> => {
      const params = new URLSearchParams({ marketplaceId, sku: sellerSku });
      const response = await fetch(`/api/sp-api/listing-content?${params}`, {
        cache: "no-store",
        signal,
      });
      const payload = (await response.json()) as RawContentSnapshot | ApiProblem;
      if (!response.ok) {
        throw new Error(problemMessage(payload as ApiProblem, "目前無法查詢這個 SKU。"));
      }
      const snapshot = normalizeSnapshot(payload as RawContentSnapshot);
      if (!snapshot.sellerSku) throw new Error("Amazon 沒有回傳可核對的 Seller SKU。");
      return snapshot;
    },
    [marketplaceId],
  );

  const lookupSingle = useCallback(async (event?: FormEvent) => {
    event?.preventDefault();
    const sellerSku = skuInput.trim();
    if (!sellerSku) {
      setError("請輸入完整 Seller SKU。");
      return;
    }
    lookupAbortRef.current?.abort();
    const controller = new AbortController();
    lookupAbortRef.current = controller;
    setLookupLoading(true);
    setError(null);
    setListing(null);
    setDraft(null);
    setPhase("edit");
    setValidation(null);
    setResult(null);
    setConfirmationSku("");
    setIdempotencyKey("");
    setResultConfirmed(false);
    setSubmittedContent(null);
    try {
      const snapshot = await fetchListing(sellerSku, controller.signal);
      setListing(snapshot);
      setDraft(toDraft(snapshot.content));
      onContextResolved?.(marketplaceId, snapshot.sellerSku);
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") return;
      setError(
        requestError instanceof Error ? requestError.message : "目前無法查詢這個 SKU。",
      );
    } finally {
      if (lookupAbortRef.current === controller) setLookupLoading(false);
    }
  }, [fetchListing, marketplaceId, onContextResolved, skuInput]);

  useEffect(() => {
    if (autoLookupRef.current || !initialSellerSku.trim()) return;
    autoLookupRef.current = true;
    void lookupSingle();
  }, [initialSellerSku, lookupSingle]);

  const mutationBody = (
    key = idempotencyKey,
    content: SubmittedContent | null = requestedContent,
  ) => ({
    marketplaceId,
    sellerSku: listing?.sellerSku,
    expectedTitle: listing?.content.title ?? "",
    expectedBulletPoints: listing?.content.bulletPoints ?? [],
    expectedIngredients: listing?.content.ingredients ?? "",
    title: content?.title ?? "",
    bulletPoints: content ? [...content.bulletPoints] : [],
    ingredients: content?.ingredients ?? "",
    confirmationSku,
    idempotencyKey: key,
  });

  const previewContent = async () => {
    if (!listing || !requestedContent || !hasChanges || fieldErrors.length) return;
    const key = createIdempotencyKey();
    setActionLoading(true);
    setError(null);
    setSubmittedContent(null);
    try {
      const response = await fetch("/api/sp-api/listing-content", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mutationBody(key)),
      });
      const payload = (await response.json()) as Partial<MutationReply> | ApiProblem;
      if (!response.ok) {
        throw new Error(
          problemMessage(payload as ApiProblem, "Amazon 商品內容預檢未通過。"),
        );
      }
      setValidation(normalizeMutationReply(payload as Partial<MutationReply>));
      setIdempotencyKey(key);
      setConfirmationSku("");
      setPhase("confirm");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Amazon 商品內容預檢未通過。",
      );
    } finally {
      setActionLoading(false);
    }
  };

  const commitContent = async () => {
    if (
      !listing ||
      !requestedContent ||
      !validation ||
      !idempotencyKey ||
      confirmationSku !== listing.sellerSku
    ) {
      return;
    }
    const submitted = immutableContent(requestedContent);
    setActionLoading(true);
    setError(null);
    setSubmittedContent(submitted);
    try {
      const response = await fetch("/api/sp-api/listing-content", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mutationBody(idempotencyKey, submitted)),
      });
      const payload = (await response.json()) as Partial<MutationReply> | ApiProblem;
      if (!response.ok) {
        throw new Error(
          problemMessage(payload as ApiProblem, "Amazon 未接受這次商品內容更新。"),
        );
      }
      setResult(normalizeMutationReply(payload as Partial<MutationReply>));
      setResultConfirmed(false);
      setPhase("result");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Amazon 未接受這次商品內容更新。",
      );
      setSubmittedContent(null);
    } finally {
      setActionLoading(false);
    }
  };

  const recheckContent = useCallback(async () => {
    if (!listing || !submittedContent) return;
    setActionLoading(true);
    setError(null);
    try {
      const latest = await fetchListing(listing.sellerSku);
      const blockingIssues = latest.issues.filter(
        (issue) => issue.severity.toUpperCase() === "ERROR",
      );
      const confirmed =
        blockingIssues.length === 0 &&
        contentMatches(latest.content, submittedContent);
      setResultConfirmed(confirmed);
      if (confirmed) {
        setListing(latest);
        setDraft(toDraft(latest.content));
      } else if (blockingIssues.length > 0) {
        const firstMessage = blockingIssues[0]?.message;
        setError(
          `Amazon 回讀仍有 ${blockingIssues.length} 項 ERROR，暫時不能確認更新${
            firstMessage ? `：${firstMessage}` : "。"
          }`,
        );
      } else {
        setError("Amazon 目前仍在同步部分內容，請稍後再重新查詢；系統不會自動重送。");
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "目前無法重新確認商品內容。",
      );
    } finally {
      setActionLoading(false);
    }
  }, [fetchListing, listing, submittedContent]);

  useEffect(() => {
    if (
      phase !== "result" ||
      !result ||
      result.mode !== "live" ||
      resultConfirmed ||
      !idempotencyKey ||
      autoRecheckRef.current === idempotencyKey
    ) {
      return;
    }
    autoRecheckRef.current = idempotencyKey;
    const timeout = window.setTimeout(() => void recheckContent(), 4_000);
    return () => window.clearTimeout(timeout);
  }, [idempotencyKey, phase, recheckContent, result, resultConfirmed]);

  const updateDraft = (nextDraft: Draft) => {
    setDraft(nextDraft);
    setValidation(null);
    setResult(null);
    setConfirmationSku("");
    setIdempotencyKey("");
    setResultConfirmed(false);
    setSubmittedContent(null);
    setError(null);
    setPhase("edit");
  };

  const downloadExport = async (
    reply: ExportReply,
    signal: AbortSignal,
  ): Promise<void> => {
    setExportState("downloading");
    setExportReply(reply);
    const params = new URLSearchParams({ marketplaceId, download: "1" });
    if (reply.reportId) params.set("reportId", reply.reportId);
    if (reply.documentId) params.set("documentId", reply.documentId);
    const target = reply.downloadUrl || `/api/sp-api/listing-content/export?${params}`;
    const response = await fetch(target, { cache: "no-store", signal });
    if (!response.ok) {
      let payload: ApiProblem = {};
      try {
        payload = (await response.json()) as ApiProblem;
      } catch {
        // A failed download may not have a JSON body.
      }
      throw new Error(problemMessage(payload, "Excel 下載失敗，請重新匯出。"));
    }
    const blob = await response.blob();
    const fallback = `amazon-listing-content-${marketplace.short}-${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = safeFilename(response, fallback);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    setExportState("done");
  };

  const startExport = async () => {
    exportAbortRef.current?.abort();
    const controller = new AbortController();
    exportAbortRef.current = controller;
    setExportState("starting");
    setExportError(null);
    setExportReply(null);
    try {
      const startResponse = await fetch("/api/sp-api/listing-content/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ marketplaceId }),
        signal: controller.signal,
      });
      const startRaw = (await startResponse.json()) as Record<string, unknown>;
      if (!startResponse.ok) {
        throw new Error(problemMessage(startRaw as ApiProblem, "無法開始建立 Excel。"));
      }
      let reply = normalizeExportReply(startRaw);
      setExportReply(reply);
      if (reply.ready) {
        await downloadExport(reply, controller.signal);
        return;
      }
      if (!reply.reportId) throw new Error("Amazon 沒有回傳可追蹤的報表 ID。");
      const reportId = reply.reportId;
      setExportState("polling");

      for (let attempt = 0; attempt < 90; attempt += 1) {
        await delay(2_000, controller.signal);
        const params = new URLSearchParams({
          marketplaceId,
          reportId,
        });
        const pollResponse = await fetch(
          `/api/sp-api/listing-content/export?${params}`,
          { cache: "no-store", signal: controller.signal },
        );
        const pollRaw = (await pollResponse.json()) as Record<string, unknown>;
        if (!pollResponse.ok) {
          throw new Error(problemMessage(pollRaw as ApiProblem, "Excel 建立狀態查詢失敗。"));
        }
        reply = normalizeExportReply({ ...pollRaw, reportId });
        setExportReply(reply);
        const terminalFailure = ["CANCELLED", "CANCELED", "FATAL", "FAILED"].includes(
          reply.status?.toUpperCase() ?? "",
        );
        if (terminalFailure) {
          throw new Error(reply.message || `Amazon 報表狀態為 ${reply.status}。`);
        }
        if (reply.ready) {
          await downloadExport(reply, controller.signal);
          return;
        }
      }
      throw new Error("Excel 建立超過三分鐘，請稍後重新匯出。");
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") return;
      setExportState("idle");
      setExportError(
        requestError instanceof Error ? requestError.message : "目前無法匯出 Excel。",
      );
    }
  };

  const titleCapability = listing?.capabilities.title;
  const bulletCapability = listing?.capabilities.bulletPoints;
  const ingredientCapability = listing?.capabilities.ingredients;
  const bulletMaxItems = Math.min(5, bulletCapability?.maxItems ?? 5);
  const exportStatusText = exportState === "starting"
    ? "正在建立 Amazon 商品報表…"
    : exportState === "polling"
      ? exportReply?.message || "Amazon 正在整理全部商品，完成後會自動下載。"
      : exportState === "downloading"
        ? "報表已完成，正在下載 Excel…"
        : exportState === "done"
          ? "Excel 已下載完成。"
          : "";

  return (
    <div
      className="drawer-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) closeDrawer();
      }}
    >
      <aside
        className="order-drawer sku-ops-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sku-ops-title"
      >
        <div className="drawer-header">
          <div>
            <p className="eyebrow">FBA LISTING CONTENT</p>
            <h2 id="sku-ops-title">商品內容</h2>
          </div>
          <button
            type="button"
            onClick={closeDrawer}
            disabled={busy}
            aria-label="關閉商品內容工具"
          >
            ×
          </button>
        </div>

        <div className="automation-summary"><span className="automation-badge automatic">自動</span><p>全域 SKU 開啟即載入；PTD、字數、五點上限、舊值衝突與送出後回查由系統處理。</p><span className="automation-badge one_click">一鍵</span><p>Excel 會自動建立、輪詢並下載；商品內容通過防呆確認後才送出。</p><span className="automation-badge manual">需人工</span><p>標題、五大賣點與成分內容由你決定。</p></div>

        <div className="sku-ops-tabs" role="tablist" aria-label="商品內容工具">
          <button
            id="content-single-tab"
            type="button"
            role="tab"
            aria-selected={tab === "single"}
            aria-controls="content-single-panel"
            className={tab === "single" ? "active" : ""}
            onClick={() => changeTab("single")}
          >
            單一 SKU 編輯
          </button>
          <button
            id="content-export-tab"
            type="button"
            role="tab"
            aria-selected={tab === "export"}
            aria-controls="content-export-panel"
            className={tab === "export" ? "active" : ""}
            onClick={() => changeTab("export")}
          >
            全部匯出 Excel
          </button>
        </div>

        <label className="ops-marketplace" htmlFor="content-marketplace">
          <span>Amazon 站點</span>
          <select
            id="content-marketplace"
            value={marketplaceId}
            onChange={(event) => changeMarketplace(event.target.value)}
            disabled={busy}
          >
            {MARKETPLACES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {tab === "single" && (
          <div
            id="content-single-panel"
            role="tabpanel"
            aria-labelledby="content-single-tab"
          >
            {phase === "edit" && (
              <>
                <form className="ops-single-search" onSubmit={lookupSingle}>
                  <label htmlFor="content-sku">
                    <span>Seller SKU</span>
                    <div className="sku-search-row">
                      <input
                        id="content-sku"
                        value={skuInput}
                        onChange={(event) => setSkuInput(event.target.value)}
                        maxLength={40}
                        placeholder={`例如 ${marketplace.sampleSku}`}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <button type="submit" disabled={lookupLoading || !skuInput.trim()}>
                        {lookupLoading ? "查詢中" : "查詢"}
                      </button>
                    </div>
                  </label>
                </form>
                {error && <div className="price-error" role="alert">{error}</div>}

                {listing && draft && (
                  <section className="ops-listing" aria-label={`${listing.sellerSku} 商品內容`}>
                    <div className="ops-product-heading">
                      <div className="listing-avatar" aria-hidden="true">
                        {(listing.content.title || listing.sellerSku).slice(0, 1)}
                      </div>
                      <div>
                        <strong>{listing.content.title || "尚未設定商品標題"}</strong>
                        <p>{listing.sellerSku} · {listing.asin ?? "無 ASIN"}</p>
                      </div>
                      <span className={`listing-mode ${listing.mode}`}>{listing.mode}</span>
                    </div>
                    <dl className="ops-listing-facts">
                      <div><dt>履約方式</dt><dd>FBA · Amazon</dd></div>
                      <div><dt>商品類型</dt><dd>{listing.productType}</dd></div>
                      <div><dt>Amazon 更新</dt><dd>{formatDateTime(listing.updatedAt)}</dd></div>
                      <div><dt>本次查詢</dt><dd>{formatDateTime(listing.fetchedAt)}</dd></div>
                    </dl>

                    <div className="ops-section-heading">
                      <div><span>EDIT CONTENT</span><h3>直接修改商品內容</h3></div>
                      <small>{changedFields.length ? `已變更 ${changedFields.length} 個欄位` : "尚未變更"}</small>
                    </div>

                    <section
                      className="batch-panel"
                      aria-label="商品內容欄位"
                      style={{
                        padding: 17,
                        border: "1px solid var(--line)",
                        borderRadius: 15,
                        background: "#fff",
                      }}
                    >
                      <label htmlFor="content-title">
                        <span>商品標題</span>
                        <textarea
                          id="content-title"
                          value={draft.title}
                          onChange={(event) => updateDraft({ ...draft, title: event.target.value })}
                          rows={3}
                          maxLength={titleCapability?.maxLength ?? undefined}
                          disabled={!titleCapability?.supported || !titleCapability.editable}
                          aria-describedby="content-title-help"
                        />
                        <small id="content-title-help">
                          {titleCapability?.supported && titleCapability.editable
                            ? `${draft.title.length}${titleCapability.maxLength === null ? "" : ` / ${titleCapability.maxLength}`} 字元`
                            : titleCapability?.reason || "此商品類型不支援在這裡編輯標題。"}
                        </small>
                      </label>

                      <div className="ops-section-heading" style={{ marginTop: 22 }}>
                        <div><span>BULLET POINTS</span><h3>五大賣點</h3></div>
                        <small>最多 {bulletMaxItems} 項</small>
                      </div>
                      {draft.bulletPoints.map((bullet, index) => {
                        const enabled = Boolean(
                          bulletCapability?.supported &&
                          bulletCapability.editable &&
                          index < bulletMaxItems,
                        );
                        const helpId = `content-bullet-${index + 1}-help`;
                        return (
                          <label
                            key={index}
                            htmlFor={`content-bullet-${index + 1}`}
                            style={{ marginTop: index === 0 ? 0 : 15 }}
                          >
                            <span>賣點 {index + 1}</span>
                            <textarea
                              id={`content-bullet-${index + 1}`}
                              value={bullet}
                              onChange={(event) => {
                                const nextBullets = [...draft.bulletPoints];
                                nextBullets[index] = event.target.value;
                                updateDraft({ ...draft, bulletPoints: nextBullets });
                              }}
                              rows={3}
                              maxLength={bulletCapability?.maxLength ?? undefined}
                              disabled={!enabled}
                              aria-describedby={helpId}
                            />
                            <small id={helpId}>
                              {enabled
                                ? `${bullet.length}${bulletCapability?.maxLength === null ? "" : ` / ${bulletCapability?.maxLength}`} 字元`
                                : index >= bulletMaxItems
                                  ? `此商品類型最多 ${bulletMaxItems} 項`
                                  : bulletCapability?.reason || "此商品類型不支援在這裡編輯賣點。"}
                            </small>
                          </label>
                        );
                      })}

                      <label htmlFor="content-ingredients" style={{ marginTop: 22 }}>
                        <span>成分</span>
                        <textarea
                          id="content-ingredients"
                          value={draft.ingredients}
                          onChange={(event) =>
                            updateDraft({ ...draft, ingredients: event.target.value })
                          }
                          rows={5}
                          maxLength={ingredientCapability?.maxLength ?? undefined}
                          disabled={
                            !ingredientCapability?.supported || !ingredientCapability.editable
                          }
                          aria-describedby="content-ingredients-help"
                        />
                        <small id="content-ingredients-help">
                          {ingredientCapability?.supported && ingredientCapability.editable
                            ? `${draft.ingredients.length}${ingredientCapability.maxLength === null ? "" : ` / ${ingredientCapability.maxLength}`} 字元`
                            : ingredientCapability?.reason || "此商品類型不支援在這裡編輯成分。"}
                        </small>
                      </label>

                      {fieldErrors.length > 0 && (
                        <div className="price-error" role="alert">
                          {fieldErrors.join("；")}
                        </div>
                      )}
                      <button
                        className="price-primary-button"
                        type="button"
                        onClick={previewContent}
                        disabled={actionLoading || !hasChanges || fieldErrors.length > 0}
                      >
                        {actionLoading ? "Amazon 預檢中…" : "檢查這次內容變更"}
                      </button>
                    </section>
                    {listing.notice && (
                      <p className="batch-footnote">{listing.notice}</p>
                    )}
                  </section>
                )}
              </>
            )}

            {phase === "confirm" && listing && validation && (
              <section className="price-confirmation">
                <button
                  className="back-link"
                  type="button"
                  onClick={() => {
                    setPhase("edit");
                    setValidation(null);
                    setConfirmationSku("");
                    setError(null);
                  }}
                  disabled={actionLoading}
                >
                  ← 返回修改
                </button>
                <p className="eyebrow">FINAL CONFIRMATION</p>
                <h3>確認商品內容變更</h3>
                <p className="confirmation-product">
                  {marketplace.label} · {listing.sellerSku}
                </p>
                <div className="price-warning compact">
                  <strong>這次會修改</strong>
                  <p>{changedFields.join("、")}</p>
                </div>
                <div className={`validation-status ${validation.mode}`}>
                  <strong>
                    {validation.mode === "live"
                      ? "Amazon Validation Preview 已通過"
                      : "展示預檢已通過"}
                  </strong>
                  <p>{validation.notice}</p>
                </div>
                {validation.issues.length > 0 && (
                  <div className="validation-issues">
                    <strong>Amazon 預檢提醒</strong>
                    {validation.issues.map((issue, index) => (
                      <p key={`${issue.code ?? "issue"}-${index}`}>{issue.message}</p>
                    ))}
                  </div>
                )}
                <label className="confirmation-input" htmlFor="content-confirmation-sku">
                  <span>重新輸入完整 SKU 以確認</span>
                  <input
                    id="content-confirmation-sku"
                    value={confirmationSku}
                    onChange={(event) => setConfirmationSku(event.target.value)}
                    placeholder={listing.sellerSku}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {confirmationSku && confirmationSku !== listing.sellerSku && (
                    <small>SKU 尚未完全一致</small>
                  )}
                </label>
                {error && <div className="price-error" role="alert">{error}</div>}
                <button
                  className="price-primary-button danger-button"
                  type="button"
                  onClick={commitContent}
                  disabled={actionLoading || confirmationSku !== listing.sellerSku}
                >
                  {actionLoading
                    ? "送交 Amazon 中…"
                    : validation.mode === "demo"
                      ? `模擬更新 ${listing.sellerSku}`
                      : `確認更新 ${listing.sellerSku}`}
                </button>
                <p className="submission-note">
                  送出前 Mac App 會重新讀取舊內容並再次預檢；若內容已被其他系統修改，這次更新會停止。
                </p>
              </section>
            )}

            {phase === "result" && listing && result && (
              <section className="price-result">
                <div className={`result-icon ${resultConfirmed ? "effective" : result.mode}`}>
                  {resultConfirmed ? "✓" : result.mode === "demo" ? "D" : "…"}
                </div>
                <p className="eyebrow">
                  {resultConfirmed
                    ? "CONTENT CONFIRMED"
                    : result.mode === "demo"
                      ? "SIMULATION COMPLETE"
                      : "AMAZON ACCEPTED"}
                </p>
                <h3>
                  {resultConfirmed
                    ? "商品內容已確認更新"
                    : result.mode === "demo"
                      ? "模擬商品內容更新完成"
                      : "Amazon 已接受，等待同步"}
                </h3>
                <p>{resultConfirmed ? "標題、五大賣點與成分已完成回讀核對。" : result.notice}</p>
                {error && <div className="price-error" role="alert">{error}</div>}
                <button
                  className="price-primary-button"
                  type="button"
                  onClick={recheckContent}
                  disabled={actionLoading}
                >
                  {actionLoading ? "重新查詢中…" : "立即再查一次"}
                </button>
                <button
                  className="secondary-wide-button"
                  type="button"
                  onClick={() => {
                    setPhase("edit");
                    setValidation(null);
                    setResult(null);
                    setConfirmationSku("");
                    setIdempotencyKey("");
                    setResultConfirmed(false);
                    setSubmittedContent(null);
                    setError(null);
                  }}
                  disabled={actionLoading}
                >
                  返回商品內容
                </button>
              </section>
            )}
          </div>
        )}

        {tab === "export" && (
          <section
            id="content-export-panel"
            className="batch-panel"
            role="tabpanel"
            aria-labelledby="content-export-tab"
          >
            <p className="price-intro">
              一鍵建立此站點全部 FBA 商品的 Excel，包含 Seller SKU、ASIN、商品標題、五大賣點與成分。
            </p>
            <div
              className="content-export-note"
              style={{ marginTop: 0 }}
            >
              <strong>只讀匯出，不會修改 Amazon</strong>
              <p>Amazon 可能需要一些時間建立完整報表；完成後會自動下載 .xlsx。</p>
            </div>
            {exportError && <div className="price-error" role="alert">{exportError}</div>}
            {exportStatusText && (
              <div
                className={`validation-status ${exportState === "done" ? "" : "demo"}`}
                role="status"
                aria-live="polite"
              >
                <strong>{exportStatusText}</strong>
                {exportReply?.progress !== null && exportReply?.progress !== undefined && (
                  <p>進度 {Math.max(0, Math.min(100, Math.round(exportReply.progress)))}%</p>
                )}
                {exportReply?.reportId && <p>報表 ID · {exportReply.reportId}</p>}
              </div>
            )}
            <button
              className="price-primary-button"
              type="button"
              onClick={startExport}
              disabled={
                exportState === "starting" ||
                exportState === "polling" ||
                exportState === "downloading"
              }
            >
              {exportState === "starting"
                ? "開始建立中…"
                : exportState === "polling"
                  ? "Amazon 建立報表中…"
                  : exportState === "downloading"
                    ? "下載中…"
                    : exportState === "done"
                      ? "再次匯出全部商品"
                      : `一鍵匯出 ${marketplace.short} 全部商品`}
            </button>
            {exportState === "done" && exportReply && (
              <button
                className="secondary-wide-button"
                type="button"
                onClick={() => {
                  const controller = new AbortController();
                  exportAbortRef.current?.abort();
                  exportAbortRef.current = controller;
                  setExportError(null);
                  void downloadExport(exportReply, controller.signal).catch((downloadError) => {
                    if (downloadError instanceof Error && downloadError.name === "AbortError") return;
                    setExportState("idle");
                    setExportError(
                      downloadError instanceof Error
                        ? downloadError.message
                        : "Excel 下載失敗，請重新匯出。",
                    );
                  });
                }}
              >
                重新下載剛才的 Excel
              </button>
            )}
            <p className="batch-footnote">
              Excel 不含 Amazon 憑證、Seller ID、買家資料或訂單資料。每次匯出只包含所選站點。
            </p>
          </section>
        )}

        <div className="privacy-footnote price-footnote">
          這個工具只處理 FBA 商品內容。所有憑證留在這台 Mac；寫入前會先跑 Amazon 預檢、完整 SKU 與本機確認。
        </div>
      </aside>
    </div>
  );
}
