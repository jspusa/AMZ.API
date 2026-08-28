import type { UpdateStatus } from "../shared/contracts";
import type { DesktopUpdatePolicy } from "./update-policy";

type UpdateInfo = Readonly<{ version: string }>;

export type DesktopUpdaterAdapter = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  removeListener(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<{ updateInfo?: UpdateInfo } | null>;
  downloadUpdate(): Promise<string[]>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
};

type DesktopUpdaterOptions = Readonly<{
  adapter: DesktopUpdaterAdapter;
  currentVersion: string;
  policy: DesktopUpdatePolicy;
  publishStatus(status: UpdateStatus): void;
  installBlockReason(): string | null;
  prepareInstall(): (() => void) | undefined;
  initialCheckDelayMs?: number;
  checkIntervalMs?: number;
}>;

const DEFAULT_INITIAL_CHECK_DELAY_MS = 15_000;
const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const INSTALL_PENDING_MESSAGE =
  "安全更新正在安裝；App 重啟後再執行 Amazon 或憑證操作。";

export class DesktopInstallGate {
  #pending = false;

  begin(): () => void {
    if (this.#pending) throw new Error(INSTALL_PENDING_MESSAGE);
    this.#pending = true;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.#pending = false;
    };
  }

  assertOperationAllowed(): void {
    if (this.#pending) throw new Error(INSTALL_PENDING_MESSAGE);
  }
}

export class DesktopUpdater {
  readonly #adapter: DesktopUpdaterAdapter;
  readonly #currentVersion: string;
  readonly #policy: DesktopUpdatePolicy;
  readonly #publishStatus: (status: UpdateStatus) => void;
  readonly #installBlockReason: () => string | null;
  readonly #prepareInstall: () => (() => void) | undefined;
  readonly #initialCheckDelayMs: number;
  readonly #checkIntervalMs: number;
  #status: UpdateStatus = { state: "idle" };
  #checkFlight: Promise<UpdateStatus> | null = null;
  #initialTimer: ReturnType<typeof setTimeout> | null = null;
  #intervalTimer: ReturnType<typeof setInterval> | null = null;
  #started = false;
  #installStarted = false;
  #installRollback: (() => void) | null = null;

  readonly #listeners: ReadonlyArray<readonly [string, (...args: any[]) => void]> = [
    ["checking-for-update", () => this.#setStatus({ state: "checking" })],
    ["update-available", (info: UpdateInfo) =>
      this.#setStatus({ state: "available", version: info.version })],
    ["update-not-available", (info: UpdateInfo) =>
      this.#setStatus({ state: "not-available", version: info.version })],
    ["download-progress", (progress: { percent: number }) =>
      this.#setStatus({
        state: "downloading",
        version: this.#status.version,
        percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
      })],
    ["update-downloaded", (info: UpdateInfo) =>
      this.#setStatus({ state: "downloaded", version: info.version, percent: 100 })],
    ["error", () => this.#handleError()],
  ];

  constructor(options: DesktopUpdaterOptions) {
    this.#adapter = options.adapter;
    this.#currentVersion = options.currentVersion;
    this.#policy = options.policy;
    this.#publishStatus = options.publishStatus;
    this.#installBlockReason = options.installBlockReason;
    this.#prepareInstall = options.prepareInstall;
    this.#initialCheckDelayMs =
      options.initialCheckDelayMs ?? DEFAULT_INITIAL_CHECK_DELAY_MS;
    this.#checkIntervalMs = options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    if (!this.#policy.enabled) {
      this.#setStatus({
        state: "not-available",
        version: this.#currentVersion,
        message: this.#policy.message ?? undefined,
      });
      return;
    }

    this.#adapter.autoDownload = false;
    this.#adapter.autoInstallOnAppQuit = false;
    for (const [event, listener] of this.#listeners) {
      this.#adapter.on(event, listener);
    }
    this.#initialTimer = setTimeout(() => {
      void this.check();
      this.#intervalTimer = setInterval(() => void this.check(), this.#checkIntervalMs);
      this.#intervalTimer.unref?.();
    }, this.#initialCheckDelayMs);
    this.#initialTimer.unref?.();
  }

  currentStatus(): UpdateStatus {
    return this.#status;
  }

  check(): Promise<UpdateStatus> {
    if (!this.#policy.enabled) return Promise.resolve(this.#status);
    if (this.#status.state === "downloading" || this.#status.state === "downloaded") {
      return Promise.resolve(this.#status);
    }
    if (this.#checkFlight) return this.#checkFlight;

    this.#checkFlight = this.#runCheck().finally(() => {
      this.#checkFlight = null;
    });
    return this.#checkFlight;
  }

  install(): void {
    if (this.#installStarted) return;
    if (!this.#policy.enabled) throw new Error("APP_UPDATE_DISABLED_FOR_PLATFORM");
    if (this.#status.state !== "downloaded") throw new Error("UPDATE_NOT_READY");
    const blockReason = this.#installBlockReason();
    if (blockReason) throw new Error(blockReason);
    this.#installStarted = true;
    try {
      this.#installRollback = this.#prepareInstall() ?? null;
      this.#adapter.quitAndInstall(true, true);
    } catch (error) {
      this.#rollbackInstall();
      throw error;
    }
  }

  stop(): void {
    if (this.#initialTimer) clearTimeout(this.#initialTimer);
    if (this.#intervalTimer) clearInterval(this.#intervalTimer);
    this.#initialTimer = null;
    this.#intervalTimer = null;
    for (const [event, listener] of this.#listeners) {
      this.#adapter.removeListener(event, listener);
    }
    this.#started = false;
  }

  async #runCheck(): Promise<UpdateStatus> {
    try {
      const result = await this.#adapter.checkForUpdates();
      if (
        result?.updateInfo &&
        result.updateInfo.version !== this.#currentVersion &&
        this.#status.state !== "downloading" &&
        this.#status.state !== "downloaded"
      ) {
        await this.#adapter.downloadUpdate();
      }
      return this.#status;
    } catch {
      return this.#setStatus({
        state: "error",
        message: "目前無法檢查更新，既有 App 仍可正常使用。",
      });
    }
  }

  #setStatus(status: UpdateStatus): UpdateStatus {
    this.#status = status;
    this.#publishStatus(status);
    return status;
  }

  #handleError(): void {
    const installFailed = this.#installStarted;
    if (installFailed) this.#rollbackInstall();
    this.#setStatus({
      state: "error",
      message: installFailed
        ? "安全更新未能啟動；既有 App 仍可正常使用，請重新檢查後再試。"
        : "目前無法檢查更新，既有 App 仍可正常使用。",
    });
  }

  #rollbackInstall(): void {
    const rollback = this.#installRollback;
    this.#installRollback = null;
    this.#installStarted = false;
    rollback?.();
  }
}
