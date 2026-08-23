import type { DesktopBridge } from "../../shared/contracts";

type AppBridge = DesktopBridge["app"];

/**
 * The fixed-SKU bridge was introduced in the same desktop release as the
 * fixed A+ destination. It is optional in the shared contract so a Pages-first
 * renderer can feature-detect an older Notebook Key without sending that old
 * main process an action enum it does not understand.
 */
export function supportsFixedSellerCentralHandoffs(
  appBridge: AppBridge | null | undefined,
): appBridge is AppBridge &
  Required<Pick<AppBridge, "openSellerCentralInventory">> {
  return typeof appBridge?.openSellerCentralInventory === "function";
}

export async function openAplusManagerHandoff(
  appBridge: AppBridge,
): Promise<"opened" | "upgrade-required"> {
  if (!supportsFixedSellerCentralHandoffs(appBridge)) {
    return "upgrade-required";
  }
  await appBridge.openExternal("a-plus-content");
  return "opened";
}

export async function openSellerCentralInventoryHandoff(
  appBridge: AppBridge,
  sellerSku: string,
): Promise<"opened" | "upgrade-required"> {
  if (!supportsFixedSellerCentralHandoffs(appBridge)) {
    return "upgrade-required";
  }
  await appBridge.openSellerCentralInventory(sellerSku);
  return "opened";
}
