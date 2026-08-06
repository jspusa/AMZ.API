type ContentConfirmationControlsProps = {
  sellerSku: string;
  mode: "live" | "demo";
  confirmationSku: string;
  actionLoading: boolean;
  error: string | null;
  onConfirmationSkuChange: (value: string) => void;
  onCommit: () => void;
};

export function ContentConfirmationControls({
  sellerSku,
  mode,
  confirmationSku,
  actionLoading,
  error,
  onConfirmationSkuChange,
  onCommit,
}: ContentConfirmationControlsProps) {
  const confirmationState = !confirmationSku
    ? "empty"
    : confirmationSku === sellerSku
      ? "ready"
      : "mismatch";
  const guidance =
    confirmationState === "empty"
      ? `欄位目前是空白。請手動輸入完整 SKU ${sellerSku}，按鈕才會啟用。`
      : confirmationState === "mismatch"
        ? "SKU 尚未完全一致；請確認大小寫與每一個字元。"
        : "SKU 完全一致，可以進行最後確認。";
  const buttonLabel = actionLoading
    ? "送交 Amazon 中…"
    : confirmationState === "empty"
      ? "請先輸入完整 SKU"
      : confirmationState === "mismatch"
        ? "SKU 尚未完全一致"
        : mode === "demo"
          ? `模擬更新 ${sellerSku}`
          : `確認更新 ${sellerSku}`;

  return (
    <>
      <label className="confirmation-input" htmlFor="content-confirmation-sku">
        <span>重新輸入完整 SKU 以確認</span>
        <input
          id="content-confirmation-sku"
          value={confirmationSku}
          onChange={(event) => onConfirmationSkuChange(event.target.value)}
          placeholder="請手動輸入完整 SKU"
          aria-describedby="content-confirmation-guidance"
          aria-invalid={confirmationState === "mismatch"}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
        <small
          id="content-confirmation-guidance"
          className={`confirmation-guidance is-${confirmationState}`}
          aria-live="polite"
        >
          {guidance}
        </small>
      </label>
      {error && <div className="price-error" role="alert">{error}</div>}
      <button
        className="price-primary-button danger-button confirmation-submit"
        type="button"
        onClick={onCommit}
        disabled={actionLoading || confirmationState !== "ready"}
        data-loading={actionLoading ? "true" : "false"}
      >
        {buttonLabel}
      </button>
    </>
  );
}
