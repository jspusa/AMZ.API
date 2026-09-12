/** Non-sensitive display choices only; no account or operational data. */
export type DisplayPreferences = Readonly<{
  fontSize: "small" | "standard" | "large";
  accent: "default" | "pink";
  mode: "light" | "dark";
  imageAuditMinimumImages: number;
}>;
export type DisplayPreferencesPatch = Partial<DisplayPreferences>;
export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = Object.freeze({
  fontSize: "standard", accent: "default", mode: "light", imageAuditMinimumImages: 8,
});
export function parseDisplayPreferencesPatch(value: unknown): DisplayPreferencesPatch {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError("INVALID_DISPLAY_PREFERENCES");
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (!keys.length || keys.some(key => !Object.hasOwn(DEFAULT_DISPLAY_PREFERENCES, key)) ||
    ("fontSize" in input && !["small", "standard", "large"].includes(input.fontSize as string)) ||
    ("accent" in input && !["default", "pink"].includes(input.accent as string)) ||
    ("mode" in input && !["light", "dark"].includes(input.mode as string)) ||
    ("imageAuditMinimumImages" in input && (!Number.isInteger(input.imageAuditMinimumImages) ||
      Number(input.imageAuditMinimumImages) < 1 || Number(input.imageAuditMinimumImages) > 9))) {
    throw new TypeError("INVALID_DISPLAY_PREFERENCES");
  }
  return Object.freeze({ ...input }) as DisplayPreferencesPatch;
}
export function parseDisplayPreferences(value: unknown): DisplayPreferences {
  const patch = parseDisplayPreferencesPatch(value);
  if (Object.keys(patch).length !== 4) throw new TypeError("INVALID_DISPLAY_PREFERENCES");
  return patch as DisplayPreferences;
}
