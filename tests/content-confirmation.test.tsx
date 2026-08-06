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

function renderConfirmation(actionLoading = false, error: string | null = null) {
  return renderToStaticMarkup(
    <ContentConfirmationControls
      sellerSku={SELLER_SKU}
      actionLoading={actionLoading}
      error={error}
      onCommit={vi.fn()}
    />,
  );
}

function confirmationElements(input: {
  actionLoading?: boolean;
  onCommit?: () => void;
}) {
  const tree = ContentConfirmationControls({
    sellerSku: SELLER_SKU,
    actionLoading: input.actionLoading ?? false,
    error: null,
    onCommit: input.onCommit ?? vi.fn(),
  }) as ReactElement<{ children: ReactNode }>;
  const rootChildren = Children.toArray(tree.props.children);
  const button = rootChildren.find(
    (child): child is ReactElement<Record<string, unknown>> =>
      isValidElement(child) && child.type === "button",
  );
  if (!button) throw new Error("confirmation controls are incomplete");
  return { rootChildren, button };
}

describe("listing content final confirmation", () => {
  it("shows one Touch ID action without asking the user to retype the SKU", () => {
    const markup = renderConfirmation();

    expect(markup).toContain(`使用 Touch ID 確認更新 ${SELLER_SKU}`);
    expect(markup).not.toContain("重新輸入完整 SKU");
    expect(markup).not.toContain("<input");
    expect(markup).not.toContain("disabled");
  });

  it("shows an explicit sending state", () => {
    const markup = renderConfirmation(true);

    expect(markup).toContain("送交 Amazon 中…");
    expect(markup).toContain('data-loading="true"');
    expect(markup).toContain("disabled");
  });

  it("wires the commit callback while blocking loading submissions", () => {
    const onCommit = vi.fn();
    const ready = confirmationElements({ onCommit });
    expect(ready.button.props.disabled).toBe(false);
    (ready.button.props.onClick as () => void)();
    expect(onCommit).toHaveBeenCalledOnce();

    const loading = confirmationElements({
      actionLoading: true,
      onCommit,
    });
    expect(loading.button.props.disabled).toBe(true);
  });

  it("keeps a failed native approval message visible", () => {
    const markup = renderConfirmation(false, "操作已取消；Amazon 沒有收到任何變更。");

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("操作已取消；Amazon 沒有收到任何變更。");
  });
});
