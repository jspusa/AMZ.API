"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseBrandSalesSnapshot, type BrandSalesSnapshot } from "../brand-sales";
import BrandSalesChart from "./brand-sales-chart";

type BrandSalesJob = {
  jobId: string;
  mode: "live" | "demo";
  marketplaceId: string;
  startDate: string;
  endDate: string;
  expiresAt: string;
  ready: boolean;
  status: "IN_QUEUE" | "IN_PROGRESS" | "DONE";
  message: string;
};

export type BrandSalesFailure = {
  code: string | null;
  message: string;
  requestId: string | null;
};

class BrandSalesResponseError extends Error {
  readonly code: string | null;
  readonly requestId: string | null;

  constructor(failure: BrandSalesFailure) {
    super(failure.message);
    this.name = "BrandSalesResponseError";
    this.code = failure.code;
    this.requestId = failure.requestId;
  }
}

function parseJob(
  value: unknown,
  expected: { marketplaceId: string; startDate: string; endDate: string },
): BrandSalesJob {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("品牌營收工作狀態無法辨識。");
  }
  const job = value as Record<string, unknown>;
  if (
    typeof job.jobId !== "string" ||
    !/^[A-Za-z0-9-]{8,120}$/u.test(job.jobId) ||
    (job.mode !== "live" && job.mode !== "demo") ||
    job.marketplaceId !== expected.marketplaceId ||
    job.startDate !== expected.startDate ||
    job.endDate !== expected.endDate ||
    typeof job.expiresAt !== "string" ||
    Number.isNaN(Date.parse(job.expiresAt)) ||
    typeof job.ready !== "boolean" ||
    (job.status !== "IN_QUEUE" && job.status !== "IN_PROGRESS" && job.status !== "DONE") ||
    job.ready !== (job.status === "DONE") ||
    typeof job.message !== "string"
  ) {
    throw new Error("品牌營收工作狀態無法辨識。");
  }
  return job as unknown as BrandSalesJob;
}

type BrandSalesSnapshotCacheEntry = {
  jobId: string;
  mode: BrandSalesJob["mode"];
  marketplaceId: string;
  startDate: string;
  endDate: string;
  expiresAt: number;
  snapshot: BrandSalesSnapshot;
};

const brandSalesSnapshotCache = new Map<string, BrandSalesSnapshotCacheEntry>();
const BRAND_SALES_SNAPSHOT_CACHE_LIMIT = 24;

function snapshotCacheKey(job: BrandSalesJob): string {
  // jobId is minted and account-scoped by trusted main. Including mode,
  // marketplace and exact range prevents a cached aggregate from being used
  // for another renderer selection even if an invalid bridge reuses an ID.
  return [job.jobId, job.mode, job.marketplaceId, job.startDate, job.endDate].join(":");
}

export function clearBrandSalesSnapshotCache(): void {
  brandSalesSnapshotCache.clear();
}

export function readBrandSalesSnapshotCache(
  job: BrandSalesJob,
  now = Date.now(),
): BrandSalesSnapshot | null {
  const key = snapshotCacheKey(job);
  const entry = brandSalesSnapshotCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now || entry.expiresAt !== Date.parse(job.expiresAt)) {
    brandSalesSnapshotCache.delete(key);
    return null;
  }
  brandSalesSnapshotCache.delete(key);
  brandSalesSnapshotCache.set(key, entry);
  return entry.snapshot;
}

export function storeBrandSalesSnapshotCache(
  job: BrandSalesJob,
  snapshot: BrandSalesSnapshot,
  now = Date.now(),
): void {
  const expiresAt = Date.parse(job.expiresAt);
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= now ||
    snapshot.mode !== job.mode ||
    snapshot.marketplaceId !== job.marketplaceId ||
    snapshot.startDate !== job.startDate ||
    snapshot.endDate !== job.endDate
  ) {
    return;
  }
  for (const [key, entry] of brandSalesSnapshotCache) {
    if (entry.expiresAt <= now) brandSalesSnapshotCache.delete(key);
  }
  const key = snapshotCacheKey(job);
  brandSalesSnapshotCache.delete(key);
  brandSalesSnapshotCache.set(key, {
    jobId: job.jobId,
    mode: job.mode,
    marketplaceId: job.marketplaceId,
    startDate: job.startDate,
    endDate: job.endDate,
    expiresAt,
    snapshot,
  });
  while (brandSalesSnapshotCache.size > BRAND_SALES_SNAPSHOT_CACHE_LIMIT) {
    const oldestKey = brandSalesSnapshotCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    brandSalesSnapshotCache.delete(oldestKey);
  }
}

