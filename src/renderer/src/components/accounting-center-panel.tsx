"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  LatestAccountingRequest,
  accountingDateRequirement,
  accountingDatesReady,
  accountingStateKind,
  accountingStateLabel,
  buildAccountingPlanRequest,
  parseAccountingAccessPlanReply,
  parseAccountingCapabilitySnapshot,
  type AccountingAccessPlanReply,
  type AccountingCapabilityView,
} from "../accounting-center";

function message(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const raw = value as Record<string, unknown>;
    if (typeof raw.message === "string" && raw.message.trim()) return raw.message;
  }
  return fallback;
}

function canPlan(capability: AccountingCapabilityView): boolean {
  return ["READY_PUBLIC_API", "READY_CREATE_REPORT", "READY_LIST_GENERATED"].includes(capability.state);
}

const HIDDEN_ACCOUNTING_CAPABILITIES = new Set([
  "SETTLEMENT_V2",
  "BRAZIL_FBA_INVOICES",
]);

export function AccountingCenterPanel({ marketplaceId }: { marketplaceId: string }) {
  const [snapshot, setSnapshot] = useState<ReturnType<typeof parseAccountingCapabilitySnapshot> | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [plans, setPlans] = useState<Record<string, AccountingAccessPlanReply>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const catalogRequests = useRef(new LatestAccountingRequest());
  const planRequests = useRef(new LatestAccountingRequest());

  useEffect(() => {
    const ticket = catalogRequests.current.begin();
    planRequests.current.invalidate();
    setSnapshot(null);
    setPlans({});
    setError(null);
    setBusy("catalog");
    const params = new URLSearchParams({ marketplaceId });
    void fetch(`/api/sp-api/accounting/capabilities?${params}`, {
      cache: "no-store",
      signal: ticket.controller.signal,
    }).then(async (response) => {
      const raw = await response.json() as unknown;
      if (!response.ok) throw new Error(message(raw, "帳務能力清單載入失敗。"));
      const parsed = parseAccountingCapabilitySnapshot(raw);
      if (parsed.marketplaceId !== marketplaceId) throw new Error("帳務能力清單與目前站點不一致。");
      if (!catalogRequests.current.isCurrent(ticket)) return;
      setSnapshot(parsed);
    }).catch((loadError) => {
      if (
        !catalogRequests.current.isCurrent(ticket) ||
        (loadError instanceof Error && loadError.name === "AbortError")
      ) return;
      setError(loadError instanceof Error ? loadError.message : "目前無法載入帳務。");
    }).finally(() => {
      if (!catalogRequests.current.isCurrent(ticket)) return;
      catalogRequests.current.complete(ticket);
      setBusy(null);
    });
    return () => catalogRequests.current.invalidate();
  }, [marketplaceId]);

  useEffect(() => {
    planRequests.current.invalidate();
    setPlans({});
    setError(null);
    setBusy((current) => current === "catalog" ? current : null);
  }, [marketplaceId, startDate, endDate]);

  const visibleSnapshot = snapshot?.marketplaceId === marketplaceId ? snapshot : null;
  const groups = useMemo(() => {
    const capabilities = (visibleSnapshot?.capabilities ?? []).filter(
      (item) => !HIDDEN_ACCOUNTING_CAPABILITIES.has(item.id),
    );
    return {
      ready: capabilities.filter((item) => accountingStateKind(item.state) === "ready"),
      manual: capabilities.filter((item) => accountingStateKind(item.state) === "manual"),
      blocked: capabilities.filter((item) => accountingStateKind(item.state) === "blocked"),
    };
  }, [visibleSnapshot]);

  const changeDate = (field: "start" | "end", value: string) => {
    planRequests.current.invalidate();
    setPlans({});
    setError(null);
    setBusy((current) => current === "catalog" ? current : null);
    if (field === "start") setStartDate(value);
    else setEndDate(value);
  };

  const requestPlan = async (capability: AccountingCapabilityView) => {
    const ticket = planRequests.current.begin();
    setBusy(capability.id);
    setError(null);
    try {
      const response = await fetch("/api/sp-api/accounting/access-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ticket.controller.signal,
        body: JSON.stringify(buildAccountingPlanRequest({
          marketplaceId,
          capabilityId: capability.id,
          startDate,
          endDate,
        })),
      });
      const raw = await response.json() as unknown;
      if (!response.ok) throw new Error(message(raw, "無法建立公開 API 下載規劃。"));
      const parsed = parseAccountingAccessPlanReply(raw);
      if (parsed.capabilityId !== capability.id || parsed.marketplaceId !== marketplaceId) {
        throw new Error("帳務規劃回應與目前選擇不一致。");
      }
      if (!planRequests.current.isCurrent(ticket)) return;
      setPlans((current) => ({ ...current, [capability.id]: parsed }));
    } catch (planError) {
      if (
        !planRequests.current.isCurrent(ticket) ||
        (planError instanceof Error && planError.name === "AbortError")
      ) return;
      setError(planError instanceof Error ? planError.message : "目前無法建立下載規劃。");
    } finally {
      if (!planRequests.current.isCurrent(ticket)) return;
      planRequests.current.complete(ticket);
      setBusy(null);
    }
  };

  const renderCapability = (capability: AccountingCapabilityView) => {
    const plan = plans[capability.id];
    const dateRequirement = accountingDateRequirement(capability.id);
    const datesReady = accountingDatesReady({
      capabilityId: capability.id,
      startDate,
      endDate,
    });
    return (
      <article className={`accounting-capability ${accountingStateKind(capability.state)}`} key={capability.id}>
        <header>
          <div><strong>{capability.label}</strong><small>{accountingStateLabel(capability.state)}</small></div>
          <span>{capability.artifact === "TAB_DELIMITED_REPORT" ? "Amazon report" : capability.artifact === "JSON" ? "API JSON" : "不可下載"}</span>
        </header>
        <p>{capability.notice}</p>
        {capability.reportType && <code>{capability.reportType}</code>}
        {capability.roles.length > 0 && <small>所需角色：{capability.roles.join("、")}</small>}
        <small>依據 Amazon 公開開發者文件</small>
        {canPlan(capability) && (
          <button type="button" onClick={() => void requestPlan(capability)} disabled={Boolean(busy) || !datesReady}>
            {busy === capability.id ? "規劃中…" : "查看 API 下載規劃"}
          </button>
        )}
        {canPlan(capability) && dateRequirement === "START_ONLY_ENDS_NOW" && (
          <small>
            FBA 費用預估只使用開始日，且須至少早於現在 72 小時；結束時間由 Mac main process 固定為送出當下 NOW，不會使用上方的舊日期午夜。
          </small>
        )}
        {canPlan(capability) && dateRequirement === "START_AND_END" && !datesReady && (
          <small>先在上方選擇開始與結束日，才能驗證 Amazon 的日期規則。</small>
        )}
        {canPlan(capability) && dateRequirement === "START_ONLY_ENDS_NOW" && !datesReady && (
          <small>先在上方選擇開始日，才能驗證 Amazon 的 72 小時規則。</small>
        )}
        {plan && (
          <div className="accounting-plan" role="status">
            <strong>{accountingStateLabel(plan.state)}</strong>
            <p>{plan.notice}</p>
            {plan.nextStep && <small>{plan.nextStep}</small>}
          </div>
        )}
      </article>
    );
  };

  return (
    <section className="accounting-center-panel" aria-label="FBA 帳務">
      <p className="eyebrow">PUBLIC API ACCOUNTING</p>
      <h3>帳務</h3>
      <p className="price-intro">集中查看目前工作區真正會用到的 FBA 公開報表規劃；不使用 Seller Central 私有接口，也不把估算資料稱為發票。</p>
      <div className="accounting-date-range">
        <label><span>開始日（需要日期的規劃）</span><input type="date" value={startDate} onChange={(event) => changeDate("start", event.target.value)} /></label>
        <label><span>結束日（Finances／庫齡附加費）</span><input type="date" value={endDate} onChange={(event) => changeDate("end", event.target.value)} /></label>
      </div>
      <p className="subscription-capability-notice">FBA 費用預估的結束時間不能選舊日期；系統固定使用送出當下 NOW，這個結束日欄位只供其他需要完整區間的能力使用。</p>
      {error && <div className="price-error" role="alert">{error}</div>}
      {busy === "catalog" && <div className="validation-status demo" role="status"><strong>正在整理 Amazon 公開 API 能力…</strong></div>}
      {visibleSnapshot && (
        <>
          <section className="accounting-capability-group" aria-labelledby="accounting-ready-title">
            <h4 id="accounting-ready-title">公開 API 可安全規劃</h4>
            <div>{groups.ready.map(renderCapability)}</div>
          </section>
          <section className="accounting-capability-group" aria-labelledby="accounting-manual-title">
            <h4 id="accounting-manual-title">需人工前置</h4>
            <div>{groups.manual.map(renderCapability)}</div>
          </section>
          <section className="accounting-capability-group" aria-labelledby="accounting-boundary-title">
            <h4 id="accounting-boundary-title">目前不可下載／仍缺 FBA 安全過濾</h4>
            <div>{groups.blocked.map(renderCapability)}</div>
          </section>
          <p className="subscription-capability-notice">{visibleSnapshot.notice}</p>
        </>
      )}
    </section>
  );
}

export function AccountingCenterDrawer({
  marketplaceId,
  onClose,
}: {
  marketplaceId: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return createPortal(
    <div
      className="drawer-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="order-drawer accounting-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="accounting-drawer-title"
      >
        <div className="drawer-header">
          <div><p className="eyebrow">FBA · PUBLIC API</p><h2 id="accounting-drawer-title">帳務</h2></div>
          <button type="button" onClick={onClose} autoFocus aria-label="關閉帳務">×</button>
        </div>
        <AccountingCenterPanel marketplaceId={marketplaceId} />
      </aside>
    </div>,
    document.body,
  );
}

export default AccountingCenterPanel;
