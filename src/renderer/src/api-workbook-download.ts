function safeWorkbookFilename(response: Response, fallback: string): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/iu);
  const plainMatch = disposition.match(/filename="?([^";]+)"?/iu);
  let candidate = fallback;
  try {
    candidate = utf8Match?.[1]
      ? decodeURIComponent(utf8Match[1])
      : plainMatch?.[1] ?? fallback;
  } catch {
    candidate = fallback;
  }
  const safe = candidate
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/gu, "-")
    .trim()
    .slice(0, 200);
  return safe.toLocaleLowerCase("en-US").endsWith(".xlsx")
    ? safe
    : fallback;
}

/** Saves the exact XLSX blob returned by main; renderer never rebuilds it. */
export async function downloadApiWorkbookResponse(
  response: Response,
  fallbackFilename: string,
): Promise<void> {
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = safeWorkbookFilename(response, fallbackFilename);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