async function json(response: Response): Promise<unknown> {
  const value = await response.json() as unknown;
  if (!response.ok) {
    const problem = value && typeof value === "object" && !Array.isArray(value)
      ? value as { code?: unknown; message?: unknown; requestId?: unknown }
      : null;
    const code = typeof problem?.code === "string" ? problem.code : null;
    const requestId = typeof problem?.requestId === "string" ? problem.requestId : null;
    const fallback = code === "REPORT_CANCELLED"
      ? "Amazon 已取消這次 FBA 出貨報表；沒有資料被修改。"
      : code === "REPORT_FATAL"
        ? "Amazon 無法完成這次 FBA 出貨報表；請稍後再試。"
        : "目前無法整理品牌營收。";
    throw new BrandSalesResponseError({
      code,
      requestId,
      message: typeof problem?.message === "string" && problem.message
        ? problem.message
        : fallback,
    });
  }
  return value;
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

export default function BrandSalesCard({
  marketplaceId,
  startDate,
  endDate,
}: {
  marketplaceId: string;
  startDate: string;
  endDate: string;
}) {
  const [snapshot, setSnapshot] = useState<BrandSalesSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<BrandSalesFailure | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const automaticSelectionRef = useRef<string | null>(null);
  const selection = useMemo(
    () => ({ marketplaceId, startDate, endDate }),
    [endDate, marketplaceId, startDate],
  );

  const sync = useCallback(async (explicitRetry = false): Promise<void> => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    setSnapshot((current) =>
      current?.marketplaceId === selection.marketplaceId &&
        current.startDate === selection.startDate &&
        current.endDate === selection.endDate
        ? current
        : null,
    );
    try {
      const started = parseJob(
        await json(await fetch("/api/sp-api/brand-sales", {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...selection,
            ...(explicitRetry ? { retry: true } : {}),
          }),
          signal: controller.signal,
        })),
        selection,
      );
      let job = started;
      if (job.ready && !explicitRetry) {
        const cached = readBrandSalesSnapshotCache(job);
        if (cached) {
          if (controllerRef.current === controller) setSnapshot(cached);
          return;
        }
      }
      for (let attempt = 0; !job.ready && attempt < 200; attempt += 1) {
        await delay(1_500, controller.signal);
        const params = new URLSearchParams({ marketplaceId, jobId: job.jobId });
        job = parseJob(
          await json(await fetch(`/api/sp-api/brand-sales?${params}`, {
            cache: "no-store",
            signal: controller.signal,
          })),
          selection,
        );
      }
      if (!job.ready) throw new Error("Amazon 準備品牌報表超過五分鐘；稍後可重新同步。");
      const params = new URLSearchParams({
        marketplaceId,
        jobId: job.jobId,
        data: "1",
      });
      const parsed = parseBrandSalesSnapshot(
        await json(await fetch(`/api/sp-api/brand-sales?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        })),
        selection,
      );
      if (controllerRef.current !== controller) return;
      storeBrandSalesSnapshotCache(job, parsed);
      setSnapshot(parsed);
    } catch (syncError) {
      if (syncError instanceof Error && syncError.name === "AbortError") return;
      if (controllerRef.current !== controller) return;
      setSnapshot(null);
      setError({
        code: syncError instanceof BrandSalesResponseError ? syncError.code : null,
        requestId: syncError instanceof BrandSalesResponseError ? syncError.requestId : null,
        message: syncError instanceof Error ? syncError.message : "目前無法整理品牌營收。",
      });
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setLoading(false);
      }
    }
  }, [marketplaceId, selection]);

  useEffect(() => {
    const selectionKey = `${marketplaceId}:${startDate}:${endDate}`;
    if (automaticSelectionRef.current === selectionKey) return;
    const timeout = window.setTimeout(() => {
      if (automaticSelectionRef.current === selectionKey) return;
      automaticSelectionRef.current = selectionKey;
      void sync(false);
    }, 0);
    return () => {
      window.clearTimeout(timeout);
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [endDate, marketplaceId, startDate, sync]);

  useEffect(() => {
    if (snapshot?.rangeFreshness !== "includes-current-day") return;
    const interval = window.setInterval(() => {
      void sync(false);
    }, 5 * 60 * 1_000);
    return () => window.clearInterval(interval);
  }, [snapshot?.dataThrough, snapshot?.rangeFreshness, sync]);

  return (
    <BrandSalesChart
      snapshot={snapshot}
      loading={loading}
      error={error}
      rangeLabel={`${startDate} – ${endDate}`}
      onRetry={() => void sync(true)}
    />
  );
}

export { parseJob as parseBrandSalesJob };
