/** Program support only. These flags never prove account access or authorize writes. */
export type NotebookCapabilitySnapshot = Readonly<{
  schemaVersion: 1;
  appVersion: string;
  features: Readonly<{
    businessPricingBatch: 0 | 1;
    recentBusinessPricingWork: 0 | 1;
  }>;
}>;

export function createNotebookCapabilitySnapshot(
  appVersion: string,
): NotebookCapabilitySnapshot {
  return Object.freeze({
    schemaVersion: 1,
    appVersion,
    features: Object.freeze({
      businessPricingBatch: 1,
      recentBusinessPricingWork: 1,
    }),
  });
}

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function safeNotebookVersion(value: unknown): string | null {
  return typeof value === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(value)
    ? value
    : null;
}

export function parseNotebookCapabilitySnapshot(
  value: unknown,
): NotebookCapabilitySnapshot | null {
  if (!exactRecord(value, ["schemaVersion", "appVersion", "features"]) ||
      value.schemaVersion !== 1) return null;
  const appVersion = safeNotebookVersion(value.appVersion);
  const features = value.features;
  if (!appVersion || !exactRecord(features, ["businessPricingBatch", "recentBusinessPricingWork"])) {
    return null;
  }
  if ((features.businessPricingBatch !== 0 && features.businessPricingBatch !== 1) ||
      (features.recentBusinessPricingWork !== 0 && features.recentBusinessPricingWork !== 1)) {
    return null;
  }
  return {
    schemaVersion: 1,
    appVersion,
    features: {
      businessPricingBatch: features.businessPricingBatch,
      recentBusinessPricingWork: features.recentBusinessPricingWork,
    },
  };
}
