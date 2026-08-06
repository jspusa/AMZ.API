import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ContentConfirmationControls } from "../src/renderer/src/components/content-confirmation-controls";

const SELLER_SKU = "AFA12AM";

function renderConfirmation(confirmationSku: string, actionLoading = false) {
  return renderToStaticMarkup(
    <ContentConfirmationControls
      sellerSku={SELLER_SKU}
      mode="live"
      confirmationSku={confirmationSku}
      actionLoading={actionLoading}
      error={null}
      onConfirmationSkuChange={vi.fn()}
      onCommit={vi.fn()}
    />,
  );
}

function confirmationElements(input: {
  confirmationSku: string;
  actionLoading?: boolean;
  onConfirmationSkuChange?: (value: string) => void;
  onCommit?: () => void;
}) {
  const tree = ContentConfirmationControls({
    sellerSku: SELLER_SKU,
    mode: "live",
    confirmationSku: input.confirmationSku,
    actionLoading: input.actionLoading ?? false,
    error: null,
    onConfirmationSkuChange: input.onConfirmationSkuChange ?? vi.fn(),
    onCommit: input.onCommit ?? vi.fn(),
  }) as ReactElement<{ children: ReactNode }>;
  const rootChildren = Children.toArray(tree.props.children);
  const label = rootChildren.find(
    (child): child is ReactElement<{ children: ReactNode }> =>
      isValidElement(child) && child.type === "label",
  );
  const button = rootChildren.find(
    (child): child is ReactElement<Record<string, unknown>> =>
      isValidElement(child) && child.type === "button",
  );
  if (!label || !button) throw new Error("confirmation controls are incomplete");
  const field = Children.toArray(label.props.children).find(
    (child): child is ReactElement<Record<string, unknown>> =>
      isValidElement(child) && child.type === "input",
  );
  if (!field) throw new Error("confirmation field is missing");
  return { field, button };
}

describe("listing content final confirmation", () => {
  it("does not make an empty confirmation field look prefilled", () => {
    const markup = renderConfirmation("");

    expect(markup).toContain('placeholder="請手動輸入完整 SKU"');
    expect(markup).not.toContain(`placeholder="${SELLER_SKU}"`);
    expect(markup).toContain("欄位目前是空白");
    expect(markup).toContain("請先輸入完整 SKU");
    expect(markup).toContain("disabled");
    expect(markup).toContain('aria-live="polite"');
    expect(markup).not.toContain("autofocus");
  });

  it("keeps the final action disabled until the SKU matches exactly", () => {
    const mismatch = renderConfirmation("afa12am");
    const ready = renderConfirmation(SELLER_SKU);

    expect(mismatch).toContain("SKU 尚未完全一致");
    expect(mismatch).toContain("disabled");
    expect(ready).toContain("SKU 完全一致，可以進行最後確認");
    expect(ready).toContain(`確認更新 ${SELLER_SKU}`);
    expect(ready).not.toContain("disabled");
  });

  it("shows an explicit sending state", () => {
    const markup = renderConfirmation(SELLER_SKU, true);

    expect(markup).toContain("送交 Amazon 中…");
    expect(markup).toContain('data-loading="true"');
    expect(markup).toContain("disabled");
  });

  it("wires input and commit callbacks while blocking loading submissions", () => {
    const onConfirmationSkuChange = vi.fn();
    const onCommit = vi.fn();
    const empty = confirmationElements({
      confirmationSku: "",
      onConfirmationSkuChange,
      onCommit,
    });

    expect(empty.button.props.disabled).toBe(true);
    (empty.field.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: SELLER_SKU },
    });
    expect(onConfirmationSkuChange).toHaveBeenCalledOnce();
    expect(onConfirmationSkuChange).toHaveBeenCalledWith(SELLER_SKU);

    const ready = confirmationElements({ confirmationSku: SELLER_SKU, onCommit });
    expect(ready.button.props.disabled).toBe(false);
    (ready.button.props.onClick as () => void)();
    expect(onCommit).toHaveBeenCalledOnce();

    const loading = confirmationElements({
      confirmationSku: SELLER_SKU,
      actionLoading: true,
      onCommit,
    });
    expect(loading.button.props.disabled).toBe(true);
  });
});
