import { useCallback, useEffect, useRef, useState } from "react";
import Dashboard, {
  DEFAULT_MARKETPLACE_ID,
  isSalesTrendSnapshotForSelection,
  salesTrendQuery,
} from "./components/dashboard";
import type {
  SalesTrendSnapshot,
  TrendRangeSelection,
} from "./components/sales-trend-chart";
import ConnectionPanel from "./connection-panel";

const INITIAL_RANGE: TrendRangeSelection = { kind: "preset", days: 7 };

export default function App() {
  const [initialSalesTrend, setInitialSalesTrend] =
    useState<SalesTrendSnapshot | null>(null);
  const [initialError, setInitialError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const requestedReloadKey = useRef<number | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setInitialError(null);
    try {
      const query = salesTrendQuery(DEFAULT_MARKETPLACE_ID, INITIAL_RANGE);
      const response = await fetch(`/api/sp-api/sales-trend?${query}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok) {
        const problem = payload as { message?: string; requestId?: string | null };
        throw new Error(
          `${problem.message || "目前無法讀取 FBA 銷售趨勢。"}${
            problem.requestId ? `（Request ID: ${problem.requestId}）` : ""
          }`,
        );
      }
      if (
        !isSalesTrendSnapshotForSelection(
          payload,
          DEFAULT_MARKETPLACE_ID,
          INITIAL_RANGE,
        )
      ) {
        throw new Error(
          "這台 Mac App Bridge 尚未支援新版銷售趨勢，請安裝新版後再同步。",
        );
      }
      if (abortRef.current === controller) setInitialSalesTrend(payload);
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") return;
      if (abortRef.current !== controller) return;
      setInitialSalesTrend(null);
      setInitialError(
        requestError instanceof Error
          ? requestError.message
          : "目前無法讀取 FBA 銷售趨勢。",
      );
    } finally {
      if (abortRef.current === controller) setReady(true);
    }
  }, []);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (requestedReloadKey.current === reloadKey) return;
      requestedReloadKey.current = reloadKey;
      void load();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [load, reloadKey]);

  if (!ready) {
    return (
      <main className="desktop-boot" aria-live="polite">
        <span>A</span>
        <strong>AMZ.API</strong>
        <small>正在啟動 Mac 安全橋接…</small>
      </main>
    );
  }

  return (
    <>
      <Dashboard
        key={`${initialSalesTrend?.mode ?? "unavailable"}-${
          initialSalesTrend?.fetchedAt ?? "not-synced"
        }-${reloadKey}`}
        initialSalesTrend={initialSalesTrend}
        initialMarketplaceId={DEFAULT_MARKETPLACE_ID}
        viewerName="Jayden"
        initialError={initialError}
      />
      <ConnectionPanel onConnectionChanged={() => setReloadKey((key) => key + 1)} />
    </>
  );
}
