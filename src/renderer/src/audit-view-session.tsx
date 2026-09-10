import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from "react";

/** Display state only. Owned by this Dashboard, never browser storage or a job cache. */
export class AuditViewMemory {
  private readonly values = new Map<string, unknown>();
  read<T>(key: string, fallback: T): T {
    return this.values.has(key) ? this.values.get(key) as T : fallback;
  }
  write<T>(key: string, value: T): void {
    this.values.delete(key);
    this.values.set(key, value);
    if (this.values.size > 512) this.values.delete(this.values.keys().next().value!);
  }
}
const MemoryContext = createContext<AuditViewMemory | null>(null);
export function useAuditViewMemory(): AuditViewMemory | null { return useContext(MemoryContext); }
export function AuditViewSessionProvider({ sessionKey, children }: { sessionKey: string; children: ReactNode }) {
  // A connection change remounts Dashboard; a marketplace/mode change discards this map.
  const memory = useMemo(() => new AuditViewMemory(), [sessionKey]);
  return <MemoryContext.Provider value={memory}>{children}</MemoryContext.Provider>;
}
export function auditViewScope(kind: string, marketplace: string, mode: string, source: string | null | undefined): string {
  return JSON.stringify([kind, marketplace, mode, source ?? "unavailable"]);
}
export function useAuditMemoryState<T>(scope: string, name: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const shared = useContext(MemoryContext);
  const local = useRef<AuditViewMemory | null>(null);
  if (!local.current) local.current = new AuditViewMemory();
  const memory = shared ?? local.current;
  const key = `${scope}:${name}`;
  const [, render] = useState(0);
  const value = memory.read(key, initial);
  const latest = useRef({ memory, key, value });
  latest.current = { memory, key, value };
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((action) => {
    const current = latest.current;
    const previous = current.memory.read(current.key, current.value);
    const next = typeof action === "function" ? (action as (old: T) => T)(previous) : action;
    current.memory.write(current.key, next);
    current.value = next;
    render(revision => revision + 1);
  }, []);
  return [value, setValue];
}

type Position = { windowY: number; panelY: number; details: boolean[]; horizontal: number[]; focusId: string | null };
/** Restore a result list, not an editor, after heading/top-scroll effects settle. */
export function useAuditPosition(scope: string, ready: boolean, existingRef?: RefObject<HTMLElement | null>): RefObject<HTMLElement | null> {
  const ownRef = useRef<HTMLElement | null>(null);
  const rootRef = existingRef ?? ownRef;
  const memory = useContext(MemoryContext);
  useEffect(() => {
    const root = rootRef.current;
    if (!ready || !memory || !root || typeof root.querySelectorAll !== "function" || typeof window === "undefined") return;
    const key = `${scope}:position`;
    const saved = memory.read<Position | null>(key, null);
    const panel = root.closest<HTMLElement>('.order-drawer');
    const scrollables = () => Array.from(root.querySelectorAll<HTMLElement>('[class*="scroll"], [class*="table-wrap"]'));
    let alive = true, restoring = true;
    let frame: number | null = null;
    const capture = () => {
      if (!alive || restoring || !root.isConnected) return;
      const active = document.activeElement;
      memory.write<Position>(key, {
        windowY: window.scrollY, panelY: panel?.scrollTop ?? 0,
        details: Array.from(root.querySelectorAll('details')).map(element => element.open),
        horizontal: scrollables().map(element => element.scrollLeft),
        focusId: active instanceof HTMLElement && root.contains(active) && active.id ? active.id : null,
      });
    };
    // The parent may schedule its initial top scroll in a timeout and two frames.
    const timeout = window.setTimeout(() => {
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => {
          frame = window.requestAnimationFrame(() => {
            if (!alive) return;
            if (saved) {
              root.querySelectorAll('details').forEach((element, index) => {
                if (saved.details[index] !== undefined) element.open = saved.details[index]!;
              });
              scrollables().forEach((element, index) => { element.scrollLeft = saved.horizontal[index] ?? 0; });
              if (saved.focusId) {
                const target = document.getElementById(saved.focusId);
                if (target && root.contains(target)) target.focus({ preventScroll: true });
              }
              if (panel) panel.scrollTop = saved.panelY;
              else {
                const html = document.documentElement;
                const behavior = html.style.scrollBehavior;
                html.style.scrollBehavior = 'auto';
                window.scrollTo(0, saved.windowY);
                html.style.scrollBehavior = behavior;
              }
            }
            restoring = false;
          });
        });
      });
    }, 0);
    window.addEventListener('scroll', capture, true);
    root.addEventListener('toggle', capture, true);
    root.addEventListener('focusin', capture);
    root.addEventListener('pointerdown', capture, true);
    return () => {
      capture(); alive = false;
      window.clearTimeout(timeout);
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', capture, true);
      root.removeEventListener('toggle', capture, true);
      root.removeEventListener('focusin', capture);
      root.removeEventListener('pointerdown', capture, true);
    };
  }, [scope, ready, rootRef, memory]);
  return rootRef;
}
