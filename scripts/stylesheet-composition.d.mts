export interface StylesheetComposition {
  readonly canonicalJson: string;
  readonly css: string;
  readonly files: readonly string[];
  readonly fingerprint: string;
}

export interface StylesheetCompositionOptions {
  readonly entryPath: string;
  readonly rootDirectory: string;
  readonly expectedFiles?: readonly string[];
  readonly expectedFingerprint: string;
}

export function verifyStylesheetComposition(
  options: StylesheetCompositionOptions,
): Promise<StylesheetComposition>;
