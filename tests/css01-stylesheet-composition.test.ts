import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("CSS01 renderer stylesheet composition", () => {
  it("loads renderer styles through one ordered composition entry", async () => {
    const mainSource = await readFile(
      new URL("../src/renderer/src/main.tsx", import.meta.url),
      "utf8",
    );
    const stylesheetImports = Array.from(
      mainSource.matchAll(/^\s*import\s+["']([^"']+\.css)["'];?\s*$/gmu),
      (match) => match[1],
    );

    expect(stylesheetImports).toEqual(["./styles/index.css"]);

    const entrySource = await readFile(
      new URL("../src/renderer/src/styles/index.css", import.meta.url),
      "utf8",
    );
    expect(entrySource).toBe('@import "../app.css";\n');
  });
});
