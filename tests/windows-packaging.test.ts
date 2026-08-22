import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Windows x64 Notebook Key packaging", () => {
  it("keeps stable unsigned NSIS and portable ZIP artifact names", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      version: string;
      description: string;
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
      build: {
        asarUnpack: string[];
        win: {
          target: Array<{ target: string; arch: string[] }>;
          artifactName: string;
        };
        nsis: { artifactName: string };
      };
    };

    expect(packageJson.version).toBe("0.1.22");
    expect(packageJson.description).toContain("macOS and Windows 11 Notebook Key");
    expect(packageJson.devDependencies.electron).toBe("43.3.0");
    expect(packageJson.devDependencies["node-gyp"]).toBe("12.4.0");
    expect(packageJson.scripts["dist:win"]).toContain("npm run build:windows-hello");
    expect(packageJson.scripts["dist:win"]).toContain("--win nsis zip --x64");
    expect(packageJson.build.asarUnpack).toEqual([
      "out/main/native/windows-hello.node",
    ]);
    expect(packageJson.build.win.target).toEqual([
      { target: "nsis", arch: ["x64"] },
      { target: "zip", arch: ["x64"] },
    ]);
    expect(packageJson.build.win.artifactName).toBe(
      "AMZ.API-Notebook-Key-Windows-${arch}.${ext}",
    );
    expect(packageJson.build.nsis.artifactName).toBe(
      "AMZ.API-Notebook-Key-Windows-${arch}-Setup.${ext}",
    );
  });

  it("builds the N-API addon before packaging and binds it to an ASAR manifest", async () => {
    const [workflow, compiler, verifier, afterPack, binding, main, nativeSource] = await Promise.all([
      readFile(
        new URL("../.github/workflows/windows-dev.yml", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../scripts/build-windows-hello.ps1", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../scripts/verify-windows-package.ps1", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../scripts/after-pack.mjs", import.meta.url), "utf8"),
      readFile(
        new URL("../native/windows-hello/binding.gyp", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../src/main/index.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../native/windows-hello/windows_hello.cc", import.meta.url),
        "utf8",
      ),
    ]);

    expect(workflow).toContain("runs-on: windows-2025");
    expect(workflow).toContain(
      "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
    );
    expect(workflow).toContain(
      "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38",
    );
    expect(workflow).toContain(
      "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    );
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("CSC_IDENTITY_AUTO_DISCOVERY: \"false\"");
    expect(workflow).toContain("release/AMZ.API-Notebook-Key-Windows-x64-Setup.exe");
    expect(workflow).toContain("release/AMZ.API-Notebook-Key-Windows-x64.zip");
    expect(workflow).toContain("release/SHA256SUMS.txt");
    expect(workflow).toContain("if: github.event_name != 'pull_request'");
    expect(compiler).toContain("native\\windows-hello");
    expect(compiler).toContain("binding.gyp");
    expect(compiler).toContain("windows_hello.cc");
    expect(compiler).toContain("node-gyp.cmd");
    expect(compiler).toContain('electronVersion = "43.3.0"');
    expect(compiler).toContain('"--target=$electronVersion"');
    expect(compiler).toContain('"--arch=x64"');
    expect(compiler).toContain('"--dist-url=https://electronjs.org/headers"');
    expect(compiler).toContain("out\\main\\native");
    expect(compiler).toContain("windows-hello.node");
    expect(compiler).toContain("windows-hello-manifest.json");
    expect(compiler).toContain("[System.Security.Cryptography.SHA256]::Create()");
    expect(compiler).toContain("Get-Sha256Hex -Path $outputPath");
    expect(compiler).not.toContain("Get-FileHash");
    expect(JSON.parse(binding).targets[0].win_delay_load_hook).toBe("true");
    expect(verifier).toContain("app.asar.unpacked");
    expect(verifier).toContain("[System.Security.Cryptography.SHA256]::Create()");
    expect(verifier).toContain("Get-Sha256Hex -Path $addonPath");
    expect(verifier).not.toContain("Get-FileHash");
    expect(verifier).toContain("amz-api-extract-manifest-");
    expect(verifier).toContain('node_modules\\@electron\\asar');
    expect(verifier).toContain("[System.IO.File]::WriteAllText(");
    expect(verifier).toContain('split("/").join(path.sep)');
    expect(verifier).toContain(
      "& $nodePath $extractScriptPath $asarModulePath $asarPath $manifestEntry",
    );
    expect(verifier).toContain(
      "Remove-Item -LiteralPath $extractScriptPath -Force",
    );
    expect(verifier).not.toContain("& $nodePath -e $extractManifest");
    expect(verifier).toContain("electron-fuses.cmd");
    expect(verifier).toContain("RunAsNode is Disabled");
    expect(verifier).toContain("EnableCookieEncryption is Enabled");
    expect(verifier).toContain("OnlyLoadAppFromAsar is Enabled");
    expect(verifier).toContain("Packaged Windows Electron fuse mismatch");
    expect(verifier).toContain("SHA-256 does not match the packed manifest");
    expect(verifier).toContain("must exist only at its exact app.asar.unpacked path");
    expect(verifier).toContain("8664 machine \\(x64\\)");
    expect(verifier).toContain("napi_register_module_v1");
    expect(verifier).toContain("(?:\\s+=\\s+.+)?");
    expect(verifier).toContain("AMZ_API_WINDOWS_HELLO_ADDON_READY");
    expect(verifier).toContain(
      'Invoke-PackagedSmoke -Executable $appExecutable -Name "win-unpacked"',
    );
    expect(verifier).toContain(
      'Invoke-PackagedSmoke -Executable $archiveExecutable.FullName -Name "zip"',
    );
    expect(verifier).toContain('ArgumentList @("/S", "/D=$installDirectory")');
    expect(verifier).toContain("Silent NSIS installation failed");
    expect(verifier).toContain(
      'Invoke-PackagedSmoke -Executable $installedExecutable -Name "nsis-installed"',
    );
    expect(verifier).toContain("Silent NSIS uninstallation failed");
    expect(verifier).toContain("CI did not prove a real Windows Hello prompt");
    expect(afterPack).toContain('context.electronPlatformName === "win32"');
    expect(afterPack).toContain('join(context.appOutDir, `${productFilename}.exe`)');
    expect(main).toContain("await preflightWindowsHelloAddon({");
    expect(main).toContain('console.info("AMZ_API_WINDOWS_HELLO_ADDON_READY")');
    expect(nativeSource).toContain("std::make_unique<VerificationWork>()");
    expect(nativeSource).toContain("if (napi_result != napi_ok)");
    expect(nativeSource).toContain("napi_delete_async_work after queue failure");
    expect(nativeSource).toContain("work.release()");
    expect(nativeSource).toContain(
      "GetWindowThreadProcessId(work->window, &owner_process_id)",
    );
    expect(nativeSource).toContain("owner_process_id == 0");
    expect(nativeSource).toContain(
      "owner_process_id != GetCurrentProcessId()",
    );
    expect(nativeSource).toContain(
      "ABI::Windows::Foundation::AsyncStatus::Started",
    );
    expect(nativeSource).toContain(
      "ABI::Windows::Foundation::AsyncStatus::Completed",
    );
    expect(nativeSource).toContain(
      "ABI::Windows::Foundation::AsyncStatus::Canceled",
    );
    expect(nativeSource).not.toContain("AsyncStatus_Started");

    expect(workflow.indexOf("npm run check")).toBeLessThan(
      workflow.indexOf("npm run dist:win"),
    );
    expect(workflow.indexOf("npm run dist:win")).toBeLessThan(
      workflow.indexOf("verify-windows-package.ps1"),
    );
    expect(verifier.indexOf('$archiveExecutable =')).toBeLessThan(
      verifier.indexOf(
        'Invoke-PackagedSmoke -Executable $archiveExecutable.FullName -Name "zip"',
      ),
    );
    expect(verifier.indexOf("Silent NSIS installation did not create the packaged app executable")).toBeLessThan(
      verifier.indexOf(
        'Invoke-PackagedSmoke -Executable $installedExecutable -Name "nsis-installed"',
      ),
    );
    expect(verifier.indexOf(
      'Invoke-PackagedSmoke -Executable $installedExecutable -Name "nsis-installed"',
    )).toBeLessThan(verifier.indexOf("Silent NSIS uninstallation failed"));
  });
});
