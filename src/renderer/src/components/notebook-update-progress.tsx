import type { UpdateStatus } from "../../../shared/contracts";

function boundedPercent(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value ?? 0)));
}

export default function NotebookUpdateProgress({
  status,
}: {
  status: UpdateStatus;
}) {
  if (status.state !== "downloading") return null;
  const percent = boundedPercent(status.percent);

  return (
    <div className="notebook-update-progress" aria-live="polite">
      <div className="notebook-update-progress-heading">
        <strong>
          正在背景下載安全更新{status.version ? ` v${status.version}` : ""}
        </strong>
        <span>{percent}%</span>
      </div>
      <div
        className="notebook-update-progress-track"
        role="progressbar"
        aria-label="Notebook 鑰匙更新下載進度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <i
          className="notebook-update-progress-fill"
          style={{ width: `${percent}%` }}
          aria-hidden="true"
        />
        <span
          className="notebook-update-skater is-rolling"
          style={{ left: `${percent}%` }}
          aria-hidden="true"
        >
          <i className="sales-skater-person" />
          <i className="sales-skater-board" />
        </span>
      </div>
      <small>下載時可以繼續使用；完成後再由你決定何時重啟。</small>
    </div>
  );
}
