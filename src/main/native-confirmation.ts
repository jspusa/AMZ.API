export const NATIVE_CONFIRMATION_CANCELLED_MESSAGE =
  "操作已取消；Amazon 沒有收到任何變更。";

export type NativeConfirmationAdapter = {
  canPromptTouchID: () => boolean;
  promptTouchID: (reason: string) => Promise<void>;
  showMessageFallback: (reason: string) => Promise<boolean>;
};

export async function requestNativeConfirmation(
  reason: string,
  adapter: NativeConfirmationAdapter,
): Promise<void> {
  if (adapter.canPromptTouchID()) {
    try {
      await adapter.promptTouchID(reason.slice(0, 120));
      return;
    } catch {
      throw new Error(NATIVE_CONFIRMATION_CANCELLED_MESSAGE);
    }
  }

  if (!(await adapter.showMessageFallback(reason))) {
    throw new Error(NATIVE_CONFIRMATION_CANCELLED_MESSAGE);
  }
}
