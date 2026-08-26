import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("macOS unsigned packaging workflow", () => {
  it("bounds the exact packaged app process-tree shutdown before DMG creation", async () => {
    const workflow = await readFile(
      new URL("../.github/workflows/mac-dev.yml", import.meta.url),
      "utf8",
    );
    const smokeStart = workflow.indexOf(
      "      - name: Ad-hoc sign and verify test app",
    );
    const dmgStart = workflow.indexOf("      - name: Create test DMG and ZIP");
    const smokeStep = workflow.slice(smokeStart, dmgStart);
    const launch = smokeStep.indexOf(
      'python3 - "$app_path/Contents/MacOS/$executable"',
    );
    const capturedPid = smokeStep.indexOf('app_pid="$!"', launch);
    const groupHandshake = smokeStep.indexOf(
      'launch_pgid="$(ps -o pgid= -p "$app_pid"',
      capturedPid,
    );
    const readinessLoop = smokeStep.indexOf("bridge_ready=false", groupHandshake);
    const cleanupDefinition = smokeStep.indexOf("cleanup_app() {");
    const trapSetup = smokeStep.indexOf(
      "trap cleanup_app EXIT",
      cleanupDefinition,
    );
    const cleanupBody = smokeStep.slice(cleanupDefinition, trapSetup);
    const cleanupStatusSetup = smokeStep.lastIndexOf("cleanup_status=0");
    const explicitCleanup = smokeStep.lastIndexOf(
      "cleanup_app || cleanup_status=$?",
    );
    const trapRemoved = smokeStep.lastIndexOf("trap - EXIT");
    const stopLauncherCall = cleanupBody.indexOf("stop_launcher || return 1");
    const bundleScanCall = cleanupBody.indexOf(
      "bundle_processes_live || bundle_scan_status=$?",
    );

    expect(smokeStart).toBeGreaterThanOrEqual(0);
    expect(dmgStart).toBeGreaterThan(smokeStart);
    expect(smokeStep).toContain(
      'app_path="$(cd "$(dirname "$app_path")" && pwd -P)/$(basename "$app_path")"',
    );
    expect(smokeStep).toContain('app_contents_path="$app_path/Contents/"');
    expect(smokeStep).toContain("os.setsid()");
    expect(smokeStep).toContain("os.execv(sys.argv[1], sys.argv[1:])");
    expect(smokeStep).toContain("pid_live()");
    expect(smokeStep).toContain("group_live()");
    expect(smokeStep).toContain("bundle_processes_live()");
    expect(smokeStep).toContain('case "$process_line" in');
    expect(smokeStep).toContain('*"$app_contents_path"*) return 0');
    expect(smokeStep).toContain(
      'if ! process_snapshot="$(ps -wwaxo stat=,command=)"; then',
    );
    expect(smokeStep).toContain('kill -TERM "$app_pid"');
    expect(smokeStep).toContain('kill -KILL "$app_pid"');
    expect(smokeStep).toContain('kill -TERM -- "-$app_pid"');
    expect(smokeStep).toContain('kill -KILL -- "-$app_pid"');
    expect(smokeStep).toContain('[[ "$attempt" -lt 10 ]]');
    expect(smokeStep).toContain('[[ "$attempt" -lt 15 ]]');
    expect(smokeStep).toContain('[[ "$attempt" -lt 5 ]]');
    expect(smokeStep).toContain('[[ "$launch_pgid" == "$app_pid" ]]');
    expect(smokeStep).toContain("group_ready=true");
    expect(smokeStep).toContain(
      "Packaged app process group was not established.",
    );
    expect(smokeStep).toContain(
      'sleep 1\n          if ! pid_live || ! group_live; then\n            cat "$smoke_log"\n            echo "Mac Bridge became ready but its launcher or process group exited."',
    );
    expect(smokeStep).toContain(
      "Packaged Mac app bundle still has a live process.",
    );
    expect(smokeStep).toContain("trap cleanup_app EXIT");
    expect(cleanupDefinition).toBeGreaterThanOrEqual(0);
    expect(trapSetup).toBeGreaterThan(cleanupDefinition);
    expect(stopLauncherCall).toBeGreaterThanOrEqual(0);
    expect(bundleScanCall).toBeGreaterThan(stopLauncherCall);
    expect(cleanupBody).toContain('[[ "$bundle_scan_status" -ne 1 ]]');
    expect(launch).toBeGreaterThanOrEqual(0);
    expect(capturedPid).toBeGreaterThan(launch);
    expect(groupHandshake).toBeGreaterThan(capturedPid);
    expect(readinessLoop).toBeGreaterThan(groupHandshake);
    expect(cleanupStatusSetup).toBeGreaterThan(readinessLoop);
    expect(explicitCleanup).toBeGreaterThan(cleanupStatusSetup);
    expect(trapRemoved).toBeGreaterThan(explicitCleanup);
  });
});
