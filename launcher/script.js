(() => {
  "use strict";
  const button = document.getElementById("open-app");
  const status = document.getElementById("launch-status");
  if (!button || !status) return;
  const label = status.querySelector("span");
  let timer = 0;

  button.addEventListener("click", () => {
    window.clearTimeout(timer);
    status.className = "launch-status trying";
    if (label) label.textContent = "正在喚醒 AMZ.API…";
    timer = window.setTimeout(() => {
      status.className = "launch-status fallback";
      if (label) label.textContent = "沒有開啟？請先下載 App，或從「應用程式」手動啟動。";
    }, 1800);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    window.clearTimeout(timer);
    status.className = "launch-status opened";
    if (label) label.textContent = "已送出啟動要求；控制台會在 Mac App 裡開啟。";
  });
})();
