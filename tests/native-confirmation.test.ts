import { describe, expect, it, vi } from "vitest";
import {
  NATIVE_CONFIRMATION_CANCELLED_MESSAGE,
  requestNativeConfirmation,
  type NativeConfirmationAdapter,
} from "../src/main/native-confirmation";

function adapter(
  overrides: Partial<NativeConfirmationAdapter> = {},
): NativeConfirmationAdapter {
  return {
    canPromptTouchID: () => true,
    promptTouchID: vi.fn(async () => undefined),
    showMessageFallback: vi.fn(async () => true),
    ...overrides,
  };
}

describe("native sensitive-action confirmation", () => {
  it("prompts Touch ID directly without first showing a message box", async () => {
    const promptTouchID = vi.fn(async () => undefined);
    const showMessageFallback = vi.fn(async () => true);

    await requestNativeConfirmation(
      "確認文案｜US AFA12AM｜五大賣點",
      adapter({ promptTouchID, showMessageFallback }),
    );

    expect(promptTouchID).toHaveBeenCalledOnce();
    expect(showMessageFallback).not.toHaveBeenCalled();
  });

  it("throws on Touch ID cancellation so the protected write never runs", async () => {
    const protectedWrite = vi.fn();
    const showMessageFallback = vi.fn(async () => true);
    const action = async () => {
      await requestNativeConfirmation(
        "確認文案｜US AFA12AM｜五大賣點",
        adapter({
          promptTouchID: vi.fn(async () => {
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
    const promptTouchID = vi.fn(async () => undefined);
    const showMessageFallback = vi.fn(async () => true);
    const reason = "確認文案｜US AFA12AM｜五大賣點";

    await requestNativeConfirmation(
      reason,
      adapter({
        canPromptTouchID: () => false,
        promptTouchID,
        showMessageFallback,
      }),
    );

    expect(promptTouchID).not.toHaveBeenCalled();
    expect(showMessageFallback).toHaveBeenCalledOnce();
    expect(showMessageFallback).toHaveBeenCalledWith(reason);
  });
});
