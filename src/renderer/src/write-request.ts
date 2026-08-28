export function publicProblemMessage(
  payload: unknown,
  fallback: string,
): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return fallback;
  }
  const source = payload as Record<string, unknown>;
  const message = typeof source.message === "string" &&
      source.message.length <= 4_000 &&
      !source.message.includes("\u0000") &&
      source.message.trim()
    ? source.message
    : fallback;
  const requestId = typeof source.requestId === "string" &&
      source.requestId.length <= 256 &&
      source.requestId === source.requestId.trim() &&
      !/[\u0000-\u001f\u007f]/u.test(source.requestId) &&
      source.requestId
    ? source.requestId
    : null;
  return `${message}${requestId ? `（Request ID: ${requestId}）` : ""}`;
}

export function createRendererIdempotencyKey(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 12)}`;
}
