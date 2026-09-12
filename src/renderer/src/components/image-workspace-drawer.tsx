"use client";

import ImageBatchImport, { type ImageUploadOutcome } from "./image-batch-import";
import AuditItemNavigation from "./audit-item-navigation";

/* eslint-disable @next/next/no-img-element -- arbitrary authenticated R2/CDN previews cannot use a fixed Next image host */

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from "react";
import {
  MARKETPLACES,
  marketplaceById,
  marketplaceSelectLabel,
} from "../../../shared/marketplaces";
import ImageAuditPanel, { type ImageAuditCache } from "./image-audit-panel";
import type {
  StandaloneAuditJob,
  StandaloneAuditMode,
} from "../standalone-audit";
import AuditWorkspaceShell, {
  type AuditSurfacePresentation,
} from "./audit-workspace-shell";

export type ImageWorkspaceTab = "single" | "audit";

type ImageCapability = {
  attributeName: string;
  label: string;
  supported: boolean;
  editable: boolean;
  required: boolean;
  reason: string | null;
};

type ImageSnapshot = {
  confirmationMode?: "native";
  snapshotToken?: string;
  mode: "live" | "demo";
  marketplaceId: string;
  sellerSku: string;
  asin: string | null;
  productType: string;
  title: string;
  images: Array<{
    attributeName: string;
    label: string;
    url: string | null;
    capability: ImageCapability;
  }>;
  notice: string;
};

type Asset = {
  url: string | null;
  previewUrl: string | null;
  key: string | null;
  readyForAmazon: boolean;
  uploading: boolean;
  sourceFile: File | null;
};

type UpdateResult = {
  mode: "live" | "demo";
  status: "VALID" | "ACCEPTED" | "SIMULATED";
  completedAt: string;
  changedSlots: number[];
  notice: string;
  issues: Array<{ severity: string; message: string }>;
};

type ApiProblem = { message?: string; requestId?: string | null };

function problemMessage(payload: ApiProblem, fallback: string) {
  return `${payload.message || fallback}${payload.requestId ? `（Request ID: ${payload.requestId}）` : ""}`;
}

function createIdempotencyKey() {
  return `images-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 12)}`;
}

function emptyAsset(url: string | null = null): Asset {
  return {
    url,
    previewUrl: url,
    key: null,
    readyForAmazon: Boolean(url),
    uploading: false,
    sourceFile: null,
  };
}

function inspectRemoteImage(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeout = window.setTimeout(() => {
      image.src = "";
      reject(new Error("圖片載入逾時，請確認公開網址可直接開啟。"));
    }, 8_000);
    image.onload = () => {
      window.clearTimeout(timeout);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error("無法讀取這個圖片網址，請確認沒有登入或防盜連限制。"));
    };
    image.referrerPolicy = "no-referrer";
    image.src = url;
  });
}

