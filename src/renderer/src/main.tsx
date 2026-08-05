import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installApiBridge } from "./api-bridge";
import WebGate from "./web-gate";
import "./app.css";

const hasMacBridge = Boolean(window.fbaOS?.api && window.fbaOS?.credentials);
if (hasMacBridge) installApiBridge();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {hasMacBridge ? <App /> : <WebGate />}
  </StrictMode>,
);
