import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const shellTest = process.platform === "win32" ? it.skip : it;
const harnessRoots: string[] = [];

function normalizeShellSource(source: string): string {
  return source.replace(/\r\n?/g, "\n");
}

afterEach(() => {
  for (const root of harnessRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function writeExecutable(path: string, source: string): void {
  writeFileSync(path, source, "utf8");
  chmodSync(path, 0o755);
}

function runArtifactScript(hdiutilSource: string) {
  const root = mkdtempSync(join(tmpdir(), "amz-macos-artifacts-"));
  harnessRoots.push(root);
  const fakeBin = join(root, "bin");
  const appPath = join(root, "AMZ.API.app");
  const outputDirectory = join(root, "release");
  const attemptFile = join(root, "hdiutil-attempts");
  const attemptOutputsFile = join(root, "hdiutil-outputs");
  mkdirSync(fakeBin, { recursive: true });
  mkdirSync(join(appPath, "Contents", "MacOS"), { recursive: true });

  writeExecutable(join(fakeBin, "hdiutil"), hdiutilSource);
  writeExecutable(
    join(fakeBin, "sleep"),
    `#!/bin/bash
exit 0
`,
  );
  writeExecutable(
    join(fakeBin, "sync"),
    `#!/bin/bash
exit 0
`,
  );
  writeExecutable(
    join(fakeBin, "ditto"),
    `#!/bin/bash
set -euo pipefail
if [[ "$#" -eq 2 ]]; then
  cp -R "$1" "$2"
  exit 0
fi
output="\${!#}"
: >"$output"
`,
  );

  const scriptPath = fileURLToPath(
    new URL("../scripts/create-macos-test-artifacts.sh", import.meta.url),
  );
  const result = spawnSync(
    "/bin/bash",
    [scriptPath, appPath, "0.1.31", outputDirectory],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        FAKE_HDIUTIL_ATTEMPTS: attemptFile,
        FAKE_HDIUTIL_OUTPUTS: attemptOutputsFile,
        PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      },
      timeout: 10_000,
    },
  );

  return {
    attemptFile,
    attemptOutputsFile,
    outputDirectory,
    root,
    result,
  };
}

const countedHdiutilPreamble = `#!/bin/bash
set -euo pipefail
attempt=0
if [[ -f "$FAKE_HDIUTIL_ATTEMPTS" ]]; then
  attempt="$(<"$FAKE_HDIUTIL_ATTEMPTS")"
fi
attempt=$((attempt + 1))
printf '%s' "$attempt" >"$FAKE_HDIUTIL_ATTEMPTS"
output="\${!#}"
printf '%s\\n' "$output" >>"$FAKE_HDIUTIL_OUTPUTS"
`;

describe("macOS test artifact packaging", () => {
  it("keeps the hdiutil mitigation exact, bounded and isolated", () => {
    const scriptSource = readFileSync(
      fileURLToPath(
        new URL("../scripts/create-macos-test-artifacts.sh", import.meta.url),
      ),
      "utf8",
    );
    const script = normalizeShellSource(scriptSource);

    const stageCopy = script.indexOf(
      'ditto "$app_path" "$stage/AMZ.API.app"',
    );
    const retryLoop = script.indexOf('while [[ "$attempt" -le 3 ]]');

    expect(normalizeShellSource(scriptSource.replace(/\r?\n/g, "\r\n"))).toBe(
      script,
    );
    expect(script).toContain(
      'artifact_root="$(mktemp -d "$output_directory/.amz-api-dmg.XXXXXX")"',
    );
    expect(script).toContain('ditto "$app_path" "$stage/AMZ.API.app"');
    expect(script).toContain("\nsync\n");
    expect(script).toContain("    -nospotlight \\\n");
    expect(script).toContain(
      'attempt_dmg="$artifact_root/AMZ.API-$version-universal-attempt-$attempt.dmg"',
    );
    expect(script).toContain(
      'grep -Fqx "hdiutil: create failed - Resource busy"',
    );
    expect(script).toContain('sleep "$((attempt * 2))"');
    expect(script).toContain('[[ "$attempt" -ge 3 ]]');
    expect(stageCopy).toBeGreaterThanOrEqual(0);
    expect(retryLoop).toBeGreaterThan(stageCopy);
    expect(script.slice(retryLoop)).not.toContain(
      'ditto "$app_path" "$stage/AMZ.API.app"',
    );
  });

  shellTest("recovers from one exact transient hdiutil Resource busy failure", () => {
    const harness = runArtifactScript(`${countedHdiutilPreamble}
if [[ "$attempt" -eq 1 ]]; then
  : >"$output"
  echo "hdiutil: create failed - Resource busy" >&2
  exit 1
fi
: >"$output"
`);

    expect(harness.result.status, harness.result.stderr).toBe(0);
    expect(readFileSync(harness.attemptFile, "utf8")).toBe("2");
    const attemptOutputs = readFileSync(
      harness.attemptOutputsFile,
      "utf8",
    )
      .trim()
      .split("\n");
    expect(attemptOutputs).toHaveLength(2);
    expect(new Set(attemptOutputs).size).toBe(2);
    expect(attemptOutputs.every((path) => !existsSync(path))).toBe(true);
    expect(
      existsSync(
        join(harness.outputDirectory, "AMZ.API-0.1.31-universal.dmg"),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(harness.outputDirectory, "AMZ.API-0.1.31-universal.zip"),
      ),
    ).toBe(true);
  });

  shellTest("does not retry a non-Resource-busy hdiutil failure", () => {
    const harness = runArtifactScript(`${countedHdiutilPreamble}
echo "hdiutil: create failed - No space left on device" >&2
exit 9
`);

    expect(harness.result.status).toBe(9);
    expect(harness.result.stderr).toContain("No space left on device");
    expect(readFileSync(harness.attemptFile, "utf8")).toBe("1");
    expect(
      existsSync(
        join(harness.outputDirectory, "AMZ.API-0.1.31-universal.dmg"),
      ),
    ).toBe(false);
    expect(
      existsSync(
        join(harness.outputDirectory, "AMZ.API-0.1.31-universal.zip"),
      ),
    ).toBe(false);
  });

  shellTest("bounds exact Resource busy retries at three attempts", () => {
    const harness = runArtifactScript(`${countedHdiutilPreamble}
echo "hdiutil: create failed - Resource busy" >&2
exit 1
`);

    expect(harness.result.status).toBe(1);
    expect(harness.result.stderr).toContain("Resource busy");
    expect(readFileSync(harness.attemptFile, "utf8")).toBe("3");
    expect(
      existsSync(
        join(harness.outputDirectory, "AMZ.API-0.1.31-universal.dmg"),
      ),
    ).toBe(false);
    expect(
      existsSync(
        join(harness.outputDirectory, "AMZ.API-0.1.31-universal.zip"),
      ),
    ).toBe(false);
  });
});
