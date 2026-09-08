/** Comparison-only interpretation; never changes the workbook's stored value. */
export function priceListPriceValue(value: unknown): number | null {
  if (typeof value === "string") {
    // Do not trim, infer a locale/currency, or evaluate formula text.
    if (
      value.length > 64 ||
      value !== value.trim() ||
      !/^[0-9]+(?:\.[0-9]+)?$/u.test(value)
    )
      return null;
    // Decimal text must fit Number's reliable 15-digit decimal precision.
    // Ignore padding zeros; retain the untouched text in the source workbook.
    const significantDigits = value
      .replace(".", "")
      .replace(/^0+/u, "")
      .replace(/0+$/u, "");
    if (significantDigits.length > 15) return null;
    value = Number(value);
  }
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
    ? value
    : null;
}
