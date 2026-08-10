export type DesktopUpdatePolicy = Readonly<{
  enabled: boolean;
  message: string | null;
}>;

export function desktopUpdatePolicy(input: {
  platform: NodeJS.Platform;
  packaged: boolean;
}): DesktopUpdatePolicy {
  if (!input.packaged) {
    return { enabled: false, message: "開發版不執行自動更新。" };
  }
  if (input.platform === "darwin") {
    return { enabled: true, message: null };
  }
  if (input.platform === "win32") {
    return {
      enabled: false,
      message:
        "Windows Notebook 鑰匙目前是內部未簽章版；App 內更新已停用。請只從 jspusa/AMZ.API 的 notebook-key-windows 固定下載頁重新下載並核對 SHA-256。",
    };
  }
  return {
    enabled: false,
    message: "這個平台目前不提供 App 內更新。",
  };
}
