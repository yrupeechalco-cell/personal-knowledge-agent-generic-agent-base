import React from "react";
import ReactDOM from "react-dom/client";
import { KnowledgeWorkspace } from "@knowledge-agent/workspace";
import { createDesktopWorkspaceAdapter } from "./desktopWorkspaceAdapter";
import "@knowledge-agent/workspace/styles.css";

const adapter = createDesktopWorkspaceAdapter();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <KnowledgeWorkspace adapter={adapter} />
  </React.StrictMode>
);
