import { DEFAULT_DISPLAY_PREFERENCES, parseDisplayPreferences, parseDisplayPreferencesPatch, type DisplayPreferences, type DisplayPreferencesPatch } from "../../shared/display-preferences";

const snapshots = new WeakMap<object, DisplayPreferences>();
function bridge() { return typeof window === "undefined" ? undefined : window.fbaOS; }
export function nativeDisplayPreferences(): DisplayPreferences | null {
  const current = bridge();
  return current ? snapshots.get(current) ?? null : null;
}
function apply(preferences: DisplayPreferences): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-ui-font-size", preferences.fontSize);
  document.documentElement.setAttribute("data-ui-accent", preferences.accent);
  document.documentElement.setAttribute("data-ui-mode", preferences.mode);
  try {
    // This is a display-only cache for older components; durable storage belongs to main.
    window.localStorage.setItem("amz-api:ui-font-size", preferences.fontSize);
    window.localStorage.setItem("amz-api:ui-accent", preferences.accent);
    window.localStorage.setItem("amz-api:ui-mode", preferences.mode);
  } catch { /* Native preferences work when browser storage is unavailable. */ }
}
export async function initializeDisplayPreferences(): Promise<void> {
  const current = bridge();
  if (!current?.preferences) return;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      current.preferences.read(),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("PREFERENCES_TIMEOUT")), 1500); }),
    ]);
    const parsed = parseDisplayPreferences(value);
    snapshots.set(current, parsed);
    apply(parsed);
  } catch { /* Optional preferences must not prevent opening the console. */ }
  finally { if (timeout !== undefined) clearTimeout(timeout); }
}
/** null means no desktop Bridge, where the caller's browser-storage result applies. */
export async function persistDisplayPreferences(patch: DisplayPreferencesPatch): Promise<boolean | null> {
  const current = bridge();
  if (!current) return null;
  const safe = parseDisplayPreferencesPatch(patch);
  snapshots.set(current, Object.freeze({ ...(snapshots.get(current) ?? DEFAULT_DISPLAY_PREFERENCES), ...safe }));
  if (!current.preferences) return false;
  try {
    parseDisplayPreferences(await current.preferences.update(safe));
    return true;
  } catch { return false; }
}
