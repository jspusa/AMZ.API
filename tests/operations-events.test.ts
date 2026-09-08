import { describe, expect, it } from "vitest";
import { OperationsEvents } from "../src/main/operations-events";
import type { OperationsReadMetadata } from "../src/shared/operations-intelligence";

const observed: OperationsReadMetadata = {
  marketplaceId: "ATVPDKIKX0DER", mode: "live", fetchedAt: "2026-09-08T01:00:00.000Z",
  coverage: "complete", warnings: [], findings: [{
    source: "advertising", key: "signal-one", sellerSku: "TEST-FBA",
    severity: "warning", title: "有花費但沒有歸因銷售", detail: "14 日歸因窗口；不是虧損判定。",
  }],
};

describe("local operations event public lifecycle", () => {
  it("deduplicates an observation and preserves the user's acknowledgement", () => {
    const events = new OperationsEvents({ marketplaceId: observed.marketplaceId, mode: "live" });
    events.observe("advertising", observed);
    const first = events.read().events[0];
    events.acknowledge(first.id, "acknowledged");
    events.observe("advertising", { ...observed, fetchedAt: "2026-09-08T02:00:00.000Z" });
    expect(events.read().events).toEqual([{ ...first, status: "acknowledged", lastObservedAt: "2026-09-08T02:00:00.000Z" }]);
  });
  it("resolves only from complete newer evidence and reopens a recurrence", () => {
    const events = new OperationsEvents({ marketplaceId: observed.marketplaceId, mode: "live" });
    events.observe("advertising", observed);
    events.observe("advertising", { ...observed, coverage: "partial", findings: [], fetchedAt: "2026-09-08T02:00:00.000Z" });
    expect(events.read().events[0].status).toBe("open");
    events.observe("advertising", { ...observed, findings: [], fetchedAt: "2026-09-08T03:00:00.000Z" });
    expect(events.read().events[0].status).toBe("resolved");
    events.observe("advertising", { ...observed, fetchedAt: "2026-09-08T02:30:00.000Z" });
    expect(events.read().events[0].status).toBe("resolved");
    events.observe("advertising", { ...observed, fetchedAt: "2026-09-08T04:00:00.000Z" });
    expect(events.read().events[0].status).toBe("open");
  });
  it("rejects other marketplace/mode and malformed findings atomically; clear discards the session", () => {
    const events = new OperationsEvents({ marketplaceId: observed.marketplaceId, mode: "live" });
    expect(() => events.observe("advertising", { ...observed, mode: "demo" })).toThrow();
    expect(() => events.observe("advertising", { ...observed, marketplaceId: "A1F83G8C2ARO7P" })).toThrow();
    expect(() => events.observe("advertising", { ...observed, findings: [{ ...observed.findings[0], detail: "access_token=canary-private" }] })).toThrow();
    expect(events.read().events).toEqual([]);
    events.observe("advertising", observed);
    events.clear();
    expect(events.read().events).toEqual([]);
  });
  it("bounds visible events and reports omitted records rather than silently dropping alerts", () => {
    const events = new OperationsEvents({ marketplaceId: observed.marketplaceId, mode: "live" });
    events.observe("advertising", { ...observed, findings: Array.from({ length: 501 }, (_, index) => ({ ...observed.findings[0], key: `signal-${index}` })) });
    expect(events.read().events).toHaveLength(500);
    expect(events.read().omittedEventCount).toBe(1);
  });
  it("preserves a verified numeric Seller SKU without confusing it with a private report identifier", () => {
    const events = new OperationsEvents({ marketplaceId: observed.marketplaceId, mode: "live" });
    events.observe("advertising", { ...observed, findings: [{ ...observed.findings[0], sellerSku: "123456789012" }] });
    expect(events.read().events[0].sellerSku).toBe("123456789012");
    expect(() => events.observe("advertising", { ...observed, fetchedAt: "2026-09-08T02:00:00.000Z", findings: [{ ...observed.findings[0], sellerSku: "123\u202e456" }] })).toThrow();
    expect(events.read().events).toHaveLength(1);
  });
});
