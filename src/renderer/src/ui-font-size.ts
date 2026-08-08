export const UI_FONT_SIZE_STORAGE_KEY = "amz-api:ui-font-size";

export type UiFontSize = "small" | "standard" | "large";

type UiPreferenceStorage = Pick<Storage, "getItem" | "setItem">;
type UiPreferenceRoot = Pick<HTMLElement, "setAttribute">;

export const UI_FONT_SIZE_OPTIONS: ReadonlyArray<{
  value: UiFontSize;
  label: string;
}> = [
  { value: "small", label: "小" },
  { value: "standard", label: "標準" },
  { value: "large", label: "大" },
];

export function isUiFontSize(value: unknown): value is UiFontSize {
  return value === "small" || value === "standard" || value === "large";
}

function browserStorage(): UiPreferenceStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function documentRoot(): UiPreferenceRoot | null {
  return typeof document === "undefined" ? null : document.documentElement;
}

export function readUiFontSize(
  storage: UiPreferenceStorage | null = browserStorage(),
): UiFontSize {
  try {
    const value = storage?.getItem(UI_FONT_SIZE_STORAGE_KEY);
    return isUiFontSize(value) ? value : "standard";
  } catch {
    return "standard";
  }
}

export function applyUiFontSize(
  value: UiFontSize,
  root: UiPreferenceRoot | null = documentRoot(),
): void {
  root?.setAttribute("data-ui-font-size", value);
}

export function saveUiFontSize(
  value: UiFontSize,
  storage: UiPreferenceStorage | null = browserStorage(),
): void {
  try {
    storage?.setItem(UI_FONT_SIZE_STORAGE_KEY, value);
  } catch {
    // The preference is optional; a locked-down localStorage must not block the UI.
  }
  applyUiFontSize(value);
}
