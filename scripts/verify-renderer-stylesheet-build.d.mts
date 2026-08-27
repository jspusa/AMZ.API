export interface RendererStylesheetBuildOptions {
  readonly expectedFingerprint: string;
  readonly expectedSourceFiles: readonly string[];
  readonly rendererOutDirectory: string;
  readonly sourceEntryPath: string;
  readonly sourceRootDirectory: string;
}

export interface RendererStylesheetBuildResult {
  readonly builtCssFile: string;
  readonly fingerprint: string;
}

export function verifyRendererStylesheetBuild(
  options: RendererStylesheetBuildOptions,
): Promise<RendererStylesheetBuildResult>;
