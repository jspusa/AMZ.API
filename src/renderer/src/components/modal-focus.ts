const MODAL_SELECTOR = '[role="dialog"][aria-modal="true"]';
const INITIAL_FOCUS_SELECTOR = [
  "[autofocus]",
  ".drawer-header button:not([disabled])",
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

type ModalFocusDocument = Pick<Document, "activeElement"> & {
  querySelectorAll<E extends Element = Element>(selectors: string): NodeListOf<E>;
};

export function focusTopmostModalDialog(
  documentRoot: ModalFocusDocument,
): boolean {
  const dialogs = documentRoot.querySelectorAll<HTMLElement>(MODAL_SELECTOR);
  const dialog = dialogs.item(dialogs.length - 1);
  if (!dialog) return false;

  const activeElement = documentRoot.activeElement;
  if (activeElement && dialog.contains(activeElement)) return true;

  const initialTarget = dialog.querySelector<HTMLElement>(INITIAL_FOCUS_SELECTOR);
  if (initialTarget) {
    initialTarget.focus();
  } else {
    if (!dialog.hasAttribute("tabindex")) dialog.setAttribute("tabindex", "-1");
    dialog.focus();
  }

  return documentRoot.activeElement === dialog
    || Boolean(documentRoot.activeElement && dialog.contains(documentRoot.activeElement));
}

export function restoreModalTriggerFocus(
  documentRoot: Pick<Document, "activeElement">,
  target: HTMLElement | null,
): boolean {
  if (
    !target
    || !target.isConnected
    || target.hasAttribute("disabled")
    || target.closest("[inert]")
  ) {
    return false;
  }

  target.focus({ preventScroll: true });
  return documentRoot.activeElement === target;
}
