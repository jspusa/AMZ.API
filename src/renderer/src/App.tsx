import { useCallback, useEffect, useState } from "react";
import Dashboard, { type DashboardSnapshot } from "./components/dashboard";
import ConnectionPanel from "./connection-panel";

const DEFAULT_MARKETPLACE = "ATVPDKIKX0DER";

function fallbackSnapshot(): DashboardSnapshot {
  return {
    mode: "demo",
    orders: [],
    marketplaceId: DEFAULT_MARKETPLACE,
    marketplace: {
      label: "美國",
      shortLabel: "US",
      name: "Amazon.com",
      currency: "USD",
      region: "na",
    },
    fetchedAt: new Date().toISOString(),
    nextToken: null,
    lastUpdatedBefore: null,
    requestId: null,
    rateLimit: null,
    notice: "開啟右上角「Mac 安全連線」輸入 SP-API 憑證，即可切換真實資料。",
  };
}

export default function App() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ marketplaceId: DEFAULT_MARKETPLACE, days: "14" });
      const response = await fetch(`/api/sp-api/orders?${params}`, { cache: "no-store" });
      const payload = (await response.json()) as DashboardSnapshot | { message?: string };
      if (!response.ok) throw new Error((payload as { message?: string }).message || "目前無法讀取 Amazon 訂單。");
      setSnapshot(payload as DashboardSnapshot);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "目前無法讀取 Amazon 訂單。");
      setSnapshot(fallbackSnapshot());
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  if (!snapshot) {
    return (
      <main className="desktop-boot" aria-live="polite">
        <span>A</span>
        <strong>Amazon FBA OS</strong>
        <small>正在啟動 Mac 安全橋接…</small>
      </main>
    );
  }

  return (
    <>
      <Dashboard
        key={`${snapshot.mode}-${snapshot.fetchedAt}-${reloadKey}`}
        initialSnapshot={snapshot}
        viewerName="Jayden"
        initialError={error}
      />
      <ConnectionPanel onConnectionChanged={() => setReloadKey((key) => key + 1)} />
    </>
  );
}
