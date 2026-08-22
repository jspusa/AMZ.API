/** Exact LanguageTag constraint published by Amazon's A+ Content API model. */
const APLUS_LANGUAGE_TAG_PATTERN = /^[a-z]{2,}-[A-Z0-9]{2,}$/u;

/** Public DTO bounds shared by the main producer and renderer validator. */
export const APLUS_AUDIT_MAX_PUBLIC_COUNT = 25_000;
export const APLUS_AUDIT_MAX_PUBLIC_LOCALES_PER_ASIN = 100;

export function isAplusLanguageTag(value: string): boolean {
  return APLUS_LANGUAGE_TAG_PATTERN.test(value);
}
