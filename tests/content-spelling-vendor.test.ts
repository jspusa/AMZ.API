import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROOT = new URL(
  "../src/shared/vendor/spellcheck/",
  import.meta.url,
);
const LICENSE_ROOT = new URL(
  "../src/renderer/public/licenses/spellcheck/",
  import.meta.url,
);

function sha256(path: string): string {
  return createHash("sha256")
    .update(readFileSync(new URL(path, ROOT)))
    .digest("hex");
}

describe("vendored Pages spellchecker", () => {
  it("keeps hash-pinned vendor bytes free of checkout EOL conversion", () => {
    const attributes = readFileSync(
      new URL("../.gitattributes", import.meta.url),
      "utf8",
    );
    for (const path of ["nspell-2.1.5.js", "en_US.aff", "en_US.dic"]) {
      expect(attributes).toContain(
        `src/shared/vendor/spellcheck/${path} -text`,
      );
    }
  });

  it.each([
    [
      "nspell-2.1.5.js",
      "8194144b0fc8754e257332be6d6565e70aa60adbeccdc61abafadfa949eb4269",
    ],
    [
      "en_US.aff",
      "8ae1f19d4840d957728ad90555d5a8dff6cc5c046279c95ff0c00fc0a0136c7b",
    ],
    [
      "en_US.dic",
      "f0b1a234bd178bdd01875b2a392a9647f888b8fe879f79c52aae62c2759b3647",
    ],
  ])("pins %s to the reviewed bytes", (path, expected) => {
    expect(sha256(path)).toBe(expected);
  });

  it.each([
    "nspell-MIT.txt",
    "is-buffer-MIT.txt",
    "dictionary-en-MIT-AND-BSD.txt",
  ])("keeps the complete %s notice", (path) => {
    expect(readFileSync(new URL(path, LICENSE_ROOT), "utf8").length).toBeGreaterThan(500);
  });
});
