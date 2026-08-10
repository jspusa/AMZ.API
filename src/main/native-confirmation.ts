export const NATIVE_CONFIRMATION_CANCELLED_MESSAGE =
  "本機身分驗證已取消或未通過；Amazon 沒有收到任何變更。";
export const WINDOWS_HELLO_REQUIRED_MESSAGE =
  "這台 Windows 電腦尚未設定可用的 Windows Hello。請先在「設定 → 帳戶 → 登入選項」設定指紋、臉部或 PIN；Amazon 沒有收到任何變更。";
export const NATIVE_CONFIRMATION_BUSY_MESSAGE =
  "另一個本機身分驗證正在進行；Amazon 尚未收到這次操作。";

export type NativeBiometricMethod = "touch-id" | "windows-hello" | null;

export type NativeConfirmationAdapter = {
  biometricMethod: () => NativeBiometricMethod;
  promptBiometric: (
    method: Exclude<NativeBiometricMethod, null>,
    reason: string,
  ) => Promise<"verified" | "unavailable">;
  showMessageFallback: (reason: string) => Promise<boolean>;
};

export class NativeConfirmationGate {
  #inFlight = false;

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#inFlight) throw new Error(NATIVE_CONFIRMATION_BUSY_MESSAGE);
    this.#inFlight = true;
    try {
      return await operation();
    } finally {
      this.#inFlight = false;
    }
  }
}

export async function requestNativeConfirmation(
  reason: string,
  adapter: NativeConfirmationAdapter,
): Promise<void> {
  const method = adapter.biometricMethod();
  if (method) {
    let result: "verified" | "unavailable";
    try {
      result = await adapter.promptBiometric(method, reason.slice(0, 120));
    } catch {
      throw new Error(NATIVE_CONFIRMATION_CANCELLED_MESSAGE);
    }
    if (result === "verified") return;
    if (method === "windows-hello") {
      throw new Error(WINDOWS_HELLO_REQUIRED_MESSAGE);
    }
  }

  if (!(await adapter.showMessageFallback(reason))) {
    throw new Error(NATIVE_CONFIRMATION_CANCELLED_MESSAGE);
  }
}
