const REPORTS_ENDPOINT = "https://sellingpartnerapi-na.amazon.com";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Test-only bridge for legacy fetch fixtures. Production code must obtain the
 * same text through ReportsRuntime; this helper only lets existing transport
 * fixtures exercise the extracted pure document readers.
 */
export async function downloadMockReportDocument(input: Readonly<{
  reportId: string;
  documentId: string;
}>): Promise<string> {
  const reportResponse = await fetch(
    `${REPORTS_ENDPOINT}/reports/2021-06-30/reports/${encodeURIComponent(input.reportId)}`,
  );
  if (!reportResponse.ok) {
    throw new Error(`Mock report status failed: ${reportResponse.status}`);
  }
  const report = record(await reportResponse.json());
  if (
    report?.processingStatus !== "DONE" ||
    report.reportDocumentId !== input.documentId
  ) {
    throw new Error("Mock report is not ready or its document identity changed.");
  }

  const documentResponse = await fetch(
    `${REPORTS_ENDPOINT}/reports/2021-06-30/documents/${encodeURIComponent(input.documentId)}`,
  );
  if (!documentResponse.ok) {
    throw new Error(`Mock report document failed: ${documentResponse.status}`);
  }
  const document = record(await documentResponse.json());
  if (typeof document?.url !== "string" || !document.url) {
    throw new Error("Mock report document URL is missing.");
  }
  const download = await fetch(document.url);
  if (!download.ok) {
    throw new Error(`Mock report download failed: ${download.status}`);
  }
  return download.text();
}
