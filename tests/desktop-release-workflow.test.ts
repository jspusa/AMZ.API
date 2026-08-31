import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("publisher-signed desktop release workflow", () => {
  it("publishes Mac and Windows update metadata only after both signed builds pass", async () => {
    const [workflow, packageSource, windowsVerifier] = await Promise.all([
      readFile(
        new URL("../.github/workflows/desktop-release.yml", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../package.json", import.meta.url), "utf8"),
      readFile(
        new URL("../scripts/verify-windows-package.ps1", import.meta.url),
        "utf8",
      ),
    ]);
    const packageJson = JSON.parse(packageSource) as {
      amzApiUpdateChannel?: string;
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.amzApiUpdateChannel).toBe("disabled");
    expect(packageJson.devDependencies?.["js-yaml"]).toBe("4.3.1");
    expect(workflow).toContain('tags: ["v*.*.*"]');
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain(
      'git merge-base --is-ancestor "$GITHUB_SHA" origin/main',
    );
    expect(workflow).toContain("runs-on: macos-15-intel");
    expect(workflow).toContain("runs-on: windows-2025");
    expect(workflow).toContain("MAC_CSC_LINK");
    expect(workflow).toContain("WIN_CSC_LINK");
    expect(workflow).toContain("WIN_CSC_KEY_PASSWORD");
    expect(workflow).toContain("-c.extraMetadata.amzApiUpdateChannel=publisher-signed-v1");
    expect(workflow).toContain("release/latest-mac.yml");
    expect(workflow).toContain("release/latest.yml");
    expect(workflow).toContain("signtool verify /pa /v");
    expect(workflow).toContain(
      "verify-windows-package.ps1 -SignatureMode Signed",
    );
    expect(workflow).toContain("codesign --verify --deep --strict");
    expect(workflow).toContain("xcrun stapler validate");
    expect(workflow).toContain("needs: [mac, windows]");
    expect(workflow).toContain("PUBLIC_DESKTOP_UPDATE_FEED");
    expect(workflow).toContain("gh release create");
    expect(workflow).toContain(
      "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
    );

    const quality = workflow.indexOf("npm run check");
    const audit = workflow.indexOf("npm audit --omit=dev");
    const macBuild = workflow.indexOf("Build signed macOS update");
    const windowsBuild = workflow.indexOf("Build signed Windows update");
    const publish = workflow.indexOf("Publish verified desktop release");
    const publicFeedApproval = workflow.indexOf(
      'test "$PUBLIC_DESKTOP_UPDATE_FEED" = approved',
    );
    expect(quality).toBeGreaterThan(-1);
    expect(audit).toBeGreaterThan(quality);
    const macJob = workflow.slice(
      workflow.indexOf("  mac:"),
      workflow.indexOf("  windows:"),
    );
    expect(macJob).toContain("run: npm run build");
    expect(macJob.indexOf("run: npm run build")).toBeLessThan(
      macJob.indexOf("Build signed macOS update"),
    );
    expect(macBuild).toBeGreaterThan(audit);
    expect(windowsBuild).toBeGreaterThan(macBuild);
    expect(publish).toBeGreaterThan(windowsBuild);
    expect(publicFeedApproval).toBeGreaterThan(publish);
    expect(workflow.indexOf("gh release create")).toBeGreaterThan(publicFeedApproval);

    expect(windowsVerifier).toContain(
      '[ValidateSet("Unsigned", "Signed")]',
    );
    expect(windowsVerifier).toContain(
      "$signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid",
    );
    expect(windowsVerifier).toContain("SignerCertificate.Thumbprint");
    expect(windowsVerifier).toContain("TimeStamperCertificate");
    expect(windowsVerifier).toContain('require("js-yaml")');
    expect(windowsVerifier).toContain("ConvertFrom-Json");
    expect(windowsVerifier).toContain("[System.StringComparison]::Ordinal");
    expect(windowsVerifier).toContain("$metadataPublisherNames.Count -ne 1");
    expect(windowsVerifier).not.toContain("$appUpdate.Contains($publisherName)");
  });
});
