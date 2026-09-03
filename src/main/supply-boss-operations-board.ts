import type {
  OperationsBoardItem,
  OperationsBoardReadResult,
  OperationsBoardSnapshot,
} from "../shared/operations-board";
import {
  emptyOperationsBoardSnapshot,
  OperationsBoardError,
  parseOperationsBoardSnapshot,
  type OperationsBoardPort,
} from "./operations-board";

export const SUPPLY_BOSS_BASE_URL =
  "https://supply-boss.brave-prawn-0848.chatgpt.site";
export const SUPPLY_BOSS_OPERATIONS_BOARD_URL =
  `${SUPPLY_BOSS_BASE_URL}/api/operations-board`;
const SUPPLY_BOSS_LOGIN_URL =
  `${SUPPLY_BOSS_BASE_URL}/api/operations-board/login`;
const MAX_RESPONSE_BYTES = 128 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const KNOWN_PRE_WRITE_REJECTION_STATUSES = new Set([
  400,
  403,
  404,
  405,
  413,
  415,
  422,
]);

type Session = Readonly<{
  token: string;
  username: string;
  expiresAt: string;
}>;

export type OperationsBoardSessionSummary = Readonly<{
  authenticated: boolean;
  username: string | null;
  expiresAt: string | null;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function boundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new OperationsBoardError(
      "OPERATIONS_BOARD_TOO_LARGE",
      "共享公布欄回應超過安全大小上限。",
    );
  }
  const contentType = response.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim() ?? "";
  if (contentType !== "application/json" && !contentType.endsWith("+json")) {
    throw new OperationsBoardError(
      "OPERATIONS_BOARD_CONTENT_TYPE",
      "共享公布欄回應格式無法辨識。",
    );
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new OperationsBoardError(
      "OPERATIONS_BOARD_RESPONSE_INVALID",
      "共享公布欄回應格式無法辨識。",
    );
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new OperationsBoardError(
          "OPERATIONS_BOARD_TOO_LARGE",
          "共享公布欄回應超過安全大小上限。",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new OperationsBoardError(
      "OPERATIONS_BOARD_RESPONSE_INVALID",
      "共享公布欄回應格式無法辨識。",
    );
  }
}

function publicErrorMessage(value: unknown, fallback: string): string {
  if (!isRecord(value) || typeof value.error !== "string") return fallback;
  const clean = value.error.trim();
  return clean && clean.length <= 300 &&
      !/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u.test(clean)
    ? clean
    : fallback;
}

function normalizeLoginInput(input: Readonly<{
  username: string;
  password: string;
}>): Readonly<{ username: string; password: string }> {
  const username = typeof input.username === "string" ? input.username.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (
    !username || username.length > 64 ||
    !password || password.length > 256 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(username)
  ) {
    throw new OperationsBoardError(
      "OPERATIONS_BOARD_LOGIN_INVALID",
      "請輸入有效的公布欄管理帳號與密碼。",
    );
  }
  return { username, password };
}

export class SupplyBossOperationsBoard implements OperationsBoardPort {
  private readonly request: typeof fetch;
  private readonly now: () => Date;
  private lastKnownGood: OperationsBoardSnapshot | null = null;
  private session: Session | null = null;

  constructor(input: Readonly<{
    request?: typeof fetch;
    now?: () => Date;
  }> = {}) {
    this.request = input.request ?? fetch;
    this.now = input.now ?? (() => new Date());
  }

  sessionSummary(): OperationsBoardSessionSummary {
    if (this.session && Date.parse(this.session.expiresAt) <= this.now().getTime()) {
      this.session = null;
    }
    return this.session
      ? {
          authenticated: true,
          username: this.session.username,
          expiresAt: this.session.expiresAt,
        }
      : { authenticated: false, username: null, expiresAt: null };
  }

  logout(): void {
    this.session = null;
  }

