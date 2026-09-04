import { describe, expect, it, vi } from "vitest";
import {
  focusTopmostModalDialog,
  restoreModalTriggerFocus,
} from "../src/renderer/src/components/modal-focus";

type FakeElement = {
  contains: (candidate: unknown) => boolean;
  focus: () => void;
  hasAttribute?: (name: string) => boolean;
  setAttribute?: (name: string, value: string) => void;
  querySelector?: (selector: string) => FakeElement | null;
};

function modalDocument({
  active,
  focusTarget = true,
}: {
  active: "background" | "dialog" | "target";
  focusTarget?: boolean;
}) {
  const background = {} as FakeElement;
  let activeElement: FakeElement = background;
  let target: FakeElement;
  const targetFocus = vi.fn(() => { activeElement = target; });
  target = {
    contains: (candidate: unknown) => candidate === target,
    focus: targetFocus,
  };
  const attributes = new Map<string, string>();
  let dialog: FakeElement;
  const dialogFocus = vi.fn(() => { activeElement = dialog; });
  dialog = {
    contains: (candidate: unknown) => candidate === dialog || candidate === target,
    focus: dialogFocus,
    hasAttribute: (name: string) => attributes.has(name),
    setAttribute: (name: string, value: string) => { attributes.set(name, value); },
    querySelector: vi.fn(() => focusTarget ? target : null),
  };
  if (active === "dialog") activeElement = dialog;
  if (active === "target") activeElement = target;

  const documentRoot = {
    get activeElement() { return activeElement; },
    querySelectorAll: vi.fn(() => ({
      length: 1,
      item: (index: number) => index === 0 ? dialog : null,
    })),
  };

  return { attributes, dialog, dialogFocus, documentRoot, target, targetFocus };
}

describe("modal initial focus", () => {
  it("moves focus from the newly inert background into the topmost dialog", () => {
    const fixture = modalDocument({ active: "background" });

    expect(focusTopmostModalDialog(fixture.documentRoot as unknown as Document)).toBe(true);
    expect(fixture.targetFocus).toHaveBeenCalledOnce();
    expect(fixture.documentRoot.activeElement).toBe(fixture.target);
  });

  it("preserves focus when a dialog child already received native autofocus", () => {
    const fixture = modalDocument({ active: "target" });

    expect(focusTopmostModalDialog(fixture.documentRoot as unknown as Document)).toBe(true);
    expect(fixture.targetFocus).not.toHaveBeenCalled();
  });

  it("makes the dialog itself programmatically focusable when it has no control", () => {
    const fixture = modalDocument({ active: "background", focusTarget: false });

    expect(focusTopmostModalDialog(fixture.documentRoot as unknown as Document)).toBe(true);
    expect(fixture.attributes.get("tabindex")).toBe("-1");
    expect(fixture.dialogFocus).toHaveBeenCalledOnce();
    expect(fixture.documentRoot.activeElement).toBe(fixture.dialog);
  });
});

describe("modal return focus", () => {
  it("returns activeElement to the persistent opener after the dialog closes", () => {
    let activeElement: unknown = {};
    const opener = {
      isConnected: true,
      hasAttribute: vi.fn(() => false),
      closest: vi.fn(() => null),
      focus: vi.fn(() => { activeElement = opener; }),
    };
    const documentRoot = {
      get activeElement() { return activeElement; },
    };

    expect(restoreModalTriggerFocus(
      documentRoot as unknown as Document,
      opener as unknown as HTMLElement,
    )).toBe(true);
    expect(opener.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(documentRoot.activeElement).toBe(opener);
  });

  it("does not focus a disconnected, disabled or still-inert opener", () => {
    const documentRoot = { activeElement: null };
    for (const target of [
      { isConnected: false, disabled: false, inert: false },
      { isConnected: true, disabled: true, inert: false },
      { isConnected: true, disabled: false, inert: true },
    ]) {
      const focus = vi.fn();
      const opener = {
        isConnected: target.isConnected,
        hasAttribute: (name: string) => name === "disabled" && target.disabled,
        closest: () => target.inert ? {} : null,
        focus,
      };
      expect(restoreModalTriggerFocus(
        documentRoot as unknown as Document,
        opener as unknown as HTMLElement,
      )).toBe(false);
      expect(focus).not.toHaveBeenCalled();
    }
  });
});
