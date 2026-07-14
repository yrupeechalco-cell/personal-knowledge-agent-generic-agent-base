import React from "react";
import ReactDOM from "react-dom/client";
import { KnowledgeWorkspace } from "@knowledge-agent/workspace";
import { createDesktopWorkspaceAdapter } from "./desktopWorkspaceAdapter";
import { DesktopUpdateNotifier } from "./DesktopUpdateNotifier";
import "@knowledge-agent/workspace/styles.css";
import "./desktop-update.css";

const adapter = createDesktopWorkspaceAdapter();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <KnowledgeWorkspace adapter={adapter} />
    <DesktopUpdateNotifier />
  </React.StrictMode>
);
