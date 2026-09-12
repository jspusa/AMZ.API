import { expect, it, vi } from "vitest";
import { createWorkspaceLoader, WorkspaceLoadError } from "../src/renderer/src/workspace-loader";
it("keeps a module prefetched during the audit available after the published source changes", async () => {
  const module = { default: "fixture module" };
  const source = vi.fn().mockResolvedValueOnce(module).mockRejectedValue(new Error("old published asset removed"));
  const loader = createWorkspaceLoader(source);
  loader.preload();
  await expect(loader.load()).resolves.toBe(module);
  await expect(loader.load()).resolves.toBe(module);
  expect(source).toHaveBeenCalledTimes(1);
});
it("allows an explicit new load after prefetch fails, without retrying automatically", async () => {
  const source = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module: https://example.invalid/workspace.js")).mockResolvedValue({ default: "fixture" });
  const loader = createWorkspaceLoader(source);
  await expect(loader.load()).rejects.toBeInstanceOf(WorkspaceLoadError);
  expect(source).toHaveBeenCalledTimes(1);
  await expect(loader.load()).resolves.toEqual({ default: "fixture" });
  expect(source).toHaveBeenCalledTimes(2);
});
it("preserves module initialization failures without presenting them as download errors", async () => {
  const error = new Error("Module initialization failed");
  const source = vi.fn().mockRejectedValue(error);
  const loader = createWorkspaceLoader(source);
  await expect(loader.load()).rejects.toBe(error);
  expect(source).toHaveBeenCalledTimes(1);
});
