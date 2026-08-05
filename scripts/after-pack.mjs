import { join } from "node:path";
import { flipFuses, FuseV1Options, FuseVersion } from "@electron/fuses";

export default async function afterPack(context) {
  const executable =
    context.electronPlatformName === "darwin"
      ? join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          "Contents",
          "MacOS",
          context.packager.appInfo.productFilename,
        )
      : join(context.appOutDir, context.packager.appInfo.productFilename);

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
