import { randomUUID } from "node:crypto";
import type { OperationsEvent, OperationsReadMetadata, OperationsSource } from "../shared/operations-intelligence";
import { SpApiError, publicSpApiError } from "./amazon/sp-api-error";

function safeText(value: unknown, limit: number): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= limit &&
    publicSpApiError(new SpApiError(value, { status: 422, code: "OPERATIONS_EVIDENCE_INVALID" }), "營運資料包含不可公開內容。").message === value;
}

// Only current-FBA source owners supply this typed identity. A numeric SKU is
// public product identity, not unstructured error text or a report identifier.
function safeSellerSku(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 40 && value === value.trim() &&
    !/[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/u.test(value);
}

/** A memory-only event ledger owned by one exact coordinator context. */
export class OperationsEvents {
  private readonly events = new Map<string, OperationsEvent>();
  private readonly lastObservation = new Map<OperationsSource, number>();
  constructor(private readonly identity: { marketplaceId: string; mode: "live" | "demo" }) {}

  observe(source: OperationsSource, snapshot: OperationsReadMetadata): void {
    const timestamp = Date.parse(snapshot.fetchedAt);
    const keys = new Set<string>();
    if (snapshot.marketplaceId !== this.identity.marketplaceId || snapshot.mode !== this.identity.mode ||
      !Number.isFinite(timestamp) || !["complete", "partial"].includes(snapshot.coverage) ||
      snapshot.findings.length > 5_000 || snapshot.findings.some((finding) => {
        if (keys.has(finding.key)) return true;
        keys.add(finding.key);
        return finding.source !== source || !safeText(finding.key, 180) ||
          !safeText(finding.title, 160) || !safeText(finding.detail, 1_024) ||
          !["info", "warning", "critical"].includes(finding.severity) ||
          (finding.sellerSku !== null && !safeSellerSku(finding.sellerSku));
      })) {
      throw new SpApiError("營運通知證據不完整或安全脈絡不符。", { status: 422, code: "OPERATIONS_EVIDENCE_INVALID" });
    }
    if (timestamp <= (this.lastObservation.get(source) ?? -Infinity)) return;
    const present = new Set(snapshot.findings.map((finding) => JSON.stringify([source, finding.key])));
    if (snapshot.coverage === "complete") {
      for (const [key, event] of this.events) {
        if (event.source === source && !present.has(key)) {
          this.events.set(key, { ...event, status: "resolved", lastObservedAt: snapshot.fetchedAt });
        }
      }
    }
    for (const finding of snapshot.findings) {
      const key = JSON.stringify([source, finding.key]);
      const previous = this.events.get(key);
      this.events.set(key, {
        ...finding,
        id: previous?.id ?? `event.${randomUUID()}`,
        firstObservedAt: previous?.firstObservedAt ?? snapshot.fetchedAt,
        lastObservedAt: snapshot.fetchedAt,
        status: previous?.status === "resolved" ? "open" : previous?.status ?? "open",
        observation: "local-sync",
      });
    }
    this.lastObservation.set(source, timestamp);
    // Retain a bounded session history; unresolved entries are retained first.
    if (this.events.size > 5_000) {
      const oldest = [...this.events.entries()].sort(([, a], [, b]) =>
        Number(b.status === "resolved") - Number(a.status === "resolved") ||
        a.lastObservedAt.localeCompare(b.lastObservedAt));
      for (const [key] of oldest.slice(0, this.events.size - 5_000)) this.events.delete(key);
    }
  }

  acknowledge(id: string, status: "open" | "acknowledged"): boolean {
    for (const [key, event] of this.events) {
      if (event.id === id && event.status !== "resolved") {
        this.events.set(key, { ...event, status });
        return true;
      }
    }
    return false;
  }

  read(): { events: readonly OperationsEvent[]; omittedEventCount: number } {
    const ordered = [...this.events.values()].sort((a, b) =>
      Number(a.status === "resolved") - Number(b.status === "resolved") ||
      b.lastObservedAt.localeCompare(a.lastObservedAt));
    return { events: ordered.slice(0, 500).map((event) => ({ ...event })), omittedEventCount: Math.max(0, ordered.length - 500) };
  }

  clear(): void {
    this.events.clear();
    this.lastObservation.clear();
  }
}
