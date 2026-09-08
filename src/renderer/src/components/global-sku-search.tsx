import { useEffect, useId, useRef } from "react";
import WorkspaceGlyph from "./workspace-glyph";

export function isSkuSearchShortcut(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "isComposing">, editing: boolean): boolean {
  if (event.isComposing || event.altKey) return false;
  return ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") ||
    (!editing && !event.metaKey && !event.ctrlKey && event.key === "/");
}

/** Focus only: shortcuts never query Amazon, change context or discard an editor. */
export default function GlobalSkuSearch({ value, onChange, onSubmit, disabled }: {
  value: string; onChange(value: string): void; onSubmit(): void; disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (disabled || event.defaultPrevented || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const target = event.target;
      const editing = target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
      if (!isSkuSearchShortcut(event, editing)) return;
      event.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [disabled]);

  return (
    <div className="global-sku global-sku-search">
      <span aria-hidden="true"><WorkspaceGlyph name="search" /></span>
      <input ref={input} id={id} value={value} disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") { event.preventDefault(); onSubmit(); }
          if (event.key === "Escape" && value) { event.preventDefault(); event.stopPropagation(); onChange(""); }
        }}
        placeholder="搜尋 Seller SKU，按 Enter 開啟" aria-label="全域 Seller SKU"
        aria-keyshortcuts="Control+k Meta+k /" autoComplete="off" spellCheck={false} />
      {value ? <button type="button" className="sku-search-clear" disabled={disabled}
        aria-label="清除 SKU 搜尋" title="清除搜尋（Esc）"
        onClick={() => { onChange(""); input.current?.focus(); }}>×</button>
        : <kbd className="sku-search-hint" title="⌘K / Ctrl+K 或 / 聚焦搜尋" aria-hidden="true">⌘ / Ctrl K</kbd>}
    </div>
  );
}
