import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

type Step = {
  uses?: string;
  run?: string;
  if?: string;
  "continue-on-error"?: boolean;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
};

const { load } = createRequire(import.meta.url)("js-yaml") as {
  load: (source: string) => {
    on: Record<string, unknown>;
    jobs: { deploy: { steps: Step[] } };
  };
};

describe("Pages publication validation", () => {
  it("requires successful checks of the exact deployed source for every trigger", async () => {
    const workflow = load(await readFile(
      new URL("../.github/workflows/pages.yml", import.meta.url), "utf8",
    ));
    expect(Object.keys(workflow.on).sort()).toEqual([
      "issues", "push", "workflow_dispatch",
    ]);
    const { steps } = workflow.jobs.deploy;
    const checks = steps.findIndex((step) => step.run === "npm run check");
    expect(checks).toBeGreaterThan(-1);
    expect(steps[checks].if).toBeUndefined();
    expect(steps[checks]["continue-on-error"]).toBeUndefined();

    const checkouts = steps.filter((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkouts).toHaveLength(1);
    expect(checkouts[0].with?.ref).toBe("${{ github.sha }}");
    expect(steps.indexOf(checkouts[0])).toBeLessThan(checks);

    const upload = steps.findIndex((step) => step.uses?.startsWith("actions/upload-pages-artifact@"));
    const deploy = steps.findIndex((step) => step.env?.PAGES_BUILD_VERSION !== undefined);
    const announcement = steps.findIndex((step) => step.run === "node scripts/build-github-operations-board.mjs");
    expect(announcement).toBeGreaterThan(checks);
    expect(upload).toBeGreaterThan(announcement);
    expect(deploy).toBeGreaterThan(upload);
    expect(steps[deploy].env?.PAGES_BUILD_VERSION).toBe("${{ github.sha }}");
    for (const step of steps.slice(checks, deploy + 1)) {
      expect(step.if ?? "").not.toMatch(/always\(|failure\(/u);
      expect(step["continue-on-error"]).not.toBe(true);
    }
  });
});
