import { useEffect, useState } from "react";
import {
  parseNotebookCapabilitySnapshot,
  safeNotebookVersion,
} from "../../shared/notebook-capabilities";

type NotebookAppCapabilitiesBridge = Readonly<{
  capabilities?: () => Promise<unknown>;
  version?: () => Promise<unknown>;
}>;

export type NotebookCapabilitiesState = Readonly<{
  ready: boolean;
  appVersion: string | null;
  businessPricingBatch: boolean;
  recentBusinessPricingWork: boolean;
  message: string | null;
}>;

const INITIAL_STATE: NotebookCapabilitiesState = {
  ready: false,
  appVersion: null,
  businessPricingBatch: false,
  recentBusinessPricingWork: false,
  message: "正在確認 Notebook Key 支援的功能…",
};

const UNAVAILABLE_STATE: NotebookCapabilitiesState = {
  ...INITIAL_STATE,
  ready: true,
  message: "無法確認這台 Notebook Key 支援新版 B2B 功能；請更新至 AMZ.API App 0.1.55 後重新開啟。",
};

export async function readNotebookCapabilities(
  bridge: NotebookAppCapabilitiesBridge | undefined,
): Promise<NotebookCapabilitiesState> {
  if (!bridge) return UNAVAILABLE_STATE;
  try {
    // An advertised protocol that fails must not silently fall back to version.
    if (bridge.capabilities !== undefined) {
      if (typeof bridge.capabilities !== "function") return UNAVAILABLE_STATE;
      const snapshot = parseNotebookCapabilitySnapshot(await bridge.capabilities());
      if (!snapshot) return UNAVAILABLE_STATE;
      const businessPricingBatch = snapshot.features.businessPricingBatch === 1;
      const recentBusinessPricingWork = snapshot.features.recentBusinessPricingWork === 1;
      return {
        ready: true,
        appVersion: snapshot.appVersion,
        businessPricingBatch,
        recentBusinessPricingWork,
        message: businessPricingBatch && recentBusinessPricingWork
          ? null
          : "這台 Notebook Key 尚未支援全部新版 B2B 功能；請更新至 AMZ.API App 0.1.55。既有單一 SKU 操作仍可使用。",
      };
    }
    const appVersion = typeof bridge.version === "function"
      ? safeNotebookVersion(await bridge.version())
      : null;
    // Only this previously released protocol is known to contain batch routes.
    // Future, prerelease or custom versions need an explicit capability reply.
    const businessPricingBatch = appVersion === "0.1.54";
    return {
      ready: true,
      appVersion,
      businessPricingBatch,
      recentBusinessPricingWork: false,
      message: businessPricingBatch
        ? "B2B 批次可使用；跨次開啟的近期工作清單需要更新至 AMZ.API App 0.1.55。"
        : appVersion === "0.1.53"
          ? "B2B 批次與近期工作清單需要更新至 AMZ.API App 0.1.55；既有單一 SKU 操作仍可使用。"
          : UNAVAILABLE_STATE.message,
    };
  } catch {
    return UNAVAILABLE_STATE;
  }
}

export function useNotebookCapabilities(): NotebookCapabilitiesState {
  const bridge = typeof window === "undefined" ? undefined : window.fbaOS?.app;
  const [observed, setObserved] = useState<Readonly<{
    bridge: NotebookAppCapabilitiesBridge | undefined;
    state: NotebookCapabilitiesState;
  }>>({ bridge: undefined, state: INITIAL_STATE });
  useEffect(() => {
    let active = true;
    setObserved({ bridge, state: INITIAL_STATE });
    void readNotebookCapabilities(bridge).then((next) => {
      if (active) setObserved({ bridge, state: next });
    });
    return () => { active = false; };
  }, [bridge]);
  return observed.bridge === bridge ? observed.state : INITIAL_STATE;
}
