import { open, readFile, rename, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { DEFAULT_DISPLAY_PREFERENCES, parseDisplayPreferences, parseDisplayPreferencesPatch, type DisplayPreferences } from "../shared/display-preferences";

/** Owns a separate, bounded cosmetic settings file; never touches the vault or write ledger. */
export class DisplayPreferencesStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly path: string) {}

  async read(): Promise<DisplayPreferences> {
    await this.queue.catch(() => undefined);
    return this.readFile();
  }

  update(input: unknown): Promise<DisplayPreferences> {
    // Validate and copy before queuing, so a caller cannot mutate queued input.
    const patch = parseDisplayPreferencesPatch(input);
    const work = this.queue.catch(() => undefined).then(async () => {
      const current = await this.readFile();
      const next = Object.freeze({ ...current, ...patch });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try {
        const file = await open(temporary, "wx", 0o600);
        try {
          await file.writeFile(JSON.stringify({ schemaVersion: 1, ...next }), "utf8");
          await file.sync();
        } finally { await file.close(); }
        await rename(temporary, this.path);
      } catch {
        throw new Error("DISPLAY_PREFERENCES_SAVE_FAILED");
      } finally { await rm(temporary, { force: true }).catch(() => undefined); }
      return next;
    });
    this.queue = work;
    return work;
  }

  private async readFile(): Promise<DisplayPreferences> {
    try {
      if ((await stat(this.path)).size > 2048) throw new Error("INVALID_DISPLAY_PREFERENCES");
      const raw = JSON.parse(await readFile(this.path, "utf8"));
      if (raw?.schemaVersion !== 1) throw new Error("INVALID_DISPLAY_PREFERENCES");
      const { schemaVersion: _version, ...settings } = raw;
      return parseDisplayPreferences(settings);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return DEFAULT_DISPLAY_PREFERENCES;
      // Invalid or unreadable existing settings are not silently overwritten.
      throw new Error("DISPLAY_PREFERENCES_READ_FAILED");
    }
  }
}
