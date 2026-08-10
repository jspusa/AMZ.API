type ContentConfirmationControlsProps = {
  sellerSku: string;
  actionLoading: boolean;
  error: string | null;
  onCommit: () => void;
};

export function ContentConfirmationControls({
  sellerSku,
  actionLoading,
  error,
  onCommit,
}: ContentConfirmationControlsProps) {
  const buttonLabel = actionLoading
    ? "送交 Amazon 中…"
    : `使用 Notebook 鑰匙確認更新 ${sellerSku}`;

  return (
    <>
      {error && <div className="price-error" role="alert">{error}</div>}
      <button
        className="price-primary-button danger-button confirmation-submit"
        type="button"
        onClick={onCommit}
        disabled={actionLoading}
        data-loading={actionLoading ? "true" : "false"}
      >
        {buttonLabel}
      </button>
    </>
  );
}
