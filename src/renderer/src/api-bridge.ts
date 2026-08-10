import type { ApiBody, ApiRequest, ApiResponse } from "../../shared/contracts";

const nativeFetch = globalThis.fetch.bind(globalThis);

async function serializeBody(body: BodyInit | null | undefined): Promise<ApiBody | undefined> {
  if (body === null || body === undefined) return undefined;
  if (body instanceof FormData) {
    const fields: Record<string, string> = {};
    let serializedFile: { name: string; type: string; bytes: Uint8Array } | null = null;
    for (const [key, value] of body.entries()) {
      if (typeof value === "string") {
        fields[key] = value;
      } else if (!serializedFile) {
        if (value.size > 10 * 1024 * 1024) {
          throw new TypeError("圖片不可超過 10 MB。");
        }
        serializedFile = {
          name: value.name.slice(0, 255),
          type: value.type.slice(0, 100),
          bytes: new Uint8Array(await value.arrayBuffer()),
        };
      } else {
        throw new TypeError("一次只能上傳一張圖片。");
      }
    }
    if (!serializedFile) throw new TypeError("圖片上傳缺少檔案。");
    return { kind: "multipart", fields, file: serializedFile };
  }
  if (typeof body === "string") {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError("JSON body 必須是物件。");
    }
    return { kind: "json", value: parsed as Record<string, unknown> };
  }
  throw new TypeError("這個 App 只接受 JSON 或圖片表單。");
}

function responseFromIpc(response: ApiResponse): Response {
  const body =
    response.body.kind === "json"
      ? JSON.stringify(response.body.value)
      : new Blob([Uint8Array.from(response.body.value).buffer]);
  return new Response(body, {
    status: response.status,
    headers: response.headers,
  });
}

async function bridgedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const inputUrl =
    input instanceof Request ? input.url : input instanceof URL ? input.toString() : input;
  const url = new URL(inputUrl, window.location.href);
  if (!url.pathname.startsWith("/api/")) return nativeFetch(input, init);
  if (!window.fbaOS?.api) throw new TypeError("本機安全橋接尚未啟動。");

  const requestId = `api-${Date.now().toString(36)}-${crypto.randomUUID()}`;
  const method = String(init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    throw new TypeError("不支援這個請求方法。");
  }
  const sourceHeaders = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, key) => sourceHeaders.set(key, value));
  const headers: Record<string, string> = {};
  sourceHeaders.forEach((value, key) => {
    if (["content-type", "accept"].includes(key.toLowerCase())) headers[key] = value;
  });
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  const body = await serializeBody(init.body);
  const request: ApiRequest = {
    requestId,
    method: method as ApiRequest["method"],
    path: url.pathname,
    query,
    headers,
    ...(body ? { body } : {}),
  };

  if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  let abortHandler: (() => void) | null = null;
  const invoke = window.fbaOS.api.request(request);
  const result = init.signal
    ? await Promise.race([
        invoke,
        new Promise<never>((_resolve, reject) => {
          abortHandler = () => {
            window.fbaOS.api.cancel(requestId);
            reject(new DOMException("Aborted", "AbortError"));
          };
          init.signal?.addEventListener("abort", abortHandler, { once: true });
        }),
      ])
    : await invoke;
  if (abortHandler) init.signal?.removeEventListener("abort", abortHandler);
  return responseFromIpc(result);
}

export function installApiBridge(): void {
  globalThis.fetch = bridgedFetch;
}
