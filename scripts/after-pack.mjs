import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { flipFuses, FuseV1Options, FuseVersion } from "@electron/fuses";

const execFileAsync = promisify(execFile);

export default async function afterPack(context) {
  const productFilename = context.packager.appInfo.productFilename;
  const appBundle = context.electronPlatformName === "darwin"
    ? join(context.appOutDir, `${productFilename}.app`)
    : null;
  if (appBundle) {
    // Finder provenance/resource-fork metadata can be inherited from the
    // Electron download cache and makes Apple's signer reject an otherwise
    // complete bundle. Strip only the freshly packed app before signing.
    await execFileAsync("/usr/bin/xattr", ["-cr", appBundle]);
  }
  const executable = context.electronPlatformName === "darwin"
    ? join(
        appBundle,
        "Contents",
        "MacOS",
        productFilename,
      )
    : context.electronPlatformName === "win32"
      ? join(context.appOutDir, `${productFilename}.exe`)
      : join(context.appOutDir, productFilename);

  await flipFuses(executable, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    // The stock Electron distribution ships one shared V8 snapshot. Enabling
    // browser-process-specific snapshots without supplying matching assets
    // terminates the app before main executes.
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  });
}
