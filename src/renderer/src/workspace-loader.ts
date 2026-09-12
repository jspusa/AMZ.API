/** A marker owned by module loading; render errors never gain reload/retry authority. */
export class WorkspaceLoadError extends Error {
  constructor() { super("WORKSPACE_MODULE_UNAVAILABLE"); }
}
function isModuleDownloadFailure(error: unknown): boolean {
  return error instanceof Error && (
    error.name === "ChunkLoadError" ||
    /^(?:Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS for)/i.test(error.message)
  );
}
export function createWorkspaceLoader<T>(importModule: () => Promise<T>) {
  let loaded: Promise<T> | null = null;
  const load = (): Promise<T> => {
    if (!loaded) {
      loaded = importModule().catch((error: unknown) => {
        loaded = null;
        throw isModuleDownloadFailure(error) ? new WorkspaceLoadError() : error;
      });
    }
    // Each React.lazy instance needs its own thenable. React annotates a
    // previously suspended promise; reusing it can starve the new initializer.
    return loaded.then(module => module);
  };
  return { load, preload: () => { void load().catch(() => undefined); } };
}
