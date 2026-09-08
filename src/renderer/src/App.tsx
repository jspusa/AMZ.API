import { useState } from "react";
import Dashboard, { DEFAULT_MARKETPLACE_ID } from "./components/dashboard";
import ConnectionPanel from "./connection-panel";

export default function App() {
  const [reloadKey, setReloadKey] = useState(0);
  const [connectionOpen, setConnectionOpen] = useState(false);

  return (
    <>
      <Dashboard
        key={reloadKey}
        initialSalesTrend={null}
        initialMarketplaceId={DEFAULT_MARKETPLACE_ID}
        loadOnMount
        onOpenConnection={() => setConnectionOpen(true)}
      />
      <ConnectionPanel
        open={connectionOpen}
        onOpenChange={setConnectionOpen}
        showTrigger={false}
        onConnectionChanged={() => setReloadKey((key) => key + 1)}
      />
    </>
  );
}