  async login(input: Readonly<{ username: string; password: string }>): Promise<void> {
    const clean = normalizeLoginInput(input);
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.request(SUPPLY_BOSS_LOGIN_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(clean),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: abort.signal,
      });
      const payload = await boundedJson(response);
      if (!response.ok) {
        throw new OperationsBoardError(
          response.status === 429
            ? "OPERATIONS_BOARD_LOGIN_RATE_LIMITED"
            : "OPERATIONS_BOARD_LOGIN_REJECTED",
          publicErrorMessage(payload, "公布欄管理帳號或密碼不正確。"),
        );
      }
      if (
        !isRecord(payload) ||
        typeof payload.token !== "string" ||
        payload.token.length < 32 || payload.token.length > 4_096 ||
        /\s/u.test(payload.token) ||
        typeof payload.expiresAt !== "string"
      ) {
        throw new OperationsBoardError(
          "OPERATIONS_BOARD_LOGIN_RESPONSE_INVALID",
          "公布欄登入回應無法安全辨識。",
        );
      }
      const expiresAt = Date.parse(payload.expiresAt);
      const now = this.now().getTime();
      if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + 24 * 60 * 60 * 1_000) {
        throw new OperationsBoardError(
          "OPERATIONS_BOARD_LOGIN_RESPONSE_INVALID",
          "公布欄登入期限無法安全辨識。",
        );
      }
      this.session = {
        token: payload.token,
        username: clean.username,
        expiresAt: new Date(expiresAt).toISOString(),
      };
    } catch (error) {
      if (error instanceof OperationsBoardError) throw error;
      throw new OperationsBoardError(
        abort.signal.aborted
          ? "OPERATIONS_BOARD_LOGIN_TIMEOUT"
          : "OPERATIONS_BOARD_LOGIN_UNAVAILABLE",
        abort.signal.aborted
          ? "公布欄登入逾時，請確認網路後重試。"
          : "目前無法連線到公布欄登入服務。",
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async read(): Promise<OperationsBoardReadResult> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.request(SUPPLY_BOSS_OPERATIONS_BOARD_URL, {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: abort.signal,
      });
      if (!response.ok) throw new Error("board unavailable");
      const snapshot = parseOperationsBoardSnapshot(await boundedJson(response));
      this.lastKnownGood = snapshot;
      return { snapshot, source: "shared", stale: false, status: "ready" };
    } catch {
      return {
        snapshot: this.lastKnownGood ?? emptyOperationsBoardSnapshot(),
        source: this.lastKnownGood ? "last-known-good" : "empty",
        stale: true,
        status: "unavailable",
        message: this.lastKnownGood
          ? "目前無法重新讀取共用公布欄；暫時顯示上次成功同步的內容。"
          : "目前無法讀取共用公布欄。",
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async replace(input: Readonly<{
    baseRevision: number;
    items: readonly OperationsBoardItem[];
  }>): Promise<OperationsBoardSnapshot> {
    const session = this.sessionSummary().authenticated ? this.session : null;
    if (!session) {
      throw new OperationsBoardError(
        "OPERATIONS_BOARD_AUTH_REQUIRED",
        "公布欄登入已過期，請重新輸入帳號密碼。",
      );
    }
    const candidate = parseOperationsBoardSnapshot({
      schemaVersion: 1,
      revision: input.baseRevision,
      updatedAt: this.now().toISOString(),
      items: input.items,
    });
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.request(SUPPLY_BOSS_OPERATIONS_BOARD_URL, {
        method: "PUT",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${session.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          baseRevision: candidate.revision,
          items: candidate.items,
        }),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: abort.signal,
      });
    } catch {
      clearTimeout(timeout);
      throw new OperationsBoardError(
        "OPERATIONS_BOARD_WRITE_UNKNOWN",
        "公布欄寫入結果不明；系統不會自動重送，請先重新同步確認。",
      );
    }

    try {
      if (response.status === 401) {
        this.session = null;
        throw new OperationsBoardError(
          "OPERATIONS_BOARD_AUTH_REQUIRED",
          "公布欄登入已過期，請重新輸入帳號密碼。",
        );
      }
      if (response.status === 409 || response.status === 412) {
        throw new OperationsBoardError(
          "OPERATIONS_BOARD_CONFLICT",
          "公布欄已被其他人更新，請重新同步後再修改。",
        );
      }
      if (KNOWN_PRE_WRITE_REJECTION_STATUSES.has(response.status)) {
        let payload: unknown = null;
        try {
          payload = await boundedJson(response);
        } catch {
          // The HTTP status already proves this allowlisted pre-write rejection.
        }
        throw new OperationsBoardError(
          "OPERATIONS_BOARD_WRITE_REJECTED",
          publicErrorMessage(payload, "公布欄拒絕這次更新，資料未發布。"),
        );
      }
      if (!response.ok) {
        try {
          await response.body?.cancel();
        } catch {
          // The status remains an unknown write result even if cancellation fails.
        }
        throw new OperationsBoardError(
          "OPERATIONS_BOARD_WRITE_UNKNOWN",
          "公布欄寫入結果不明；系統不會自動重送，請先重新同步確認。",
        );
      }

      try {
        const snapshot = parseOperationsBoardSnapshot(await boundedJson(response));
        if (snapshot.revision !== input.baseRevision + 1) throw new Error("revision mismatch");
        this.lastKnownGood = snapshot;
        return snapshot;
      } catch {
        throw new OperationsBoardError(
          "OPERATIONS_BOARD_WRITE_UNKNOWN",
          "公布欄寫入結果不明；系統不會自動重送，請先重新同步確認。",
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
