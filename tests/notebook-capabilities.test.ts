import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNotebookCapabilitySnapshot } from "../src/shared/notebook-capabilities";
import { readNotebookCapabilities, useNotebookCapabilities } from "../src/renderer/src/notebook-capabilities";

afterEach(() => vi.unstubAllGlobals());

describe("Notebook Key capability negotiation", () => {
  it("uses the explicit main-owned feature snapshot without guessing from version", async () => {
    const version = vi.fn(async () => "0.1.53");
    const result = await readNotebookCapabilities({
      capabilities: async () => createNotebookCapabilitySnapshot("0.1.55"),
      version,
    });
    expect(result).toMatchObject({
      ready: true,
      appVersion: "0.1.55",
      businessPricingBatch: true,
      recentBusinessPricingWork: true,
      message: null,
    });
    expect(version).not.toHaveBeenCalled();
  });

  it.each([
    ["0.1.54", true],
    ["0.1.53", false],
    ["0.1.55", false],
    ["0.2.0", false],
    ["0.1.54-custom", false],
  ])("conservatively supports the known legacy version %s", async (version, batch) => {
    const result = await readNotebookCapabilities({ version: async () => version });
    expect(result.businessPricingBatch).toBe(batch);
    expect(result.recentBusinessPricingWork).toBe(false);
    expect(result.ready).toBe(true);
    expect(result.message).toContain("更新");
  });

  it.each([
    null,
    { schemaVersion: 2, appVersion: "0.1.55", features: { businessPricingBatch: 1, recentBusinessPricingWork: 1 } },
    { schemaVersion: 1, appVersion: "0.1.55", features: { businessPricingBatch: true, recentBusinessPricingWork: 1 } },
    { schemaVersion: 1, appVersion: "0.1.55", features: { businessPricingBatch: 1, recentBusinessPricingWork: 1 }, credentials: "must-not-reach-state" },
  ])("does not fall back to version after an invalid advertised snapshot", async (snapshot) => {
    const version = vi.fn(async () => "0.1.54");
    const result = await readNotebookCapabilities({ capabilities: async () => snapshot, version });
    expect(result).toMatchObject({ ready: true, businessPricingBatch: false, recentBusinessPricingWork: false });
    expect(version).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("must-not-reach-state");
  });

  it("fails closed when the bridge is missing or capability IPC rejects", async () => {
    const missing = await readNotebookCapabilities(undefined);
    const version = vi.fn(async () => "0.1.54");
    const rejected = await readNotebookCapabilities({
      capabilities: async () => { throw new Error("private transport detail"); },
      version,
    });
    for (const result of [missing, rejected]) {
      expect(result).toMatchObject({ ready: true, appVersion: null, businessPricingBatch: false, recentBusinessPricingWork: false });
      expect(JSON.stringify(result)).not.toContain("private transport detail");
    }
    expect(version).not.toHaveBeenCalled();
  });

  it("does not replace current capabilities with a late reply from an earlier bridge", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let resolveEarlier!: (value: unknown) => void;
    const earlier = new Promise<unknown>((resolve) => { resolveEarlier = resolve; });
    const app = { capabilities: () => earlier };
    const browser = { fbaOS: { app } };
    vi.stubGlobal("window", browser);
    function Probe() {
      return createElement("output", null, JSON.stringify(useNotebookCapabilities()));
    }
    let tree!: ReactTestRenderer;
    try {
      await act(async () => { tree = create(createElement(Probe)); });
      expect(tree.root.findByType("output").children.join("")).toContain('"ready":false');
      browser.fbaOS.app = { capabilities: async () => createNotebookCapabilitySnapshot("0.1.55") };
      await act(async () => { tree.update(createElement(Probe)); });
      expect(tree.root.findByType("output").children.join("")).toContain('"businessPricingBatch":true');
      await act(async () => { resolveEarlier(null); });
      expect(tree.root.findByType("output").children.join("")).toContain('"appVersion":"0.1.55"');
    } finally {
      if (tree) await act(async () => tree.unmount());
    }
  });
});
