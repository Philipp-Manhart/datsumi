import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import { ConnectionForm } from "./app/ConnectionForm";

import "@vscode/codicons/dist/codicon.css";
import "./index.css";

const root = document.querySelector("#root");

if (!root) {
  throw new Error("Missing root element");
}

createRoot(root).render(
  <StrictMode>
    {document.body.dataset.app === "connection" ||
    new URLSearchParams(location.search).get("view") === "connection" ? (
      <ConnectionForm />
    ) : (
      <App />
    )}
  </StrictMode>,
);
