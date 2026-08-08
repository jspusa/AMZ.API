"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parseBrandSalesSnapshot, type BrandSalesSnapshot } from "../brand-sales";
import BrandSalesChart from "./brand-sales-chart";

type BrandSalesJob = {
  jobId: string;
  mode: "live" | "demo";
  marketplaceId: string;
  startDate: string;
  endDate: string;
  ready: boolean;
  status: "IN_QUEUE" | "IN_PROGRESS" | "DONE";
  message: string;
};

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
    typeof job.ready !== "boolean" ||
    (job.status !== "IN_QUEUE" && job.status !== "IN_PROGRESS" && job.status !== "DONE") ||
    job.ready !== (job.status === "DONE") ||
    typeof job.message !== "string"
  ) {
    throw new Error("品牌營收工作狀態無法辨識。");
  }
  return job as unknown as BrandSalesJob;
}

async function json(response: Response): Promise<unknown> {
  const value = await response.json() as unknown;
  if (!response.ok) {
    const problem = value && typeof value === "object" && !Array.isArray(value)
      ? value as { message?: unknown }
      : null;
    throw new Error(
      typeof problem?.message === "string"
        ? problem.message
        : "目前無法整理品牌營收。",
    );
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
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const selection = useMemo(
    () => ({ marketplaceId, startDate, endDate }),
    [endDate, marketplaceId, startDate],
  );

  useEffect(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setSnapshot(null);
    setLoading(false);
    setError(null);
    return () => controllerRef.current?.abort();
  }, [marketplaceId, startDate, endDate]);

  async function sync(): Promise<void> {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    setSnapshot(null);
    try {
      const started = parseJob(
        await json(await fetch("/api/sp-api/brand-sales", {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(selection),
          signal: controller.signal,
        })),
        selection,
      );
      let job = started;
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
      setSnapshot(parsed);
    } catch (syncError) {
      if (syncError instanceof Error && syncError.name === "AbortError") return;
      if (controllerRef.current !== controller) return;
      setError(syncError instanceof Error ? syncError.message : "目前無法整理品牌營收。");
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setLoading(false);
      }
    }
  }

  return (
    <BrandSalesChart
      snapshot={snapshot}
      loading={loading}
      error={error}
      rangeLabel={`${startDate} – ${endDate}`}
      onSync={() => void sync()}
    />
  );
}

export { parseJob as parseBrandSalesJob };
