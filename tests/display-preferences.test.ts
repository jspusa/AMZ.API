import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { DisplayPreferencesStore } from "../src/main/display-preferences";

let directory: string | undefined;
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

it("restores chosen display settings in a new Notebook Key process without renderer storage", async () => {
  directory = await mkdtemp(join(tmpdir(), "amz-display-preferences-"));
  const path = join(directory, "display-preferences.json");
  const first = new DisplayPreferencesStore(path);
  expect(await first.read()).toEqual({ fontSize: "standard", accent: "default", mode: "light", imageAuditMinimumImages: 8 });
  await Promise.all([first.update({ fontSize: "large" }), first.update({ accent: "pink", mode: "dark" }), first.update({ imageAuditMinimumImages: 9 })]);
  const restarted = new DisplayPreferencesStore(path);
  expect(await restarted.read()).toEqual({ fontSize: "large", accent: "pink", mode: "dark", imageAuditMinimumImages: 9 });
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ schemaVersion: 1, fontSize: "large", accent: "pink", mode: "dark", imageAuditMinimumImages: 9 });
});

it("rejects arbitrary keys and invalid values without changing existing preferences", async () => {
  directory = await mkdtemp(join(tmpdir(), "amz-display-preferences-"));
  const store = new DisplayPreferencesStore(join(directory, "display-preferences.json"));
  await store.update({ mode: "dark" });
  for (const patch of [{ sellerId: "forbidden" }, { fontSize: "url(x)" }, { imageAuditMinimumImages: 0 }, { imageAuditMinimumImages: 10 }, { imageAuditMinimumImages: 1.5 }, {}, { mode: undefined }]) {
    expect(() => store.update(patch)).toThrow("INVALID_DISPLAY_PREFERENCES");
  }
  expect((await store.read()).mode).toBe("dark");
});

it("reports an unwritable location instead of claiming persistence and keeps future calls usable", async () => {
  directory = await mkdtemp(join(tmpdir(), "amz-display-preferences-"));
  const store = new DisplayPreferencesStore(join(directory, "missing", "display-preferences.json"));
  await expect(store.update({ mode: "dark" })).rejects.toThrow("DISPLAY_PREFERENCES_SAVE_FAILED");
  expect((await store.read()).mode).toBe("light");
});
