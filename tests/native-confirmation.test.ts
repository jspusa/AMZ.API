import { describe, expect, it, vi } from "vitest";
import {
  NATIVE_CONFIRMATION_BUSY_MESSAGE,
  NATIVE_CONFIRMATION_CANCELLED_MESSAGE,
  NativeConfirmationGate,
  WINDOWS_HELLO_REQUIRED_MESSAGE,
  requestNativeConfirmation,
  type NativeConfirmationAdapter,
} from "../src/main/native-confirmation";

function adapter(
  overrides: Partial<NativeConfirmationAdapter> = {},
): NativeConfirmationAdapter {
  return {
    biometricMethod: () => "touch-id",
    promptBiometric: vi.fn(async () => "verified" as const),
    showMessageFallback: vi.fn(async () => true),
    ...overrides,
  };
}

describe("native sensitive-action confirmation", () => {
  it("allows only one system confirmation at a time and releases the gate", async () => {
    const gate = new NativeConfirmationGate();
    let releaseFirst!: () => void;
    const first = gate.run(
      () => new Promise<void>((resolve) => {
        releaseFirst = resolve;
      }),
    );

    await expect(gate.run(async () => undefined)).rejects.toThrow(
      NATIVE_CONFIRMATION_BUSY_MESSAGE,
    );
    releaseFirst();
    await first;
    await expect(gate.run(async () => "released")).resolves.toBe("released");
  });

  it("prompts Touch ID directly without first showing a message box", async () => {
    const promptBiometric = vi.fn(async () => "verified" as const);
    const showMessageFallback = vi.fn(async () => true);

    await requestNativeConfirmation(
      "確認文案｜US AFA12AM｜五大賣點",
      adapter({ promptBiometric, showMessageFallback }),
    );

    expect(promptBiometric).toHaveBeenCalledWith(
      "touch-id",
      "確認文案｜US AFA12AM｜五大賣點",
    );
    expect(showMessageFallback).not.toHaveBeenCalled();
  });

  it("throws on Touch ID cancellation so the protected write never runs", async () => {
    const protectedWrite = vi.fn();
    const showMessageFallback = vi.fn(async () => true);
    const action = async () => {
      await requestNativeConfirmation(
        "確認文案｜US AFA12AM｜五大賣點",
        adapter({
          promptBiometric: vi.fn(async () => {
            throw new Error("userCancel");
          }),
          showMessageFallback,
        }),
      );
      protectedWrite();
    };

    await expect(action()).rejects.toThrow(NATIVE_CONFIRMATION_CANCELLED_MESSAGE);
    expect(protectedWrite).not.toHaveBeenCalled();
    expect(showMessageFallback).not.toHaveBeenCalled();
  });

  it("uses the native message fallback only when Touch ID is unavailable", async () => {
    const promptBiometric = vi.fn(async () => "verified" as const);
    const showMessageFallback = vi.fn(async () => true);
    const reason = "確認文案｜US AFA12AM｜五大賣點";

    await requestNativeConfirmation(
      reason,
      adapter({
        biometricMethod: () => null,
        promptBiometric,
        showMessageFallback,
      }),
    );

    expect(promptBiometric).not.toHaveBeenCalled();
    expect(showMessageFallback).toHaveBeenCalledOnce();
    expect(showMessageFallback).toHaveBeenCalledWith(reason);
  });

  it("blocks protected writes when Windows Hello is not configured", async () => {
    const showMessageFallback = vi.fn(async () => true);
    await expect(
      requestNativeConfirmation(
        "確認更新價格",
        adapter({
          biometricMethod: () => "windows-hello",
          promptBiometric: vi.fn(async () => "unavailable" as const),
          showMessageFallback,
        }),
      ),
    ).rejects.toThrow(WINDOWS_HELLO_REQUIRED_MESSAGE);
    expect(showMessageFallback).not.toHaveBeenCalled();
  });
});
