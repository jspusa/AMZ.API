import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const ADDON_NAME = "windows-hello.node";
const MAXIMUM_ADDON_BYTES = 2 * 1024 * 1024;
const MAXIMUM_REASON_LENGTH = 120;

export type WindowsHelloOutcome = "verified" | "unavailable";

export type WindowsHelloAdapter = Readonly<{
  platform: NodeJS.Platform;
  nativeWindowHandle(): Buffer | null;
  verifyForWindow(handle: Buffer, reason: string): Promise<string>;
}>;

type NativeModule = Readonly<{
  verifyForWindow(handle: Buffer, reason: string): Promise<string>;
}>;

type Manifest = Readonly<{ file: typeof ADDON_NAME; sha256: string }>;

type WindowsHelloModuleLocation = Readonly<{
  platform: NodeJS.Platform;
  appPath: string;
  resourcesPath: string;
  packaged: boolean;
}>;

export type WindowsHelloLoadDependencies = Readonly<{
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Buffer>;
  fileInfo(path: string): Promise<Readonly<{
    isFile(): boolean;
    isSymbolicLink(): boolean;
  }>>;
  loadModule(path: string): unknown;
}>;

const defaultLoadDependencies: WindowsHelloLoadDependencies = {
  readText: (path) => readFile(path, "utf8"),
  readBytes: (path) => readFile(path),
  fileInfo: (path) => lstat(path),
  loadModule: (path) => require(path) as unknown,
};

export function parseWindowsHelloManifest(raw: string): Manifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("WINDOWS_HELLO_MANIFEST_INVALID");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("WINDOWS_HELLO_MANIFEST_INVALID");
  }
  const keys = Object.keys(parsed);
  const value = parsed as Record<string, unknown>;
  if (
    keys.length !== 2 ||
    !keys.includes("file") ||
    !keys.includes("sha256") ||
    value.file !== ADDON_NAME ||
    typeof value.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.sha256)
  ) {
    throw new Error("WINDOWS_HELLO_MANIFEST_INVALID");
  }
  return { file: ADDON_NAME, sha256: value.sha256 };
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function createVerifiedWindowsHelloLoader(
  input: WindowsHelloModuleLocation,
  dependencies: WindowsHelloLoadDependencies = defaultLoadDependencies,
): () => Promise<NativeModule> {
  let loaded: NativeModule | null = null;
  const manifestPath = resolve(input.appPath, "out", "main", "windows-hello-manifest.json");
  const addonPath = input.packaged
    ? resolve(input.resourcesPath, "app.asar.unpacked", "out", "main", "native", ADDON_NAME)
    : resolve(input.appPath, "out", "main", "native", ADDON_NAME);

  return async (): Promise<NativeModule> => {
    if (loaded) return loaded;
    const [manifestRaw, info, bytes] = await Promise.all([
      dependencies.readText(manifestPath),
      dependencies.fileInfo(addonPath),
      dependencies.readBytes(addonPath),
    ]);
    const manifest = parseWindowsHelloManifest(manifestRaw);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      bytes.byteLength < 1_024 ||
      bytes.byteLength > MAXIMUM_ADDON_BYTES ||
      sha256(bytes) !== manifest.sha256
    ) {
      throw new Error("WINDOWS_HELLO_ADDON_INTEGRITY_FAILED");
    }
    const candidate = dependencies.loadModule(addonPath) as Partial<NativeModule> | null;
    if (!candidate || typeof candidate.verifyForWindow !== "function") {
      throw new Error("WINDOWS_HELLO_ADDON_INVALID");
    }
    loaded = { verifyForWindow: candidate.verifyForWindow.bind(candidate) };
    return loaded;
  };
}

export async function preflightWindowsHelloAddon(
  input: WindowsHelloModuleLocation,
  dependencies: WindowsHelloLoadDependencies = defaultLoadDependencies,
): Promise<void> {
  if (input.platform !== "win32") return;
  await createVerifiedWindowsHelloLoader(input, dependencies)();
}

export function parseWindowsHelloToken(raw: string):
  | "verified"
  | "device-not-present"
  | "not-configured"
  | "disabled-by-policy"
  | "canceled"
  | "device-busy"
  | "retries-exhausted"
  | "unsupported"
  | "failed"
  | "timeout"
  | "invalid-window"
  | null {
  switch (raw) {
    case "verified":
    case "device-not-present":
    case "not-configured":
    case "disabled-by-policy":
    case "canceled":
    case "device-busy":
    case "retries-exhausted":
    case "unsupported":
    case "failed":
    case "timeout":
    case "invalid-window":
      return raw;
    default:
      return null;
  }
}

export async function requestWindowsHello(
  reason: string,
  adapter: WindowsHelloAdapter,
): Promise<WindowsHelloOutcome> {
  if (adapter.platform !== "win32") return "unavailable";
  const prompt = reason.trim().slice(0, MAXIMUM_REASON_LENGTH);
  if (!prompt || /[\u0000-\u001f\u007f]/.test(prompt)) {
    throw new Error("WINDOWS_HELLO_REASON_INVALID");
  }
  const handle = adapter.nativeWindowHandle();
  if (!handle || handle.byteLength !== 8) {
    throw new Error("WINDOWS_HELLO_WINDOW_UNAVAILABLE");
  }

  const token = parseWindowsHelloToken(await adapter.verifyForWindow(handle, prompt));
  if (token === "verified") return "verified";
  if (
    token === "device-not-present" ||
    token === "not-configured" ||
    token === "disabled-by-policy" ||
    token === "unsupported"
  ) {
    return "unavailable";
  }
  if (token === "canceled") throw new Error("WINDOWS_HELLO_CANCELED");
  if (token === "device-busy") throw new Error("WINDOWS_HELLO_DEVICE_BUSY");
  if (token === "retries-exhausted") throw new Error("WINDOWS_HELLO_RETRIES_EXHAUSTED");
  if (token === "timeout") throw new Error("WINDOWS_HELLO_TIMEOUT");
  throw new Error("WINDOWS_HELLO_VERIFICATION_FAILED");
}

export function createWindowsHelloAdapter(input: {
  platform: NodeJS.Platform;
  appPath: string;
  resourcesPath: string;
  packaged: boolean;
  nativeWindowHandle(): Buffer | null;
}): WindowsHelloAdapter {
  const load = createVerifiedWindowsHelloLoader(input);

  return {
    platform: input.platform,
    nativeWindowHandle: input.nativeWindowHandle,
    verifyForWindow: async (handle, prompt) => (await load()).verifyForWindow(handle, prompt),
  };
}
