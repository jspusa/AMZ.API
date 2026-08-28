export type DesktopUpdatePolicy = Readonly<{
  enabled: boolean;
  message: string | null;
}>;

export type DesktopUpdateChannel = "disabled" | "publisher-signed-v1";

export function desktopUpdateChannelFromPackageMetadata(
  metadata: unknown,
): DesktopUpdateChannel {
  if (
    metadata &&
    typeof metadata === "object" &&
    "amzApiUpdateChannel" in metadata &&
    metadata.amzApiUpdateChannel === "publisher-signed-v1"
  ) {
    return "publisher-signed-v1";
  }
  return "disabled";
}

export function desktopUpdatePolicy(input: {
  platform: NodeJS.Platform;
  packaged: boolean;
  updateChannel: DesktopUpdateChannel;
}): DesktopUpdatePolicy {
  if (!input.packaged) {
    return { enabled: false, message: "開發版不執行自動更新。" };
  }
  if (
    (input.platform === "darwin" || input.platform === "win32") &&
    input.updateChannel === "publisher-signed-v1"
  ) {
    return { enabled: true, message: null };
  }
  if (input.platform === "win32") {
    return {
      enabled: false,
      message:
        "Windows Notebook 鑰匙目前是內部未簽章版；App 內更新已停用。請只從 jspusa/AMZ.API 的 notebook-key-windows 固定下載頁重新下載並核對 SHA-256。",
    };
  }
  if (input.platform === "darwin") {
    return {
      enabled: false,
      message: "這份 Mac Notebook 鑰匙不是正式簽章更新版；請先完成最後一次安全安裝。",
    };
  }
  return {
    enabled: false,
    message: "這個平台目前不提供 App 內更新。",
  };
}
