"use client";

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
import ImageAuditPanel, { type ImageAuditCache } from "./image-audit-panel";

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

const MARKETPLACES = [
  { id: "ATVPDKIKX0DER", label: "US · 美國站", sample: "AFA-TRKY-4OZ" },
  { id: "A1VC38T7YXB528", label: "JP · 日本站", sample: "AFA100-JP" },
  { id: "A2EUQ1WTGCTBG2", label: "CA · 加拿大站", sample: "AFA-TRKY-4OZ" },
  { id: "A19VAU5U5O7RUS", label: "SG · 新加坡站", sample: "AFA-TRKY-4OZ" },
  { id: "A39IBJ37TRP1C6", label: "AU · 澳洲站", sample: "AFA-TRKY-4OZ" },
  { id: "A1F83G8C2ARO7P", label: "UK · 英國站", sample: "AFA-TRKY-4OZ" },
  { id: "A1PA6795UKMFR9", label: "DE · 德國站", sample: "AFA-TRKY-4OZ" },
];

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
  onContextResolved,
  onClose,
}: {
  initialMarketplaceId: string;
  initialSellerSku?: string;
  initialTab?: ImageWorkspaceTab;
  auditCacheByMarketplace?: Readonly<Record<string, ImageAuditCache>>;
  onAuditCacheChange?: (cache: ImageAuditCache) => void;
  onContextResolved?: (marketplaceId: string, sellerSku: string) => void;
  onClose: () => void;
}) {
  const [marketplaceId, setMarketplaceId] = useState(initialMarketplaceId);
  const [skuInput, setSkuInput] = useState(initialSellerSku);
  const [tab, setTab] = useState<ImageWorkspaceTab>(initialTab);
  const [returnToAudit, setReturnToAudit] = useState(initialTab === "audit");
  const [snapshot, setSnapshot] = useState<ImageSnapshot | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [manualUrl, setManualUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [phase, setPhase] = useState<"edit" | "confirm" | "result">("edit");
  const [preview, setPreview] = useState<UpdateResult | null>(null);
  const [result, setResult] = useState<UpdateResult | null>(null);
  const [verified, setVerified] = useState(false);
  const [confirmationSku, setConfirmationSku] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileTargetRef = useRef<number | undefined>(undefined);
  const autoLookupRef = useRef(false);
  const autoRecheckRef = useRef("");

  const marketplace =
    MARKETPLACES.find((item) => item.id === marketplaceId) ?? MARKETPLACES[0];
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
    (asset) => asset.previewUrl && !asset.readyForAmazon,
  );
  const hasDuplicateUrls = useMemo(() => {
    const urls = requestedUrls.filter((item): item is string => Boolean(item));
    return new Set(urls).size !== urls.length;
  }, [requestedUrls]);

  const closeDrawer = useCallback(() => {
    if (hasChanges && phase !== "result" && !window.confirm("圖片排序尚未送出，確定要離開嗎？")) {
      return;
    }
    onClose();
  }, [hasChanges, onClose, phase]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !actionLoading) closeDrawer();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actionLoading, closeDrawer]);

  const reset = (nextMarketplaceId: string) => {
    setMarketplaceId(nextMarketplaceId);
    setSkuInput("");
    setSnapshot(null);
    setAssets([]);
    setPhase("edit");
    setError(null);
    setPreview(null);
    setResult(null);
  };

  const loadSku = useCallback(async (requestedSku: string) => {
    const sellerSku = requestedSku.trim();
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
      const next = payload as ImageSnapshot;
      setSnapshot(next);
      setAssets(next.images.map((item) => emptyAsset(item.url)));
      setSelectedIndex(Math.max(0, next.images.findIndex((item) => item.capability.supported)));
      setPhase("edit");
      setPreview(null);
      setResult(null);
      setVerified(false);
      setSkuInput(next.sellerSku);
      onContextResolved?.(marketplaceId, next.sellerSku);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "目前無法查詢商品圖片。");
    } finally {
      setLoading(false);
    }
  }, [marketplaceId, onContextResolved]);

  const lookup = useCallback(async (event?: FormEvent) => {
    event?.preventDefault();
    await loadSku(skuInput);
  }, [loadSku, skuInput]);

  const changeTab = (nextTab: ImageWorkspaceTab): boolean => {
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

  const openAuditSku = (sellerSku: string) => {
    setReturnToAudit(true);
    setTab("single");
    setPhase("edit");
    void loadSku(sellerSku);
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

  const uploadFile = async (file: File, index: number) => {
    if (!snapshot || !snapshot.images[index]?.capability.editable) return;
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
      });
      const payload = (await response.json()) as {
        key?: string;
        previewUrl?: string;
        amazonUrl?: string | null;
        readyForAmazon?: boolean;
        notice?: string;
        message?: string;
      };
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
              }
            : item,
        ),
      );
    } catch (requestError) {
      setAssets((items) =>
        items.map((item, itemIndex) =>
          itemIndex === index ? { ...item, uploading: false } : item,
        ),
      );
      setError(requestError instanceof Error ? requestError.message : "圖片上傳失敗。");
    }
  };

  const uploadFiles = async (files: File[], preferredIndex?: number) => {
    if (!snapshot || !files.length) return;
    const open = supportedIndexes.filter(
      (index) => snapshot.images[index].capability.editable && !assets[index]?.previewUrl,
    );
    const targets = preferredIndex === undefined
      ? open
      : [preferredIndex, ...open.filter((index) => index !== preferredIndex)];
    for (let index = 0; index < Math.min(files.length, targets.length); index += 1) {
      await uploadFile(files[index], targets[index]);
    }
  };

  const swapAssets = (left: number, right: number) => {
    if (left === right || left < 0 || right < 0) return;
    setAssets((items) => {
      const next = [...items];
      [next[left], next[right]] = [next[right], next[left]];
      return next;
    });
    setSelectedIndex(right);
  };

  const onDrop = (event: ReactDragEvent, index?: number) => {
    event.preventDefault();
    if (draggingIndex !== null && index !== undefined) {
      swapAssets(draggingIndex, index);
      setDraggingIndex(null);
      return;
    }
    const files = Array.from(event.dataTransfer.files).filter((file) =>
      ["image/jpeg", "image/png"].includes(file.type),
    );
    void uploadFiles(files, index);
  };

  const applyManualUrl = async () => {
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
    setActionLoading(true);
    setError(null);
    try {
      const dimensions = await inspectRemoteImage(value);
      if (dimensions.width < 500 || dimensions.height < 500) {
        throw new Error("圖片寬高都必須至少 500px；建議 1000px 以上。");
      }
      setAssets((items) =>
        items.map((item, index) =>
          index === selectedIndex
            ? { url: value, previewUrl: value, key: null, readyForAmazon: true, uploading: false }
            : item,
        ),
      );
      setManualUrl("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "圖片網址檢查失敗。");
    } finally {
      setActionLoading(false);
    }
  };

  const updateBody = () => ({
    marketplaceId,
    sellerSku: snapshot?.sellerSku,
    expectedUrls,
    urls: requestedUrls,
    confirmationSku,
    idempotencyKey,
  });

  const previewChange = async () => {
    if (!snapshot || !hasChanges || hasPrivateDraft) return;
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
      if (!response.ok) {
        throw new Error(problemMessage(payload as ApiProblem, "Amazon 圖片預檢未通過。"));
      }
      setPreview(payload as UpdateResult);
      setIdempotencyKey(key);
      setConfirmationSku("");
      setPhase("confirm");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Amazon 圖片預檢未通過。");
    } finally {
      setActionLoading(false);
    }
  };

  const submit = async () => {
    if (!snapshot || !preview || confirmationSku !== snapshot.sellerSku) return;
    setActionLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/sp-api/listing-images", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(updateBody()),
      });
      const payload = (await response.json()) as UpdateResult | ApiProblem;
      if (!response.ok) {
        throw new Error(problemMessage(payload as ApiProblem, "Amazon 未接受圖片更新。"));
      }
      const nextResult = payload as UpdateResult;
      setResult(nextResult);
      setVerified(nextResult.mode === "demo");
      setPhase("result");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Amazon 未接受圖片更新。");
    } finally {
      setActionLoading(false);
    }
  };

  const recheckImages = useCallback(async () => {
    if (!snapshot || !result) return;
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
      setError(requestError instanceof Error ? requestError.message : "目前無法確認 Amazon 圖片。");
    } finally {
      setActionLoading(false);
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
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !actionLoading) closeDrawer();
    }}>
      <aside className="order-drawer image-workspace-drawer" role="dialog" aria-modal="true" aria-labelledby="image-workspace-title">
        <div className="drawer-header">
          <div>
            <p className="eyebrow">LISTING MEDIA · FBA ONLY</p>
            <h2 id="image-workspace-title">商品圖片</h2>
          </div>
          <button type="button" onClick={closeDrawer} disabled={actionLoading} aria-label="關閉圖片工作區">×</button>
        </div>

        {phase === "edit" && (
          <>
            <div className="automation-summary"><span className="automation-badge automatic">自動</span><p>全站圖片健檢會找出少於五張圖片與讀取未完成的 FBA SKU；單一 SKU 的格式、像素、PTD 與回查由系統處理。</p><span className="automation-badge one_click">一鍵</span><p>健檢會自動建立及輪詢報表；圖片排序完成後可安全預檢並送出。</p><span className="automation-badge manual">需人工</span><p>選圖、排序與主圖位置必須由你判斷。</p></div>
            <div className="sku-ops-tabs image-workspace-tabs" role="tablist" aria-label="商品圖片工具">
              <button
                id="image-single-tab"
                type="button"
                role="tab"
                aria-selected={tab === "single"}
                aria-controls="image-single-panel"
                className={tab === "single" ? "active" : ""}
                onClick={() => changeTab("single")}
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
              >
                全站圖片健檢
              </button>
            </div>
          </>
        )}

        {phase === "edit" && tab === "single" && (
          <>
            {returnToAudit && (
              <button
                className="back-link image-audit-return-button"
                type="button"
                onClick={() => changeTab("audit")}
                disabled={loading || actionLoading}
              >
                ← 返回全站圖片健檢結果
              </button>
            )}
            <p className="price-intro">拖進來、排好順序、預檢後送出。主圖放第一格，最多八張副圖。</p>
            <div
              id="image-single-panel"
              role="tabpanel"
              aria-labelledby="image-single-tab"
            >
            <form className="price-search image-search" onSubmit={lookup}>
              <label>
                <span>Amazon 站點</span>
                <select value={marketplaceId} onChange={(event) => reset(event.target.value)} disabled={loading || actionLoading}>
                  {MARKETPLACES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>
              <label>
                <span>Seller SKU</span>
                <div className="sku-search-row">
                  <input value={skuInput} onChange={(event) => setSkuInput(event.target.value)} placeholder={`例如 ${marketplace.sample}`} autoFocus autoComplete="off" spellCheck={false} />
                  <button type="submit" disabled={loading || !skuInput.trim()}>{loading ? "查詢中" : "查詢"}</button>
                </div>
              </label>
            </form>

            {error && <div className="price-error" role="alert">{error}</div>}

            {snapshot && (
              <>
                <section className="image-product-bar">
                  <div>
                    <strong>{snapshot.title}</strong>
                    <p>{snapshot.sellerSku} · {snapshot.asin ?? "無 ASIN"} · {snapshot.productType}</p>
                  </div>
                  <span className={`listing-mode ${snapshot.mode}`}>{snapshot.mode === "live" ? "Live" : "Demo"}</span>
                </section>

                <section className="image-drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => onDrop(event)} onClick={() => { fileTargetRef.current = undefined; inputRef.current?.click(); }}>
                  <input ref={inputRef} type="file" accept="image/jpeg,image/png" multiple hidden onChange={(event) => {
                    void uploadFiles(Array.from(event.target.files ?? []), fileTargetRef.current);
                    fileTargetRef.current = undefined;
                    event.target.value = "";
                  }} />
                  <span className="image-drop-icon">＋</span>
                  <div><strong>把 JPEG／PNG 拉到這裡</strong><small>或點一下選檔 · 每張 10 MB · 至少 500 × 500px</small></div>
                </section>

                <section className="image-slot-grid" aria-label="商品圖片排序">
                  {supportedIndexes.map((index) => {
                    const slot = snapshot.images[index];
                    const asset = assets[index] ?? emptyAsset();
                    return (
                      <article
                        key={slot.attributeName}
                        className={`image-slot ${selectedIndex === index ? "selected" : ""} ${index === 0 ? "main" : ""}`}
                        draggable={Boolean(asset.previewUrl) && !asset.uploading}
                        onDragStart={() => setDraggingIndex(index)}
                        onDragEnd={() => setDraggingIndex(null)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => onDrop(event, index)}
                        onClick={() => setSelectedIndex(index)}
                      >
                        <div className="image-slot-label"><span>{slot.label}</span>{index === 0 && <b>MAIN</b>}</div>
                        <div className="image-preview">
                          {asset.uploading ? <span className="image-loading">上傳中…</span> : asset.previewUrl ? <img src={asset.previewUrl} alt={`${snapshot.title} ${slot.label}`} /> : <button type="button" onClick={(event) => { event.stopPropagation(); setSelectedIndex(index); fileTargetRef.current = index; inputRef.current?.click(); }}>＋</button>}
                        </div>
                        {asset.previewUrl && (
                          <div className="image-slot-actions">
                            {index > 0 && <button type="button" onClick={(event) => { event.stopPropagation(); swapAssets(index, 0); }}>設主圖</button>}
                            <button type="button" disabled={index === supportedIndexes[0]} onClick={(event) => { event.stopPropagation(); const position = supportedIndexes.indexOf(index); swapAssets(index, supportedIndexes[position - 1]); }}>←</button>
                            <button type="button" disabled={index === supportedIndexes.at(-1)} onClick={(event) => { event.stopPropagation(); const position = supportedIndexes.indexOf(index); swapAssets(index, supportedIndexes[position + 1]); }}>→</button>
                            <button type="button" className="danger" onClick={(event) => { event.stopPropagation(); setAssets((items) => items.map((item, itemIndex) => itemIndex === index ? emptyAsset() : item)); }}>移除</button>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </section>

                <section className="image-url-panel">
                  <div><strong>{snapshot.images[selectedIndex]?.label ?? "圖片"}公開網址</strong><small>已經有 CDN 圖片時，可直接貼上 HTTPS URL。</small></div>
                  <div className="sku-search-row"><input value={manualUrl} onChange={(event) => setManualUrl(event.target.value)} placeholder="https://cdn.example.com/product.jpg" inputMode="url" /><button type="button" onClick={() => void applyManualUrl()} disabled={actionLoading}>{actionLoading ? "檢查中" : "檢查並套用"}</button></div>
                </section>

                {hasPrivateDraft && <div className="price-warning compact"><strong>圖片已暫存，但尚無 Amazon 可用網址</strong><p>請設定公開 R2／CDN 網域，或為這些格子貼上公開 HTTPS URL；私人網站網址不能交給 Amazon 抓圖。</p></div>}
                {hasDuplicateUrls && <div className="price-warning compact"><strong>發現重複圖片網址</strong><p>同一個 URL 不可同時放在兩個圖片位置；系統已停止預檢，請移除重複項目。</p></div>}

                <div className="image-submit-row">
                  <span>{assets.filter((asset) => asset.previewUrl).length} / {supportedIndexes.length} 張</span>
                  <button className="price-primary-button" type="button" onClick={previewChange} disabled={!hasChanges || hasPrivateDraft || hasDuplicateUrls || actionLoading || assets.some((asset) => asset.uploading)}>{actionLoading ? "Amazon 預檢中…" : "安全預檢圖片"}</button>
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
                disabled={loading || actionLoading}
              >
                {MARKETPLACES.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </label>
            <ImageAuditPanel
              marketplaceId={marketplaceId}
              marketplaceShort={marketplace.label.split(" · ")[0]}
              onOpenSku={openAuditSku}
              cachedResult={auditCacheByMarketplace[marketplaceId] ?? null}
              onCachedResultChange={onAuditCacheChange}
            />
          </div>
        )}

        {phase === "confirm" && snapshot && preview && (
          <section className="image-confirmation">
            <button className="back-link" type="button" onClick={() => setPhase("edit")}>← 返回排序</button>
            <p className="eyebrow">FINAL CONFIRMATION</p>
            <h3>Amazon 預檢已通過</h3>
            <p>將更新 {preview.changedSlots.length} 個圖片位置。送出後 Amazon 仍需下載與審核圖片。</p>
            {preview.issues.length > 0 && <div className="price-warning compact"><strong>Amazon 警告</strong><p>{preview.issues.map((item) => item.message).join("；")}</p></div>}
            <label className="confirmation-field"><span>重新輸入完整 SKU 確認</span><input value={confirmationSku} onChange={(event) => setConfirmationSku(event.target.value)} placeholder={snapshot.sellerSku} autoFocus autoComplete="off" spellCheck={false} /></label>
            {error && <div className="price-error" role="alert">{error}</div>}
            <button className="price-primary-button" type="button" onClick={submit} disabled={actionLoading || confirmationSku !== snapshot.sellerSku}>{actionLoading ? "送出中…" : "送出圖片更新"}</button>
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
      </aside>
    </div>
  );
}
