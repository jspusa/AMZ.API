import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("CSS visual baseline scenario registry", () => {
  it("owns scenario selection, evidence, surfaces, and capture accounting in one seam", async () => {
    const source = await readFile(
      fileURLToPath(
        new URL(
          "../scripts/visual-qa/renderer-visual-baseline.js",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(source).toContain("const visualScenarios = [");
    expect(source).toContain("const visualScenario = visualScenarios.find(");
    expect(source).toContain("switch (visualScenario.key)");
    expect(source).toContain("visualScenario.evidenceDirectory");
    expect(source).toContain("visualScenario.surfaces");
    expect(source).toContain("visualScenario.expectedCaptures");
    expect(source).not.toMatch(/\bcss0[23]Extra\b/u);
  });
});
