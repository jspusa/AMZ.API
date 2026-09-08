import { useId, useState } from "react";
import {
  readUiAppearance, saveUiAppearance, UI_ACCENT_OPTIONS, type UiAppearance,
} from "../ui-appearance";

export default function AppearancePreference() {
  const id = useId();
  const [appearance, setAppearance] = useState<UiAppearance>(() => readUiAppearance());
  const [persisted, setPersisted] = useState(true);
  const choose = (next: UiAppearance) => {
    setAppearance(next);
    setPersisted(saveUiAppearance(next));
  };

  return (
    <section className="appearance-preference" aria-labelledby={`${id}-title`}>
      <div className="appearance-heading">
        <p className="eyebrow">個人化</p>
        <h3 id={`${id}-title`}>介面顏色</h3>
        <p>立即套用，只保存這個介面的顯示偏好。</p>
      </div>
      <fieldset className="appearance-colors">
        <legend>主色系</legend>
        <div className="appearance-options">
          {UI_ACCENT_OPTIONS.map((option) => (
            <label className="appearance-option" key={option.value}>
              <input
                type="radio"
                name={`${id}-accent`}
                value={option.value}
                checked={appearance.accent === option.value}
                onChange={() => choose({ ...appearance, accent: option.value })}
              />
              <span className="appearance-option-surface">
                <span className={`appearance-swatch is-${option.value}`} aria-hidden="true" />
                <span className="appearance-option-copy">
                  <strong>{option.label}</strong><small>{option.description}</small>
                </span>
                <span className="appearance-check" aria-hidden="true">✓</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="appearance-mode">
        <span><strong>深色模式</strong><small>可搭配原色或粉紅色，不改變商品圖片。</small></span>
        <input
          type="checkbox"
          role="switch"
          aria-label="深色模式"
          checked={appearance.mode === "dark"}
          onChange={(event) => choose({ ...appearance, mode: event.target.checked ? "dark" : "light" })}
        />
      </label>
      {!persisted && <p className="appearance-storage-note" role="status">已套用；目前無法儲存偏好，重新開啟後可能恢復預設。</p>}
    </section>
  );
}
