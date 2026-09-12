/** Operator-selected Listing image count, including the main image. */
export const IMAGE_AUDIT_MINIMUM_IMAGES = 8;

export function isImageAuditMinimum(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 9;
}
