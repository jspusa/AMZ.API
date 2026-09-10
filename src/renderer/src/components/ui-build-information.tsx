import { useRef } from "react";
import { loadedUiBuild, requestUiReload } from "../ui-build";

export default function UiBuildInformation({ blockedReason = null }: { blockedReason?: string | null }) {
  const latestReason = useRef(blockedReason);
  latestReason.current = blockedReason;
  const build = loadedUiBuild();
  return <section className="ui-build-information" aria-label="目前載入的網頁介面版本">
    <div><h3>網頁介面版本</h3>
      <strong>{build.revision ? build.revision.slice(0, 8) : "本機開發版本"}</strong>
      {build.builtAt && <time dateTime={build.builtAt}>{new Intl.DateTimeFormat("zh-TW", {
        timeZone: "Asia/Taipei", dateStyle: "short", timeStyle: "short", hour12: false,
      }).format(new Date(build.builtAt))} · 台北</time>}
    </div>
    <button type="button" disabled={Boolean(blockedReason)} onClick={() => {
      requestUiReload(() => Boolean(latestReason.current),
        () => window.confirm("重新載入介面會結束本次篩選與畫面位置紀錄。請確認已處理未儲存內容；不會更新或重新安裝 Notebook Key。確定重新載入？"),
        () => window.location.reload());
    }}>重新載入介面</button>
    {blockedReason && <small role="status">{blockedReason}</small>}
  </section>;
}
