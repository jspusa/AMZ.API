import { Component, Suspense, type ReactNode } from "react";
import { WorkspaceLoadError } from "../workspace-loader";

type Props = { children: ReactNode; onClose: () => void; overlay?: boolean; onRetry?: () => void };

export default class DeferredWorkspace extends Component<Props, { failed: boolean; moduleFailed: boolean }> {
  state = { failed: false, moduleFailed: false };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, moduleFailed: error instanceof WorkspaceLoadError };
  }

  render() {
    const status = (failed: boolean) => {
      const content = <div className="deferred-workspace-status" role={failed ? "alert" : "status"}>
        <p>{failed
          ? this.state.moduleFailed
            ? "工作區元件暫時無法下載。可先重新載入工作區；若介面剛更新，請返回首頁並從設定重新載入介面。"
            : "無法載入此工作區。請返回首頁後再開啟；若持續發生，請回報這項工作區錯誤。"
          : "正在載入工作區…"}</p>
        {failed && this.state.moduleFailed && this.props.onRetry &&
          <button type="button" onClick={this.props.onRetry}>重新載入工作區</button>}
        <button type="button" autoFocus={this.props.overlay} onClick={this.props.onClose}>關閉</button>
      </div>;
      return this.props.overlay ? <div className="drawer-backdrop" role="presentation"
        onMouseDown={(event) => { if (event.target === event.currentTarget) this.props.onClose(); }}>
        <aside className="order-drawer" role="dialog" aria-modal="true" aria-label="工作區載入"
          onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); this.props.onClose(); } }}>
          {content}
        </aside>
      </div> : content;
    };
    return this.state.failed
      ? status(true)
      : <Suspense fallback={status(false)}>{this.props.children}</Suspense>;
  }
}
