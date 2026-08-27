export interface RendererStylesheetContract {
  readonly expectedFiles: readonly string[];
  readonly fingerprint: string;
}

export const RENDERER_STYLESHEET_CONTRACT: RendererStylesheetContract;