export default function ImageWorkspaceDrawer({
  initialMarketplaceId,
  initialSellerSku = "",
  initialTab = "single",
  auditCacheByMarketplace = {},
  onAuditCacheChange,
  auditMode = "live",
  auditJob = null,
  onAuditJobChange,
  minimumImages,
  onMinimumImagesChange,
  onContextResolved,
  onBusyChange,
  presentation = "dialog",
  onClose,
}: {
  initialMarketplaceId: string;
  initialSellerSku?: string;
  initialTab?: ImageWorkspaceTab;
  auditCacheByMarketplace?: Readonly<Record<string, ImageAuditCache>>;
  onAuditCacheChange?: (cache: ImageAuditCache) => void;
  auditMode?: StandaloneAuditMode;
  auditJob?: StandaloneAuditJob | null;
  onAuditJobChange?: (job: StandaloneAuditJob) => void;
  minimumImages?: number;
  onMinimumImagesChange?: (value: number) => void;
  onContextResolved?: (marketplaceId: string, sellerSku: string) => void;
  onBusyChange?: (busy: boolean) => void;
  presentation?: AuditSurfacePresentation;
  onClose: () => void;
}) {
  const [marketplaceId, setMarketplaceId] = useState(initialMarketplaceId);
  const [skuInput, setSkuInput] = useState(initialSellerSku);
  const [tab, setTab] = useState<ImageWorkspaceTab>(initialTab);
  const [returnToAudit, setReturnToAudit] = useState(initialTab === "audit");
  const [editorQueue, setEditorQueue] = useState<readonly string[]>([]);
  const [snapshot, setSnapshot] = useState<ImageSnapshot | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [snapshotRevision, setSnapshotRevision] = useState(-1);
  const [isolatedBatches, setIsolatedBatches] = useState<Array<{ marketplaceId: string; sellerSku: string; files: File[]; positions: Array<{ file: File; index: number }> }>>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [manualUrl, setManualUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [phase, setPhase] = useState<"edit" | "confirm" | "result">("edit");
  const [preview, setPreview] = useState<UpdateResult | null>(null);
  const [result, setResult] = useState<UpdateResult | null>(null);
  const [verified, setVerified] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchPositions, setBatchPositions] = useState<Array<{ file: File; index: number }>>([]);
  const [batchId, setBatchId] = useState(0);
  const [batchProcessing, setBatchProcessing] = useState(false);
  const uploadContextRef = useRef(0);
  const uploadBusyRef = useRef(false);
  const activeUploadRef = useRef<{ file: File; index: number; controller: AbortController } | null>(null);
  const busy = actionLoading || batchProcessing || assets.some(asset => asset.uploading);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileTargetRef = useRef<number | undefined>(undefined);
  const autoLookupRef = useRef(false);
  const autoRecheckRef = useRef("");

  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);

  useEffect(() => () => {
    uploadContextRef.current += 1;
    activeUploadRef.current?.controller.abort();
  }, []);

  useEffect(() => window.fbaOS?.app.onContextInvalidated?.(() => {
    uploadContextRef.current += 1;
    const activeFile = activeUploadRef.current?.file;
    if (snapshot) {
      const files = [...new Set([...batchFiles, ...assets.flatMap(asset => asset.sourceFile ? [asset.sourceFile] : []), ...(activeFile ? [activeFile] : [])])];
      const positions = [...batchPositions, ...assets.flatMap((asset, index) => asset.sourceFile ? [{ file: asset.sourceFile, index }] : [])];
      if (activeUploadRef.current) positions.push({ file: activeUploadRef.current.file, index: activeUploadRef.current.index });
      if (files.length) setIsolatedBatches(previous => {
        const matching = previous.find(batch => batch.marketplaceId === snapshot.marketplaceId && batch.sellerSku === snapshot.sellerSku);
        const retainedPositions = new Map([...(matching?.positions ?? []), ...positions].map(position => [position.file, position]));
        return [...previous.filter(batch => batch !== matching), { marketplaceId: snapshot.marketplaceId, sellerSku: snapshot.sellerSku, files: [...new Set([...(matching?.files ?? []), ...files])], positions: [...retainedPositions.values()] }];
      });
    }
    activeUploadRef.current?.controller.abort();
    activeUploadRef.current = null;
    uploadBusyRef.current = false;
    setBatchProcessing(false);
    setActionLoading(false);
    setLoading(false);
    setSnapshot(null);
    setAssets([]);
    setBatchFiles([]);
    setBatchPositions([]);
    setManualUrl("");
    setDraggingIndex(null);
    setPreview(null);
    setResult(null);
    setVerified(false);
    setIdempotencyKey("");
    setPhase("edit");
    setError("帳號或安全環境已更新，圖片草稿已停止；請重新查詢商品後再準備保留圖片。");
  }), [assets, batchFiles, batchPositions, snapshot]);

  const marketplace = marketplaceById(marketplaceId) ?? MARKETPLACES[0];
  const nativeConfirmationAvailable = snapshot?.confirmationMode === "native" && Boolean(snapshot.snapshotToken);
  const supportedIndexes = useMemo(
    () =>
      snapshot?.images.flatMap((item, index) =>
        item.capability.supported ? [index] : [],
      ) ?? [],
    [snapshot],
  );
  const expectedUrls = useMemo(
    () => snapshot?.images.map((item) => item.url) ?? [],
    [snapshot],
  );
  const requestedUrls = useMemo(
    () => snapshot?.images.map((_, index) => assets[index]?.url ?? null) ?? [],
    [assets, snapshot],
  );
  const hasChanges = useMemo(
    () =>
      expectedUrls.length > 0 &&
      expectedUrls.some((url, index) => url !== requestedUrls[index]),
    [expectedUrls, requestedUrls],
  );
  const hasPrivateDraft = assets.some(
    (asset) => (asset.previewUrl || asset.sourceFile) && !asset.readyForAmazon,
  );
  const hasDuplicateUrls = useMemo(() => {
    const urls = requestedUrls.filter((item): item is string => Boolean(item));
    return new Set(urls).size !== urls.length;
  }, [requestedUrls]);

  const closeDrawer = useCallback(() => {
    if (busy) return;
    if ((hasChanges || hasPrivateDraft) && phase !== "result" && !window.confirm("圖片排序尚未送出，確定要離開嗎？")) {
      return;
    }
    onClose();
  }, [busy, hasChanges, hasPrivateDraft, onClose, phase]);

  useEffect(() => {
    if (presentation !== "dialog") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) closeDrawer();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, closeDrawer, presentation]);

  const reset = (nextMarketplaceId: string) => {
    if (busy) return;
    uploadContextRef.current += 1;
    setBatchFiles([]);
    setBatchPositions([]);
    setEditorQueue([]);
    setMarketplaceId(nextMarketplaceId);
    setSkuInput("");
    setSnapshot(null);
    setAssets([]);
    setPhase("edit");
    setError(null);
    setPreview(null);
    setResult(null);
  };

  const loadSku = useCallback(async (requestedSku: string, exact = false) => {
    if (uploadBusyRef.current) return;
    const loadContext = ++uploadContextRef.current;
    setBatchFiles([]);
    setBatchPositions([]);
    setSnapshot(null);
    setAssets([]);
    const sellerSku = exact ? requestedSku : requestedSku.trim();
    if (!sellerSku) return setError("請輸入完整 Seller SKU。");
    setSkuInput(sellerSku);
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ marketplaceId, sku: sellerSku });
      const response = await fetch(`/api/sp-api/listing-images?${params}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as ImageSnapshot | ApiProblem;
      if (!response.ok) {
        throw new Error(problemMessage(payload as ApiProblem, "目前無法查詢商品圖片。"));
      }
      if (loadContext !== uploadContextRef.current) return;
      const next = payload as ImageSnapshot;
      if (next.sellerSku !== sellerSku || next.marketplaceId !== marketplaceId) {
        throw new Error("商品識別與目前選取不一致，請返回健檢後重新開啟。");
      }
      setSnapshot(next);
      setSnapshotRevision(loadContext);
      setAssets(next.images.map((item) => emptyAsset(item.url)));
      setSelectedIndex(Math.max(0, next.images.findIndex((item) => item.capability.supported)));
      setPhase("edit");
      setPreview(null);
      setResult(null);
      setVerified(false);
      setSkuInput(next.sellerSku);
      onContextResolved?.(marketplaceId, next.sellerSku);
    } catch (requestError) {
      if (loadContext !== uploadContextRef.current) return;
      setError(requestError instanceof Error ? requestError.message : "目前無法查詢商品圖片。");
    } finally {
      if (loadContext === uploadContextRef.current) setLoading(false);
    }
  }, [marketplaceId, onContextResolved]);

  const lookup = useCallback(async (event?: FormEvent) => {
    event?.preventDefault();
    await loadSku(skuInput);
  }, [loadSku, skuInput]);

  const changeTab = (nextTab: ImageWorkspaceTab): boolean => {
    if (busy) return false;
    if (nextTab === tab) return true;
    if (
      nextTab === "audit" &&
      hasChanges &&
      phase !== "result" &&
      !window.confirm("圖片排序尚未送出，確定要返回全站圖片健檢嗎？")
    ) {
      return false;
    }
    if (tab === "audit" && nextTab === "single") setReturnToAudit(true);
    setTab(nextTab);
    return true;
  };

  const openAuditSku = (sellerSku: string, navigationSkus: readonly string[] = []) => {
    setEditorQueue([...new Set(navigationSkus)]);
    setReturnToAudit(true);
    setTab("single");
    setPhase("edit");
    void loadSku(sellerSku, true);
  };

  useEffect(() => {
    if (
      autoLookupRef.current ||
      initialTab !== "single" ||
      !initialSellerSku.trim()
    ) return;
    autoLookupRef.current = true;
    void loadSku(initialSellerSku);
  }, [initialSellerSku, initialTab, loadSku]);

  const uploadFile = async (file: File, index: number): Promise<ImageUploadOutcome> => {
    if (uploadBusyRef.current || snapshotRevision !== uploadContextRef.current || !snapshot || !snapshot.images[index]?.capability.editable) {
      return { ok: false, message: "目前商品的圖片位置不可編輯。", stopBatch: true };
    }
    const context = uploadContextRef.current;
    uploadBusyRef.current = true;
    const controller = new AbortController();
    activeUploadRef.current = { file, index, controller };
    let stopBatch = true;
    setAssets((items) =>
      items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, uploading: true } : item,
      ),
    );
    setError(null);
    try {
      const form = new FormData();
      form.set("marketplaceId", marketplaceId);
      form.set("sellerSku", snapshot.sellerSku);
      form.set("file", file);
      const response = await fetch("/api/uploads/listing-images", {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      const payload = (await response.json()) as {
        key?: string;
        previewUrl?: string;
        amazonUrl?: string | null;
        readyForAmazon?: boolean;
        notice?: string;
        message?: string;
        code?: string;
      };
      if (context !== uploadContextRef.current) {
        return { ok: false, message: "商品已切換，已停止套用圖片。", stopBatch: true };
      }
      stopBatch = !([413, 415, 422].includes(response.status) && ["IMAGE_TOO_LARGE", "INVALID_IMAGE", "IMAGE_TOO_SMALL"].includes(payload.code ?? ""));
      if (!response.ok || !payload.previewUrl) {
        throw new Error(payload.message || "圖片上傳失敗。");
      }
      setAssets((items) =>
        items.map((item, itemIndex) =>
          itemIndex === index
            ? {
                url:
                  payload.amazonUrl ??
                  (snapshot.mode === "demo" && payload.key
                    ? `https://demo-images.invalid/${payload.key}`
                    : null),
                previewUrl: payload.previewUrl!,
                key: payload.key ?? null,
                readyForAmazon:
                  Boolean(payload.readyForAmazon) || snapshot.mode === "demo",
                uploading: false,
                sourceFile: file,
              }
            : item,
        ),
      );
      setSelectedIndex(index);
      return { ok: true, readyForAmazon: Boolean(payload.readyForAmazon) || snapshot.mode === "demo" };
    } catch (requestError) {
      if (context !== uploadContextRef.current) return { ok: false, message: "商品已切換，已停止套用圖片。", stopBatch: true };
      setAssets((items) =>
        items.map((item, itemIndex) =>
          itemIndex === index ? { ...item, uploading: false } : item,
        ),
      );
      const message = requestError instanceof Error ? requestError.message : "圖片上傳失敗。";
      setError(message);
      return { ok: false, message, stopBatch };
    } finally {
      if (activeUploadRef.current?.controller === controller) {
        activeUploadRef.current = null;
        uploadBusyRef.current = false;
      }
    }
  };

  const uploadFiles = async (files: File[], preferredIndex?: number) => {
    if (!snapshot || !files.length || busy || uploadBusyRef.current) return;
    if (preferredIndex !== undefined && files.length === 1 && !/_\d+(?:_|\.(?:png|jpe?g)$)/iu.test(files[0].name)) {
      const context = uploadContextRef.current;
      const result = await uploadFile(files[0], preferredIndex);
      if (!result.ok && context === uploadContextRef.current) {
        // Keep the selected file and position without replacing the current
        // image URL; explicit preparation resumes through the same batch UI.
        setAssets(items => items.map((item, index) => index === preferredIndex ? { ...item, sourceFile: files[0], readyForAmazon: false } : item));
        setSelectedIndex(preferredIndex);
        setBatchFiles(files);
        setBatchPositions([{ file: files[0], index: preferredIndex }]);
        setBatchId(value => value + 1);
      }
      return;
    }
    if (files.length > 100) { setError("一次最多選擇 100 個檔案；一個商品最多對應 10 個圖片位置。"); return; }
    setError(null);
    setBatchFiles(files);
    setBatchPositions([]);
    setBatchId(value => value + 1);
  };

  const swapAssets = (left: number, right: number) => {
    if (busy || left === right || left < 0 || right < 0 || !snapshot?.images[left]?.capability.editable || !snapshot.images[right]?.capability.editable) return;
    setAssets((items) => {
      const next = [...items];
      [next[left], next[right]] = [next[right], next[left]];
      return next;
    });
    setSelectedIndex(right);
  };

  const onDrop = (event: ReactDragEvent, index?: number) => {
    event.preventDefault();
    if (busy) return;
    if (draggingIndex !== null && index !== undefined) {
      swapAssets(draggingIndex, index);
      setDraggingIndex(null);
      return;
    }
    const files = Array.from(event.dataTransfer.files);
    void uploadFiles(files, index);
  };

  const applyManualUrl = async () => {
    if (busy || !snapshot?.images[selectedIndex]?.capability.editable) return;
    const value = manualUrl.trim();
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return setError("請貼上有效的 HTTPS 圖片 URL。");
    }
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    ) {
      return setError("圖片網址必須是沒有登入資訊或錨點的公開 HTTPS URL。");
    }
    const context = uploadContextRef.current;
    setActionLoading(true);
    setError(null);
    try {
      const dimensions = await inspectRemoteImage(value);
      if (context !== uploadContextRef.current) return;
      if (dimensions.width < 500 || dimensions.height < 500) {
        throw new Error("圖片寬高都必須至少 500px；建議 1000px 以上。");
      }
      setAssets((items) =>
        items.map((item, index) =>
          index === selectedIndex
            ? { url: value, previewUrl: value, key: null, readyForAmazon: true, uploading: false, sourceFile: item.sourceFile }
            : item,
        ),
      );
      setManualUrl("");
    } catch (requestError) {
      if (context !== uploadContextRef.current) return;
      setError(requestError instanceof Error ? requestError.message : "圖片網址檢查失敗。");
    } finally {
      if (context === uploadContextRef.current) setActionLoading(false);
    }
  };

  const updateBody = () => ({
    marketplaceId,
    sellerSku: snapshot?.sellerSku,
    expectedUrls,
    urls: requestedUrls,
    snapshotToken: snapshot?.snapshotToken,
    idempotencyKey,
  });

  const previewChange = async () => {
    if (busy || uploadBusyRef.current || !snapshot || !nativeConfirmationAvailable || !hasChanges || hasPrivateDraft) return;
    const context = uploadContextRef.current;
    setActionLoading(true);
    setError(null);
    const key = createIdempotencyKey();
    try {
      const response = await fetch("/api/sp-api/listing-images", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...updateBody(), idempotencyKey: key }),
      });
      const payload = (await response.json()) as UpdateResult | ApiProblem;
      if (context !== uploadContextRef.current) return;
      if (!response.ok) {
        throw new Error(problemMessage(payload as ApiProblem, "Amazon 圖片預檢未通過。"));
      }
      setPreview(payload as UpdateResult);
      setIdempotencyKey(key);
      setPhase("confirm");
    } catch (requestError) {
      if (context !== uploadContextRef.current) return;
      setError(requestError instanceof Error ? requestError.message : "Amazon 圖片預檢未通過。");
    } finally {
      if (context === uploadContextRef.current) setActionLoading(false);
    }
  };

  const submit = async () => {
    if (busy || !snapshot || !preview || !nativeConfirmationAvailable) return;
    const context = uploadContextRef.current;
    setActionLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/sp-api/listing-images", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(updateBody()),
      });
      const payload = (await response.json()) as UpdateResult | ApiProblem;
      if (context !== uploadContextRef.current) return;
      if (!response.ok) {
        throw new Error(problemMessage(payload as ApiProblem, "Amazon 未接受圖片更新。"));
      }
      const nextResult = payload as UpdateResult;
      setResult(nextResult);
      setVerified(nextResult.mode === "demo");
      setPhase("result");
    } catch (requestError) {
      if (context !== uploadContextRef.current) return;
      setError(requestError instanceof Error ? requestError.message : "Amazon 未接受圖片更新。");
    } finally {
      if (context === uploadContextRef.current) setActionLoading(false);
    }
  };

  const recheckImages = useCallback(async () => {
    if (!snapshot || !result) return;
    const context = uploadContextRef.current;
    setActionLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        marketplaceId,
        sku: snapshot.sellerSku,
      });
      const response = await fetch(`/api/sp-api/listing-images?${params}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as ImageSnapshot | ApiProblem;
      if (context !== uploadContextRef.current) return;
      if (!response.ok) {
        throw new Error(problemMessage(payload as ApiProblem, "目前無法確認 Amazon 圖片。"));
      }
      const latest = payload as ImageSnapshot;
      const latestUrls = latest.images.map((item) => item.url);
      const requested = assets.map((item) => item.url);
      const confirmed = requested.every(
        (url, index) => (latestUrls[index] ?? null) === (url ?? null),
      );
      setVerified(confirmed);
      if (confirmed) {
        setSnapshot(latest);
      } else {
        setError("Amazon 仍在下載或審核圖片；系統不會重送，請稍後再查。");
      }
    } catch (requestError) {
      if (context !== uploadContextRef.current) return;
      setError(requestError instanceof Error ? requestError.message : "目前無法確認 Amazon 圖片。");
    } finally {
      if (context === uploadContextRef.current) setActionLoading(false);
    }
  }, [assets, marketplaceId, result, snapshot]);

  useEffect(() => {
    if (
      phase !== "result" ||
      !result ||
      result.mode !== "live" ||
      verified ||
      !idempotencyKey ||
      autoRecheckRef.current === idempotencyKey
    ) {
      return;
    }
    autoRecheckRef.current = idempotencyKey;
    const timeout = window.setTimeout(() => void recheckImages(), 5_000);
    return () => window.clearTimeout(timeout);
  }, [idempotencyKey, phase, recheckImages, result, verified]);

  return (
    <AuditWorkspaceShell
      presentation={presentation}
      eyebrow="LISTING MEDIA · FBA ONLY"
      title={tab === "audit" ? "全站圖片健檢" : "商品圖片"}
      closeLabel="關閉圖片工作區"
      surfaceClassName="image-workspace-drawer"
      busy={busy}
      onBack={closeDrawer}
    >

        {phase === "edit" && (
          <>
            <div className="sku-ops-tabs image-workspace-tabs" role="tablist" aria-label="商品圖片工具">
              <button
                id="image-single-tab"
                type="button"
                role="tab"
                aria-selected={tab === "single"}
                aria-controls="image-single-panel"
                className={tab === "single" ? "active" : ""}
                onClick={() => changeTab("single")}
                disabled={busy}
              >
                單一 SKU 圖片工作台
              </button>
              <button
                id="image-audit-tab"
                type="button"
                role="tab"
                aria-selected={tab === "audit"}
                aria-controls="image-audit-panel"
                className={tab === "audit" ? "active" : ""}
                onClick={() => changeTab("audit")}
                disabled={busy}
              >
                全站圖片健檢
              </button>
            </div>
          </>
        )}

        {tab === "single" && returnToAudit && <AuditItemNavigation skus={editorQueue} currentSku={snapshot?.sellerSku ?? skuInput}
          disabled={loading || actionLoading || assets.some(asset => asset.uploading)}
          onSelect={sku => {
            if (loading || actionLoading || assets.some(asset => asset.uploading) || !editorQueue.includes(sku)) return;
            if (phase !== "result" && (hasChanges || hasPrivateDraft || manualUrl.length > 0) &&
              !window.confirm("尚有未送出的圖片變更，確定捨棄並查看下一個商品嗎？")) return;
            setManualUrl("");
            setSnapshot(null);
            setAssets([]);
            void loadSku(sku, true);
          }} />}
        {phase === "edit" && tab === "single" && (
          <>
            {returnToAudit && (
              <button
                className="back-link image-audit-return-button"
                type="button"
                onClick={() => changeTab("audit")}
                disabled={loading || busy}
              >
                ← 返回全站圖片健檢結果
              </button>
            )}
            <p className="price-intro">拖進來、排好順序、預檢後送出。主圖放第一格，最多九張副圖，依此商品允許的位置準備。</p>
            <div
              id="image-single-panel"
              role="tabpanel"
              aria-labelledby="image-single-tab"
            >
            <form className="price-search image-search" onSubmit={lookup}>
              <label>
                <span>Amazon 站點</span>
                <select value={marketplaceId} onChange={(event) => reset(event.target.value)} disabled={loading || busy}>
                  {MARKETPLACES.map((item) => <option key={item.id} value={item.id}>{marketplaceSelectLabel(item)}</option>)}
                </select>
              </label>
              <label>
                <span>Seller SKU</span>
                <div className="sku-search-row">
                  <input disabled={loading || busy} value={skuInput} onChange={(event) => setSkuInput(event.target.value)} placeholder={`例如 ${marketplace.sampleSku}`} autoFocus autoComplete="off" spellCheck={false} />
                  <button type="submit" disabled={loading || busy || !skuInput.trim()}>{loading ? "查詢中" : "查詢"}</button>
                </div>
              </label>
            </form>

            {error && <div className="price-error" role="alert">{error}</div>}
            {isolatedBatches.map(batch => <div className="price-warning compact" key={`${batch.marketplaceId}:${batch.sellerSku}`}>
              <strong>{batch.sellerSku} · 已保留 {batch.files.length} 個原檔</strong>
              <p>先重新查詢相同站點與 Seller SKU，再核對檔名位置；保留檔案不會自動上傳。</p>
              <button type="button" disabled={busy || loading || snapshot?.marketplaceId !== batch.marketplaceId || snapshot?.sellerSku !== batch.sellerSku} onClick={() => {
                const retainedByIndex = new Map(batch.positions.map(position => [position.index, position.file]));
                setAssets(items => items.map((item, index) => {
                  const file = retainedByIndex.get(index);
                  const capability = snapshot?.images[index]?.capability;
                  return file && capability?.supported && capability.editable ? { ...item, sourceFile: file, readyForAmazon: false } : item;
                }));
                setBatchFiles(batch.files);
                setBatchPositions(batch.positions);
                setBatchId(value => value + 1);
                setIsolatedBatches(current => current.filter(item => item !== batch));
              }}>重新準備保留圖片</button>
            </div>)}

            {snapshot && (
              <>
                <section className="image-product-bar">
                  <div>
                    <strong>{snapshot.title}</strong>
                    <p>{snapshot.sellerSku} · {snapshot.asin ?? "無 ASIN"} · {snapshot.productType}</p>
                  </div>
                  <span className={`listing-mode ${snapshot.mode}`}>{snapshot.mode === "live" ? "Live" : "Demo"}</span>
                </section>

                {!nativeConfirmationAvailable && <div className="price-warning compact" role="status"><strong>請更新 AMZ.API Notebook Key</strong><p>目前安裝版本尚不支援直接以 Touch ID／Windows Hello 確認圖片更新。更新後重新查詢商品，即可預檢與送出。</p></div>}

                <section className="image-drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => onDrop(event)} role="button" tabIndex={busy ? -1 : 0} aria-disabled={busy}
                  onKeyDown={event => { if (!busy && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); fileTargetRef.current = undefined; inputRef.current?.click(); } }}
                  onClick={(event) => { if (busy || event.target === inputRef.current) return; fileTargetRef.current = undefined; inputRef.current?.click(); }}>
                  <input ref={inputRef} type="file" accept="image/jpeg,image/png" multiple hidden disabled={busy} onChange={(event) => {
                    void uploadFiles(Array.from(event.target.files ?? []), fileTargetRef.current);
                    fileTargetRef.current = undefined;
                    event.target.value = "";
                  }} />
                  <span className="image-drop-icon">＋</span>
                  <div><strong>把整組 JPEG／PNG 拉到這裡</strong><small>依「品號_01–10」排序，可加說明 · 最多第 1–10 張 · 每張 10 MB · 至少 500 × 500px</small></div>
                </section>

                {batchFiles.length > 0 && <ImageBatchImport key={`${snapshot.marketplaceId}:${snapshot.sellerSku}:${batchId}`}
                  files={batchFiles} positions={batchPositions} sellerSku={snapshot.sellerSku}
                  slots={snapshot.images.map((slot, index) => ({ label: slot.label, editable: slot.capability.supported && slot.capability.editable, reason: slot.capability.reason, occupied: Boolean(assets[index]?.previewUrl), sourceFile: assets[index]?.sourceFile ?? null, readyForAmazon: assets[index]?.readyForAmazon ?? false }))}
                  disabled={busy || loading} upload={uploadFile} onBusyChange={value => { if (snapshotRevision === uploadContextRef.current) setBatchProcessing(value); }} onDismiss={() => setBatchFiles([])} onSelectSlot={setSelectedIndex} />}

                <section className="image-slot-grid" aria-label="商品圖片排序">
                  {supportedIndexes.map((index) => {
                    const slot = snapshot.images[index];
                    const asset = assets[index] ?? emptyAsset();
                    return (
                      <article
                        key={slot.attributeName}
                        className={`image-slot ${selectedIndex === index ? "selected" : ""} ${index === 0 ? "main" : ""}`}
                        draggable={Boolean(asset.previewUrl) && !busy && slot.capability.editable}
                        onDragStart={() => setDraggingIndex(index)}
                        onDragEnd={() => setDraggingIndex(null)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => onDrop(event, index)}
                        onClick={() => setSelectedIndex(index)}
                      >
                        <div className="image-slot-label"><span>{slot.label}</span>{index === 0 && <b>MAIN</b>}</div>
                        <div className="image-preview">
                          {asset.uploading ? <span className="image-loading">上傳中…</span> : asset.previewUrl ? <img src={asset.previewUrl} alt={`${snapshot.title} ${slot.label}`} /> : <button type="button" disabled={busy || !slot.capability.editable} onClick={(event) => { event.stopPropagation(); setSelectedIndex(index); fileTargetRef.current = index; inputRef.current?.click(); }}>＋</button>}
                        </div>
                        {(asset.previewUrl || asset.sourceFile) && (
                          <div className="image-slot-actions">
                            {index > 0 && <button type="button" disabled={busy || !slot.capability.editable} onClick={(event) => { event.stopPropagation(); swapAssets(index, 0); }}>設主圖</button>}
                            <button type="button" disabled={busy || !slot.capability.editable || index === supportedIndexes[0]} onClick={(event) => { event.stopPropagation(); const position = supportedIndexes.indexOf(index); swapAssets(index, supportedIndexes[position - 1]); }}>←</button>
                            <button type="button" disabled={busy || !slot.capability.editable || index === supportedIndexes.at(-1)} onClick={(event) => { event.stopPropagation(); const position = supportedIndexes.indexOf(index); swapAssets(index, supportedIndexes[position + 1]); }}>→</button>
                            <button type="button" className="danger" disabled={busy || !slot.capability.editable} onClick={(event) => { event.stopPropagation(); setAssets((items) => items.map((item, itemIndex) => itemIndex === index ? emptyAsset() : item)); }}>移除</button>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </section>

                <section className="image-url-panel">
                  <div><strong>{snapshot.images[selectedIndex]?.label ?? "圖片"}公開網址</strong><small>已經有 CDN 圖片時，可直接貼上 HTTPS URL。</small></div>
                  <div className="sku-search-row"><input disabled={busy} value={manualUrl} onChange={(event) => setManualUrl(event.target.value)} placeholder="https://cdn.example.com/product.jpg" inputMode="url" /><button type="button" onClick={() => void applyManualUrl()} disabled={busy || !snapshot.images[selectedIndex]?.capability.editable}>{actionLoading ? "檢查中" : "檢查並套用"}</button></div>
                </section>

                {hasPrivateDraft && <div className="price-warning compact"><strong>圖片已暫存，但尚無 Amazon 可用網址</strong><p>原圖保留在目前草稿；圖片服務可用後，按下方按鈕繼續準備。若未出現圖片服務登入，請先更新 AMZ.API Notebook Key；已有公開 HTTPS 圖片網址也可直接套用到對應位置。</p><button type="button" disabled={busy} onClick={() => {
                  setBatchFiles(assets.flatMap(asset => !asset.readyForAmazon && asset.sourceFile ? [asset.sourceFile] : []));
                  setBatchId(value => value + 1);
                }}>繼續準備暫存圖片</button></div>}
                {hasDuplicateUrls && <div className="price-warning compact"><strong>發現重複圖片網址</strong><p>同一個 URL 不可同時放在兩個圖片位置；系統已停止預檢，請移除重複項目。</p></div>}

                <div className="image-submit-row">
                  <span>{supportedIndexes.filter(index => assets[index]?.previewUrl).length} / {supportedIndexes.length} 張</span>
                  <button className="price-primary-button" type="button" onClick={previewChange} disabled={!nativeConfirmationAvailable || !hasChanges || hasPrivateDraft || hasDuplicateUrls || actionLoading || assets.some((asset) => asset.uploading)}>{actionLoading ? "Amazon 預檢中…" : "安全預檢圖片"}</button>
                </div>
              </>
            )}
            </div>
          </>
        )}

        {phase === "edit" && tab === "audit" && (
          <div
            id="image-audit-panel"
            role="tabpanel"
            aria-labelledby="image-audit-tab"
          >
            <label className="ops-marketplace" htmlFor="image-audit-marketplace">
              <span>Amazon 站點</span>
              <select
                id="image-audit-marketplace"
                value={marketplaceId}
                onChange={(event) => reset(event.target.value)}
                disabled={loading || busy}
              >
                {MARKETPLACES.map((item) => (
                  <option key={item.id} value={item.id}>{marketplaceSelectLabel(item)}</option>
                ))}
              </select>
            </label>
            <ImageAuditPanel
              marketplaceId={marketplaceId}
              marketplaceShort={marketplace.shortLabel}
              mode={auditMode}
              onOpenSku={openAuditSku}
              cachedResult={auditCacheByMarketplace[marketplaceId] ?? null}
              onCachedResultChange={onAuditCacheChange}
              initialJob={auditJob}
              onJobChange={onAuditJobChange}
              minimumImages={minimumImages}
              onMinimumImagesChange={onMinimumImagesChange}
            />
          </div>
        )}

        {phase === "confirm" && snapshot && preview && (
          <section className="image-confirmation">
            <button className="back-link" type="button" onClick={() => setPhase("edit")} disabled={actionLoading}>← 返回排序</button>
            <p className="eyebrow">FINAL CONFIRMATION</p>
            <h3>Amazon 預檢已通過</h3>
            <section className="image-product-bar" aria-label="即將更新的商品">
              <div><strong>SKU {snapshot.sellerSku}</strong><p>ASIN {snapshot.asin ?? "無 ASIN"} · {marketplaceSelectLabel(marketplace)}</p></div>
              <span className={`listing-mode ${snapshot.mode}`}>{snapshot.mode === "live" ? "Live" : "Demo"}</span>
            </section>
            <p><strong>變更位置：{preview.changedSlots.map(index => index + 1).join("、")}</strong></p>
            <p>將更新 {preview.changedSlots.length} 個圖片位置。送出後 Amazon 仍需下載與審核圖片。</p>
            <p>送出時使用 Touch ID／Windows Hello 確認這次圖片更新。</p>
            {preview.issues.length > 0 && <div className="price-warning compact"><strong>Amazon 警告</strong><p>{preview.issues.map((item) => item.message).join("；")}</p></div>}
            {error && <div className="price-error" role="alert">{error}</div>}
            <button className="price-primary-button" type="button" onClick={submit} disabled={actionLoading || !nativeConfirmationAvailable}>{actionLoading ? "送出中…" : "送出圖片更新"}</button>
          </section>
        )}

        {phase === "result" && snapshot && result && (
          <section className="image-result-state">
            <span className={`result-check ${verified ? "verified" : "processing"}`}>{verified ? "✓" : "…"}</span>
            <p className="eyebrow">{verified ? "IMAGES CONFIRMED" : result.mode === "live" ? "AMAZON PROCESSING" : "DEMO COMPLETE"}</p>
            <h3>{verified ? "圖片已完成回讀確認" : "Amazon 已接受，正在下載與審核"}</h3>
            <p>{verified ? "圖片位置已與這次送出的內容一致。" : result.notice}</p>
            {error && <div className="price-error" role="status">{error}</div>}
            {!verified && <button className="price-primary-button" type="button" onClick={() => void recheckImages()} disabled={actionLoading}>{actionLoading ? "重新查詢中…" : "立即再查一次"}</button>}
          </section>
        )}

        <div className="drawer-api-footnote">Listings Items v2021-08-01 · Product Type Definitions · Local validation · Optional R2 · FBA only</div>
    </AuditWorkspaceShell>
  );
}
