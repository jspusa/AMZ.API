declare const __AMZ_UI_BUILD__: { revision: string; builtAt: string } | undefined;

export type UiBuild = Readonly<{ revision: string; builtAt: string }>;
export function loadedUiBuild(): UiBuild {
  const build = typeof __AMZ_UI_BUILD__ === "undefined" ? null : __AMZ_UI_BUILD__;
  return {
    revision: build && /^[a-f0-9]{40}$/u.test(build.revision) ? build.revision : "",
    builtAt: build && Number.isFinite(Date.parse(build.builtAt)) ? build.builtAt : "",
  };
}

/** Recheck the current guard after the user dismisses the confirmation. */
export function requestUiReload(blocked: () => boolean, confirm: () => boolean, reload: () => void): boolean {
  if (blocked() || !confirm() || blocked()) return false;
  reload();
  return true;
}
