import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installApiBridge } from "./api-bridge";
import "./app.css";

installApiBridge();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
