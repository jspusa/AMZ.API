import { Component, Suspense, type ReactNode } from "react";

type Props = { children: ReactNode; onClose: () => void; overlay?: boolean };

export default class DeferredWorkspace extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    const status = (failed: boolean) => {
      const content = <div className="deferred-workspace-status" role={failed ? "alert" : "status"}>
        <p>{failed ? "無法載入此工作區，請確認連線後重新開啟 App。" : "正在載入工作區…"}</p>
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
