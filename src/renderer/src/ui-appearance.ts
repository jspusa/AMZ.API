import { nativeDisplayPreferences } from "./display-preferences-client";
/** Display preferences only. Never store account or operational data here. */
export const UI_ACCENT_STORAGE_KEY = "amz-api:ui-accent";
export const UI_MODE_STORAGE_KEY = "amz-api:ui-mode";
export type UiAccent = "default" | "pink";
export type UiMode = "light" | "dark";
export type UiAppearance = Readonly<{ accent: UiAccent; mode: UiMode }>;
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
type PreferenceRoot = Pick<HTMLElement, "setAttribute">;

export const UI_ACCENT_OPTIONS = [
  { value: "default", label: "原色", description: "經典金色與深藍" },
  { value: "pink", label: "粉紅色", description: "櫻花粉與奶油白" },
] as const;

function browserStorage(): PreferenceStorage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; }
  catch { return null; }
}

export function normalizeUiAppearance(value: { accent?: unknown; mode?: unknown }): UiAppearance {
  return {
    accent: value.accent === "pink" ? "pink" : "default",
    mode: value.mode === "dark" ? "dark" : "light",
  };
}

export function readUiAppearance(storage?: PreferenceStorage | null): UiAppearance {
  const native = storage === undefined ? nativeDisplayPreferences() : null;
  if (native) return { accent: native.accent, mode: native.mode };
  if (storage === undefined) storage = browserStorage();
  try {
    return normalizeUiAppearance({
      accent: storage?.getItem(UI_ACCENT_STORAGE_KEY),
      mode: storage?.getItem(UI_MODE_STORAGE_KEY),
    });
  } catch { return { accent: "default", mode: "light" }; }
}

export function applyUiAppearance(
  value: UiAppearance,
  root: PreferenceRoot | null = typeof document === "undefined" ? null : document.documentElement,
): void {
  const safe = normalizeUiAppearance(value);
  root?.setAttribute("data-ui-accent", safe.accent);
  root?.setAttribute("data-ui-mode", safe.mode);
}

/** Applies immediately even when storage is blocked; reports persistence honestly. */
export function saveUiAppearance(
  value: UiAppearance,
  storage: PreferenceStorage | null = browserStorage(),
): boolean {
  const safe = normalizeUiAppearance(value);
  applyUiAppearance(safe);
  try {
    if (!storage) return false;
    storage.setItem(UI_ACCENT_STORAGE_KEY, safe.accent);
    storage.setItem(UI_MODE_STORAGE_KEY, safe.mode);
    return true;
  } catch { return false; }
}
