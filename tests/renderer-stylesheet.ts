import { fileURLToPath } from "node:url";
import {
  verifyStylesheetComposition,
  type StylesheetComposition,
} from "../scripts/stylesheet-composition.mjs";
import { RENDERER_STYLESHEET_CONTRACT } from "../scripts/renderer-stylesheet-contract.mjs";

let compositionPromise: Promise<StylesheetComposition> | undefined;

export async function readRendererStylesheet(): Promise<string> {
  compositionPromise ??= verifyStylesheetComposition({
    entryPath: fileURLToPath(
      new URL("../src/renderer/src/styles/index.css", import.meta.url),
    ),
    rootDirectory: fileURLToPath(
      new URL("../src/renderer/src/", import.meta.url),
    ),
    expectedFiles: RENDERER_STYLESHEET_CONTRACT.expectedFiles,
    expectedFingerprint: RENDERER_STYLESHEET_CONTRACT.fingerprint,
  });

  return (await compositionPromise).css;
}
