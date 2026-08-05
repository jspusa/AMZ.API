export const REMOTE_CONSOLE_URL = "https://jspusa.github.io/AMZ.API/";
export const DEV_RENDERER_ORIGIN = "http://127.0.0.1:5173";

export function isTrustedRendererDocument(
  raw: string,
  developmentUrl: string | null,
): boolean {
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.search || url.hash) {
      return false;
    }
    if (developmentUrl) {
      return url.origin === DEV_RENDERER_ORIGIN;
    }
    return (
      url.protocol === "https:" &&
      url.hostname === "jspusa.github.io" &&
      !url.port &&
      (url.pathname === "/AMZ.API/" ||
        url.pathname === "/AMZ.API/index.html")
    );
  } catch {
    return false;
  }
}
